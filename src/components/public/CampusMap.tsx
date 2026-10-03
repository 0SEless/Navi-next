'use client'

import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { CampusBundle, Component, LatLng } from '@/types/nav-types'
import { deriveBuildingFootprint } from '@/lib/campus-geometry'
import { usePublicStore } from '@/store/public-store'
import { FloorSelector } from '@/components/map/FloorSelector'

/**
 * Presentational explore-campus map with indoor room rendering.
 *
 * Building polygons come from `deriveBuildingFootprint`.
 * Room polygons come from `bundle.components` filtered by activeFloor.
 *
 * Interaction contract:
 *  - hover building → pointer cursor + highlight
 *  - click building → `selectBuilding(building)` + `setSheet('half')`
 *  - floor selector → filters rooms by floor level
 */

const STYLE_URL = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'

const DEFAULT_CENTER: [number, number] = [122.168, 11.819]
const DEFAULT_ZOOM = 15

const SRC_BUILDINGS = 'public-buildings'
const SRC_HIGHLIGHT = 'public-highlight'
const SRC_EDGES = 'public-edges'
const SRC_ROOMS = 'public-rooms'
const SRC_ENTRANCES = 'public-indoor-entrances'
const SRC_STAIRS = 'public-stairs'
const SRC_HALLWAYS = 'public-hallways'

const LYR_FILL = 'public-buildings-fill'
const LYR_OUTLINE = 'public-buildings-outline'
const LYR_LABELS = 'public-buildings-labels'
const LYR_HIGHLIGHT = 'public-buildings-highlight'
const LYR_EDGES = 'public-edges-line'
const LYR_ROOMS_FILL = 'public-rooms-fill'
const LYR_ROOMS_OUTLINE = 'public-rooms-outline'
const LYR_ROOMS_LABELS = 'public-rooms-labels'
const LYR_ENTRANCES = 'public-indoor-entrances'
const LYR_STAIRS = 'public-stairs'
const LYR_STAIRS_LABELS = 'public-stairs-labels'
const LYR_HALLWAYS_FILL = 'public-hallways-fill'
const LYR_HALLWAYS_OUTLINE = 'public-hallways-outline'

const COLOR_PRIMARY = '#2563EB'
const COLOR_ROOM = '#10B981'
const COLOR_ROOM_OUTLINE = '#059669'
const COLOR_ENTRANCE_MARKER = '#8B5CF6'
const COLOR_STAIR = '#F59E0B'
const COLOR_HALLWAY = '#94A3B8'
const COLOR_HALLWAY_OUTLINE = '#64748B'
const COLOR_PRIMARY_LIGHT = '#EFF6FF'

/** Resolve a CSS var at runtime; `--navi-primary` etc. may not be in scope at module eval. */
function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

function ringToGeoJSON(ring: LatLng[]): [number, number][] {
  return ring.map((p) => [p.lng, p.lat])
}

function buildingFeature(
  bundle: CampusBundle,
  b: CampusBundle['buildings'][number],
): GeoJSON.Feature<GeoJSON.Polygon> | null {
  // Skip virtual/container buildings (e.g., __outdoor__ is a catch-all for
  // outdoor waypoints, not an actual building to render on the map).
  if (b.id === '__outdoor__' || b.name === '__outdoor__') return null
  const ring = deriveBuildingFootprint(b, bundle.nodes)
  if (!ring || ring.length < 3) return null
  return {
    type: 'Feature',
    id: b.id,
    properties: {
      id: b.id,
      name: b.name,
      code: b.code ?? '',
      label: b.code ?? b.name,
      derived: b.footprint.length < 3,
    },
    geometry: { type: 'Polygon', coordinates: [ringToGeoJSON(ring)] },
  }
}

interface CampusMapProps {
  bundle: CampusBundle
}

