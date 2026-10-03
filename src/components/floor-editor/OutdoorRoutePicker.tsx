'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Road } from '@navi/core'
import type { Area, Building, Component, LatLng, NavEdge, NavNode } from '@/types/nav-types'
import {
  buildCampusNavigationEdges,
  buildCampusNavigationNodes,
  buildOutdoorRouteCandidates,
  buildingPickerBounds,
  outdoorRoutePickerCenter,
  resolveOutdoorRoutePick,
  type OutdoorRouteCandidate,
} from './outdoor-route-picker-model'

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

const SOURCE_IDS = {
  campusBuildings: 'picker-campus-buildings',
  campusRoads: 'picker-campus-roads',
  campusAreas: 'picker-campus-areas',
  campusGraphNodes: 'picker-campus-graph-nodes',
  building: 'picker-building',
  entrance: 'picker-entrance',
  edges: 'picker-outdoor-edges',
  nodes: 'picker-outdoor-nodes',
  selection: 'picker-selected-node',
  pendingAccess: 'picker-pending-access',
} as const

const LAYER_IDS = {
  campusBuildings: 'picker-campus-buildings-fill',
  campusBuildingsOutline: 'picker-campus-buildings-outline',
  campusRoads: 'picker-campus-roads-line',
  campusAreas: 'picker-campus-areas-fill',
  campusGraphNodes: 'picker-campus-graph-nodes',
  building: 'picker-building-fill',
  buildingOutline: 'picker-building-outline',
  entrance: 'picker-entrance',
  edges: 'picker-outdoor-edges',
  edgesHit: 'picker-outdoor-edges-hit',
  nodes: 'picker-outdoor-nodes',
  nodesHit: 'picker-outdoor-nodes-hit',
  selection: 'picker-selected-node',
  pendingAccess: 'picker-pending-access',
} as const

type GeoJsonSource = maplibregl.GeoJSONSource

export interface OutdoorRoutePickerProps {
  open: boolean
  building: Building
  entrance: Pick<Component, 'id' | 'name' | 'position'>
  nodes: NavNode[]
  edges: NavEdge[]
  campusBuildings?: Building[]
  campusRoads?: Road[]
  campusAreas?: Area[]
  onCancel: () => void
  onConfirm: (candidate: OutdoorRouteCandidate) => void
}

function isStyleReady(map: maplibregl.Map): boolean {
  try {
    if (typeof map.isStyleLoaded === 'function') return map.isStyleLoaded()
    if (typeof map.loaded === 'function') return map.loaded()
  } catch {
    return false
  }
  return false
}

function setSourceData(map: maplibregl.Map, sourceId: string, data: GeoJSON.FeatureCollection): void {
  const source = map.getSource(sourceId) as GeoJsonSource | undefined
  if (source && typeof source.setData === 'function') source.setData(data)
}

function closeRing(points: LatLng[]): [number, number][] {
  const ring = points.map((point) => [point.lng, point.lat] as [number, number])
  if (ring.length > 0) {
    const first = ring[0]
    const last = ring[ring.length - 1]
    if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first)
  }
  return ring
}

function boundsForPositions(positions: LatLng[], paddingMeters: number): [[number, number], [number, number]] | null {
  if (positions.length === 0) return null
  const minLng = Math.min(...positions.map((point) => point.lng))
  const maxLng = Math.max(...positions.map((point) => point.lng))
  const minLat = Math.min(...positions.map((point) => point.lat))
  const maxLat = Math.max(...positions.map((point) => point.lat))
  const centerLat = (minLat + maxLat) / 2
  const latPadding = paddingMeters / 111_320
  const lngPadding = paddingMeters / (111_320 * Math.max(0.01, Math.abs(Math.cos((centerLat * Math.PI) / 180))))
  return [[minLng - lngPadding, minLat - latPadding], [maxLng + lngPadding, maxLat + latPadding]]
}

