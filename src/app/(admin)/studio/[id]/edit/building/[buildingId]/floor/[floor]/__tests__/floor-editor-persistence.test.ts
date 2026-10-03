import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Graph } from '@/engine/graph'
import { useGraphStore, __resetGraphSaveQueuesForTests } from '@/store/graph-store'
import { CoordinateTransformer, CampusDocument } from '@navi/core'
import { GraphAdapter } from '@navi/editor'

const MAP_ID = 'map-test-floor-persistence'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function stubServer(): ReturnType<typeof vi.fn> {
  let n = 0
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if ((init?.method ?? 'GET') === 'POST') {
      n += 1
      return jsonResponse({ success: true, updatedAt: `2026-09-27T06:30:0${n}.000Z` })
    }
    const graph = new Graph()
    graph.campusId = MAP_ID
    graph.addBuilding({
      id: 'building-1',
      name: 'Science Hall',
      campusId: MAP_ID,
      floors: [0],
      footprint: [{ lat: 10, lng: 120 }, { lat: 10.001, lng: 120 }, { lat: 10.001, lng: 120.001 }, { lat: 10, lng: 120.001 }],
      floorData: [{ level: 0, label: 'Ground Floor' }],
    } as never)
    return jsonResponse(graph.toJSON() as unknown as Record<string, unknown>)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('Floor Editor Persistence & Multi-Floor Repair', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    __resetGraphSaveQueuesForTests()
    useGraphStore.setState({ graph: new Graph(), currentMapId: null, syncStatus: 'idle', syncError: null })
  })

  it('verifies FloorEditor hydration marks campus ready and unblocks saves', async () => {
    const fetchMock = stubServer()

    // 1. Initial hydration starts not ready
    useGraphStore.getState().beginCampusHydration()
    expect(useGraphStore.getState().campusReady).toBe(false)

    // 2. Prior to fix, saves were silently refused when campusReady is false
    useGraphStore.setState({ currentMapId: MAP_ID })
    await useGraphStore.getState().save({ trigger: 'autosave' })
    const postCallsBefore = fetchMock.mock.calls.filter(([, init]) => ((init as RequestInit | undefined)?.method ?? 'GET') === 'POST')
    expect(postCallsBefore.length).toBe(0)

    // 3. Mount reconciliation marks campus ready
    useGraphStore.getState().completeCampusHydration()
    expect(useGraphStore.getState().campusReady).toBe(true)

    // 4. Record authored intent for floor 1
    useGraphStore.getState().recordAuthoredMutation('floor', 'building-1', 1)
    expect(useGraphStore.getState().pendingAuthoredMutations.length).toBeGreaterThan(0)
    expect(useGraphStore.getState().pendingAuthoredMutations[0].kind).toBe('floor')
    expect(useGraphStore.getState().pendingAuthoredMutations[0].buildingId).toBe('building-1')
    expect(useGraphStore.getState().pendingAuthoredMutations[0].floor).toBe(1)

    // 5. Save now proceeds through the safety guards and emits POST
    await useGraphStore.getState().save({ trigger: 'autosave' })
    const postCallsAfter = fetchMock.mock.calls.filter(([, init]) => ((init as RequestInit | undefined)?.method ?? 'GET') === 'POST')
    expect(postCallsAfter.length).toBe(1)
    expect(useGraphStore.getState().syncStatus).toBe('synced')
  })

  it('dynamically registers newly added floors in CoordinateTransformer during GraphAdapter.sync', () => {
    const transformer = new CoordinateTransformer()
    const graph = new Graph()
    graph.campusId = MAP_ID

    const doc: CampusDocument = {
      schemaVersion: 1,
      version: 1,
      metadata: { campusId: MAP_ID, name: 'Test Campus', description: '', lastModified: new Date().toISOString(), editorVersion: '1.0.0' },
      buildings: [
        {
          id: 'building-1',
          name: 'Main Hall',
          code: 'MH',
          category: 'academic',
          description: '',
          department: '',
          footprint: { points: [{ lat: 10, lng: 120 }, { lat: 10.001, lng: 120 }, { lat: 10.001, lng: 120.001 }] },
          baseElevation: 0,
          height: 10,
          floors: [
            { id: 'flr-0', level: 0, label: 'Ground', height: 3.5, elevation: 0, visible: true, locked: false, rooms: [], hallways: [], staircases: [], elevators: [], entrances: [], metadata: {} },
            // Dynamically added second floor (level 1)
            { id: 'flr-1', level: 1, label: 'Second Floor', height: 3.5, elevation: 3.5, visible: true, locked: false, rooms: [], hallways: [], staircases: [], elevators: [], entrances: [], metadata: {} },
          ],
        },
      ],
      roads: [],
    }

    const adapter = new GraphAdapter(graph, transformer)
    adapter.sync(doc)

    // Verify both level 0 and level 1 are registered in transformer
    const floor0Sys = transformer.getFloorSystem('building-1', 0)
    const floor1Sys = transformer.getFloorSystem('building-1', 1)

    expect(floor0Sys).toBeDefined()
    expect(floor1Sys).toBeDefined()
    expect(floor1Sys?.offset).toEqual({ x: 0, y: 0 })

    // Verify coordinate transform works for level 1
    const worldPoint = transformer.floorLocalToWorld({ x: 10, y: 20 }, 'building-1', 1)
    expect(worldPoint).not.toBeNull()
    expect(worldPoint?.lat).toBeCloseTo(10, 2)
    expect(worldPoint?.lng).toBeCloseTo(120, 2)
  })
})
