import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { NavigationInspector, computeGraphHealth, computeRouteSteps, findNearestNode } from '../RouteTesting'
import type { NavNode, NavEdge } from '@/types/nav-types'
import { useCompiledGraphStore } from '@/store/compiled-graph-store'
import { usePublicStore } from '@/store/public-store'

vi.mock('maplibre-gl', () => ({
  default: {
    Map: class {
      addControl = vi.fn()
      on = vi.fn()
      off = vi.fn()
      fitBounds = vi.fn()
      remove = vi.fn()
      getSource = vi.fn()
      getLayer = vi.fn()
      addSource = vi.fn()
      addLayer = vi.fn()
      removeLayer = vi.fn()
      removeSource = vi.fn()
      setLayoutProperty = vi.fn()
      loaded = vi.fn(() => true)
      // P1-T15: the component calls real maplibre APIs — the mock fixture was
      // incomplete without them.
      isStyleLoaded = vi.fn(() => true)
      querySourceFeatures = vi.fn(() => [])
      setPaintProperty = vi.fn()
      flyTo = vi.fn()
      dragPan = { enable: vi.fn(), disable: vi.fn() }
      once = vi.fn()
    },
    Marker: class {
      _lngLat = { lat: 0, lng: 0 }
      setLngLat(ll: any) { this._lngLat = ll; return this }
      addTo() { return this }
      on() { return this }
      getLngLat() { return this._lngLat }
      remove() {}
    },
    NavigationControl: vi.fn(),
    LngLatBounds: class {
      extend = vi.fn()
    },
  },
}))

vi.mock('@/store/compiled-graph-store', () => ({
  useCompiledGraphStore: vi.fn(() => ({
    nodes: [],
    edges: [],
    hasRealData: false,
    loadFromStorage: vi.fn(),
    result: null,
  })),
}))

vi.mock('../RouteOverlay', () => ({
  RouteOverlay: vi.fn(() => null),
}))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('NavigationInspector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useCompiledGraphStore).mockReturnValue({
      nodes: [],
      edges: [],
      hasRealData: false,
      loadFromStorage: vi.fn(),
      result: null,
    } as any)
    // P1-T15: the component reads campus data from public-store — reset it
    // so tests don't leak state into each other.
    usePublicStore.setState({
      campus: null,
      campusStatus: 'idle',
      campusError: null,
      campusLoading: false,
      campusData: null,
    } as never)
  })

  it('renders with routing tab active by default', () => {
    render(<NavigationInspector />)
    expect(screen.getByText('Routing')).toBeInTheDocument()
    expect(screen.getByText('Diagnostics')).toBeInTheDocument()
  })

  it('switches to Routing tab and shows route controls when real campus data exists', () => {
    // P1-T15: the component's data source is public-store (sole runtime
    // source — no compiled-graph fallback); seed it instead of mocking the
    // removed compiled-graph-store contract.
    const nodes: NavNode[] = [
      { id: 'N1', label: 'Lobby', name: 'Lobby', type: 'room', buildingId: 'b1', campusId: 'c1', floor: 0, position: { lat: 10, lng: 20 } },
      { id: 'N2', label: 'Room 101', name: 'Room 101', type: 'room', buildingId: 'b1', campusId: 'c1', floor: 0, position: { lat: 10.001, lng: 20 } },
    ]
    const edges: NavEdge[] = [{ id: 'E1', from: 'N1', to: 'N2', distance: 111, weight: 111, type: 'walkway' }]
    usePublicStore.setState({
      campus: { nodes, edges, searchEntries: [], buildings: [], poi: [], boundingBox: null },
      campusStatus: 'ready',
    } as never)
    render(<NavigationInspector />)
    fireEvent.click(screen.getByText('Routing'))
    expect(screen.getByText('ROUTE CONFIGURATION')).toBeInTheDocument()
  })

  it('shows no-data state on Routing tab when no real data', () => {
    render(<NavigationInspector />)
    fireEvent.click(screen.getByText('Routing'))
    expect(screen.getByText('No published graph available.')).toBeInTheDocument()
  })

  it('switches to Diagnostics tab on click', () => {
    render(<NavigationInspector />)
    fireEvent.click(screen.getByText('Diagnostics'))
    expect(screen.getByText('Waiting for published snapshot...')).toBeInTheDocument()
  })
})