function addPickerSourcesAndLayers(map: maplibregl.Map): void {
  if (!map.getSource(SOURCE_IDS.campusRoads)) {
    map.addSource(SOURCE_IDS.campusRoads, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({ id: LAYER_IDS.campusRoads, type: 'line', source: SOURCE_IDS.campusRoads, paint: { 'line-color': '#64748B', 'line-width': 4, 'line-opacity': 0.8 } })
  }
  if (!map.getSource(SOURCE_IDS.campusAreas)) {
    map.addSource(SOURCE_IDS.campusAreas, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({ id: LAYER_IDS.campusAreas, type: 'fill', source: SOURCE_IDS.campusAreas, paint: { 'fill-color': '#8B5CF6', 'fill-opacity': 0.08 } })
  }
  if (!map.getSource(SOURCE_IDS.campusBuildings)) {
    map.addSource(SOURCE_IDS.campusBuildings, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({ id: LAYER_IDS.campusBuildings, type: 'fill', source: SOURCE_IDS.campusBuildings, paint: { 'fill-color': '#94A3B8', 'fill-opacity': 0.18 } })
    map.addLayer({ id: LAYER_IDS.campusBuildingsOutline, type: 'line', source: SOURCE_IDS.campusBuildings, paint: { 'line-color': '#64748B', 'line-width': 1.5, 'line-opacity': 0.85 } })
  }
  if (!map.getSource(SOURCE_IDS.campusGraphNodes)) {
    map.addSource(SOURCE_IDS.campusGraphNodes, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({ id: LAYER_IDS.campusGraphNodes, type: 'circle', source: SOURCE_IDS.campusGraphNodes, paint: { 'circle-radius': 4, 'circle-color': '#475569', 'circle-stroke-color': '#F8FAFC', 'circle-stroke-width': 1.5, 'circle-opacity': 0.9 } })
  }
  if (!map.getSource(SOURCE_IDS.building)) {
    map.addSource(SOURCE_IDS.building, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({ id: LAYER_IDS.building, type: 'fill', source: SOURCE_IDS.building, paint: { 'fill-color': '#2563EB', 'fill-opacity': 0.18 } })
    map.addLayer({ id: LAYER_IDS.buildingOutline, type: 'line', source: SOURCE_IDS.building, paint: { 'line-color': '#1D4ED8', 'line-width': 3 } })
  }
  if (!map.getSource(SOURCE_IDS.entrance)) {
    map.addSource(SOURCE_IDS.entrance, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({ id: LAYER_IDS.entrance, type: 'circle', source: SOURCE_IDS.entrance, paint: { 'circle-radius': 8, 'circle-color': '#F59E0B', 'circle-stroke-color': '#FFFFFF', 'circle-stroke-width': 2 } })
  }
  if (!map.getSource(SOURCE_IDS.edges)) {
    map.addSource(SOURCE_IDS.edges, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({ id: LAYER_IDS.edges, type: 'line', source: SOURCE_IDS.edges, paint: { 'line-color': '#0EA5E9', 'line-width': 4, 'line-opacity': 0.9 } })
    map.addLayer({ id: LAYER_IDS.edgesHit, type: 'line', source: SOURCE_IDS.edges, paint: { 'line-color': '#000000', 'line-width': 18, 'line-opacity': 0.01 } })
  }
  if (!map.getSource(SOURCE_IDS.nodes)) {
    map.addSource(SOURCE_IDS.nodes, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({ id: LAYER_IDS.nodes, type: 'circle', source: SOURCE_IDS.nodes, paint: { 'circle-radius': 7, 'circle-color': '#0284C7', 'circle-stroke-color': '#FFFFFF', 'circle-stroke-width': 2 } })
    map.addLayer({ id: LAYER_IDS.nodesHit, type: 'circle', source: SOURCE_IDS.nodes, paint: { 'circle-radius': 16, 'circle-color': '#000000', 'circle-opacity': 0.01, 'circle-stroke-opacity': 0.01 } })
  }
  if (!map.getSource(SOURCE_IDS.selection)) {
    map.addSource(SOURCE_IDS.selection, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({ id: LAYER_IDS.selection, type: 'circle', source: SOURCE_IDS.selection, paint: { 'circle-radius': 11, 'circle-color': '#22C55E', 'circle-stroke-color': '#FFFFFF', 'circle-stroke-width': 3 } })
  }
  if (!map.getSource(SOURCE_IDS.pendingAccess)) {
    map.addSource(SOURCE_IDS.pendingAccess, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({ id: LAYER_IDS.pendingAccess, type: 'line', source: SOURCE_IDS.pendingAccess, paint: { 'line-color': '#22C55E', 'line-width': 3, 'line-dasharray': [1.5, 1.5], 'line-opacity': 0.95 } })
  }
}

function buildingFeature(building: Building): GeoJSON.FeatureCollection {
  const footprint = (building.outline ?? building.footprint ?? []).filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng))
  if (footprint.length < 3) return { type: 'FeatureCollection', features: [] }
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { id: building.id, name: building.name },
      geometry: { type: 'Polygon', coordinates: [closeRing(footprint)] },
    }],
  }
}

function campusBuildingsFeature(buildings: Building[], activeBuildingId: string): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: buildings.flatMap((campusBuilding) => {
      const footprint = (campusBuilding.outline ?? campusBuilding.footprint ?? []).filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng))
      if (footprint.length < 3) return []
      return [{
        type: 'Feature' as const,
        properties: { id: campusBuilding.id, name: campusBuilding.name, active: campusBuilding.id === activeBuildingId },
        geometry: { type: 'Polygon' as const, coordinates: [closeRing(footprint)] },
      }]
    }),
  }
}

function campusRoadsFeature(roads: Road[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: roads.flatMap((road) => {
      const points = road.polyline?.points?.filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng)) ?? []
      if (points.length < 2) return []
      const color = typeof road.metadata?.color === 'string' ? road.metadata.color : '#64748B'
      return [{
        type: 'Feature' as const,
        properties: { id: road.id, name: road.name, type: road.type, color, width: road.width },
        geometry: { type: 'LineString' as const, coordinates: points.map((point) => [point.lng, point.lat] as [number, number]) },
      }]
    }),
  }
}

