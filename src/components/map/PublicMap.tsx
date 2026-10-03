'use client'

import { useRef, useEffect, useState, useCallback } from 'react'
import maplibregl, { RasterTileSource } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useGraphStore } from '@/store/graph-store'
import { RouteLine } from '@/components/map/RouteLine'
import { QRScanner } from '@/components/map/QRScanner'
import { SearchBar } from '@/components/search/SearchBar'
import { BuildingInfo } from '@/components/directory/BuildingInfo'
import { useGeolocation } from '@/hooks/useGeolocation'
import { resolvePosition } from '@/engine/spatial-resolver'
import type { LatLng, PathResult, Building, TracePath } from '@/types/nav-types'

import { FloorSelector } from '@/components/map/FloorSelector'
import { syncFloorPlanImageLayer, type FloorPlanMapLike } from '@/lib/floor-plan-map-source'

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

interface PublicMapProps {
  campusId?: string
  boundary?: { lat: number; lng: number }[]
}

const SRC = {
  BUILDINGS: 'public-buildings',
  BOUNDARY: 'public-boundary',
  TRACES: 'public-traces',
  ENTRANCES: 'public-entrances',
  FLOORPLAN: 'public-floorplan',
  ROOMS: 'public-rooms',
} as const

const LYR = {
  BUILDINGS_FILL: 'public-buildings-fill',
  BUILDINGS_OUTLINE: 'public-buildings-outline',
  BUILDINGS_EXTRUSION: 'public-buildings-extrusion',
  BOUNDARY_FILL: 'public-boundary-fill',
  BOUNDARY_OUTLINE: 'public-boundary-outline',
  TRACES_ARTERIAL: 'public-traces-arterial',
  TRACES_CONNECTOR: 'public-traces-connector',
  ENTRANCES: 'public-entrances',
  FLOORPLAN: 'public-floorplan-layer',
  ROOMS_FILL: 'public-rooms-fill',
  ROOMS_EXTRUSION: 'public-rooms-extrusion',
  ROOMS_OUTLINE: 'public-rooms-outline',
  ROOMS_LABELS: 'public-rooms-labels',
} as const