export function CampusMap({ bundle }: CampusMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)

  const selectBuilding = usePublicStore((s) => s.selectBuilding)
  const setSheet = usePublicStore((s) => s.setSheet)
  const activeFloor = usePublicStore((s) => s.activeFloor)
  const setActiveFloor = usePublicStore((s) => s.setActiveFloor)
  const indoorContext = usePublicStore((s) => s.indoorContext)

  // Collect all floor levels across buildings for the floor selector
  const floors = Array.from(new Set(
    bundle.buildings.flatMap(b => (b.floors ?? []) as number[])
  )).sort((a, b) => a - b)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE_URL,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      attributionControl: { compact: true },
    })
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }))
    mapRef.current = map

    const fillColor = cssVar('--navi-primary', COLOR_PRIMARY)

    map.on('load', () => {
      if (map.getSource(SRC_BUILDINGS)) return
      try {
        map.addSource(SRC_BUILDINGS, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        })
        map.addLayer({
          id: LYR_FILL,
          type: 'fill',
          source: SRC_BUILDINGS,
          paint: {
            'fill-color': fillColor,
            // Derived (hull) buildings sit slightly lighter than footprint polygons.
            'fill-opacity': ['case', ['get', 'derived'], 0.3, 0.45],
          },
        })
        map.addLayer({
          id: LYR_OUTLINE,
          type: 'line',
          source: SRC_BUILDINGS,
          paint: {
            'line-color': fillColor,
            'line-width': ['case', ['get', 'derived'], 1.5, 2.5],
          },
        })
        map.addLayer({
          id: LYR_LABELS,
          type: 'symbol',
          source: SRC_BUILDINGS,
          minzoom: 15.5,
          layout: {
            'text-field': ['get', 'label'],
            'text-size': 11,
            'text-anchor': 'center',
            'text-allow-overlap': false,
          },
          paint: {
            'text-color': cssVar('--navi-text', '#0F172A'),
            'text-halo-color': cssVar('--navi-card', '#FFFFFF'),
            'text-halo-width': 1.5,
          },
        })
        map.addSource(SRC_HIGHLIGHT, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        })
        map.addLayer({
          id: LYR_HIGHLIGHT,
          type: 'fill',
          source: SRC_HIGHLIGHT,
          paint: {
            'fill-color': fillColor,
            'fill-opacity': 0.6,
          },
        })

        // Road/path edges from the navigation graph
        map.addSource(SRC_EDGES, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        })
        map.addLayer({
          id: LYR_EDGES,
          type: 'line',
          source: SRC_EDGES,
          paint: {
            'line-color': '#64748B',
            'line-width': 2,
            'line-opacity': 0.6,
          },
        })

        // Indoor room polygons
        // W16C: minzoom removed — visibility gated by indoorContext in sync functions.
        map.addSource(SRC_ROOMS, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        })
        map.addLayer({
          id: LYR_ROOMS_FILL,
          type: 'fill',
          source: SRC_ROOMS,
          paint: {
            'fill-color': COLOR_ROOM,
            'fill-opacity': 0.35,
          },
        })
        map.addLayer({
          id: LYR_ROOMS_OUTLINE,
          type: 'line',
          source: SRC_ROOMS,
          paint: {
            'line-color': COLOR_ROOM_OUTLINE,
            'line-width': 1.5,
          },
        })
        map.addLayer({
          id: LYR_ROOMS_LABELS,
          type: 'symbol',
          source: SRC_ROOMS,
          layout: {
            'text-field': ['get', 'name'],
            'text-size': 10,
            'text-anchor': 'center',
            'text-allow-overlap': false,
          },
          paint: {
            'text-color': '#065F46',
            'text-halo-color': '#FFFFFF',
            'text-halo-width': 1,
          },
        })

        // Indoor entrance markers (door/hallway connectors)
        // W16C: minzoom removed — visibility gated by indoorContext in sync functions.
        map.addSource(SRC_ENTRANCES, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        })
        map.addLayer({
          id: LYR_ENTRANCES,
          type: 'circle',
          source: SRC_ENTRANCES,
          paint: {
            'circle-radius': 5,
            'circle-color': COLOR_ENTRANCE_MARKER,
            'circle-stroke-width': 2,
            'circle-stroke-color': '#FFFFFF',
          },
        })

        // Staircase / elevator markers
        // W16C: minzoom removed — visibility gated by indoorContext in sync functions.
        map.addSource(SRC_STAIRS, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        })
        map.addLayer({
          id: LYR_STAIRS,
          type: 'circle',
          source: SRC_STAIRS,
          paint: {
            'circle-radius': 5,
            'circle-color': COLOR_STAIR,
            'circle-stroke-width': 2,
            'circle-stroke-color': '#FFFFFF',
          },
        })
        map.addLayer({
          id: LYR_STAIRS_LABELS,
          type: 'symbol',
          source: SRC_STAIRS,
          layout: {
            'text-field': ['get', 'name'],
            'text-size': 9,
            'text-anchor': 'left',
            'text-offset': [1, 0],
            'text-allow-overlap': false,
          },
          paint: {
            'text-color': '#92400E',
            'text-halo-color': '#FFFFFF',
            'text-halo-width': 1,
          },
        })

        // Hallway polygons
        // W16C: minzoom removed — visibility gated by indoorContext in sync functions.
        map.addSource(SRC_HALLWAYS, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        })
        map.addLayer({
          id: LYR_HALLWAYS_FILL,
          type: 'fill',
          source: SRC_HALLWAYS,
          paint: {
            'fill-color': COLOR_HALLWAY,
            'fill-opacity': 0.25,
          },
        })
        map.addLayer({
          id: LYR_HALLWAYS_OUTLINE,
          type: 'line',
          source: SRC_HALLWAYS,
          paint: {
            'line-color': COLOR_HALLWAY_OUTLINE,
            'line-width': 1,
            'line-dasharray': [3, 2],
          },
        })

        syncFeatures(map, bundle)
        syncEdges(map, bundle)
        syncRooms(map, bundle, activeFloor, indoorContext)
        syncEntrances(map, bundle, activeFloor, indoorContext)
        syncStairs(map, bundle, activeFloor, indoorContext)
        syncHallways(map, bundle, activeFloor, indoorContext)
        fitToBundle(map, bundle)
      } catch (err) {
        console.error('[CampusMap] load handler threw:', err)
      }
    })

    // Hover: pointer cursor + highlight via a dedicated source (setFeatureState
    // would need promoteId wiring; this matches the RouteOverlay setData pattern).
    map.on('mouseenter', LYR_FILL, (e) => {
      if (!e.features?.length) return
      const feature = e.features[0]
      const src = map.getSource(SRC_HIGHLIGHT) as maplibregl.GeoJSONSource | undefined
      src?.setData({
        type: 'FeatureCollection',
        features: [feature as GeoJSON.Feature],
      })
      map.getCanvas().style.cursor = 'pointer'
    })
    map.on('mouseleave', LYR_FILL, () => {
      const src = map.getSource(SRC_HIGHLIGHT) as maplibregl.GeoJSONSource | undefined
      src?.setData({ type: 'FeatureCollection', features: [] })
      map.getCanvas().style.cursor = ''
    })
    map.on('click', LYR_FILL, (e) => {
      const feature = e.features?.[0]
      if (!feature) return
      const id = feature.properties?.id as string | undefined
      const building = bundle.buildings.find((b) => b.id === id)
      if (building) {
        selectBuilding(building)
        setSheet('half')
      }
    })

    const resizeObserver = new ResizeObserver(() => {
      if (mapRef.current) mapRef.current.resize()
    })
    if (containerRef.current) resizeObserver.observe(containerRef.current)

    return () => {
      resizeObserver.disconnect()
      try { map.remove() } catch {}
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle, selectBuilding, setSheet])

  // Data can arrive after the style finished loading (map created before the
  // fetch resolves in rare cases) — resync without recreating the map.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    if (!map.getSource(SRC_BUILDINGS)) return
    syncFeatures(map, bundle)
    syncEdges(map, bundle)
    syncRooms(map, bundle, activeFloor, indoorContext)
    syncEntrances(map, bundle, activeFloor, indoorContext)
    syncStairs(map, bundle, activeFloor, indoorContext)
    syncHallways(map, bundle, activeFloor, indoorContext)
  }, [bundle, activeFloor, indoorContext])

  return (
    <>
      <div ref={containerRef} className="h-full w-full" />
      <FloorSelector floors={floors} activeFloor={activeFloor} onChange={setActiveFloor} />
    </>
  )
}

