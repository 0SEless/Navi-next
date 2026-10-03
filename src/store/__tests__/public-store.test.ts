import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPublicStore, usePublicStore, search as searchEntries, nearestNode as nearestNodeOf, normalizeEdge } from '../public-store'
import type { NavNode, NavEdge, SearchEntry, CampusBundle } from '@/types/nav-types'
import type { QrIndex } from '@navi/core'
import { createMemoryCampusCacheRepository, type CachedCampus } from '@/features/public-campus/cache'

const graphFixture = {
  version: '1.0.0',
  campusId: 'test-campus',
  source: 'published_maps',
  revision: '12',
  nodes: [
    { id: 'n1', label: 'Main Lobby', type: 'space', position: { lat: 10.0, lng: 20.0 }, floor: 0, buildingId: 'b1', properties: { category: 'lobby' } },
    { id: 'n2', label: 'Registrar Office', type: 'space', position: { lat: 10.001, lng: 20.0 }, floor: 0, buildingId: 'b1', properties: { category: 'office' } },
    { id: 'n3', label: 'Room 101', type: 'space', position: { lat: 10.002, lng: 20.0 }, floor: 1, buildingId: 'b1', properties: { category: 'classroom' } },
  ],
  edges: [
    { id: 'e1', from: 'n1', to: 'n2', type: 'walk', distance: 111, weight: 111 },
    { id: 'e2', from: 'n2', to: 'n3', type: 'walk', distance: 111, weight: 111 },
  ],
  metadata: { boundingBox: { minLat: 10, maxLat: 10.002, minLng: 20, maxLng: 20 } },
}

const searchFixture = {
  version: '1.0.0',
  entries: [
    { id: 's1', label: 'Main Building', type: 'building', nodeId: 'n1', tags: ['MAIN', 'administrative'], buildingId: 'b1' },
    { id: 's2', label: 'Main Lobby', type: 'room', nodeId: 'n1', tags: ['lobby'], buildingId: 'b1', floor: 0 },
    { id: 's3', label: 'Registrar Office', type: 'room', nodeId: 'n2', tags: ['101', 'office'], buildingId: 'b1', floor: 0 },
    { id: 's4', label: 'Room 101', type: 'room', nodeId: 'n3', tags: ['101', 'classroom'], buildingId: 'b1', floor: 1 },
  ],
}

const buildingsFixture = {
  version: '1.0.0',
  buildings: [
    {
      id: 'b1',
      name: 'Main Building',
      code: 'MAIN',
      category: 'administrative',
      position: { lat: 10.0, lng: 20.0 },
      floors: [
        { level: 0, label: 'Ground Floor', elevation: 0 },
        { level: 1, label: 'Second Floor', elevation: 4 },
      ],
      entrances: [{ id: 'ent1', label: 'Main Entrance', position: { lat: 10.0, lng: 20.0 } }],
    },
  ],
}

const poiFixture = {
  version: '1.0.0',
  points: [
    { id: 'poi-1', label: 'Main Lobby', category: 'space', position: { lat: 10.0, lng: 20.0 }, buildingId: 'b1', floor: 0, nodeId: 'n1' },
  ],
}

const qrIndexFixture: QrIndex = {
  schemaVersion: 1,
  formatVersion: 1,
  campusId: 'test-campus',
  checkpoints: [
    {
      id: 'checkpoint-1',
      label: 'Main Entrance',
      buildingId: 'b1',
      floor: 0,
      position: { x: 0, y: 0 },
      code: 'navi.app/q/checkpoint-1',
    },
  ],
}

const authoredSearchFixture = {
  version: '1.0.0',
  entries: [{
    id: 'poi-study-area',
    label: 'Student Study Area',
    type: 'poi',
    position: { lat: 10.0005, lng: 20.0005 },
    tags: ['student', 'study', 'area', 'owner', 'library'],
    category: 'study_area',
    buildingId: 'b1',
    floor: 1,
    floorId: 'f1',
    source: 'authored',
    sourceId: 'poi-study-area',
  }],
}

const fixtureNodes: NavNode[] = [
  { id: 'n1', label: 'Main Lobby', position: { lat: 10.0, lng: 20.0 }, floor: 0, buildingId: 'b1', campusId: 'test-campus', type: 'room' },
  { id: 'n2', label: 'Registrar Office', position: { lat: 10.001, lng: 20.0 }, floor: 0, buildingId: 'b1', campusId: 'test-campus', type: 'room' },
  { id: 'n3', label: 'Room 101', position: { lat: 10.002, lng: 20.0 }, floor: 1, buildingId: 'b1', campusId: 'test-campus', type: 'room' },
]