describe('computeGraphHealth', () => {
  const baseNode = (id: string): NavNode => ({
    id, label: id, name: id, type: 'room', buildingId: 'b1', campusId: 'c1', floor: 1,
    position: { lat: 11.8, lng: 122.17 }, hasQr: false, hasPanorama: false,
  })

  const edge = (id: string, from: string, to: string): NavEdge => ({
    id, from, to, distance: 100, type: 'walkway',
  })

  it('returns healthy for fully connected graph', () => {
    const nodes = [baseNode('A'), baseNode('B'), baseNode('C'), baseNode('D')]
    const edges = [edge('e1', 'A', 'B'), edge('e2', 'B', 'C'), edge('e3', 'C', 'D'), edge('e4', 'D', 'A')]
    const h = computeGraphHealth(nodes, edges)
    expect(h.disconnected).toBe(0)
    expect(h.isolated).toBe(0)
    expect(h.components).toBe(1)
    expect(h.warnings).toHaveLength(0)
  })

  it('detects isolated nodes', () => {
    const nodes = [baseNode('A'), baseNode('B'), baseNode('C')]
    const edges = [edge('e1', 'A', 'B')]
    const h = computeGraphHealth(nodes, edges)
    expect(h.isolated).toBe(1)
    expect(h.warnings.some(w => w.message.includes('isolated'))).toBe(true)
  })

  it('counts components correctly', () => {
    const nodes = [baseNode('A'), baseNode('B'), baseNode('C'), baseNode('D')]
    const edges = [edge('e1', 'A', 'B'), edge('e2', 'C', 'D')]
    const h = computeGraphHealth(nodes, edges)
    expect(h.components).toBe(2)
    expect(h.disconnected).toBe(0)
    expect(h.isolated).toBe(0)
  })
})

describe('computeRouteSteps', () => {
  const node = (id: string, label: string, type: NavNode['type']): NavNode => ({
    id, label, name: label, type, position: { lat: 0, lng: 0 }, floor: 0, buildingId: 'b1', campusId: 'c',
  })

  const edge = (id: string, from: string, to: string, distance: number, type: NavEdge['type'] = 'walkway'): NavEdge => ({
    id, from, to, distance, type,
  })

  it('computes route steps with distances', () => {
    const nodes = [
      node('A', 'Entrance', 'entrance'),
      node('B', 'Waypoint', 'room'),
      node('C', 'Room', 'room'),
    ]
    const edges = [
      edge('E1', 'A', 'B', 100),
      edge('E2', 'B', 'C', 80),
    ]
    const steps = computeRouteSteps(['A', 'B', 'C'], nodes, edges)
    expect(steps).toHaveLength(3)
    expect(steps[0].instruction).toBe('Start')
    expect(steps[1].distance).toBe(100)
    expect(steps[2].instruction).toBe('Destination')
  })

  it('generates correct instructions for node types', () => {
    const nodes = [
      node('A', 'Start', 'outdoor'),
      node('B', 'Entry', 'entrance'),
      node('C', 'Stairs', 'staircase'),
      node('D', 'Lift', 'elevator'),
      node('E', 'End', 'room'),
    ]
    const edges = [
      edge('E1', 'A', 'B', 50),
      edge('E2', 'B', 'C', 10),
      edge('E3', 'C', 'D', 10),
      edge('E4', 'D', 'E', 10),
    ]
    const steps = computeRouteSteps(['A', 'B', 'C', 'D', 'E'], nodes, edges)
    expect(steps[0].instruction).toBe('Start')
    expect(steps[1].instruction).toBe('Enter building')
    expect(steps[2].instruction).toBe('Use stairs')
    expect(steps[3].instruction).toBe('Use elevator')
    expect(steps[4].instruction).toBe('Destination')
  })

  it('uses node name over label over id', () => {
    const nodes = [
      { id: 'X', name: 'Full Name', label: 'Short', type: 'room' as NavNode['type'], position: { lat: 0, lng: 0 }, floor: 0, buildingId: 'b', campusId: 'c' },
    ]
    const steps = computeRouteSteps(['X'], nodes, [])
    expect(steps[0].nodeLabel).toBe('Full Name')
  })

  it('falls back to id when name and label are missing', () => {
    const nodes = [
      { id: 'Z', label: '', type: 'room' as NavNode['type'], position: { lat: 0, lng: 0 }, floor: 0, buildingId: 'b', campusId: 'c' },
    ]
    const steps = computeRouteSteps(['Z'], nodes, [])
    expect(steps[0].nodeLabel).toBe('Z')
  })

  it('sets edge to null for the first node', () => {
    const nodes = [node('A', 'A', 'outdoor'), node('B', 'B', 'room')]
    const edges = [edge('E1', 'A', 'B', 100)]
    const steps = computeRouteSteps(['A', 'B'], nodes, edges)
    expect(steps[0].edge).toBeNull()
    expect(steps[0].distance).toBe(0)
  })

  it('finds bidirectional edges', () => {
    const nodes = [node('A', 'A', 'outdoor'), node('B', 'B', 'room')]
    const edges = [edge('E1', 'B', 'A', 55)]
    const steps = computeRouteSteps(['A', 'B'], nodes, edges)
    expect(steps[1].edge).not.toBeNull()
    expect(steps[1].distance).toBe(55)
  })

  it('uses the canonical selected edge id when parallel endpoints are ambiguous', () => {
    const nodes = [node('A', 'A', 'outdoor'), node('B', 'B', 'room')]
    const edges = [
      { ...edge('blocked-shortcut', 'A', 'B', 5), routing: { sourceRoadId: 'blocked', authoredOrientation: 'forward' as const, authored: { walkable: false } } },
      edge('eligible-parallel', 'A', 'B', 20),
    ]

    const steps = computeRouteSteps(['A', 'B'], nodes, edges, [undefined, 'eligible-parallel'])

    expect(steps[1].edge?.id).toBe('eligible-parallel')
    expect(steps[1].distance).toBe(20)
  })
})