function syncFeatures(map: maplibregl.Map, bundle: CampusBundle) {
  const src = map.getSource(SRC_BUILDINGS) as maplibregl.GeoJSONSource | undefined
  if (!src) return
  const features = bundle.buildings
    .map((b) => buildingFeature(bundle, b))
    .filter((f): f is GeoJSON.Feature<GeoJSON.Polygon> => f !== null)
  src.setData({ type: 'FeatureCollection', features })
}

function syncEdges(map: maplibregl.Map, bundle: CampusBundle) {
  const src = map.getSource(SRC_EDGES) as maplibregl.GeoJSONSource | undefined
  if (!src) return
  if (bundle.edges.length === 0 || bundle.nodes.length === 0) {
    src.setData({ type: 'FeatureCollection', features: [] })
    return
  }
  // Build a lookup from node id → position
  const nodePos = new Map<string, { lat: number; lng: number }>()
  for (const n of bundle.nodes) {
    nodePos.set(n.id, n.position)
  }
  const features: GeoJSON.Feature<GeoJSON.LineString>[] = []
  for (const edge of bundle.edges) {
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

function syncRooms(map: maplibregl.Map, bundle: CampusBundle, activeFloor: number, indoorContext: { active: boolean; buildingId?: string; floorId?: number }) {
  const src = map.getSource(SRC_ROOMS) as maplibregl.GeoJSONSource | undefined
  if (!src) return

  // W16C: If indoor context is inactive, hide all rooms
  if (!indoorContext.active) {
    src.setData({ type: 'FeatureCollection', features: [] })
    return
  }

  const components: Component[] = bundle.components ?? []
  const features: GeoJSON.Feature<GeoJSON.Polygon>[] = []
  for (const c of components) {
    if (c.type !== 'room') continue
    // W16C: Gate by indoor context building and floor
    if (indoorContext.buildingId && c.buildingId !== indoorContext.buildingId) continue
    if (indoorContext.floorId !== undefined && c.floor !== indoorContext.floorId) continue
    // Also apply floor filter for backward compatibility
    if (c.floor !== activeFloor) continue
    if (!c.polygon || c.polygon.length < 3) continue
    const ring = [
      ...c.polygon.map((p: LatLng) => [p.lng, p.lat] as [number, number]),
      [c.polygon![0].lng, c.polygon![0].lat] as [number, number],
    ]
    features.push({
      type: 'Feature',
      properties: { id: c.id, name: c.name, type: c.type, buildingId: c.buildingId },
      geometry: { type: 'Polygon', coordinates: [ring] },
    })
  }
  src.setData({ type: 'FeatureCollection', features })
}

function syncEntrances(map: maplibregl.Map, bundle: CampusBundle, activeFloor: number, indoorContext: { active: boolean; buildingId?: string; floorId?: number }) {
  const src = map.getSource(SRC_ENTRANCES) as maplibregl.GeoJSONSource | undefined
  if (!src) return

  // W16C: If indoor context is inactive, hide all entrances
  if (!indoorContext.active) {
    src.setData({ type: 'FeatureCollection', features: [] })
    return
  }

  const features: GeoJSON.Feature<GeoJSON.Point>[] = []
  for (const b of bundle.buildings) {
    // W16C: Gate by indoor context building
    if (indoorContext.buildingId && b.id !== indoorContext.buildingId) continue
    for (const e of b.entrances ?? []) {
      // W16C: Gate by indoor context floor
      if (indoorContext.floorId !== undefined && e.floor !== indoorContext.floorId) continue
      if (e.floor !== activeFloor) continue
      features.push({
        type: 'Feature',
        properties: { id: e.id, name: e.label ?? 'Entrance', buildingId: b.id },
        geometry: { type: 'Point', coordinates: [e.position.lng, e.position.lat] },
      })
    }
  }
  src.setData({ type: 'FeatureCollection', features })
}

function syncStairs(map: maplibregl.Map, bundle: CampusBundle, activeFloor: number, indoorContext: { active: boolean; buildingId?: string; floorId?: number }) {
  const src = map.getSource(SRC_STAIRS) as maplibregl.GeoJSONSource | undefined
  if (!src) return

  // W16C: If indoor context is inactive, hide all stairs
  if (!indoorContext.active) {
    src.setData({ type: 'FeatureCollection', features: [] })
    return
  }

  const components: Component[] = bundle.components ?? []
  const features: GeoJSON.Feature<GeoJSON.Point>[] = []
  for (const c of components) {
    if (c.type !== 'stair' && c.type !== 'elevator') continue
    // W16C: Gate by indoor context building and floor
    if (indoorContext.buildingId && c.buildingId !== indoorContext.buildingId) continue
    if (indoorContext.floorId !== undefined && c.floor !== indoorContext.floorId) continue
    if (c.floor !== activeFloor) continue
    features.push({
      type: 'Feature',
      properties: { id: c.id, name: c.name, type: c.type, buildingId: c.buildingId },
      geometry: { type: 'Point', coordinates: [c.position.lng, c.position.lat] },
    })
  }
  src.setData({ type: 'FeatureCollection', features })
}

function syncHallways(map: maplibregl.Map, bundle: CampusBundle, activeFloor: number, indoorContext: { active: boolean; buildingId?: string; floorId?: number }) {
  const src = map.getSource(SRC_HALLWAYS) as maplibregl.GeoJSONSource | undefined
  if (!src) return

  // W16C: If indoor context is inactive, hide all hallways
  if (!indoorContext.active) {
    src.setData({ type: 'FeatureCollection', features: [] })
    return
  }

  const components: Component[] = bundle.components ?? []
  const features: GeoJSON.Feature<GeoJSON.Polygon>[] = []
  for (const c of components) {
    if (c.type !== 'hallway') continue
    // W16C: Gate by indoor context building and floor
    if (indoorContext.buildingId && c.buildingId !== indoorContext.buildingId) continue
    if (indoorContext.floorId !== undefined && c.floor !== indoorContext.floorId) continue
    if (c.floor !== activeFloor) continue
    if (!c.polygon || c.polygon.length < 3) continue
    const ring = [
      ...c.polygon.map((p: LatLng) => [p.lng, p.lat] as [number, number]),
      [c.polygon![0].lng, c.polygon![0].lat] as [number, number],
    ]
    features.push({
      type: 'Feature',
      properties: { id: c.id, name: c.name, type: c.type, buildingId: c.buildingId },
      geometry: { type: 'Polygon', coordinates: [ring] },
    })
  }
  src.setData({ type: 'FeatureCollection', features })
}

function fitToBundle(map: maplibregl.Map, bundle: CampusBundle) {
  if (bundle.boundingBox) {
    const { minLat, maxLat, minLng, maxLng } = bundle.boundingBox
    if (Number.isFinite(minLat) && Number.isFinite(maxLng)) {
      map.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 60, maxZoom: 17.5 })
      return
    }
  }
  const first = bundle.buildings[0]
  const center = first?.center
  if (center) {
    map.jumpTo({ center: [center.lng, center.lat], zoom: 16 })
  }
}

export default CampusMap