function campusAreasFeature(areas: Area[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: areas.flatMap((area) => {
      const points = area.points.filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng))
      if (points.length < 3) return []
      return [{
        type: 'Feature' as const,
        properties: { id: area.id, name: area.name, color: area.color || '#8B5CF6' },
        geometry: { type: 'Polygon' as const, coordinates: [closeRing(points)] },
      }]
    }),
  }
}

function pointFeature(point: LatLng, properties: Record<string, unknown> = {}): GeoJSON.Feature {
  return { type: 'Feature', properties, geometry: { type: 'Point', coordinates: [point.lng, point.lat] } }
}

function routeEdgeFeatures(nodes: NavNode[], edges: NavEdge[]): GeoJSON.FeatureCollection {
  const positionById = new Map(nodes.map((node) => [node.id, node.position]))
  const features = edges.flatMap((edge) => {
    const from = positionById.get(edge.from)
    const to = positionById.get(edge.to)
    if (!from || !to) return []
    return [{
      type: 'Feature' as const,
      properties: { id: edge.id, from: edge.from, to: edge.to, type: edge.type },
      geometry: { type: 'LineString' as const, coordinates: [[from.lng, from.lat], [to.lng, to.lat]] },
    }]
  })
  return { type: 'FeatureCollection', features }
}

function pendingAccessFeature(entrance: Pick<Component, 'id' | 'position'>, candidate: OutdoorRouteCandidate | null): GeoJSON.FeatureCollection {
  if (!candidate) return { type: 'FeatureCollection', features: [] }
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {
        sourceId: entrance.id,
        targetId: candidate.id,
        targetKind: candidate.targetKind,
      },
      geometry: {
        type: 'LineString',
        coordinates: [[entrance.position.lng, entrance.position.lat], [candidate.position.lng, candidate.position.lat]],
      },
    }],
  }
}

