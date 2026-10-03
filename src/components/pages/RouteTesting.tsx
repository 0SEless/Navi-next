import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import maplibregl from 'maplibre-gl'
import {
  Route, RotateCcw, AlertTriangle, CheckCircle,
  Activity, XCircle, X, MapPin,
  Search, Navigation as NavigationIcon,
} from 'lucide-react'
import type { NavNode, NavEdge, PathResult } from '@/types/nav-types'
import { getAdjacencyList } from '@/engine/a-star'
import { findCanonicalRoutePath } from '@/engine/canonical-routing-adapter'
import {
  getTerrainValidationCase,
  getTerrainValidationFixture,
  matchesTerrainExpectation,
  summarizeTerrainRoute,
  TERRAIN_VALIDATION_PROFILE,
  terrainValidationFixtures,
  type TerrainValidationCase,
  type TerrainValidationFixture,
} from '@/engine/fixtures/terrain-validation-fixtures'
import { usePublicStore } from '@/store/public-store'
import { RouteOverlay } from './RouteOverlay'
import { BASE_STYLES, DEFAULT_BASE_STYLE } from '@/components/studio/rendering/styles'
import { BuildingLayer } from '@/components/map/layers/BuildingLayer'
import { BoundaryLayer } from '@/components/map/layers/BoundaryLayer'
import { EntranceLayer } from '@/components/map/layers/EntranceLayer'
import { buildFromCampusBundle, type NavigationRenderModel } from '@/components/map/NavigationRenderModel'

export interface GraphHealth {
  total: number
  connected: number
  disconnected: number
  isolated: number
  components: number
  deadEnds: number
  avgDegree: number
  maxDegree: number
  nodeTypes: Record<string, number>
  warnings: Array<{ nodeIds: string[]; message: string }>
}

export function findNearestNode(
  pos: { lat: number; lng: number },
  nodes: NavNode[],
  maxSnapMeters?: number,
): NavNode | null {
  const toRad = (d: number) => (d * Math.PI) / 180
  const R = 6371000
  let best: NavNode | null = null
  let bestDist = Infinity
  for (const n of nodes) {
    const dLat = toRad(n.position.lat - pos.lat)
    const dLng = toRad(n.position.lng - pos.lng)
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(pos.lat)) * Math.cos(toRad(n.position.lat)) * Math.sin(dLng / 2) ** 2
    const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    if (dist < bestDist) { bestDist = dist; best = n }
  }
  if (!best || (maxSnapMeters !== undefined && bestDist > maxSnapMeters)) return null
  return best
}

export function computeGraphHealth(nodes: NavNode[], edges: NavEdge[]): GraphHealth {
  const adj: Record<string, string[]> = {}
  for (const n of nodes) adj[n.id] = []
  for (const e of edges) {
    adj[e.from]?.push(e.to)
    adj[e.to]?.push(e.from)
  }

  const degree = new Map<string, number>()
  const nodeTypes: Record<string, number> = {}
  for (const n of nodes) {
    degree.set(n.id, adj[n.id]?.length ?? 0)
    nodeTypes[n.type] = (nodeTypes[n.type] ?? 0) + 1
  }

  const visited = new Set<string>()
  let components = 0
  function bfs(startId: string) {
    const queue = [startId]
    visited.add(startId)
    while (queue.length > 0) {
      const cur = queue.shift()!
      for (const neighbor of (adj[cur] ?? [])) {
        if (!visited.has(neighbor)) { visited.add(neighbor); queue.push(neighbor) }
      }
    }
  }
  for (const n of nodes) {
    if (!visited.has(n.id)) { components++; bfs(n.id) }
  }

  const isolated = nodes.filter(n => (degree.get(n.id) ?? 0) === 0).length
  const disconnected = nodes.filter(n => !visited.has(n.id)).length
  const deadEnds = nodes.filter(n => (degree.get(n.id) ?? 0) === 1).length
  const degrees = nodes.map(n => degree.get(n.id) ?? 0)
  const avgDegree = degrees.length > 0 ? degrees.reduce((a, b) => a + b, 0) / degrees.length : 0
  const maxDegree = degrees.length > 0 ? Math.max(...degrees) : 0

  const warnings: Array<{ nodeIds: string[]; message: string }> = []
  if (deadEnds > 0) warnings.push({ nodeIds: nodes.filter(n => (degree.get(n.id) ?? 0) === 1).map(n => n.id), message: `${deadEnds} dead-end node${deadEnds > 1 ? 's' : ''} (degree 1)` })
  if (isolated > 0) warnings.push({ nodeIds: nodes.filter(n => (degree.get(n.id) ?? 0) === 0).map(n => n.id), message: `${isolated} isolated node${isolated > 1 ? 's' : ''} (no edges)` })

  return { total: nodes.length, connected: nodes.length - disconnected, disconnected, isolated, components, deadEnds, avgDegree, maxDegree, nodeTypes, warnings }
}

export interface RouteStepInfo {
  nodeId: string
  nodeLabel: string
  nodeType: string
  edge: NavEdge | null
  edgeId?: string
  distance: number
  instruction: string
}

export function computeRouteSteps(
  path: string[],
  nodes: NavNode[],
  edges: NavEdge[],
  selectedEdgeIds?: Array<string | undefined>,
): RouteStepInfo[] {
  return path.map((nodeId, i) => {
    const node = nodes.find(n => n.id === nodeId)
    if (!node) return null
    const prevId = i > 0 ? path[i - 1] : null
    const selectedEdgeId = selectedEdgeIds?.[i]
    const edge = prevId
      ? selectedEdgeId
        ? edges.find((candidate) => candidate.id === selectedEdgeId) ?? null
        : edges.find(e =>
          (e.from === prevId && e.to === nodeId) || (e.from === nodeId && e.to === prevId)
        ) ?? null
      : null
    const distance = edge?.distance ?? 0

    let instruction = ''
    if (i === 0) instruction = 'Start'
    else if (i === path.length - 1) instruction = 'Destination'
    else if (node.type === 'entrance' || node.type === 'building_entrance') instruction = 'Enter building'
    else if (node.type === 'staircase' || node.type === 'stair') instruction = 'Use stairs'
    else if (node.type === 'elevator') instruction = 'Use elevator'
    else instruction = `Walk ${distance}m`

    return {
      nodeId,
      nodeLabel: node.name || node.label || node.id,
      nodeType: node.type,
      edge,
      ...(edge?.id ? { edgeId: edge.id } : {}),
      distance,
      instruction,
    }
  }).filter(Boolean) as RouteStepInfo[]
}

interface CampusListItem {
  id: string
  campus_id: string
  building_count: number
}

function metric(value: number | undefined, suffix = ''): string {
  return value === undefined ? '—' : `${Number.isInteger(value) ? value : value.toFixed(2)}${suffix}`
}

interface TerrainValidationDiagnosticsProps {
  fixture: TerrainValidationFixture
  fixtureCase: TerrainValidationCase
  result: PathResult | null
  edges: NavEdge[]
}