describe('development terrain validation source', () => {
  beforeEach(() => {
    usePublicStore.setState({
      campus: null,
      campusStatus: 'idle',
      campusError: null,
      campusLoading: false,
      campusData: null,
    } as never)
  })

  it('exposes the existing routes page fixture selector and diagnostics', async () => {
    render(<NavigationInspector />)

    fireEvent.change(screen.getByLabelText('Route data source'), { target: { value: 'terrain-fixture' } })

    expect(await screen.findByLabelText('Terrain validation fixture')).toBeInTheDocument()
    expect(await screen.findByText('TERRAIN VALIDATION')).toBeInTheDocument()
    expect(screen.getByText('STANDARD_TERRAIN_PROFILE_V1')).toBeInTheDocument()
    expect(await screen.findByText('PASS')).toBeInTheDocument()
  })

  it('does not expose local fixture controls in production', () => {
    vi.stubEnv('NODE_ENV', 'production')

    render(<NavigationInspector />)

    expect(screen.queryByLabelText('Route data source')).not.toBeInTheDocument()
  })

  it('keeps fixture selection on read-only requests with no graph or publish write', async () => {
    const fetchMock = vi.fn(async () => new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    render(<NavigationInspector />)
    fireEvent.change(screen.getByLabelText('Route data source'), { target: { value: 'terrain-fixture' } })

    expect(await screen.findByText('PASS')).toBeInTheDocument()
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === undefined || init?.method === 'GET')).toBe(true)
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes('/api/graph') && !String(url).includes('/api/publish'))).toBe(true)
  })
})

describe('findNearestNode', () => {
  const baseNode = (id: string, lat: number, lng: number): NavNode => ({
    id, label: id, name: id, type: 'room', buildingId: 'b1', campusId: 'c1', floor: 1,
    position: { lat, lng }, hasQr: false, hasPanorama: false,
  })

  it('finds nearest node to pin position', () => {
    const nodes = [
      baseNode('A', 0, 0),
      baseNode('B', 0.001, 0.001),
    ]
    const nearest = findNearestNode({ lat: 0.0001, lng: 0.0001 }, nodes)
    expect(nearest?.id).toBe('A')
  })

  it('returns null when beyond maxSnapMeters', () => {
    const nodes = [baseNode('A', 0, 0)]
    const nearest = findNearestNode({ lat: 10, lng: 10 }, nodes, 100)
    expect(nearest).toBeNull()
  })

  it('returns nearest node when within maxSnapMeters', () => {
    const nodes = [baseNode('A', 0, 0)]
    // ~111m at equator
    const nearest = findNearestNode({ lat: 0.001, lng: 0 }, nodes, 200)
    expect(nearest?.id).toBe('A')
  })

  it('returns null for empty node list', () => {
    const nearest = findNearestNode({ lat: 0, lng: 0 }, [])
    expect(nearest).toBeNull()
  })
})