const fixtureEdges: NavEdge[] = [
  { id: 'e1', from: 'n1', to: 'n2', distance: 111, weight: 111, type: 'walk' },
  { id: 'e2', from: 'n2', to: 'n3', distance: 111, weight: 111, type: 'walk' },
]

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  )
}

function stubFetch(handler: (url: string) => Promise<Response>) {
  const fn = vi.fn((url: string) => handler(url))
  vi.stubGlobal('fetch', fn)
  return fn
}

function makeBundle(overrides: Partial<CampusBundle> = {}): CampusBundle {
  return {
    nodes: fixtureNodes,
    edges: fixtureEdges,
    searchEntries: [],
    buildings: [],
    poi: [],
    boundingBox: null,
    ...overrides,
  }
}

function makeCacheRecord(overrides: Partial<CachedCampus> = {}): CachedCampus {
  return {
    campusId: 'test-campus',
    cacheSchemaVersion: 1,
    revision: '11',
    downloadedAt: Date.now(),
    source: 'published',
    payload: makeBundle(),
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('public-store routing metadata normalization', () => {
  const baseEdge = {
    id: 'edge-1',
    from: 'n1',
    to: 'n2',
    distance: 10,
    weight: 12,
    type: 'walk',
  }

  it('preserves valid sparse routing metadata without materializing defaults', () => {
    const routing = {
      sourceRoadId: 'road-sparse',
      authoredOrientation: 'forward' as const,
      authored: {
        feature: 'stairs' as const,
        startElevationMeters: 0,
        endElevationMeters: -4,
        walkable: false,
        wheelchairAccessible: false,
      },
    }

    const normalized = normalizeEdge({ ...baseEdge, routing })

    expect(normalized?.routing).toEqual(routing)
    expect(normalized?.routing?.authored).not.toHaveProperty('slope')
    expect(normalized?.routing?.authored).not.toHaveProperty('direction')
  })

  it.each([true, false])('preserves wheelchairAccessible=%s', (wheelchairAccessible) => {
    const normalized = normalizeEdge({
      ...baseEdge,
      routing: {
        sourceRoadId: 'road-wheelchair',
        authoredOrientation: 'forward',
        authored: { wheelchairAccessible },
      },
    })

    expect(normalized?.routing?.authored.wheelchairAccessible).toBe(wheelchairAccessible)
  })

  it('keeps omitted wheelchair metadata undefined and routing absent when omitted', () => {
    const normalized = normalizeEdge({
      ...baseEdge,
      routing: {
        sourceRoadId: 'road-unknown-wheelchair',
        authoredOrientation: 'forward',
        authored: { feature: 'normal' },
      },
    })

    expect(normalized?.routing?.authored).not.toHaveProperty('wheelchairAccessible')
    expect(normalizeEdge(baseEdge)).not.toHaveProperty('routing')
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'does not admit non-finite authored elevations: %s',
    (elevation) => {
      const normalized = normalizeEdge({
        ...baseEdge,
        routing: {
          sourceRoadId: 'road-invalid-elevation',
          authoredOrientation: 'forward',
          authored: { startElevationMeters: elevation },
        },
      })

      expect(normalized).toMatchObject(baseEdge)
      expect(normalized).not.toHaveProperty('routing')
    },
  )

  it('drops malformed routing without changing scalar edge fields', () => {
    const normalized = normalizeEdge({
      ...baseEdge,
      routing: {
        sourceRoadId: 'road-malformed',
        authoredOrientation: 'forward',
        authored: { slope: 'lava', wheelchairAccessible: 'sometimes' },
      },
    })

    expect(normalized).toEqual(baseEdge)
  })
})

describe('usePublicStore campus data layer', () => {
  beforeEach(() => {
    usePublicStore.setState({
      activeTab: 'home',
      sheetState: 'hidden',
      mapMode: 'explore',
      fromNode: null,
      toNode: null,
      selectedBuilding: null,
      selectedNode: null,
      qrLocation: null,
      currentCampusId: null,
      defaultCampusId: null,
      campusData: null,
      campusStatus: 'idle',
      campusError: null,
      activeFloor: 0,
      campus: null,
      campusLoading: false,
      campusOrigin: null,
      campusRevision: null,
      isRefreshing: false,
      refreshError: null,
      recentDestinations: [],
      recentSearches: [],
      onboardingComplete: false,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // P1-T15 (R14.1): repointed from the removed /api/campus-maps surface to
  // the current /api/public-campus contract (single endpoint; artifacts carry
  // searchIndex/poiIndex). Guard preserved: bundle parsing correctness.
  it('loads a bundle via /api/public-campus', async () => {
    const fetchMock = stubFetch((url) => {
      if (url.includes('/api/public-campus')) return jsonResponse(graphFixture)
      return jsonResponse({ error: 'not found' }, 404)
    })

    await usePublicStore.getState().fetchCampusData('test-campus')

    const state = usePublicStore.getState()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toContain('/api/public-campus')
    expect(state.campus).not.toBeNull()
    expect(state.campus!.nodes).toHaveLength(3)
    expect(state.campus!.edges).toHaveLength(2)
    expect(state.campus!.boundingBox).toEqual({ minLat: 10, maxLat: 10.002, minLng: 20, maxLng: 20 })
    expect(state.campus!.nodes[0].type).toBe('room')
    expect(state.campus!.nodes[0].metadata).toEqual({ category: 'lobby' })
    expect(state.campusLoading).toBe(false)
    expect(state.campusStatus).toBe('ready')
    expect(state.campusError).toBeNull()
    expect(state.campusData?.source).toBe('published_maps')
    expect(state.campusData?.nodes).toHaveLength(3)
    expect(state.activeFloor).toBe(0)
  })

  it('preserves serialized routing through the shared public navigation seam', async () => {
    const routing = {
      sourceRoadId: 'road-shared-seam',
      authoredOrientation: 'forward' as const,
      authored: { feature: 'stairs' as const, slope: 'level' as const, wheelchairAccessible: false },
    }
    const fetchMock = stubFetch((url) => {
      if (url.includes('/api/public-campus')) {
        return jsonResponse({
          ...graphFixture,
          edges: [
            { id: 'blocked-shortcut', from: 'n1', to: 'n2', type: 'walk', distance: 5, weight: 5, routing: { ...routing, sourceRoadId: 'road-blocked', authored: { ...routing.authored, walkable: false } } },
            { id: 'eligible-parallel', from: 'n1', to: 'n2', type: 'walk', distance: 20, weight: 20 },
            graphFixture.edges[1],
          ],
        })
      }
      return jsonResponse({ error: 'not found' }, 404)
    })

    await usePublicStore.getState().fetchCampusData('test-campus')

    const state = usePublicStore.getState()
    expect(state.campus?.edges[0].routing).toEqual({
      ...routing,
      sourceRoadId: 'road-blocked',
      authored: { ...routing.authored, walkable: false },
    })
    const result = state.findRoute('n1', 'n2')
    expect(result?.steps[1].edgeId).toBe('eligible-parallel')
    expect(result?.totalDistance).toBe(20)
    expect(result?.generalizedCost).toBe(20)
    expect(fetchMock.mock.calls.every(([url]) => String(url).includes('/api/public-campus'))).toBe(true)
  })

  // The old multi-file fallback chain (/api/campus-maps → demo artifacts) was
  // replaced by a single /api/public-campus endpoint that checks its sources
  // server-side. Its guard — full bundle parsing (searchIndex, poiIndex,
  // buildings) — is preserved here at the current contract.
  it('parses the full bundle from /api/public-campus artifacts', async () => {
    const fetchMock = stubFetch((url) => {
      if (url.includes('/api/public-campus')) {
        return jsonResponse({
          campusId: 'test-campus',
          source: 'published_maps',
          revision: '12',
          campusName: 'North Campus',
          nodes: graphFixture.nodes,
          edges: graphFixture.edges,
          buildings: buildingsFixture.buildings,
          artifacts: { searchIndex: searchFixture, poiIndex: poiFixture, qrIndex: qrIndexFixture },
        })
      }
      return jsonResponse({ error: 'not found' }, 404)
    })

    await usePublicStore.getState().fetchCampusData('test-campus')

    const state = usePublicStore.getState()
    const urls = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(urls[0]).toContain('/api/public-campus')
    expect(state.campus).not.toBeNull()
    expect(state.campus!.nodes).toHaveLength(3)
    expect(state.campus!.nodes[0].campusId).toBe('test-campus')
    expect(state.campus!.searchEntries).toHaveLength(4)
    expect(state.campus!.buildings).toHaveLength(1)
    expect(state.campus!.buildings[0].floors).toEqual([0, 1])
    expect(state.campus!.buildings[0].entrances?.[0].id).toBe('ent1')
    expect(state.campus!.campusName).toBe('North Campus')
    expect(state.campus!.poi).toHaveLength(1)
    expect(state.campus!.qrIndex).toEqual(qrIndexFixture)
    expect(state.campusStatus).toBe('ready')
  })

  it('preserves authored POI search identity and finds normalized category tokens', async () => {
    stubFetch((url) => {
      if (url.includes('/api/public-campus')) {
        return jsonResponse({
          campusId: 'test-campus',
          source: 'published_maps',
          revision: '13',
          nodes: graphFixture.nodes,
          edges: graphFixture.edges,
          buildings: buildingsFixture.buildings,
          artifacts: { searchIndex: authoredSearchFixture, poiIndex: poiFixture },
        })
      }
      return jsonResponse({ error: 'not found' }, 404)
    })

    await usePublicStore.getState().fetchCampusData('test-campus')

    const state = usePublicStore.getState()
    const entry = state.campus?.searchEntries.find(candidate => candidate.id === 'poi-study-area')
    expect(entry).toMatchObject({
      id: 'poi-study-area',
      label: 'Student Study Area',
      type: 'poi',
      position: { lat: 10.0005, lng: 20.0005 },
      category: 'study_area',
      source: 'authored',
      sourceId: 'poi-study-area',
      buildingId: 'b1',
      floor: 1,
      floorId: 'f1',
    })
    expect(entry?.nodeId).toBeUndefined()
    expect(state.campus ? state.search('study_area').map(result => result.id) : []).toEqual(['poi-study-area'])
  })

  it('scopes recent destinations to the active campus and reconciles legacy stale ids', async () => {
    localStorage.clear()
    localStorage.setItem('navi-recent-destinations', JSON.stringify(['stale-node', 'a1']))

    const campusA = {
      campusId: 'campus-a',
      source: 'published_maps',
      nodes: [{ id: 'a1', label: 'A Lobby', type: 'space', position: { lat: 10, lng: 20 }, floor: 0, buildingId: 'a-building' }],
      edges: [],
      buildings: [{ id: 'a-building', name: 'A Building', position: { lat: 10, lng: 20 }, floors: [{ level: 0 }] }],
    }
    const campusB = {
      campusId: 'campus-b',
      source: 'published_maps',
      nodes: [{ id: 'b1', label: 'B Lobby', type: 'space', position: { lat: 11, lng: 21 }, floor: 0, buildingId: 'b-building' }],
      edges: [],
      buildings: [{ id: 'b-building', name: 'B Building', position: { lat: 11, lng: 21 }, floors: [{ level: 0 }] }],
    }

    stubFetch((url) => url.includes('campus-a')
      ? jsonResponse(campusA)
      : jsonResponse(campusB))

    await usePublicStore.getState().fetchCampusData('campus-a')
    expect(usePublicStore.getState().recentDestinations).toEqual(['a1'])

    usePublicStore.getState().addRecentDestination('a1')
    await usePublicStore.getState().fetchCampusData('campus-b')
    expect(usePublicStore.getState().recentDestinations).toEqual([])

    usePublicStore.getState().addRecentDestination('b1')
    await usePublicStore.getState().fetchCampusData('campus-a')
    expect(usePublicStore.getState().recentDestinations).toEqual(['a1'])
    expect(JSON.parse(localStorage.getItem('navi-recent-destinations-by-campus') ?? '{}')).toEqual({
      'campus-a': ['a1'],
      'campus-b': ['b1'],
    })
  })

  it('does not treat an opaque campus id as a display name', async () => {
    stubFetch((url) => {
      if (url.includes('/api/public-campus')) {
        return jsonResponse({
          campusId: 'test-campus',
          source: 'published_maps',
          campusName: 'test-campus',
          nodes: graphFixture.nodes,
          edges: graphFixture.edges,
          buildings: buildingsFixture.buildings,
        })
      }
      return jsonResponse({ error: 'not found' }, 404)
    })

    await usePublicStore.getState().fetchCampusData('test-campus')

    expect(usePublicStore.getState().campus?.campusName).toBeUndefined()
  })

  it('sets campusError when every source fails', async () => {
    const fetchMock = stubFetch(() => jsonResponse({ error: 'boom' }, 500))

    await usePublicStore.getState().fetchCampusData('test-campus')

    const state = usePublicStore.getState()
    expect(fetchMock).toHaveBeenCalled()
    expect(state.campus).toBeNull()
    expect(state.campusLoading).toBe(false)
    expect(state.campusStatus).toBe('error')
    expect(state.campusError).toBe('No campus data available')
  })

  it('skips malformed entries and keeps the valid rest', async () => {
    stubFetch((url) => {
      if (url.includes('/api/public-campus')) {
        return jsonResponse({
          campusId: 'test-campus',
          source: 'published_maps',
          revision: '12',
          nodes: [
            graphFixture.nodes[0],
            { id: '', type: 'space', position: { lat: 1, lng: 1 } }, // malformed: no id
            { id: 'x1', type: 'space', position: { lat: 99, lng: 99 } }, // no label → label = id
          ],
          edges: graphFixture.edges,
          artifacts: { searchIndex: searchFixture, poiIndex: poiFixture },
        })
      }
      return jsonResponse({ error: 'not found' }, 404)
    })

    await usePublicStore.getState().fetchCampusData('test-campus')

    const state = usePublicStore.getState()
    expect(state.campus).not.toBeNull()
    expect(state.campus!.nodes).toHaveLength(2) // malformed node skipped, valid kept
    expect(state.campus!.edges).toHaveLength(2)
    expect(state.campus!.searchEntries).toHaveLength(4)
    expect(state.campus!.poi).toHaveLength(1)
    expect(state.campusStatus).toBe('ready')
  })

  it('ranks search results: startsWith, then contains, then tag', () => {
    const entries: SearchEntry[] = [
      { id: 'a', label: 'Lab Building', type: 'building', nodeId: 'n0' },
      { id: 'b', label: 'Computer Lab', type: 'room', nodeId: 'n1' },
      { id: 'c', label: 'Computer Room', type: 'room', nodeId: 'n2', tags: ['LAB', 'x'] },
      { id: 'd', label: 'Library', type: 'building', nodeId: 'n3' },
    ]
    usePublicStore.setState({ campus: makeBundle({ searchEntries: entries }) })

    const results = usePublicStore.getState().search('lab')
    expect(results.map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })

  it('search is case-insensitive', () => {
    const entries: SearchEntry[] = [
      { id: 'a', label: 'Main Lobby', type: 'room', nodeId: 'n1' },
      { id: 'b', label: 'Lobby Annex', type: 'room', nodeId: 'n2' },
    ]
    usePublicStore.setState({ campus: makeBundle({ searchEntries: entries }) })

    const results = usePublicStore.getState().search('LOBBY')
    expect(results.map((r) => r.id)).toEqual(['b', 'a'])
  })

  it('search caps results at 20 and matches tags', () => {
    const entries: SearchEntry[] = Array.from({ length: 25 }, (_, i) => ({
      id: `r${i}`,
      label: `Room ${i}`,
      type: 'room' as const,
      nodeId: `n${i}`,
    }))
    entries.push({ id: 't', label: 'Auditorium', type: 'room', nodeId: 'n99', tags: ['room-99'] })
    usePublicStore.setState({ campus: makeBundle({ searchEntries: entries }) })

    const results = usePublicStore.getState().search('room')
    expect(results).toHaveLength(20)
    const tagHit = searchEntries(entries, 'auditorium')
    expect(tagHit.map((r) => r.id)).toEqual(['t'])
    expect(searchEntries(entries, '')).toEqual([])
  })

  it('findRoute returns a NavRoute with enriched steps for a connected pair', () => {
    usePublicStore.setState({ campus: makeBundle() })

    const result = usePublicStore.getState().findRoute('n1', 'n3')
    expect(result).not.toBeNull()
    expect(result!.path).toEqual(['n1', 'n2', 'n3'])
    expect(result!.totalDistance).toBe(222)
    expect(result!.steps).toHaveLength(3)
    expect(result!.steps[0].nodeId).toBe('n1')
    expect(result!.steps[2].nodeId).toBe('n3')
    expect(typeof result!.steps[1].label).toBe('string')
    expect(result!.steps[0]).toHaveProperty('floor')
    expect(result!.steps[0]).toHaveProperty('position')
    expect(result!.steps[0]).toHaveProperty('type')
    expect(result!.steps[1].edgeId).toBe('e1')
  })

  it('findRoute uses canonical terrain semantics from the active public bundle', () => {
    const position = { lat: 10, lng: 20 }
    const nodes: NavNode[] = [
      { ...fixtureNodes[0], id: 'a', position, type: 'outdoor', buildingId: '' },
      { ...fixtureNodes[0], id: 'b', position, type: 'outdoor', buildingId: '' },
      { ...fixtureNodes[0], id: 'c', position, type: 'outdoor', buildingId: '' },
    ]
    const edges: NavEdge[] = [
      {
        id: 'steep-shortcut', from: 'a', to: 'c', distance: 100, weight: 100, type: 'walk',
        routing: {
          sourceRoadId: 'steep-shortcut', authoredOrientation: 'forward',
          authored: { slope: 'steep' },
        },
      },
      { id: 'level-a', from: 'a', to: 'b', distance: 55, weight: 55, type: 'walk' },
      { id: 'level-b', from: 'b', to: 'c', distance: 55, weight: 55, type: 'walk' },
    ]
    usePublicStore.setState({ campus: makeBundle({ nodes, edges }) })

    const result = usePublicStore.getState().findRoute('a', 'c')

    expect(result?.path).toEqual(['a', 'b', 'c'])
    expect(result?.totalDistance).toBe(110)
    expect(result?.generalizedCost).toBe(110)
  })

  it('findRoute returns null for a disconnected pair', () => {
    const nodes = [...fixtureNodes, { ...fixtureNodes[0], id: 'n9', label: 'Isolated' }]
    usePublicStore.setState({ campus: makeBundle({ nodes }) })

    expect(usePublicStore.getState().findRoute('n1', 'n9')).toBeNull()
  })

  it('nearestNode returns the closest node within maxDistance', () => {
    usePublicStore.setState({ campus: makeBundle() })

    const result = usePublicStore.getState().nearestNode({ lat: 10.0014, lng: 20.0 })
    expect(result?.id).toBe('n2')
    expect(result).toEqual(
      nearestNodeOf(fixtureNodes, { lat: 10.0014, lng: 20.0 }),
    )
  })

  it('nearestNode returns null beyond maxDistance', () => {
    usePublicStore.setState({ campus: makeBundle() })

    expect(usePublicStore.getState().nearestNode({ lat: 10.0005, lng: 20.0 })).toBeNull()
    expect(usePublicStore.getState().nearestNode({ lat: 10.0002, lng: 20.0 }, 100)?.id).toBe('n1')
  })

  it('is a no-op when campus is already loaded', async () => {
    const fetchMock = stubFetch((url) => {
      if (url.includes('/api/public-campus')) return jsonResponse(graphFixture)
      return jsonResponse({ error: 'not found' }, 404)
    })

    await usePublicStore.getState().fetchCampusData('test-campus')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await usePublicStore.getState().fetchCampusData('test-campus')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('is a no-op while loading', async () => {
    const fetchMock = stubFetch(() => jsonResponse(graphFixture))
    usePublicStore.setState({ campusLoading: true })

    await usePublicStore.getState().fetchCampusData('test-campus')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(usePublicStore.getState().campusLoading).toBe(true)
  })

  it('hydrates a valid cache first while a separate refresh is in flight', async () => {
    const cache = createMemoryCampusCacheRepository()
    await cache.put(makeCacheRecord())
    const network = deferred<Response>()
    const fetchMock = stubFetch(() => network.promise)
    const store = createPublicStore({ cache })

    const request = store.getState().fetchCampusData('test-campus')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    expect(store.getState().campusLoading).toBe(false)
    expect(store.getState().isRefreshing).toBe(true)
    expect(store.getState().campusOrigin).toBe('cache')
    expect(store.getState().campusData?.nodes).toHaveLength(3)
    expect(store.getState().campus?.nodes).toHaveLength(3)
    expect(store.getState().campusData?.nodes).toBe(store.getState().campus?.nodes)

    network.resolve(await jsonResponse({ ...graphFixture, revision: '12' }))
    await request

    expect(store.getState().isRefreshing).toBe(false)
    expect(store.getState().campusOrigin).toBe('network')
    expect(store.getState().campusRevision).toBe('12')
    expect((await cache.get('test-campus'))?.revision).toBe('12')
  })

  it('preserves a usable cache when refresh returns empty data', async () => {
    const cache = createMemoryCampusCacheRepository()
    await cache.put(makeCacheRecord())
    stubFetch(() => jsonResponse({ campusId: 'test-campus', source: 'empty', revision: null }))
    const store = createPublicStore({ cache })

    await store.getState().fetchCampusData('test-campus')

    expect(store.getState().campusLoading).toBe(false)
    expect(store.getState().campusStatus).toBe('ready')
    expect(store.getState().campusError).toBeNull()
    expect(store.getState().refreshError).toBe('No campus data available')
    expect(store.getState().campusOrigin).toBe('cache')
    expect(store.getState().campus?.nodes).toHaveLength(3)
    expect((await cache.get('test-campus'))?.revision).toBe('11')
  })

  it('does not persist a graph snapshot by default', async () => {
    const cache = createMemoryCampusCacheRepository()
    stubFetch(() => jsonResponse({
      campusId: 'test-campus',
      source: 'graph_snapshots',
      revision: null,
      nodes: graphFixture.nodes,
      edges: graphFixture.edges,
      buildings: buildingsFixture.buildings,
    }))
    const store = createPublicStore({ cache })

    await store.getState().fetchCampusData('test-campus')

    expect(store.getState().campusStatus).toBe('ready')
    expect(store.getState().campusData?.source).toBe('graph_snapshots')
    expect(await cache.get('test-campus')).toBeNull()
  })

  it('continues with the network when cache storage is unavailable', async () => {
    const cache = {
      get: vi.fn().mockRejectedValue(new Error('IndexedDB unavailable')),
      put: vi.fn().mockRejectedValue(new Error('IndexedDB unavailable')),
      delete: vi.fn().mockResolvedValue(undefined),
    }
    stubFetch(() => jsonResponse(graphFixture))
    const store = createPublicStore({ cache })

    await store.getState().fetchCampusData('test-campus')

    expect(store.getState().campusStatus).toBe('ready')
    expect(store.getState().campusError).toBeNull()
    expect(store.getState().isRefreshing).toBe(false)
    expect(cache.get).toHaveBeenCalledWith('test-campus')
    expect(cache.put).toHaveBeenCalledWith(expect.objectContaining({ source: 'published' }))
  })

  it('ignores a late response from a previous campus request', async () => {
    const first = deferred<Response>()
    const second = deferred<Response>()
    const cache = createMemoryCampusCacheRepository()
    const fetchMock = stubFetch((url) => url.includes('campus-a') ? first.promise : second.promise)
    const store = createPublicStore({ cache })

    const firstRequest = store.getState().fetchCampusData('campus-a')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const secondRequest = store.getState().fetchCampusData('campus-b')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    second.resolve(jsonResponse({ ...graphFixture, campusId: 'campus-b' }))
    await secondRequest
    first.resolve(jsonResponse(graphFixture))
    await firstRequest

    expect(store.getState().campusData?.campusId).toBe('campus-b')
    expect(store.getState().campus?.nodes[0].campusId).toBe('campus-b')
  })

  it('suppresses duplicate requests for the same campus', async () => {
    const response = deferred<Response>()
    const fetchMock = stubFetch(() => response.promise)
    const store = createPublicStore({ cache: createMemoryCampusCacheRepository() })

    const firstRequest = store.getState().fetchCampusData('test-campus')
    const secondRequest = store.getState().fetchCampusData('test-campus')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    response.resolve(jsonResponse(graphFixture))
    await Promise.all([firstRequest, secondRequest])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(store.getState().campusStatus).toBe('ready')
  })

  it('keeps a temporary campus switch separate from the persisted default campus', async () => {
    localStorage.clear()
    const cache = createMemoryCampusCacheRepository()
    const store = createPublicStore({ cache })
    store.getState().setDefaultCampus('campus-default')

    stubFetch((url) => {
      if (url.includes('/api/public-campus')) {
        return jsonResponse({ ...graphFixture, campusId: 'campus-temporary' })
      }
      return jsonResponse({ error: 'not found' }, 404)
    })

    await store.getState().fetchCampusData('campus-temporary')

    expect(store.getState().currentCampusId).toBe('campus-temporary')
    expect(store.getState().defaultCampusId).toBe('campus-default')
    expect(localStorage.getItem('navi-default-campus')).toBe('campus-default')
  })

  it('keeps an explicit QR origin separate from ordinary origin selection', () => {
    const store = createPublicStore({ cache: createMemoryCampusCacheRepository() })
    const location = {
      source: 'qr' as const,
      campusId: 'test-campus',
      checkpointId: 'checkpoint-1',
      label: 'Main Entrance QR',
      buildingId: 'b1',
      floor: 1,
      position: { lat: 10.001, lng: 20 },
      nodeId: 'n2',
      anchor: 'graph-node' as const,
    }

    store.getState().setQrLocation(location)

    expect(store.getState().qrLocation).toEqual(location)
    expect(store.getState().fromNode).toBe('n2')

    store.getState().setFrom('n1')
    expect(store.getState().qrLocation).toBeNull()
    expect(store.getState().fromNode).toBe('n1')
  })

  it('preserves the previous valid current campus when a temporary switch fails', async () => {
    localStorage.clear()
    const store = createPublicStore({ cache: createMemoryCampusCacheRepository() })
    const previousBuilding = {
      id: 'b1',
      name: 'Main Building',
      campusId: 'campus-a',
      floors: [0],
      footprint: [],
      baseElevation: 0,
      height: 0,
    }
    store.setState({
      currentCampusId: 'campus-a',
      defaultCampusId: 'campus-a',
      campus: makeBundle({ buildings: [previousBuilding] }),
      campusData: {
        campusId: 'campus-a',
        source: 'published_maps',
        buildings: [previousBuilding],
        components: [],
        nodes: fixtureNodes,
        edges: fixtureEdges,
      },
      fromNode: 'n1',
      toNode: 'n3',
      campusStatus: 'ready',
    })
    stubFetch(() => jsonResponse({ error: 'unavailable' }, 503))

    await store.getState().fetchCampusData('campus-b')

    expect(store.getState().currentCampusId).toBe('campus-a')
    expect(store.getState().campus?.buildings).toEqual([previousBuilding])
    expect(store.getState().fromNode).toBe('n1')
    expect(store.getState().toNode).toBe('n3')
    expect(store.getState().defaultCampusId).toBe('campus-a')
    expect(store.getState().campusStatus).toBe('ready')
    expect(store.getState().refreshError).toBe('No campus data available')
  })

  it('persists public presentation preferences without changing campus data', () => {
    localStorage.clear()
    const store = createPublicStore({ cache: createMemoryCampusCacheRepository() })
    const authoredBuilding = {
      id: 'b1',
      name: 'Main Building',
      campusId: 'test-campus',
      floors: [0, 1],
      footprint: [],
      baseElevation: 0,
      height: 0,
      color: '#123456',
    }
    const campus = makeBundle({ buildings: [authoredBuilding] })
    store.setState({ campus })

    store.getState().setTheme('dark')
    store.getState().setMapAppearance('uniform')
    store.getState().setNotifications(false)
    store.getState().setNavigationPreferences({ defaultMapView: 'follow', headingFollow: true })
    store.getState().setAccessibilityPreferences({ reducedMotion: true })

    expect(store.getState().campus?.buildings[0]).toEqual(authoredBuilding)
    expect(store.getState().preferences).toMatchObject({
      theme: 'dark',
      mapAppearance: 'uniform',
      notifications: false,
      navigation: { defaultMapView: 'follow', headingFollow: true },
      accessibility: { reducedMotion: true },
    })

    const reloaded = createPublicStore({ cache: createMemoryCampusCacheRepository() })
    expect(reloaded.getState().preferences).toEqual(store.getState().preferences)
  })

  it('clears campus-scoped selections when a different current campus hydrates', async () => {
    localStorage.clear()
    const cache = createMemoryCampusCacheRepository()
    const store = createPublicStore({ cache })
    const building = {
      id: 'b1',
      name: 'Main Building',
      campusId: 'campus-a',
      floors: [0, 2],
      footprint: [],
      baseElevation: 0,
      height: 0,
    }
    store.setState({
      currentCampusId: 'campus-a',
      defaultCampusId: 'campus-default',
      campus: makeBundle({ buildings: [building] }),
      campusData: {
        campusId: 'campus-a',
        source: 'published_maps',
        buildings: [building],
        components: [],
        nodes: fixtureNodes,
        edges: fixtureEdges,
      },
      selectedBuilding: building,
      selectedNode: fixtureNodes[1],
      fromNode: 'n1',
      toNode: 'n3',
      activeFloor: 2,
      indoorContext: { active: true, buildingId: 'b1', floorId: 2 },
      campusStatus: 'ready',
    })
    stubFetch((url) => {
      if (url.includes('/api/public-campus')) {
        return jsonResponse({ ...graphFixture, campusId: 'campus-b' })
      }
      return jsonResponse({ error: 'not found' }, 404)
    })

    await store.getState().fetchCampusData('campus-b')

    expect(store.getState().currentCampusId).toBe('campus-b')
    expect(store.getState().defaultCampusId).toBe('campus-default')
    expect(store.getState().selectedBuilding).toBeNull()
    expect(store.getState().selectedNode).toBeNull()
    expect(store.getState().fromNode).toBeNull()
    expect(store.getState().toNode).toBeNull()
    expect(store.getState().activeFloor).toBe(0)
    expect(store.getState().indoorContext).toEqual({ active: false })
  })
})