function TerrainValidationDiagnostics({ fixture, fixtureCase, result, edges }: TerrainValidationDiagnosticsProps) {
  const actual = summarizeTerrainRoute(result)
  const passed = matchesTerrainExpectation(fixtureCase.expected, actual)
  const selectedEdges = actual.selectedEdgeIds
    .map((edgeId) => edges.find((edge) => edge.id === edgeId))
    .filter((edge): edge is NavEdge => Boolean(edge?.routing))

  return (
    <div
      data-testid="terrain-validation-diagnostics"
      style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 7, padding: 10, margin: '0 14px 10px' }}
    >
      <div style={{ color: '#1D4ED8', fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', marginBottom: 6 }}>TERRAIN VALIDATION</div>
      <div style={{ color: 'var(--navi-text)', fontSize: 11, fontWeight: 700, marginBottom: 6 }}>{fixture.name}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, fontSize: 9 }}>
        <span style={{ color: 'var(--navi-text-secondary)' }}>Profile</span>
        <span style={{ color: 'var(--navi-text)', fontFamily: 'monospace' }}>{TERRAIN_VALIDATION_PROFILE}</span>
        <span style={{ color: 'var(--navi-text-secondary)' }}>Origin</span>
        <span style={{ color: 'var(--navi-text)', fontFamily: 'monospace' }}>{fixtureCase.origin}</span>
        <span style={{ color: 'var(--navi-text-secondary)' }}>Destination</span>
        <span style={{ color: 'var(--navi-text)', fontFamily: 'monospace' }}>{fixtureCase.destination}</span>
        <span style={{ color: 'var(--navi-text-secondary)' }}>Route found</span>
        <span style={{ color: 'var(--navi-text)', fontWeight: 700 }}>{actual.routeFound ? 'yes' : 'no'}</span>
        <span style={{ color: 'var(--navi-text-secondary)' }}>Selected edge IDs</span>
        <span style={{ color: 'var(--navi-text)', fontFamily: 'monospace', wordBreak: 'break-word' }}>{actual.selectedEdgeIds.join(', ') || '—'}</span>
        <span style={{ color: 'var(--navi-text-secondary)' }}>Physical distance</span>
        <span style={{ color: 'var(--navi-text)', fontWeight: 700 }}>{metric(actual.physicalDistance, ' m')}</span>
        <span style={{ color: 'var(--navi-text-secondary)' }}>Generalized cost</span>
        <span style={{ color: 'var(--navi-text)', fontWeight: 700 }}>{metric(actual.generalizedCost)}</span>
        <span style={{ color: 'var(--navi-text-secondary)' }}>Expected edge IDs</span>
        <span style={{ color: 'var(--navi-text)', fontFamily: 'monospace', wordBreak: 'break-word' }}>{fixtureCase.expected.selectedEdgeIds.join(', ') || '—'}</span>
        <span style={{ color: 'var(--navi-text-secondary)' }}>Expected result</span>
        <span style={{ color: 'var(--navi-text)' }}>{fixtureCase.expected.routeFound ? 'route found' : 'no route'}</span>
        <span style={{ color: 'var(--navi-text-secondary)' }}>Actual result</span>
        <span style={{ color: 'var(--navi-text)' }}>{actual.routeFound ? 'route found' : 'no route'}</span>
      </div>
      <div style={{ marginTop: 8, color: passed ? '#047857' : '#B91C1C', fontSize: 11, fontWeight: 800 }}>{passed ? 'PASS' : 'FAIL'}</div>
      {selectedEdges.length > 0 && (
        <details style={{ marginTop: 6, color: 'var(--navi-text-secondary)', fontSize: 9 }}>
          <summary style={{ cursor: 'pointer' }}>Selected Road metadata</summary>
          {selectedEdges.map((edge) => (
            <div key={edge.id} style={{ marginTop: 4, fontFamily: 'monospace' }}>
              {edge.id}: {edge.routing?.authored.feature ?? 'normal'} · {edge.routing?.authored.slope ?? 'level'} · {edge.routing?.authored.direction ?? 'both'} · walkable {edge.routing?.authored.walkable === undefined ? 'unknown' : String(edge.routing.authored.walkable)} · {edge.routing.sourceRoadId}
            </div>
          ))}
        </details>
      )}
    </div>
  )
}