export function OutdoorRoutePicker({ open, building, entrance, nodes, edges, campusBuildings = [], campusRoads = [], campusAreas = [], onCancel, onConfirm }: OutdoorRoutePickerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const [mapError, setMapError] = useState<string | null>(null)
  const [fullCampus, setFullCampus] = useState(false)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedCandidate, setSelectedCandidate] = useState<OutdoorRouteCandidate | null>(null)
  const [selectedPickSource, setSelectedPickSource] = useState<'node' | 'edge' | 'list' | null>(null)

  const contextBuildings = campusBuildings.length > 0 ? campusBuildings : [building]
  const campusGraphNodes = useMemo(() => buildCampusNavigationNodes(nodes), [nodes])
  const campusGraphEdges = useMemo(() => buildCampusNavigationEdges(campusGraphNodes, edges), [campusGraphNodes, edges])
  const campusPositions = useMemo(() => [
    ...contextBuildings.flatMap((campusBuilding) => campusBuilding.outline ?? campusBuilding.footprint ?? []),
    ...campusRoads.flatMap((road) => road.polyline?.points ?? []),
    ...campusAreas.flatMap((area) => area.points),
    ...campusGraphNodes.map((node) => node.position),
    entrance.position,
  ].filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng)), [campusAreas, campusGraphNodes, campusRoads, contextBuildings, entrance.position])

  const nearbyCandidates = useMemo(
    () => buildOutdoorRouteCandidates(nodes, building, entrance, { includeAll: false }),
    [building, entrance, nodes],
  )
  const allCandidates = useMemo(
    () => buildOutdoorRouteCandidates(nodes, building, entrance, { includeAll: true }),
    [building, entrance, nodes],
  )
  const visibleCandidates = fullCampus || nearbyCandidates.length === 0 ? allCandidates : nearbyCandidates

  const fitMap = useCallback((showFullCampus: boolean) => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const buildingPoints = (building.outline ?? building.footprint ?? []).filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng))
    const positions = showFullCampus ? campusPositions : buildingPoints
    const bounds = showFullCampus ? boundsForPositions(positions, 70) : buildingPickerBounds(building, 25)
    if (!bounds) return
    try {
      map.fitBounds(bounds, { padding: 28, maxZoom: showFullCampus ? 17 : 20, duration: 0 })
    } catch {
      setMapError('The outdoor map could not be centered. Try viewing the full campus.')
    }
  }, [building, campusPositions, mapReady])

  useEffect(() => {
    if (!open || !containerRef.current) return
    let active = true
    let initialized = false
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: OSM_STYLE,
      center: (() => {
        const center = outdoorRoutePickerCenter(building, entrance)
        return [center.lng, center.lat] as [number, number]
      })(),
      zoom: 18,
      attributionControl: false,
    })
    mapRef.current = map
    setMapReady(false)
    setMapError(null)

    const initialize = () => {
      if (!active || initialized || !isStyleReady(map)) return
      try {
        addPickerSourcesAndLayers(map)
        initialized = true
        setMapReady(true)
      } catch {
        setMapError('The outdoor map is still loading. Try again in a moment.')
      }
    }

    map.on('load', initialize)
    map.on('idle', initialize)
    map.on('styledata', initialize)
    initialize()
    const retryTimer = window.setInterval(initialize, 50)

    return () => {
      active = false
      window.clearInterval(retryTimer)
      try { map.off('load', initialize) } catch { /* map may already be removed */ }
      try { map.off('idle', initialize) } catch { /* map may already be removed */ }
      try { map.off('styledata', initialize) } catch { /* map may already be removed */ }
      try { map.remove() } catch { /* map may already be removed */ }
      if (mapRef.current === map) mapRef.current = null
      setMapReady(false)
    }
  }, [building.id, entrance.id, open])

  useEffect(() => {
    if (!open) return
    setFullCampus(false)
    setSelectedNodeId(null)
    setSelectedCandidate(null)
    setSelectedPickSource(null)
  }, [building.id, entrance.id, open])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const nodeFeatures: GeoJSON.Feature[] = visibleCandidates.map((candidate) => pointFeature(candidate.position, { id: candidate.id, label: candidate.label, type: candidate.type }))
    const campusNodeFeatures: GeoJSON.Feature[] = campusGraphNodes.map((node) => pointFeature(node.position, { id: node.id, label: node.name ?? node.label, type: node.type }))
    const selectionFeatures = selectedCandidate
      ? [pointFeature(selectedCandidate.position, { id: selectedCandidate.id })]
      : []
    const entranceFeature = pointFeature(entrance.position, { id: entrance.id, label: entrance.name })

    try {
      setSourceData(map, SOURCE_IDS.campusRoads, campusRoadsFeature(campusRoads))
      setSourceData(map, SOURCE_IDS.campusAreas, campusAreasFeature(campusAreas))
      setSourceData(map, SOURCE_IDS.campusBuildings, campusBuildingsFeature(contextBuildings, building.id))
      setSourceData(map, SOURCE_IDS.campusGraphNodes, { type: 'FeatureCollection', features: campusNodeFeatures })
      setSourceData(map, SOURCE_IDS.building, buildingFeature(building))
      setSourceData(map, SOURCE_IDS.entrance, { type: 'FeatureCollection', features: [entranceFeature] })
      setSourceData(map, SOURCE_IDS.nodes, { type: 'FeatureCollection', features: nodeFeatures })
      setSourceData(map, SOURCE_IDS.edges, routeEdgeFeatures(campusGraphNodes, campusGraphEdges))
      setSourceData(map, SOURCE_IDS.selection, { type: 'FeatureCollection', features: selectionFeatures })
      setSourceData(map, SOURCE_IDS.pendingAccess, pendingAccessFeature(entrance, selectedCandidate))
    } catch {
      setMapError('The outdoor route display could not be updated.')
    }
  }, [building, campusAreas, campusGraphEdges, campusGraphNodes, campusRoads, contextBuildings, entrance, mapReady, selectedCandidate, visibleCandidates])

  useEffect(() => {
    fitMap(fullCampus)
  }, [fitMap, fullCampus])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return

    const selectFromMap = (request: Parameters<typeof resolveOutdoorRoutePick>[0]) => {
      const result = resolveOutdoorRoutePick(request, nodes, edges)
      if (!result) return
      setSelectedNodeId(result.candidate.id)
      setSelectedCandidate(result.candidate)
      setSelectedPickSource(result.source)
      setMapError(null)
    }
    const handleNodeClick = (event: maplibregl.MapLayerMouseEvent) => {
      const nodeId = event.features?.[0]?.properties?.id
      if (typeof nodeId === 'string') selectFromMap({ kind: 'node', nodeId })
    }
    const handleEdgeClick = (event: maplibregl.MapLayerMouseEvent) => {
      const edgeId = event.features?.[0]?.properties?.id
      if (typeof edgeId === 'string') selectFromMap({ kind: 'edge', edgeId, lngLat: { lat: event.lngLat.lat, lng: event.lngLat.lng }, anchor: entrance.position })
    }

    map.on('click', LAYER_IDS.nodes, handleNodeClick)
    map.on('click', LAYER_IDS.nodesHit, handleNodeClick)
    map.on('click', LAYER_IDS.edges, handleEdgeClick)
    map.on('click', LAYER_IDS.edgesHit, handleEdgeClick)
    return () => {
      try { map.off('click', LAYER_IDS.nodes, handleNodeClick) } catch { /* map may be removed */ }
      try { map.off('click', LAYER_IDS.nodesHit, handleNodeClick) } catch { /* map may be removed */ }
      try { map.off('click', LAYER_IDS.edges, handleEdgeClick) } catch { /* map may be removed */ }
      try { map.off('click', LAYER_IDS.edgesHit, handleEdgeClick) } catch { /* map may be removed */ }
    }
  }, [edges, mapReady, nodes])

  if (!open) return null

  const selectionDescription = selectedPickSource === 'edge'
    ? 'Creates a new junction at the selected route position'
    : selectedPickSource === 'node'
      ? 'Reuses the selected outdoor route node'
      : 'Selected from the route list'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Choose outdoor route"
      style={{
        position: 'absolute', inset: 18, zIndex: 40, display: 'flex', flexDirection: 'column',
        background: '#0F172A', border: '1px solid #334155', borderRadius: 10, overflow: 'hidden',
        boxShadow: '0 18px 50px rgba(0,0,0,0.45)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 14px', borderBottom: '1px solid #334155' }}>
        <div>
          <div style={{ color: '#F8FAFC', fontSize: 13, fontWeight: 700 }}>Connect Entrance to Outdoor Route</div>
          <div style={{ color: '#94A3B8', fontSize: 10, marginTop: 2 }}>Choose the outdoor point that visitors will use to enter {building.name}.</div>
        </div>
        <button type="button" onClick={onCancel} aria-label="Close outdoor route picker" style={{ border: 'none', background: 'transparent', color: '#94A3B8', fontSize: 18, cursor: 'pointer' }}>×</button>
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 300 }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 0, background: '#CBD5E1' }}>
          <div ref={containerRef} data-testid="outdoor-route-picker-map" style={{ position: 'absolute', inset: 0 }} />
          {!mapReady && <div role="status" style={{ position: 'absolute', top: 10, left: 10, padding: '5px 8px', borderRadius: 4, background: 'rgba(15,23,42,0.85)', color: '#E2E8F0', fontSize: 10 }}>Loading outdoor map…</div>}
          <div style={{ position: 'absolute', top: 10, left: 10, right: 10, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
            <div style={{ padding: '5px 8px', borderRadius: 4, background: 'rgba(15,23,42,0.85)', color: '#F8FAFC', fontSize: 10 }}>
              <strong>Campus navigation map</strong> · <span style={{ color: '#FBBF24' }}>Current: <span>{building.name}</span> · <span>{entrance.name}</span></span>
            </div>
          </div>
        </div>

        <div style={{ width: 250, padding: 12, overflowY: 'auto', borderLeft: '1px solid #334155', background: '#111827' }}>
          <div style={{ color: '#CBD5E1', fontSize: 11, fontWeight: 700, marginBottom: 4 }}>Choose the outdoor route target</div>
          <div style={{ color: '#94A3B8', fontSize: 10, lineHeight: 1.4, marginBottom: 8 }}>Entrance is the fixed source. Click an outdoor node to reuse it, or click a route line to create a junction exactly where you clicked. Nothing is saved until confirmation.</div>

          <div role="status" aria-label="Campus navigation graph summary" style={{ padding: '6px 7px', borderRadius: 4, background: '#172033', border: '1px solid #334155', color: '#CBD5E1', fontSize: 9, marginBottom: 8 }}>
            Campus navigation graph · {campusGraphNodes.length} nodes · {campusGraphEdges.length} edges
          </div>

          {campusGraphEdges.length === 0 && campusRoads.length > 0 && (
            <div style={{ padding: '6px 7px', borderRadius: 4, background: '#2A2412', border: '1px solid #66531A', color: '#FDE68A', fontSize: 10, marginBottom: 8 }}>
              Campus roads are visible, but no authored outdoor graph edges are available yet.
            </div>
          )}

          {mapError && <div role="alert" style={{ padding: '6px 7px', borderRadius: 4, background: '#3F1D1D', border: '1px solid #7F1D1D', color: '#FCA5A5', fontSize: 10, marginBottom: 8 }}>{mapError}</div>}

          {nearbyCandidates.length === 0 && allCandidates.length > 0 && !fullCampus && (
            <div style={{ padding: '6px 7px', borderRadius: 4, background: '#2A2412', border: '1px solid #66531A', color: '#FDE68A', fontSize: 10, marginBottom: 8 }}>
              No outdoor route point is close to this building.
              <button type="button" onClick={() => setFullCampus(true)} style={{ display: 'block', marginTop: 5, padding: 0, border: 'none', background: 'transparent', color: '#FBBF24', fontSize: 10, cursor: 'pointer', textDecoration: 'underline' }}>View full campus</button>
            </div>
          )}

          {allCandidates.length === 0 ? (
            <div style={{ padding: '7px', borderRadius: 4, background: '#1E293B', color: '#94A3B8', fontSize: 10 }}>No outdoor route points are available on this campus yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {(fullCampus ? allCandidates : visibleCandidates).map((candidate) => {
                const selected = candidate.id === selectedNodeId
                return (
                  <button key={candidate.id} type="button" aria-pressed={selected} onClick={() => { setSelectedNodeId(candidate.id); setSelectedCandidate(candidate); setSelectedPickSource('list'); setMapError(null) }} style={{ display: 'flex', alignItems: 'center', gap: 7, width: '100%', padding: '7px 8px', borderRadius: 5, border: `1px solid ${selected ? '#22C55E' : '#334155'}`, background: selected ? '#16351F' : '#1E293B', color: '#E2E8F0', textAlign: 'left', cursor: 'pointer' }}>
                    <span style={{ width: 9, height: 9, flex: '0 0 auto', borderRadius: '50%', background: selected ? '#22C55E' : '#0284C7', border: '1px solid #E0F2FE' }} />
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ display: 'block', fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{candidate.label}</span>
                      <span style={{ display: 'block', marginTop: 2, color: '#94A3B8', fontSize: 9 }}>{candidate.type} · {candidate.distanceMeters.toFixed(0)} m away</span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}

          {allCandidates.length > 0 && (
            <button type="button" onClick={() => setFullCampus((value) => !value)} style={{ width: '100%', marginTop: 8, padding: '5px 0', border: '1px solid #475569', borderRadius: 4, background: 'transparent', color: '#CBD5E1', fontSize: 10, cursor: 'pointer' }}>{fullCampus ? 'Focus on current building' : 'View full campus'}</button>
          )}

          {selectedCandidate && (
            <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid #334155' }}>
              <div style={{ color: '#4ADE80', fontSize: 10, fontWeight: 700 }}>Selected outdoor target</div>
              <div style={{ color: '#F8FAFC', fontSize: 12, fontWeight: 700, marginTop: 3 }}>{selectedCandidate.label}</div>
              <div style={{ color: '#94A3B8', fontSize: 9, marginTop: 3 }}>{selectionDescription} · {selectedCandidate.distanceMeters.toFixed(0)} m from Entrance</div>
              <div role="status" aria-label="Pending outdoor connection preview" style={{ marginTop: 6, padding: '5px 6px', borderRadius: 4, background: '#16351F', border: '1px dashed #22C55E', color: '#BBF7D0', fontSize: 9 }}>Unsaved preview · Entrance → {selectedCandidate.label}</div>
              <div style={{ color: '#64748B', fontSize: 9, marginTop: 5 }}>{selectedCandidate.targetKind === 'segment' ? 'Confirming stores the authored route ID and this position, then Route authoring will connect the indoor path’s first node to this Entrance.' : 'Confirming stores this explicit outdoor target, then Route authoring will connect the indoor path’s first node to this Entrance.'}</div>
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 7, padding: '9px 12px', borderTop: '1px solid #334155' }}>
        <button type="button" onClick={onCancel} style={{ padding: '6px 12px', borderRadius: 4, border: '1px solid #475569', background: 'transparent', color: '#CBD5E1', fontSize: 10, cursor: 'pointer' }}>Cancel</button>
        <button type="button" onClick={() => { if (selectedCandidate) onConfirm(selectedCandidate) }} disabled={!selectedCandidate} aria-label="Confirm outdoor connection" style={{ padding: '6px 12px', borderRadius: 4, border: '1px solid #16A34A', background: selectedCandidate ? '#16A34A' : '#334155', color: selectedCandidate ? '#F0FDF4' : '#64748B', fontSize: 10, fontWeight: 700, cursor: selectedCandidate ? 'pointer' : 'not-allowed' }}>Confirm outdoor connection</button>
      </div>
    </div>
  )
}