function addMapSources(map: maplibregl.Map) {
  if (map.getSource(SRC.BUILDINGS)) return

  map.addSource(SRC.BUILDINGS, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  map.addLayer({ id: LYR.BUILDINGS_FILL, type: 'fill', source: SRC.BUILDINGS, paint: { 'fill-color': '#1C6BEB', 'fill-opacity': 0.12 } })
  map.addLayer({ id: LYR.BUILDINGS_OUTLINE, type: 'line', source: SRC.BUILDINGS, paint: { 'line-color': '#1C6BEB', 'line-width': 2 } })
  map.addLayer({ id: LYR.BUILDINGS_EXTRUSION, type: 'fill-extrusion', source: SRC.BUILDINGS, paint: { 'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-height': ['get', 'height'], 'fill-extrusion-opacity': 0.65, 'fill-extrusion-base': 0 } })

  map.addSource(SRC.BOUNDARY, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  map.addLayer({ id: LYR.BOUNDARY_FILL, type: 'fill', source: SRC.BOUNDARY, paint: { 'fill-color': '#94A3B8', 'fill-opacity': 0.15 } })
  map.addLayer({ id: LYR.BOUNDARY_OUTLINE, type: 'line', source: SRC.BOUNDARY, paint: { 'line-color': '#94A3B8', 'line-width': 2, 'line-dasharray': [4, 2], 'line-opacity': 0.5 } })

  map.addSource(SRC.TRACES, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  map.addLayer({ id: LYR.TRACES_ARTERIAL, type: 'line', source: SRC.TRACES, filter: ['==', ['get', 'trace_type'], 'arterial'], paint: { 'line-color': '#3B82F6', 'line-width': ['get', 'width'], 'line-opacity': 0.7 } })
  map.addLayer({ id: LYR.TRACES_CONNECTOR, type: 'line', source: SRC.TRACES, filter: ['match', ['get', 'trace_type'], ['connector', 'path', 'interior'], true, false], paint: { 'line-color': '#F59E0B', 'line-width': ['get', 'width'], 'line-opacity': 0.5, 'line-dasharray': [4, 3] } })

  map.addSource(SRC.ENTRANCES, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  map.addLayer({ id: LYR.ENTRANCES, type: 'circle', source: SRC.ENTRANCES, paint: { 'circle-radius': 6, 'circle-color': '#8B5CF6', 'circle-stroke-width': 2, 'circle-stroke-color': '#FFFFFF' } })

  map.addSource(SRC.ROOMS, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  map.addLayer({ id: LYR.ROOMS_FILL, type: 'fill', source: SRC.ROOMS, paint: { 'fill-color': '#E8E0D4', 'fill-opacity': 0.65 } })
  map.addLayer({ id: LYR.ROOMS_EXTRUSION, type: 'fill-extrusion', source: SRC.ROOMS, paint: { 'fill-extrusion-color': '#E8E0D4', 'fill-extrusion-height': ['get', 'height'], 'fill-extrusion-opacity': 0.8, 'fill-extrusion-base': ['get', 'base'] } })
  map.addLayer({ id: LYR.ROOMS_OUTLINE, type: 'line', source: SRC.ROOMS, paint: { 'line-color': '#C4B8A8', 'line-width': 1.5 } })
  map.addLayer({ id: LYR.ROOMS_LABELS, type: 'symbol', source: SRC.ROOMS, layout: { 'text-field': ['get', 'name'], 'text-size': 11, 'text-offset': [0, -0.5] }, paint: { 'text-color': '#3D2E1E', 'text-halo-color': '#FFFFFF', 'text-halo-width': 2 } })
}

function syncBuildings(map: maplibregl.Map, buildings: Building[]) {
  const src = map.getSource(SRC.BUILDINGS) as maplibregl.GeoJSONSource
  if (!src) return
  const features = buildings.map((b) => ({
    type: 'Feature' as const,
    id: b.id,
    properties: { name: b.name, code: b.id, height: b.height ?? 10, color: b.color ?? '#1C6BEB', base_elevation: b.baseElevation ?? 0 },
    geometry: {
      type: 'Polygon' as const,
      coordinates: [(b.outline ?? b.footprint)?.map((p: LatLng) => [p.lng, p.lat] as [number, number]) ?? []],
    },
  }))
  src.setData({ type: 'FeatureCollection', features })
  map.triggerRepaint()
}

function syncBoundary(map: maplibregl.Map, boundary: { lat: number; lng: number }[]) {
  if (!boundary || boundary.length < 3) return
  const src = map.getSource(SRC.BOUNDARY) as maplibregl.GeoJSONSource
  if (!src) return
  const coords = boundary.map((p) => [p.lng, p.lat] as [number, number])
  src.setData({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[...coords, coords[0]]] }, properties: {} }],
  })
}

export function tracesToGeoJSON(traces: TracePath[]): GeoJSON.FeatureCollection {
  const features = traces
    .filter((t) => t.displayMode !== 'navigation-only' && t.points.length >= 2)
    .map((t) => ({
      type: 'Feature' as const,
      properties: { trace_type: t.type, name: t.name ?? '', color: t.color ?? '', width: t.width ?? 8, displayMode: t.displayMode ?? 'visible' },
      geometry: {
        type: 'LineString' as const,
        coordinates: t.points.map((p) => [p.lng, p.lat] as [number, number]),
      },
    }))
  return { type: 'FeatureCollection', features }
}

function syncTraces(map: maplibregl.Map, traces: TracePath[]) {
  const src = map.getSource(SRC.TRACES) as maplibregl.GeoJSONSource
  if (!src) return
  src.setData(tracesToGeoJSON(traces))
}

function syncEntrances(map: maplibregl.Map, buildings: Building[]) {
  const src = map.getSource(SRC.ENTRANCES) as maplibregl.GeoJSONSource
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

export function PublicMap({ boundary }: PublicMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [mapInstance, setMapInstance] = useState<maplibregl.Map | null>(null)
  const graph = useGraphStore((s) => s.graph)
  const readyRef = useRef(false)

  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [path, setPath] = useState<PathResult | null>(null)
  const [selectedBuilding, setSelectedBuilding] = useState<Building | null>(null)
  const [activeFloor, setActiveFloor] = useState<number>(0)

  const handleSelectBuilding = useCallback((b: Building | null) => {
    setSelectedBuilding(b)
    if (b) {
      const defaultFloor = b.floors?.[0] ?? 0
      setActiveFloor(defaultFloor)
    } else {
      setActiveFloor(0)
    }
  }, [])

  const getNodePosition = useCallback((nodeId: string) => {
    const node = graph.getNode(nodeId)
    return node ? node.position : undefined
  }, [graph])

  const geo = useGeolocation()
  const [scanning, setScanning] = useState(false)
  const [qrError, setQrError] = useState<string | null>(null)
  const userMarkerRef = useRef<maplibregl.Marker | null>(null)

  const handleQrScan = useCallback((nodeId: string) => {
    setScanning(false)
    setQrError(null)
    const resolved = graph.getNode(nodeId)
    if (resolved) {
      setFrom(resolved.id)
    }
  }, [graph])

  useEffect(() => {
    if (geo.latitude == null || geo.longitude == null) return
    if (graph.nodes.length === 0) return
    const resolved = resolvePosition(
      graph,
      { lat: geo.latitude, lng: geo.longitude },
      { maxDistance: 50 },
    )
    if (resolved) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (!from) setFrom(resolved.id)
    }
  }, [geo.latitude, geo.longitude, graph, from])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (!geo.latitude || !geo.longitude) {
      userMarkerRef.current?.remove()
      userMarkerRef.current = null
      return
    }
    if (!userMarkerRef.current) {
      const el = document.createElement('div')
      el.style.width = '16px'
      el.style.height = '16px'
      el.style.background = '#3b82f6'
      el.style.border = '3px solid white'
      el.style.borderRadius = '50%'
      el.style.boxShadow = '0 0 8px rgba(59,130,246,0.6)'
      el.style.pointerEvents = 'none'
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([geo.longitude, geo.latitude])
        .addTo(map)
      userMarkerRef.current = marker
    } else {
      userMarkerRef.current.setLngLat([geo.longitude, geo.latitude])
    }
  }, [mapInstance, geo.latitude, geo.longitude])

  // Init map
  useEffect(() => {
    if (mapRef.current) return
    const map = new maplibregl.Map({
      container: mapContainerRef.current!,
      style: OSM_STYLE,
      center: [122.0922, 11.8195],
      zoom: 17,
      pitch: 35,
    })
    // Suppress tile fetch errors (e.g., zoom beyond OSM tile coverage)
    map.on('error', (e) => {
      if (e.error?.status === 0 || `${e.error}`.includes('Failed to fetch') || `${e.error}`.includes('CORS')) return
      console.error(e.error)
    })
    map.on('load', () => {
      addMapSources(map)
      readyRef.current = true
      syncBuildings(map, graph.buildings)
      syncBoundary(map, boundary ?? [])
      syncTraces(map, graph.traces)
      syncEntrances(map, graph.buildings)
    })
    mapRef.current = map
    setMapInstance(map)
    return () => { try { map.remove() } catch {} mapRef.current = null; setMapInstance(null); readyRef.current = false }
  }, [boundary])

  // Sync graph data to map layers (filtered by activeFloor for rooms)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    syncBuildings(map, graph.buildings)
    syncTraces(map, graph.traces)
    syncEntrances(map, graph.buildings)

    // Sync rooms for selected building on active floor
    try {
      const roomSrc = map.getSource(SRC.ROOMS) as maplibregl.GeoJSONSource
      if (!roomSrc) return
      if (selectedBuilding) {
        const roomComponents = graph.components.filter(
          (c) => c.type === 'room' && c.buildingId === selectedBuilding.id && c.floor === activeFloor && c.polygon && c.polygon.length >= 3,
        )
        const roomGeo: GeoJSON.FeatureCollection = {
          type: 'FeatureCollection',
          features: roomComponents.map((c) => ({
            type: 'Feature',
            properties: { name: c.name, type: c.type, height: 1, base: 0 },
            geometry: {
              type: 'Polygon',
              coordinates: [[...c.polygon!.map((p) => [p.lng, p.lat] as [number, number]), [c.polygon![0].lng, c.polygon![0].lat] as [number, number]]],
            },
          })),
        }
        roomSrc.setData(roomGeo)
      } else {
        roomSrc.setData({ type: 'FeatureCollection', features: [] })
      }
    } catch { /* source not ready */ }
  }, [graph.buildings, graph.traces, graph.components, selectedBuilding, activeFloor])

  // T2: ImageSource Floor Plan Overlay in PublicMap
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    const floorData = selectedBuilding?.floorData?.find((fd: any) => fd.level === activeFloor)
    const publishedVisual = selectedBuilding?.floorPlanVisuals?.[activeFloor]
    const imgUrl = (selectedBuilding?.floorPlanUrls?.[activeFloor] ?? floorData?.planImageId ?? publishedVisual?.imageUrl) as string | undefined
    const footprint = selectedBuilding?.outline ?? selectedBuilding?.footprint ?? []
    const planAlign = (floorData?.planAlignment ?? publishedVisual?.alignment) as any

    syncFloorPlanImageLayer(map as unknown as FloorPlanMapLike, {
      sourceId: SRC.FLOORPLAN,
      layerId: LYR.FLOORPLAN,
      beforeLayerId: LYR.ROOMS_FILL,
      imageUrl: imgUrl,
      footprint,
      alignment: planAlign,
      opacity: planAlign?.opacity,
    })
  }, [selectedBuilding, activeFloor])

  // Building click detection
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const handler = (e: maplibregl.MapMouseEvent) => {
      const features = map.queryRenderedFeatures(e.point, { layers: [LYR.BUILDINGS_FILL] })
      if (features.length > 0) {
        const f = features[0]
        const building = graph.buildings.find(
          (b) => b.id === f.id || b.name === f.properties?.name
        )
        handleSelectBuilding(building ?? null)
      }
    }
    map.on('click', LYR.BUILDINGS_FILL, handler)
    return () => { try { map.off('click', LYR.BUILDINGS_FILL, handler) } catch {} }
  }, [mapInstance, graph, handleSelectBuilding])

  const handleSearchSelect = useCallback((nodeId: string) => {
    const node = graph.getNode(nodeId)
    if (node?.buildingId) {
      const bldg = graph.buildings.find((b) => b.id === node.buildingId)
      if (bldg) handleSelectBuilding(bldg)
    }
  }, [graph, handleSelectBuilding])

  const handleRoute = useCallback(() => {
    if (!from || !to) return
    const result = graph.findPath(from, to)
    setPath(result)
  }, [graph, from, to])

  const fromNode = from ? graph.getNode(from) : null

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: 10, background: 'var(--navi-card)', borderBottom: '1px solid var(--navi-border)', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        {fromNode ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', background: 'var(--navi-content)', border: '1px solid var(--navi-border)', borderRadius: 5, fontSize: 11 }}>
            <span style={{ color: 'var(--navi-text-secondary)' }}>From:</span>
            <span style={{ color: 'var(--navi-text)', fontWeight: 500 }}>{fromNode.label || fromNode.id}</span>
            <button onClick={() => { setFrom(''); setPath(null) }} aria-label="Clear start location"
              style={{ background: 'none', border: 'none', color: 'var(--navi-text-secondary)', cursor: 'pointer', padding: 0, fontSize: 14, lineHeight: 1 }}>
              &times;
            </button>
          </div>
        ) : (
          <SearchBar onSelect={(n) => { setFrom(n.id); handleSearchSelect(n.id) }} placeholder="Set start..." />
        )}

        <SearchBar onSelect={(n) => { setTo(n.id); handleSearchSelect(n.id) }} placeholder="Where to?" />

        <button onClick={handleRoute}
          style={{ padding: '5px 12px', background: 'var(--navi-primary)', border: 'none', borderRadius: 5, color: 'white', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
          Route
        </button>

        <button onClick={() => setScanning(true)}
          style={{ padding: '5px 10px', background: scanning ? 'var(--navi-success)' : 'var(--navi-content)', border: '1px solid var(--navi-border)', borderRadius: 5, color: scanning ? 'white' : 'var(--navi-text-secondary)', fontSize: 11, cursor: 'pointer' }}>
          {scanning ? 'Scanning...' : 'QR'}
        </button>

        {geo.loading && <span style={{ color: 'var(--navi-text-secondary)', fontSize: 10 }}>locating...</span>}
        {fromNode && <span style={{ color: 'var(--navi-success)', fontSize: 10 }}>{fromNode.label || fromNode.id}</span>}
      </div>

      <div style={{ flex: 1, position: 'relative' }}>
        <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />
        <FloorSelector
          floors={selectedBuilding?.floors ?? []}
          activeFloor={activeFloor}
          onChange={setActiveFloor}
        />
      </div>

      <RouteLine map={mapInstance} route={path as { path: string[]; cost: number } | null} getNodePosition={getNodePosition} />

      {path && (
        <div style={{ padding: 10, background: 'var(--navi-card)', borderTop: '1px solid var(--navi-border)', maxHeight: 180, overflowY: 'auto' }}>
          <div style={{ color: 'var(--navi-text-secondary)', fontSize: 10, fontWeight: 600, marginBottom: 4 }}>ROUTE ({Math.round(path.cost)}m)</div>
          {path.steps.map((step, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, padding: '2px 0', fontSize: 10, color: 'var(--navi-text)' }}>
              <span style={{ color: 'var(--navi-text-secondary)', minWidth: 14 }}>{i + 1}.</span>
              <span style={{ flex: 1 }}>{step.instruction}</span>
              {step.distance > 0 && <span style={{ color: 'var(--navi-text-secondary)' }}>{Math.round(step.distance)}m</span>}
            </div>
          ))}
        </div>
      )}

      <BuildingInfo building={selectedBuilding} onClose={() => setSelectedBuilding(null)} />

      {scanning && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(15,23,42,0.9)', display: 'flex',
          flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{ width: 280, height: 280, borderRadius: 12, overflow: 'hidden' }}>
            <QRScanner
              onScan={handleQrScan}
              onError={(err) => setQrError(err)}
            />
          </div>
          {qrError && <p style={{ color: 'var(--navi-error)', fontSize: 12, marginTop: 8 }}>{qrError}</p>}
          <button onClick={() => { setScanning(false); setQrError(null) }}
            style={{ marginTop: 14, padding: '7px 24px', background: 'var(--navi-error)', border: 'none', borderRadius: 6, color: 'white', fontSize: 12, cursor: 'pointer' }}>
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}
