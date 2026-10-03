'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { usePublicStore } from '@/store/public-store'
import { FloorSelector } from '@/components/map/FloorSelector'
import { RouteLine } from '@/components/map/RouteLine'
import { useOptionalNavigationContext } from '@/components/map/NavigationContext'
import type { Building, LatLng, CampusBundle } from '@/types/nav-types'

const OSM_STYLE = {
  version: 8 as const,
  sources: {
    osm: {
      type: 'raster' as const,
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '&copy; OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster' as const, source: 'osm' as const }],
}

const SRC = {
  BUILDINGS: 'campus-buildings',
  BOUNDARY: 'campus-boundary',
  ENTRANCES: 'campus-entrances',
  EDGES: 'campus-edges',
} as const

const LYR = {
  BUILDINGS_FILL: 'campus-buildings-fill',
  BUILDINGS_EXTRUSION: 'campus-buildings-extrusion',
  BUILDINGS_OUTLINE: 'campus-buildings-outline',
  BUILDINGS_LABELS: 'campus-buildings-labels',
  BOUNDARY_FILL: 'campus-boundary-fill',
  BOUNDARY_OUTLINE: 'campus-boundary-outline',
  ENTRANCES: 'campus-entrances',
  EDGES_LINE: 'campus-edges-line',
} as const

interface CampusMapProps {
  /** Route overlay: node ids in order. */
  route?: { path: string[]; cost: number } | null
  /** Expose the Map instance to parents (for RouteLine/fitBounds etc). */
  onMapReady?: (map: maplibregl.Map) => void
  /** Initial camera. */
  center?: [number, number]
  zoom?: number
  /** Whether to auto-fit to campus bounds when data arrives. */
  autoFit?: boolean
  /** Show building labels on the map. */
  showLabels?: boolean
}

function footprintCoords(b: Building): [number, number][] {
  return (b.outline ?? b.footprint ?? []).map((p) => [p.lng, p.lat] as [number, number])
}

/** T2 CampusBundle has no boundary polygon — derive one from its bounding box. */
function boundaryFromBundle(campus: CampusBundle | null | undefined): { points: LatLng[] } | undefined {
  const bb = campus?.boundingBox
  if (!bb) return undefined
  return {
    points: [
      { lat: bb.minLat, lng: bb.minLng },
      { lat: bb.minLat, lng: bb.maxLng },
      { lat: bb.maxLat, lng: bb.maxLng },
      { lat: bb.maxLat, lng: bb.minLng },
    ],
  }
}