export function NavigationInspector() {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [, forceRender] = useState(0) // Force re-render when map is created

  // Campus selector state
  const [campuses, setCampuses] = useState<CampusListItem[]>([])
  const [selectedCampusId, setSelectedCampusId] = useState<string | null>(null)
  const [dataSource, setDataSource] = useState<'campus' | 'terrain-fixture'>('campus')
  const [selectedFixtureId, setSelectedFixtureId] = useState(terrainValidationFixtures[0]?.id ?? '')
  const [selectedFixtureCaseId, setSelectedFixtureCaseId] = useState('')
  const localFixtureEnabled = process.env.NODE_ENV !== 'production'
  const activeFixture = localFixtureEnabled && dataSource === 'terrain-fixture'
    ? getTerrainValidationFixture(selectedFixtureId) ?? null
    : null
  const activeFixtureCase = activeFixture
    ? getTerrainValidationCase(activeFixture, selectedFixtureCaseId || undefined) ?? null
    : null

  // Load campus data from public-store (same source as navigate page)
  const campus = usePublicStore((s) => s.campus)
  const campusLoading = usePublicStore((s) => s.campusLoading)
  const campusError = usePublicStore((s) => s.campusError)
  const fetchCampusData = usePublicStore((s) => s.fetchCampusData)

  // Fetch available campuses on mount
  useEffect(() => {
    let cancelled = false
    async function loadCampuses() {
      try {
        const res = await fetch('/api/campuses')
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled && Array.isArray(data) && data.length > 0) {
          setCampuses(data)
          // Auto-select the first campus that has data (skip empty drafts)
          if (!selectedCampusId) {
            const firstWithData = data.find((c) => (c.building_count ?? 0) > 0) ?? data[0]
            setSelectedCampusId(firstWithData.campus_id)
          }
        }
      } catch { /* ignore */ }
    }
    void loadCampuses()
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch campus data when selected campus changes
  useEffect(() => {
    if (dataSource !== 'campus') return
    if (!selectedCampusId) return
    if (campus && campus.nodes.length > 0) return // already loaded
    if (campusLoading) return

    // Clear old campus data before fetching new
    usePublicStore.setState({
      campus: null,
      campusLoading: false,
      campusStatus: 'idle',
      campusError: null,
      campusData: null,
    })
    void fetchCampusData(selectedCampusId)
  }, [dataSource, selectedCampusId, campus, campusLoading, fetchCampusData])

  // Handle campus switch
  const handleCampusChange = (newCampusId: string) => {
    if (newCampusId === selectedCampusId) return
    setSelectedCampusId(newCampusId)
    // Clear campus cache so fetchCampusData re-fetches
    usePublicStore.setState({
      campus: null,
      campusLoading: false,
      campusStatus: 'idle',
      campusError: null,
      campusData: null,
      selectedBuilding: null,
      selectedNode: null,
      fromNode: null,
      toNode: null,
    })
    void fetchCampusData(newCampusId)
  }

  // Use campus data from public-store as the sole runtime source
  // No compiled graph fallback, no mock data fallback
  const activeNodes = useMemo(() => {
    if (activeFixture) return activeFixture.nodes
    if (campus && campus.nodes.length > 0) return campus.nodes
    return []
  }, [activeFixture, campus])

  const activeEdges = useMemo(() => {
    if (activeFixture) return activeFixture.edges
    if (campus && campus.edges.length > 0) return campus.edges
    return []
  }, [activeFixture, campus])

  // Campus buildings for rendering building polygons
  const campusBuildings = activeFixture ? [] : campus?.buildings ?? []

  const graphHealth = activeNodes.length > 0 ? computeGraphHealth(activeNodes, activeEdges) : null
  const isHealthy = graphHealth && graphHealth.disconnected === 0 && graphHealth.isolated === 0

  const [startId, setStartId] = useState<string>('N014')
  const [endId, setEndId] = useState<string>('N001')
  const [routeResult, setRouteResult] = useState<PathResult | null>(null)
  const [animStep, setAnimStep] = useState(-1)
  const [disconnectedNodes, setDisconnectedNodes] = useState<string[]>([])
  const [activeTab, setActiveTab] = useState<'routing' | 'diagnostics'>('routing')
  const [showGraph, setShowGraph] = useState(true)
  const [showRoute, setShowRoute] = useState(true)
  const [showSnapIndicators, setShowSnapIndicators] = useState(true)
  const [showLabels, setShowLabels] = useState(false)
  const [showNodeIds, setShowNodeIds] = useState(false)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)

  // ── Preview search state ──
  const [previewQuery, setPreviewQuery] = useState('')
  const [previewPicker, setPreviewPicker] = useState<'from' | 'to' | null>(null)
  const [previewFrom, setPreviewFrom] = useState<string | null>(null)
  const [previewTo, setPreviewTo] = useState<string | null>(null)
  const [directionsCollapsed, setDirectionsCollapsed] = useState(false)

  // ── Pin state (drag-and-drop pin placement) ──
  const [startPin, setStartPin] = useState<{ lat: number; lng: number } | null>(null)
  const [endPin, setEndPin] = useState<{ lat: number; lng: number } | null>(null)
  const [dragging, setDragging] = useState<'start' | 'end' | null>(null)
  const SNAP_THRESHOLD_METERS = 50

  const nearestStart = useMemo(() => startPin ? findNearestNode(startPin, activeNodes, SNAP_THRESHOLD_METERS) : null, [startPin, activeNodes])
  const nearestEnd = useMemo(() => endPin ? findNearestNode(endPin, activeNodes, SNAP_THRESHOLD_METERS) : null, [endPin, activeNodes])

  const startNode = nearestStart ?? activeNodes.find(n => n.id === startId) ?? null
  const endNode = nearestEnd ?? activeNodes.find(n => n.id === endId) ?? null

  const selectedNode = selectedNodeId ? activeNodes.find(n => n.id === selectedNodeId) ?? null : null
  const hoveredNode = hoveredNodeId ? activeNodes.find(n => n.id === hoveredNodeId) ?? null : null

  // Auto-route: run A* whenever start/end change
  useEffect(() => {
    if (!startNode || !endNode) {
      setRouteResult(null)
      setAnimStep(-1)
      return
    }
    if (activeNodes.length === 0 || activeEdges.length === 0) return

    const result = findCanonicalRoutePath(activeNodes, activeEdges, startNode.id, endNode.id)
    setRouteResult(result)
    setAnimStep(-1)

    if (result) {
      const pathNodes = result.path.map(id => activeNodes.find(n => n.id === id)).filter(Boolean) as NavNode[]
      if (pathNodes.length > 0 && mapRef.current) {
        const bounds = new maplibregl.LngLatBounds()
        pathNodes.forEach(n => bounds.extend([n.position.lng, n.position.lat]))
        mapRef.current.fitBounds(bounds, { padding: 80, duration: 1200, maxZoom: 19 })
      }

      if (result.path.length > 1) {
        setAnimStep(0)
        let step = 0
        const interval = setInterval(() => {
          step++
          setAnimStep(step)
          if (step >= result.path.length - 1) clearInterval(interval)
        }, 200)
        return () => clearInterval(interval)
      }
    }
  }, [startNode, endNode, activeNodes, activeEdges, mapRef.current])

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedNodeId(null)
        setHoveredNodeId(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const snapLines = useMemo(() => {
    const lines: Array<{ from: [number, number]; to: [number, number]; color: string }> = []
    if (startPin && nearestStart) {
      lines.push({
        from: [startPin.lng, startPin.lat],
        to: [nearestStart.position.lng, nearestStart.position.lat],
        color: '#22C55E',
      })
    }
    if (endPin && nearestEnd) {
      lines.push({
        from: [endPin.lng, endPin.lat],
        to: [nearestEnd.position.lng, nearestEnd.position.lat],
        color: '#3B82F6',
      })
    }
    return lines
  }, [startPin, nearestStart, endPin, nearestEnd])

  // ── Render model for building layers ──
  // Build directly from campus data — no conversion to compiler format
  const renderModel = useMemo<NavigationRenderModel | null>(() => {
    if (campusBuildings.length === 0 || activeNodes.length === 0) return null

    const model = buildFromCampusBundle({
      buildings: campusBuildings,
      nodes: activeNodes,
      edges: activeEdges,
      boundingBox: campus?.boundingBox ?? null,
      components: campus?.components,
    })

    console.log(`[RouteTesting] renderModel: ${model.buildings.length} buildings from ${campusBuildings.length} campus buildings, ${activeNodes.length} nodes`)
    for (const b of model.buildings) {
      console.log(`  building ${b.id}: footprint=${b.footprint.length} points, color=${b.color}, height=${b.height}`)
    }
    return model
  }, [campusBuildings, activeNodes, activeEdges, campus?.boundingBox, campus?.components])

  // ── Preview search results ──
  const previewSearchResults = useMemo(() => {
    if (!previewPicker || !renderModel) return []
    const query = previewQuery.toLowerCase()
    return renderModel.nodes
      .filter(n => {
        const label = (n.name || n.label || n.id).toLowerCase()
        return label.includes(query)
      })
      .slice(0, 10)
  }, [previewPicker, previewQuery, renderModel])

  // ── Preview route ──
  const previewRoute = useMemo(() => {
    if (!previewFrom || !previewTo || !renderModel) return null
    return findCanonicalRoutePath(renderModel.nodes, renderModel.edges, previewFrom, previewTo)
  }, [previewFrom, previewTo, renderModel])

  const flashNode = useCallback((nodeId: string) => {
    const node = activeNodes.find(n => n.id === nodeId)
    if (!node || !mapRef.current) return
    const map = mapRef.current

    map.flyTo({
      center: [node.position.lng, node.position.lat],
      zoom: 18,
      duration: 600,
    })

    const flashId = `flash-${nodeId}`
    if (map.getLayer(flashId)) map.removeLayer(flashId)
    if (map.getSource(flashId)) map.removeSource(flashId)

    map.addSource(flashId, {
      type: 'geojson',
      data: { type: 'Feature', geometry: { type: 'Point', coordinates: [node.position.lng, node.position.lat] }, properties: {} },
    })
    map.addLayer({
      id: flashId, type: 'circle', source: flashId,
      paint: { 'circle-radius': 20, 'circle-color': '#EAB308', 'circle-opacity': 0.8 },
    })

    let opacity = 0.8
    const fade = setInterval(() => {
      opacity -= 0.05
      if (opacity <= 0) {
        clearInterval(fade)
        try { map.removeLayer(flashId); map.removeSource(flashId) } catch {}
      } else {
        map.setPaintProperty(flashId, 'circle-opacity', opacity)
      }
    }, 50)
  }, [activeNodes])

  // ── Initialize MapLibre map ──
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: BASE_STYLES[DEFAULT_BASE_STYLE].style,
      center: [122.171, 11.8177],
      zoom: 16,
      pitch: 0,
    })

    // Suppress tile fetch errors (e.g., zoom beyond OSM tile coverage)
    map.on('error', (e) => {
      if (e.error?.status === 0 || `${e.error}`.includes('Failed to fetch') || `${e.error}`.includes('CORS')) return
      console.error(e.error)
    })

    map.addControl(new maplibregl.NavigationControl(), 'top-right')
    mapRef.current = map
    forceRender(n => n + 1) // Trigger re-render so BuildingLayer receives the map

    return () => {
      try { map.remove() } catch {}
      mapRef.current = null
    }
  }, [])

  // ── Fit bounds to nodes when data changes ──
  useEffect(() => {
    const map = mapRef.current
    if (!map || activeNodes.length === 0) return

    const bounds = new maplibregl.LngLatBounds()
    activeNodes.forEach(n => bounds.extend([n.position.lng, n.position.lat]))
    map.fitBounds(bounds, { padding: 60, maxZoom: 17, duration: 0 })
  }, [activeNodes])

  // ── Map click handler for pin placement ──
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const handler = (e: maplibregl.MapMouseEvent) => {
      if (dragging) return
      const pos = { lat: e.lngLat.lat, lng: e.lngLat.lng }
      // Place start pin if not set, then end pin
      if (!startPin) {
        setStartPin(pos)
        return
      }
      if (!endPin) {
        setEndPin(pos)
      }
    }
    map.on('click', handler)
    return () => { try { map.off('click', handler) } catch {} }
  }, [mapRef.current, startPin, endPin, dragging])

  // ── Draggable pin markers ──
  const startMarkerRef = useRef<maplibregl.Marker | null>(null)
  const endMarkerRef = useRef<maplibregl.Marker | null>(null)

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    // Start marker
    if (startMarkerRef.current) { startMarkerRef.current.remove(); startMarkerRef.current = null }
    if (startNode) {
      const el = document.createElement('div')
      el.style.cssText = 'width:20px;height:20px;border-radius:50%;background:#059669;border:3px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.3);cursor:grab;display:flex;align-items:center;justify-content:center;'
      const inner = document.createElement('div')
      inner.style.cssText = 'width:6px;height:6px;border-radius:50%;background:white;'
      el.appendChild(inner)
      const marker = new maplibregl.Marker({ element: el, draggable: true })
        .setLngLat([startPin?.lng ?? startNode.position.lng, startPin?.lat ?? startNode.position.lat])
        .addTo(map)
      marker.on('dragstart', () => { setDragging('start'); map.dragPan.disable() })
      marker.on('drag', (e) => { /* position updates handled by setDragging */ })
      marker.on('dragend', (e) => {
        map.dragPan.enable()
        setDragging(null)
        const lngLat = marker.getLngLat()
        setStartPin({ lat: lngLat.lat, lng: lngLat.lng })
      })
      startMarkerRef.current = marker
    }

    // End marker
    if (endMarkerRef.current) { endMarkerRef.current.remove(); endMarkerRef.current = null }
    if (endNode) {
      const el = document.createElement('div')
      el.style.cssText = 'width:20px;height:20px;border-radius:50%;background:#3B82F6;border:3px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.3);cursor:grab;display:flex;align-items:center;justify-content:center;'
      const inner = document.createElement('div')
      inner.style.cssText = 'width:6px;height:6px;border-radius:50%;background:white;'
      el.appendChild(inner)
      const marker = new maplibregl.Marker({ element: el, draggable: true })
        .setLngLat([endPin?.lng ?? endNode.position.lng, endPin?.lat ?? endNode.position.lat])
        .addTo(map)
      marker.on('dragstart', () => { setDragging('end'); map.dragPan.disable() })
      marker.on('drag', (e) => { /* position updates handled by setDragging */ })
      marker.on('dragend', (e) => {
        map.dragPan.enable()
        setDragging(null)
        const lngLat = marker.getLngLat()
        setEndPin({ lat: lngLat.lat, lng: lngLat.lng })
      })
      endMarkerRef.current = marker
    }

    return () => {
      try { startMarkerRef.current?.remove() } catch {}
      startMarkerRef.current = null
      try { endMarkerRef.current?.remove() } catch {}
      endMarkerRef.current = null
    }
  }, [mapRef.current, startNode, endNode, startPin, endPin])


  const detectDisconnected = useCallback(() => {
    const adj = getAdjacencyList(activeEdges)
    const disconnected = activeNodes.filter(n => !adj[n.id] || adj[n.id].length === 0).map(n => n.id)
    setDisconnectedNodes(disconnected.length > 0 ? disconnected : [])
  }, [activeNodes, activeEdges])

  const reset = useCallback(() => {
    setRouteResult(null)
    setAnimStep(-1)
    setDisconnectedNodes([])
  }, [])

  const clearAll = useCallback(() => {
    setStartId('')
    setEndId('')
    setStartPin(null)
    setEndPin(null)
    setRouteResult(null)
    setAnimStep(-1)
    if (mapRef.current && activeNodes.length > 0) {
      const bounds = new maplibregl.LngLatBounds()
      activeNodes.forEach(n => bounds.extend([n.position.lng, n.position.lat]))
      mapRef.current.fitBounds(bounds, { padding: 40 })
    }
  }, [activeNodes])

  const handleDataSourceChange = (nextSource: 'campus' | 'terrain-fixture') => {
    setDataSource(nextSource)
    setStartPin(null)
    setEndPin(null)
    setPreviewFrom(null)
    setPreviewTo(null)
    setPreviewPicker(null)
    setPreviewQuery('')
    setDisconnectedNodes([])
    if (nextSource === 'campus') {
      setStartId('N014')
      setEndId('N001')
    } else {
      const fixture = getTerrainValidationFixture(selectedFixtureId)
      const fixtureCase = fixture ? getTerrainValidationCase(fixture) : null
      if (fixtureCase) {
        setStartId(fixtureCase.origin)
        setEndId(fixtureCase.destination)
      }
      setSelectedFixtureCaseId(fixture?.defaultCaseId ?? '')
    }
  }

  const resetForFixtureCase = (fixtureCase: TerrainValidationCase | null) => {
    if (!fixtureCase) return
    setStartId(fixtureCase.origin)
    setEndId(fixtureCase.destination)
    setStartPin(null)
    setEndPin(null)
    setPreviewFrom(null)
    setPreviewTo(null)
    setPreviewPicker(null)
    setPreviewQuery('')
    setDisconnectedNodes([])
  }



  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>


      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Map canvas */}
        <div style={{ flex: 1, position: 'relative' }}>
          <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />

          {/* ═══════════════════════════════════════════════════════════
              ROUTING TAB: Graph debug overlay
              ═══════════════════════════════════════════════════════════ */}
          {activeTab === 'routing' && (
            <>
              {/* Visualization toggles */}
              <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 10, background: 'var(--navi-sidebar)', borderRadius: 6, padding: '8px 10px', fontSize: 10, display: 'flex', flexDirection: 'column', gap: 4, opacity: 0.95 }}>
                <div style={{ color: 'var(--navi-text-sidebar)', fontWeight: 600, marginBottom: 2, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Visualization</div>
                {[
                  { label: 'Navigation Graph', checked: showGraph, set: setShowGraph },
                  { label: 'Show Route', checked: showRoute, set: setShowRoute },
                  { label: 'Snap Indicators', checked: showSnapIndicators, set: setShowSnapIndicators },
                  { label: 'Labels', checked: showLabels, set: setShowLabels },
                  { label: 'Node IDs', checked: showNodeIds, set: setShowNodeIds },
                ].map(({ label, checked, set }) => (
                  <label key={label} style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', color: 'var(--navi-text-sidebar)' }}>
                    <input type="checkbox" checked={checked} onChange={(e) => set(e.target.checked)} style={{ width: 12, height: 12 }} />
                    {label}
                  </label>
                ))}
              </div>
              {mapRef.current && (
                <RouteOverlay
                  map={mapRef.current}
                  nodes={activeNodes}
                  edges={activeEdges}
                  path={showRoute ? (routeResult?.path ?? null) : null}
                  animStep={animStep}
                  showGraph={showGraph}
                  showLabels={showLabels}
                  showNodeIds={showNodeIds}
                  snapLines={showSnapIndicators ? snapLines : []}
                  selectedNodeId={selectedNodeId}
                  onNodeHover={setHoveredNodeId}
                  onNodeClick={(nodeId) => {
                    setSelectedNodeId(nodeId)
                    flashNode(nodeId)
                  }}
                />
              )}
              {hoveredNode && (
                <div style={{
                  position: 'absolute', bottom: 50, left: '50%', transform: 'translateX(-50%)',
                  background: 'var(--navi-sidebar)', border: '1px solid var(--navi-content)',
                  borderRadius: 6, padding: '5px 10px', fontSize: 10, color: 'var(--navi-text-sidebar)',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.15)', zIndex: 10, pointerEvents: 'none',
                  whiteSpace: 'nowrap',
                }}>
                  <b>{hoveredNode.name || hoveredNode.label || hoveredNode.id}</b>
                  <span style={{ color: 'var(--navi-text-secondary)', marginLeft: 6 }}>{hoveredNode.type}</span>
                  <span style={{ color: 'var(--navi-text-secondary)', marginLeft: 6 }}>Floor {hoveredNode.floor}</span>
                </div>
              )}
              <div style={{ position: 'absolute', bottom: 10, left: 10, background: 'var(--navi-sidebar)', borderRadius: 6, padding: '4px 8px', fontSize: 9, display: 'flex', gap: 6, opacity: 0.9, zIndex: 10 }}>
                <span style={{ color: '#059669' }}>● Start</span>
                <span style={{ color: '#3B82F6' }}>● End</span>
                <span style={{ color: '#3B82F6' }}>— Route</span>
                <span style={{ color: '#94A3B8' }}>● Nodes</span>
                {disconnectedNodes.length > 0 && <span style={{ color: 'var(--navi-error)' }}>● Disconnected</span>}
              </div>
            </>
          )}

          {/* Building layers — always mounted; each layer guards on map !== null */}
          <BuildingLayer map={mapRef.current} buildings={renderModel?.buildings ?? []} />
          <BoundaryLayer map={mapRef.current} boundary={renderModel?.boundary ?? null} />
          <EntranceLayer map={mapRef.current} entrances={renderModel?.entrances ?? []} />
        </div>

        {/* Right panel */}
        <div style={{ width: 280, background: 'var(--navi-card)', borderLeft: '1px solid var(--navi-border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Development-only source/fixture selector; it never writes store or API state. */}
          {localFixtureEnabled && (
            <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--navi-border)', background: 'var(--navi-content)' }}>
              <label htmlFor="route-data-source" style={{ fontSize: 9, fontWeight: 600, color: 'var(--navi-text-secondary)', display: 'block', marginBottom: 3 }}>DATA SOURCE</label>
              <select
                id="route-data-source"
                aria-label="Route data source"
                value={dataSource}
                onChange={(event) => handleDataSourceChange(event.target.value as 'campus' | 'terrain-fixture')}
                style={{ width: '100%', background: 'var(--navi-sidebar)', border: '1px solid var(--navi-border)', borderRadius: 5, padding: '5px 8px', color: 'var(--navi-text)', fontSize: 11, outline: 'none', cursor: 'pointer' }}
              >
                <option value="campus">Current campus</option>
                <option value="terrain-fixture">Terrain validation fixtures</option>
              </select>
              {activeFixture && (
                <>
                  <label htmlFor="terrain-validation-fixture" style={{ fontSize: 9, fontWeight: 600, color: 'var(--navi-text-secondary)', display: 'block', margin: '7px 0 3px' }}>FIXTURE</label>
                  <select
                    id="terrain-validation-fixture"
                    aria-label="Terrain validation fixture"
                    value={activeFixture.id}
                    onChange={(event) => {
                      const fixture = getTerrainValidationFixture(event.target.value)
                      setSelectedFixtureId(event.target.value)
                      setSelectedFixtureCaseId(fixture?.defaultCaseId ?? '')
                      resetForFixtureCase(fixture ? getTerrainValidationCase(fixture) : null)
                    }}
                    style={{ width: '100%', background: 'var(--navi-sidebar)', border: '1px solid var(--navi-border)', borderRadius: 5, padding: '5px 8px', color: 'var(--navi-text)', fontSize: 10, outline: 'none', cursor: 'pointer' }}
                  >
                    {terrainValidationFixtures.map((fixture) => <option key={fixture.id} value={fixture.id}>{fixture.name}</option>)}
                  </select>
                  {activeFixture.cases.length > 1 && (
                    <>
                      <label htmlFor="terrain-validation-case" style={{ fontSize: 9, fontWeight: 600, color: 'var(--navi-text-secondary)', display: 'block', margin: '7px 0 3px' }}>CASE</label>
                      <select
                        id="terrain-validation-case"
                        aria-label="Terrain validation case"
                        value={activeFixtureCase?.id ?? activeFixture.defaultCaseId}
                        onChange={(event) => {
                          setSelectedFixtureCaseId(event.target.value)
                          resetForFixtureCase(getTerrainValidationCase(activeFixture, event.target.value))
                        }}
                        style={{ width: '100%', background: 'var(--navi-sidebar)', border: '1px solid var(--navi-border)', borderRadius: 5, padding: '5px 8px', color: 'var(--navi-text)', fontSize: 10, outline: 'none', cursor: 'pointer' }}
                      >
                        {activeFixture.cases.map((fixtureCase) => <option key={fixtureCase.id} value={fixtureCase.id}>{fixtureCase.label}</option>)}
                      </select>
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {/* Current campus selector */}
          {dataSource === 'campus' && campuses.length > 0 && (
            <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--navi-border)', background: 'var(--navi-content)' }}>
              <label style={{ fontSize: 9, fontWeight: 600, color: 'var(--navi-text-secondary)', display: 'block', marginBottom: 3 }}>CAMPUS</label>
              <select
                value={selectedCampusId ?? ''}
                onChange={(e) => handleCampusChange(e.target.value)}
                style={{
                  width: '100%', background: 'var(--navi-sidebar)', border: '1px solid var(--navi-border)',
                  borderRadius: 5, padding: '5px 8px', color: 'var(--navi-text)', fontSize: 11, outline: 'none', cursor: 'pointer',
                }}
              >
                {campuses.map((c) => (
                  <option key={c.campus_id} value={c.campus_id}>
                    {c.campus_id} ({c.building_count} buildings)
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Tab bar */}
          <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--navi-border)' }}>
              {([
                { key: 'routing' as const, label: 'Routing', icon: <Route size={12} /> },
                { key: 'diagnostics' as const, label: 'Diagnostics', icon: <Activity size={12} /> },
              ]).map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                style={{
                  flex: 1, padding: '8px 0', background: 'transparent', border: 'none', borderBottom: activeTab === tab.key ? '2px solid var(--navi-primary)' : '2px solid transparent',
                  color: activeTab === tab.key ? 'var(--navi-primary)' : 'var(--navi-text-secondary)', fontSize: 11, fontWeight: activeTab === tab.key ? 700 : 500, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                }}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingRight: 10 }}>
              {activeFixture ? (
                <span style={{ fontSize: 9, color: '#2563EB', display: 'flex', alignItems: 'center', gap: 3 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#2563EB' }} />
                  Terrain fixture
                </span>
              ) : campus && campus.nodes.length > 0 ? (
                <span style={{ fontSize: 9, color: '#059669', display: 'flex', alignItems: 'center', gap: 3 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#059669' }} />
                  Campus
                </span>
              ) : (
                <span style={{ fontSize: 9, color: '#F59E0B', display: 'flex', alignItems: 'center', gap: 3 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#F59E0B' }} />
                  No Data
                </span>
              )}
            </div>
          </div>

          {/* ═══════ ROUTING TAB ═══════ */}
          {activeTab === 'routing' && (
            <>
              {!activeNodes.length ? (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
                  <div style={{ textAlign: 'center', color: 'var(--navi-text-secondary)' }}>
                    <Route size={24} style={{ opacity: 0.3, marginBottom: 8 }} />
                    <div style={{ fontSize: 11 }}>No published graph available.</div>
                    <div style={{ fontSize: 10, marginTop: 4 }}>Select a campus above, or publish from Studio.</div>
                  </div>
                </div>
              ) : (
                <>
                  {/* Search by name */}
                  <div style={{ padding: '14px 14px 10px' }}>
                    <div style={{ background: 'var(--navi-content)', border: '1px solid var(--navi-content)', borderRadius: 7, padding: 10 }}>
                      <div style={{ color: 'var(--navi-text-secondary)', fontSize: 9, fontWeight: 600, marginBottom: 6 }}>SEARCH BY NAME</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {/* From input */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#059669', flexShrink: 0 }} />
                          <input
                            type="text"
                            placeholder="Where are you?"
                            value={previewPicker === 'from' ? previewQuery : (previewFrom ? renderModel?.nodes.find(n => n.id === previewFrom)?.name || previewFrom : '')}
                            onFocus={() => { setPreviewPicker('from'); setPreviewQuery('') }}
                            onChange={(e) => setPreviewQuery(e.target.value)}
                            style={{ flex: 1, background: 'var(--navi-sidebar)', border: '1px solid var(--navi-sidebar)', borderRadius: 5, padding: '6px 8px', fontSize: 11, color: 'var(--navi-text)', outline: 'none' }}
                          />
                        </div>

                        {/* Swap button */}
                        <button
                          onClick={() => {
                            const tmpFrom = previewFrom
                            const tmpTo = previewTo
                            setPreviewFrom(tmpTo)
                            setPreviewTo(tmpFrom)
                          }}
                          style={{ alignSelf: 'center', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--navi-text-secondary)', padding: 2 }}
                        >
                          <RotateCcw size={12} />
                        </button>

                        {/* To input */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#3B82F6', flexShrink: 0 }} />
                          <input
                            type="text"
                            placeholder="Where do you want to go?"
                            value={previewPicker === 'to' ? previewQuery : (previewTo ? renderModel?.nodes.find(n => n.id === previewTo)?.name || previewTo : '')}
                            onFocus={() => { setPreviewPicker('to'); setPreviewQuery('') }}
                            onChange={(e) => setPreviewQuery(e.target.value)}
                            style={{ flex: 1, background: 'var(--navi-sidebar)', border: '1px solid var(--navi-sidebar)', borderRadius: 5, padding: '6px 8px', fontSize: 11, color: 'var(--navi-text)', outline: 'none' }}
                          />
                        </div>

                        {/* Search results dropdown */}
                        {previewPicker && previewSearchResults.length > 0 && (
                          <div style={{ background: 'var(--navi-sidebar)', border: '1px solid var(--navi-border)', borderRadius: 5, maxHeight: 150, overflowY: 'auto' }}>
                            {previewSearchResults.map(node => (
                              <button
                                key={node.id}
                                onClick={() => {
                                  if (previewPicker === 'from') setPreviewFrom(node.id)
                                  else setPreviewTo(node.id)
                                  setPreviewPicker(null)
                                  setPreviewQuery('')
                                }}
                                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 8px', fontSize: 10, border: 'none', borderBottom: '1px solid var(--navi-border)', background: 'transparent', cursor: 'pointer', color: 'var(--navi-text)' }}
                              >
                                <div style={{ fontWeight: 600 }}>{node.name || node.label || node.id}</div>
                                <div style={{ fontSize: 9, color: 'var(--navi-text-secondary)' }}>{node.type} · Floor {node.floor}</div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div style={{ padding: '0 14px 10px' }}>
                    <div style={{ background: 'var(--navi-content)', border: '1px solid var(--navi-content)', borderRadius: 7, padding: 10 }}>
                      <div style={{ color: 'var(--navi-text-secondary)', fontSize: 9, fontWeight: 600, marginBottom: 6 }}>PIN PLACEMENT</div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          onClick={() => { setStartId(''); setStartPin(null) }}
                          style={{ flex: 1, padding: '6px 8px', fontSize: 10, fontWeight: 600, border: `1px solid ${!startNode ? '#22C55E' : 'var(--navi-content)'}`, borderRadius: 5, cursor: 'pointer', background: !startNode ? '#ECFDF5' : 'var(--navi-content)', color: !startNode ? '#059669' : 'var(--navi-text)' }}
                        >
                          {startNode ? `📍 ${startNode.name || startNode.id}` : '① Click to set Start'}
                        </button>
                        <button
                          onClick={() => { setEndId(''); setEndPin(null) }}
                          style={{ flex: 1, padding: '6px 8px', fontSize: 10, fontWeight: 600, border: `1px solid ${!endNode ? '#3B82F6' : 'var(--navi-content)'}`, borderRadius: 5, cursor: 'pointer', background: !endNode ? '#EFF6FF' : 'var(--navi-content)', color: !endNode ? '#3B82F6' : 'var(--navi-text)' }}
                        >
                          {endNode ? `📍 ${endNode.name || endNode.id}` : '② Click to set End'}
                        </button>
                      </div>
                      {(nearestStart || nearestEnd) && (
                        <div style={{ marginTop: 6, fontSize: 9, color: 'var(--navi-text-secondary)' }}>
                          {nearestStart && <div>🟢 Snapped to: <b>{nearestStart.name || nearestStart.id}</b></div>}
                          {nearestEnd && <div>🔵 Snapped to: <b>{nearestEnd.name || nearestEnd.id}</b></div>}
                        </div>
                      )}
                    </div>
                  </div>

                  <div style={{ padding: '14px', borderBottom: '1px solid var(--navi-content)' }}>
                    <div style={{ color: 'var(--navi-text-secondary)', fontSize: 10, fontWeight: 600, marginBottom: 8 }}>ROUTE CONFIGURATION</div>
                    {[
                      { label: 'START NODE', value: startId, set: setStartId, color: '#059669' },
                      { label: 'END NODE', value: endId, set: setEndId, color: '#3B82F6' },
                    ].map(({ label, value, set, color }) => (
                      <div key={label} style={{ marginBottom: 6 }}>
                        <label style={{ color: 'var(--navi-text-secondary)', fontSize: 9, fontWeight: 600, display: 'block', marginBottom: 2 }}>{label}</label>
                        <select value={value} onChange={(e) => set(e.target.value)} style={{ width: '100%', background: 'var(--navi-content)', border: `1px solid ${color}30`, borderRadius: 5, padding: '5px 8px', color: 'var(--navi-text)', fontSize: 11, outline: 'none', cursor: 'pointer' }}>
                          <option value="">— Select node —</option>
                          {activeNodes.map((n) => <option key={n.id} value={n.id}>{n.id} — {n.name}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>

                  {activeFixture && activeFixtureCase && (
                    <TerrainValidationDiagnostics
                      fixture={activeFixture}
                      fixtureCase={activeFixtureCase}
                      result={routeResult}
                      edges={activeEdges}
                    />
                  )}

                  <div style={{ flex: 1, overflowY: 'auto' }}>
                    {routeResult ? (
                      <div style={{ padding: '0 14px 14px' }}>
                        <div style={{ background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 7, padding: 10, marginBottom: 10 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6 }}>
                            <CheckCircle size={12} color='#059669' />
                            <span style={{ color: '#059669', fontSize: 11, fontWeight: 700 }}>Route Found</span>
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                            {[
                              { label: 'Nodes', value: routeResult.path.length },
                              { label: 'Distance', value: `${Math.round(routeResult.cost)}m` },
                              { label: 'Est. Time', value: `~${Math.ceil(routeResult.cost / 80)}min` },
                            ].map(({ label, value }) => (
                              <div key={label} style={{ fontSize: 10 }}>
                                <span style={{ color: 'var(--navi-text-secondary)', fontWeight: 600 }}>{label} </span>
                                <span style={{ color: 'var(--navi-text)', fontWeight: 700 }}>{value}</span>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div style={{ color: 'var(--navi-text-secondary)', fontSize: 9, fontWeight: 600, marginBottom: 4 }}>COMPUTED PATH</div>
                        {computeRouteSteps(routeResult.path, activeNodes, activeEdges, routeResult.steps.map((routeStep) => routeStep.edgeId)).map((step, i, steps) => {
                          const isStart = i === 0
                          const isEnd = i === steps.length - 1
                          const isAnimated = i <= animStep
                          return (
                            <div key={step.nodeId}>
                              <div style={{
                                display: 'flex', gap: 5, padding: '5px 7px',
                                background: isAnimated ? 'var(--navi-primary-light)' : 'transparent',
                                border: `1px solid ${isAnimated ? 'rgba(37,99,235,0.2)' : 'var(--navi-content)'}`,
                                borderRadius: 5, marginBottom: 0,
                              }}>
                                <div style={{
                                  width: 16, height: 16, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  flexShrink: 0, fontSize: 7, fontWeight: 700,
                                  background: isStart ? '#059669' : isEnd ? '#EF4444' : isAnimated ? 'rgba(37,99,235,0.3)' : 'var(--navi-content)',
                                  color: isAnimated ? 'white' : 'var(--navi-text-secondary)',
                                }}>
                                  {i + 1}
                                </div>
                                <div style={{ flex: 1 }}>
                                  <div style={{ fontSize: 10, fontWeight: 600, color: isAnimated ? 'var(--navi-text)' : 'var(--navi-text-secondary)' }}>
                                    {step.nodeLabel}
                                  </div>
                                  <div style={{ fontSize: 9, color: 'var(--navi-text-secondary)' }}>
                                    {step.nodeId} · {step.nodeType}
                                    {step.distance > 0 && ` · ${step.distance}m`}
                                    {activeFixture && step.edgeId && ` · ${step.edgeId}`}
                                  </div>
                                </div>
                              </div>
                              {i < steps.length - 1 && (
                                <div style={{ paddingLeft: 20, fontSize: 9, color: 'var(--navi-text-secondary)', padding: '2px 0 2px 20px', lineHeight: 1.4 }}>
                                  │<br/>├── {step.instruction}
                                </div>
                              )}
                            </div>
                          )
                        })}

                        {selectedNode && (
                          <div style={{ marginTop: 10 }}>
                            <div style={{ background: 'var(--navi-content)', border: '1px solid var(--navi-content)', borderRadius: 7, padding: 10 }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                                <div style={{ color: 'var(--navi-text-secondary)', fontSize: 9, fontWeight: 600 }}>NODE INSPECTOR</div>
                                <button
                                  onClick={() => setSelectedNodeId(null)}
                                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--navi-text-secondary)' }}
                                >
                                  <X size={12} />
                                </button>
                              </div>
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                                <div>
                                  <div style={{ fontSize: 9, color: 'var(--navi-text-secondary)' }}>ID</div>
                                  <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--navi-text)', fontFamily: 'monospace', wordBreak: 'break-all' }}>{selectedNode.id}</div>
                                </div>
                                <div>
                                  <div style={{ fontSize: 9, color: 'var(--navi-text-secondary)' }}>Name</div>
                                  <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--navi-text)' }}>{selectedNode.name || selectedNode.label || '—'}</div>
                                </div>
                                <div>
                                  <div style={{ fontSize: 9, color: 'var(--navi-text-secondary)' }}>Type</div>
                                  <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--navi-text)' }}>{selectedNode.type}</div>
                                </div>
                                <div>
                                  <div style={{ fontSize: 9, color: 'var(--navi-text-secondary)' }}>Floor</div>
                                  <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--navi-text)' }}>{selectedNode.floor}</div>
                                </div>
                                <div>
                                  <div style={{ fontSize: 9, color: 'var(--navi-text-secondary)' }}>Building</div>
                                  <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--navi-text)' }}>{selectedNode.buildingId || '—'}</div>
                                </div>
                                <div>
                                  <div style={{ fontSize: 9, color: 'var(--navi-text-secondary)' }}>Position</div>
                                  <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--navi-text)', fontFamily: 'monospace' }}>
                                    {selectedNode.position.lat.toFixed(6)}, {selectedNode.position.lng.toFixed(6)}
                                  </div>
                                </div>
                                <div>
                                  <div style={{ fontSize: 9, color: 'var(--navi-text-secondary)' }}>Edges</div>
                                  <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--navi-text)' }}>
                                    {activeEdges.filter(e => e.from === selectedNode.id || e.to === selectedNode.id).length}
                                  </div>
                                </div>
                                <div>
                                  <div style={{ fontSize: 9, color: 'var(--navi-text-secondary)' }}>Degree</div>
                                  <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--navi-text)' }}>
                                    {activeEdges.filter(e => e.from === selectedNode.id || e.to === selectedNode.id).length}
                                  </div>
                                </div>
                              </div>
                              <div style={{ marginTop: 8 }}>
                                <div style={{ fontSize: 9, color: 'var(--navi-text-secondary)', marginBottom: 2 }}>Compiler Source</div>
                                <div style={{ fontSize: 10, fontFamily: 'monospace', background: 'var(--navi-content)', padding: '4px 6px', borderRadius: 4, border: '1px solid var(--navi-content)', color: 'var(--navi-text)' }}>
                                  {(selectedNode as any).compilerSource || `node:${selectedNode.id}`}
                                </div>
                              </div>
                              <button
                                onClick={() => {
                                  setStartId(selectedNode.id)
                                  setStartPin(null)
                                }}
                                style={{
                                  marginTop: 8, width: '100%', padding: '6px 0', fontSize: 10, fontWeight: 600,
                                  border: '1px solid #22C55E', borderRadius: 5, cursor: 'pointer',
                                  background: '#ECFDF5', color: '#059669',
                                }}
                              >
                                Set as Start
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : disconnectedNodes.length > 0 ? (
                      <div style={{ padding: '14px' }}>
                        <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 7, padding: '10px', marginBottom: 8 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                            <AlertTriangle size={12} color='var(--navi-error)' />
                            <span style={{ color: 'var(--navi-error)', fontSize: 11, fontWeight: 700 }}>{disconnectedNodes.length} Disconnected</span>
                          </div>
                          <div style={{ color: 'var(--navi-text-secondary)', fontSize: 10 }}>These nodes have no valid path connections.</div>
                        </div>
                        {disconnectedNodes.map((nodeId) => (
                          <div key={nodeId} style={{ display: 'flex', gap: 5, padding: '6px 8px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 5, marginBottom: 3 }}>
                            <XCircle size={11} color='var(--navi-error)' style={{ flexShrink: 0, marginTop: 1 }} />
                            <div><div style={{ fontSize: 11, fontWeight: 600, color: 'var(--navi-text)' }}>{nodeId}</div><div style={{ fontSize: 10, color: 'var(--navi-text-secondary)' }}>{activeNodes.find((n) => n.id === nodeId)?.name ?? ''}</div></div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ padding: '14px' }}>
                        <div style={{ textAlign: 'center', color: 'var(--navi-text-secondary)' }}>
                          <MapPin size={32} style={{ marginBottom: 8, opacity: 0.4 }} />
                          <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4, color: 'var(--navi-text)' }}>Set Start & End Points</div>
                          <div style={{ fontSize: 10, lineHeight: 1.5, maxWidth: 220, margin: '0 auto' }}>
                            Click the map to place pins, or use the dropdowns above. Route calculates automatically.
                          </div>
                          <div style={{ marginTop: 10, display: 'flex', gap: 6, justifyContent: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9 }}>
                              <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#059669', border: '2px solid white' }} />
                              Start
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9 }}>
                              <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#3B82F6', border: '2px solid white' }} />
                              End
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          )}

          {/* ═══════ DIAGNOSTICS TAB ═══════ */}
          {activeTab === 'diagnostics' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
              {!activeNodes.length ? (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
                  <div style={{ textAlign: 'center', color: 'var(--navi-text-secondary)' }}>
                    <Activity size={24} style={{ opacity: 0.3, marginBottom: 8 }} />
                    <div style={{ fontSize: 11 }}>Waiting for published snapshot...</div>
                    <div style={{ fontSize: 10, marginTop: 4 }}>Diagnostics will appear once a campus is published.</div>
                  </div>
                </div>
              ) : (
                <>
                  {/* SNAPSHOT */}
                  <div style={{ background: 'var(--navi-content)', borderRadius: 6, padding: 10, marginBottom: 10 }}>
                    <div style={{ color: 'var(--navi-text-secondary)', fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>SNAPSHOT</div>
                    {[
                      { label: 'Version', value: campus?.boundingBox ? 'Campus Data' : '—' },
                      { label: 'Timestamp', value: campus?.boundingBox ? 'From public-store' : '—' },
                      { label: 'Campus', value: campus?.boundingBox ? (usePublicStore.getState().campusData?.campusId ?? '—') : '—' },
                      { label: 'Nodes', value: activeNodes.length },
                      { label: 'Edges', value: activeEdges.length },
                      { label: 'Buildings', value: campusBuildings.length },
                    ].map(({ label, value }) => (
                      <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid var(--navi-border)' }}>
                        <span style={{ fontSize: 10, color: 'var(--navi-text-secondary)', fontWeight: 600 }}>{label}</span>
                        <span style={{ fontSize: 10, color: 'var(--navi-text)', fontWeight: 700 }}>{value}</span>
                      </div>
                    ))}
                  </div>

                  {/* HEALTH */}
                  {graphHealth && (
                    <div style={{ background: 'var(--navi-content)', borderRadius: 6, padding: 10, marginBottom: 10 }}>
                      <div style={{ color: 'var(--navi-text-secondary)', fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>HEALTH</div>
                      <div style={{ background: isHealthy ? '#ECFDF5' : '#FFFBEB', border: `1px solid ${isHealthy ? '#A7F3D0' : '#FDE68A'}`, borderRadius: 6, padding: '8px 10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                          <span style={{ fontSize: 14 }}>{isHealthy ? '🟢' : '⚠'}</span>
                          <span style={{ fontSize: 11, fontWeight: 700, color: isHealthy ? '#059669' : '#D97706' }}>
                            {isHealthy ? 'Healthy' : `${graphHealth.disconnected} unreachable node${graphHealth.disconnected !== 1 ? 's' : ''}`}
                          </span>
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--navi-text-secondary)' }}>
                          {graphHealth.connected}/{graphHealth.total} connected · {graphHealth.components} component{graphHealth.components !== 1 ? 's' : ''}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* STATISTICS */}
                  {graphHealth && (
                    <div style={{ background: 'var(--navi-content)', borderRadius: 6, padding: 10, marginBottom: 10 }}>
                      <div style={{ color: 'var(--navi-text-secondary)', fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>STATISTICS</div>
                      {[
                        { label: 'Components', value: graphHealth.components },
                        { label: 'Dead Ends', value: graphHealth.deadEnds },
                        { label: 'Isolated Nodes', value: graphHealth.isolated },
                        { label: 'Avg Degree', value: graphHealth.avgDegree.toFixed(1) },
                        { label: 'Max Degree', value: graphHealth.maxDegree },
                      ].map(({ label, value }) => (
                        <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid var(--navi-border)' }}>
                          <span style={{ fontSize: 10, color: 'var(--navi-text-secondary)', fontWeight: 600 }}>{label}</span>
                          <span style={{ fontSize: 10, color: 'var(--navi-text)', fontWeight: 700 }}>{value}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* NODE TYPES */}
                  {graphHealth && Object.keys(graphHealth.nodeTypes).length > 0 && (
                    <div style={{ background: 'var(--navi-content)', borderRadius: 6, padding: 10, marginBottom: 10 }}>
                      <div style={{ color: 'var(--navi-text-secondary)', fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>NODE TYPES</div>
                      {Object.entries(graphHealth.nodeTypes).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
                        <div key={type} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid var(--navi-border)' }}>
                          <span style={{ fontSize: 10, color: 'var(--navi-text-secondary)', fontWeight: 600 }}>{type}</span>
                          <span style={{ fontSize: 10, color: 'var(--navi-text)', fontWeight: 700 }}>{count}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* WARNINGS */}
                  {graphHealth && graphHealth.warnings.length > 0 && (
                    <div style={{ background: 'var(--navi-content)', borderRadius: 6, padding: 10, marginBottom: 10 }}>
                      <div style={{ color: 'var(--navi-text-secondary)', fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>WARNINGS</div>
                      {graphHealth.warnings.map((warning, i) => (
                        <div key={i} style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 6, padding: '8px 10px', marginBottom: 4 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                            <AlertTriangle size={11} color='#D97706' />
                            <span style={{ fontSize: 10, fontWeight: 700, color: '#D97706' }}>{warning.message}</span>
                          </div>
                          <div style={{ fontSize: 9, color: 'var(--navi-text-secondary)', lineHeight: 1.5 }}>
                            {warning.nodeIds.join(', ')}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export const RouteTesting = NavigationInspector