function addMapSources(map: maplibregl.Map, showLabels: boolean) {
  if (map.getSource(SRC.BUILDINGS)) return

  map.addSource(SRC.BUILDINGS, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  map.addLayer({ id: LYR.BUILDINGS_FILL, type: 'fill', source: SRC.BUILDINGS, paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.25 } })
  map.addLayer({ id: LYR.BUILDINGS_OUTLINE, type: 'line', source: SRC.BUILDINGS, paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-opacity': 0.9 } })
  map.addLayer({
    id: LYR.BUILDINGS_EXTRUSION,
    type: 'fill-extrusion',
    source: SRC.BUILDINGS,
    paint: {
      'fill-extrusion-color': ['get', 'color'],
      'fill-extrusion-height': ['get', 'height'],
      'fill-extrusion-base': ['get', 'base_elevation'],
      'fill-extrusion-opacity': 0.55,
    },
  })
  if (showLabels) {
    map.addLayer({
      id: LYR.BUILDINGS_LABELS,
      type: 'symbol',
      source: SRC.BUILDINGS,
      layout: { 'text-field': ['get', 'name'], 'text-size': 12, 'text-offset': [0, 1.2], 'text-anchor': 'top' },
      paint: { 'text-color': '#0F172A', 'text-halo-color': '#FFFFFF', 'text-halo-width': 2 },
    })
  }

  map.addSource(SRC.BOUNDARY, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  map.addLayer({ id: LYR.BOUNDARY_FILL, type: 'fill', source: SRC.BOUNDARY, paint: { 'fill-color': '#94A3B8', 'fill-opacity': 0.15 } })
  map.addLayer({ id: LYR.BOUNDARY_OUTLINE, type: 'line', source: SRC.BOUNDARY, paint: { 'line-color': '#94A3B8', 'line-width': 2, 'line-dasharray': [4, 2], 'line-opacity': 0.5 } })

  map.addSource(SRC.ENTRANCES, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  map.addLayer({ id: LYR.ENTRANCES, type: 'circle', source: SRC.ENTRANCES, paint: { 'circle-radius': 5, 'circle-color': '#8B5CF6', 'circle-stroke-width': 2, 'circle-stroke-color': '#FFFFFF' } })

  map.addSource(SRC.EDGES, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  map.addLayer({
    id: LYR.EDGES_LINE,
    type: 'line',
    source: SRC.EDGES,
    paint: {
      'line-color': '#64748B',
      'line-width': 2,
      'line-opacity': 0.7,
    },
  })
}

function syncBuildings(map: maplibregl.Map, buildings: Building[]) {
  const src = map.getSource(SRC.BUILDINGS) as maplibregl.GeoJSONSource | undefined
  if (!src) return
  const features = buildings
    // Skip virtual/container buildings (e.g., __outdoor__ is a catch-all for
    // outdoor waypoints, not an actual building to render on the map).
    .filter((b) => b.id !== '__outdoor__' && b.name !== '__outdoor__')
    .filter((b) => footprintCoords(b).length >= 3)
    .map((b) => ({
      type: 'Feature' as const,
      id: b.id,
      properties: {
        id: b.id,
        name: b.name,
        color: b.color ?? '#1C6BEB',
        height: b.height ?? 10,
        base_elevation: b.baseElevation ?? 0,
      },
      geometry: {
        type: 'Polygon' as const,
        coordinates: [footprintCoords(b)],
      },
    }))
  src.setData({ type: 'FeatureCollection', features })
  map.triggerRepaint()
}

function syncBoundary(map: maplibregl.Map, boundary: { points: LatLng[] } | null | undefined) {
  const src = map.getSource(SRC.BOUNDARY) as maplibregl.GeoJSONSource | undefined
  if (!src) return
  if (!boundary?.points || boundary.points.length < 2) {
    src.setData({ type: 'FeatureCollection', features: [] })
    return
  }
  // boundary.points may be a bbox (2 points) or a polygon ring; draw a rectangle for bbox
  const pts = boundary.points
  let ring: [number, number][]
  if (pts.length === 2) {
    const [a, b] = pts
    ring = [
      [a.lng, a.lat], [b.lng, a.lat], [b.lng, b.lat], [a.lng, b.lat], [a.lng, a.lat],
    ]
  } else {
    ring = pts.map((p) => [p.lng, p.lat] as [number, number])
    if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) {
      ring = [...ring, ring[0]]
    }
  }
  src.setData({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: {} }],
  })
}

function syncEntrances(map: maplibregl.Map, buildings: Building[]) {
  const src = map.getSource(SRC.ENTRANCES) as maplibregl.GeoJSONSource | undefined
  if (!src) return
  const features = buildings.flatMap((b) =>
    (b.entrances ?? []).map((e) => ({
      type: 'Feature' as const,
      properties: { id: e.id, building: b.name, label: e.label ?? b.name, floor: e.floor },
      geometry: { type: 'Point' as const, coordinates: [e.position.lng, e.position.lat] as [number, number] },
    })),
  )
  src.setData({ type: 'FeatureCollection', features })
}

function syncEdges(map: maplibregl.Map, campus: CampusBundle | null | undefined) {
  const src = map.getSource(SRC.EDGES) as maplibregl.GeoJSONSource | undefined
  if (!src) return
  const edges = campus?.edges ?? []
  const nodes = campus?.nodes ?? []
  if (edges.length === 0 || nodes.length === 0) {
    src.setData({ type: 'FeatureCollection', features: [] })
    return
  }
  const nodePos = new Map<string, { lat: number; lng: number }>()
  for (const n of nodes) {
    nodePos.set(n.id, n.position)
  }
  const features: GeoJSON.Feature<GeoJSON.LineString>[] = []
  for (const edge of edges) {
    const from = nodePos.get(edge.from)
    const to = nodePos.get(edge.to)
    if (!from || !to) continue
    features.push({
      type: 'Feature',
      properties: { type: edge.type, id: edge.id },
      geometry: {
        type: 'LineString',
        coordinates: [
          [from.lng, from.lat],
          [to.lng, to.lat],
        ],
      },
    })
  }
  src.setData({ type: 'FeatureCollection', features })
}

export default function CampusMap({
  route = null,
  onMapReady,
  center = [122.1677, 11.8197],
  zoom = 16,
  autoFit = true,
  showLabels = true,
}: CampusMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [mapInstance, setMapInstance] = useState<maplibregl.Map | null>(null)
  const fitDoneRef = useRef(false)

  const campus = usePublicStore((s) => s.campus)
  const activeFloor = usePublicStore((s) => s.activeFloor)
  const setActiveFloor = usePublicStore((s) => s.setActiveFloor)
  const selectBuilding = usePublicStore((s) => s.selectBuilding)
  const selectedBuilding = usePublicStore((s) => s.selectedBuilding)
  const navCtx = useOptionalNavigationContext()
  const navigationSegment = navCtx?.navigationSegment ?? null

  const buildings = campus?.buildings ?? []
  const boundary = useMemo(() => boundaryFromBundle(campus), [campus])

  // Init map
  useEffect(() => {
    if (mapRef.current) return
    const map = new maplibregl.Map({
      container: mapContainerRef.current!,
      style: OSM_STYLE,
      center,
      zoom,
      pitch: 40,
    })
    // Suppress tile fetch errors (e.g., zoom beyond OSM tile coverage)
    map.on('error', (e) => {
      if (e.error?.status === 0 || `${e.error}`.includes('Failed to fetch') || `${e.error}`.includes('CORS')) return
      console.error(e.error)
    })
    map.on('load', () => {
      addMapSources(map, showLabels)
      // Read the CURRENT store state — the closure `buildings` may be stale
      // (data often arrives while the map is still loading).
      const current = usePublicStore.getState().campus
      syncBuildings(map, current?.buildings ?? [])
      syncBoundary(map, boundaryFromBundle(current))
      syncEntrances(map, current?.buildings ?? [])
      syncEdges(map, current)
      setMapInstance(map)
      onMapReady?.(map)
    })
    mapRef.current = map

    // Keep canvas in sync with container size (container height may resolve
    // after first paint inside flex layouts)
    const resizeObserver = new ResizeObserver(() => {
      if (mapRef.current) mapRef.current.resize()
    })
    if (mapContainerRef.current) resizeObserver.observe(mapContainerRef.current)

    return () => {
      resizeObserver.disconnect()
      try { map.remove() } catch {}
      mapRef.current = null
      setMapInstance(null)
      fitDoneRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sync data when it arrives/changes (only after the map finished loading;
  // the load handler above covers the pre-load case).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.loaded()) return
    syncBuildings(map, buildings)
    syncBoundary(map, boundary)
    syncEntrances(map, buildings)
    syncEdges(map, campus)

    if (autoFit && !fitDoneRef.current && campus && buildings.length > 0) {
      fitDoneRef.current = true
      const bounds = new maplibregl.LngLatBounds()
      let any = false
      for (const b of buildings) {
        for (const p of b.outline ?? b.footprint ?? []) {
          bounds.extend([p.lng, p.lat])
          any = true
        }
      }
      if (any) map.fitBounds(bounds, { padding: 60, maxZoom: 18 })
    }
  }, [buildings, boundary, campus, autoFit])

  // Click building → select in store
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const handler = (e: maplibregl.MapMouseEvent) => {
      const features = map.queryRenderedFeatures(e.point, { layers: [LYR.BUILDINGS_FILL] })
      if (features.length === 0) return
      const f = features[0]
      const building = buildings.find((b) => b.id === f.properties?.id || b.name === f.properties?.name)
      if (building) {
        selectBuilding(building)
        const def = building.floors?.find((fl) => fl === activeFloor) ?? building.floors?.[0] ?? 0
        setActiveFloor(def)
      }
    }
    map.on('click', LYR.BUILDINGS_FILL, handler)
    return () => { try { map.off('click', LYR.BUILDINGS_FILL, handler) } catch {} }
  }, [buildings, activeFloor, selectBuilding, setActiveFloor])

  const getNodePosition = useCallback((nodeId: string) => {
    const node = campus?.nodes.find((n) => n.id === nodeId)
    return node ? node.position : undefined
  }, [campus])

  const getNodeFloor = useCallback(
    (nodeId: string) => campus?.nodes.find((n) => n.id === nodeId)?.floor,
    [campus],
  )

  const floors = selectedBuilding?.floors ?? []

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />
      <FloorSelector floors={floors} activeFloor={activeFloor} onChange={setActiveFloor} />
      <RouteLine
        map={mapInstance}
        route={route}
        getNodePosition={getNodePosition}
        getNodeFloor={getNodeFloor}
        activeFloor={activeFloor}
        navigationSegment={navigationSegment}
      />
    </div>
  )
}
