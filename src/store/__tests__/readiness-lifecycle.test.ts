import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Graph } from '../../engine/graph'
import { useGraphStore, __resetGraphSaveQueuesForTests } from '../graph-store'

/**
 * P0.15 — readiness lifecycle matrix A-E, pinned against the real store
 * lifecycle actions (beginCampusHydration / completeCampusHydration) and the
 * real save entry. Test-only file; no production behavior changes.
 */

const MAP_ID = 'readiness-map'
const MAP_B = 'readiness-map-b'

function makeGraph(name: string): Graph {
  const graph = new Graph()
  graph.campusId = MAP_ID
  graph.addBuilding({ id: 'building-1', name, campusId: MAP_ID, footprint: [] } as never)
  return graph
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function setClientGraphDirect(name: string, mapId = MAP_ID): void {
  useGraphStore.setState({ graph: makeGraph(name), currentMapId: mapId, syncStatus: 'idle', syncError: null })
}

function stubServer(opts?: { failGet?: boolean }): ReturnType<typeof vi.fn> {
  let n = 0
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if ((init?.method ?? 'GET') === 'POST') {
      n += 1
      return jsonResponse({ success: true, updatedAt: `R${n}` })
    }
    if (opts?.failGet) return jsonResponse({ error: 'read failed' }, 500)
    return jsonResponse(makeGraph('Server Hall').toJSON() as unknown as Record<string, unknown>)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function countPosts(fetchMock: ReturnType<typeof vi.fn>): number {
  return fetchMock.mock.calls.filter(([, init]) => ((init as RequestInit | undefined)?.method ?? 'GET') === 'POST').length
}

describe('P0.15 readiness lifecycle', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    __resetGraphSaveQueuesForTests()
    useGraphStore.setState({ graph: new Graph(), currentMapId: null, syncStatus: 'idle', syncError: null })
  })

  it('TEST A — initial load: true → false → false → true, with zero premature readiness', async () => {
    const fetchMock = stubServer()
    useGraphStore.setState({ campusReady: true })
    expect(useGraphStore.getState().campusReady).toBe(true)

    useGraphStore.getState().beginCampusHydration()
    expect(useGraphStore.getState().campusReady).toBe(false)

    // Authoritative graph arrives.
    setClientGraphDirect('Loaded Hall')
    expect(useGraphStore.getState().campusReady).toBe(false)

    // Store/document hydration proceeds.
    useGraphStore.setState({ syncStatus: 'idle' })
    expect(useGraphStore.getState().campusReady).toBe(false)

    // Verified EditorBridge completion (GraphAdapter.sync -> complete).
    useGraphStore.getState().completeCampusHydration()
    expect(useGraphStore.getState().campusReady).toBe(true)
    expect(countPosts(fetchMock)).toBe(0)
  })

  it('TEST B — campus switch: not ready immediately, A intents cleared, ready only after completion', async () => {
    stubServer()
    setClientGraphDirect('Campus A Hall')
    useGraphStore.getState().completeCampusHydration()
    useGraphStore.getState().updateBuilding('building-1', { name: 'A edited' } as never)
    expect(useGraphStore.getState().pendingAuthoredMutations.length).toBeGreaterThan(0)

    useGraphStore.getState().setCurrentMapId(MAP_B)
    expect(useGraphStore.getState().campusReady).toBe(false)
    expect(useGraphStore.getState().pendingAuthoredMutations).toHaveLength(0)

    // B loads (still not ready), then completes via the verified point.
    useGraphStore.getState().beginCampusHydration()
    expect(useGraphStore.getState().campusReady).toBe(false)
    useGraphStore.getState().completeCampusHydration()
    expect(useGraphStore.getState().campusReady).toBe(true)
  })

  it('TEST C — load failure keeps not-ready and blocks both save triggers', async () => {
    const fetchMock = stubServer({ failGet: true })
    useGraphStore.getState().beginCampusHydration()
    await useGraphStore.getState().fetchFromSupabase(MAP_ID)
    expect(useGraphStore.getState().campusReady).toBe(false)
    // A failed load leaves no active map mounted; the save gate must still hold.
    useGraphStore.setState({ currentMapId: MAP_ID })

    await useGraphStore.getState().save()
    await useGraphStore.getState().syncToSupabase({ trigger: 'autosave' })
    expect(countPosts(fetchMock)).toBe(0)
    expect(useGraphStore.getState().syncStatus).not.toBe('synced')
  })

  it('TEST D — save while not ready: 0 writes for manual + autosave, intents preserved', async () => {
    const fetchMock = stubServer()
    useGraphStore.getState().recordAuthoredMutation('door', 'building-1', 0)
    useGraphStore.getState().beginCampusHydration()
    useGraphStore.setState({ currentMapId: MAP_ID })

    await useGraphStore.getState().save()
    await useGraphStore.getState().syncToSupabase({ trigger: 'autosave' })
    expect(countPosts(fetchMock)).toBe(0)
    expect(useGraphStore.getState().syncStatus).not.toBe('synced')
    expect(useGraphStore.getState().pendingAuthoredMutations).toHaveLength(1)
  })

  it('TEST E — after ready: clean manual revision handshake, then authored autosave with ack clearing', async () => {
    const fetchMock = stubServer()
    setClientGraphDirect('Seed Hall')
    useGraphStore.getState().completeCampusHydration()

    // Clean manual save: revision handshake preserved.
    await useGraphStore.getState().save()
    expect(countPosts(fetchMock)).toBe(1)
    const firstBody = JSON.parse(fetchMock.mock.calls.find(([, init]) => ((init as RequestInit | undefined)?.method) === 'POST')![1].body as string)
    expect('expectedServerUpdatedAt' in firstBody).toBe(true)

    // Real authored edit -> intent -> autosave allowed -> ack -> intent cleared.
    useGraphStore.getState().updateBuilding('building-1', { name: 'Authored Hall' } as never)
    expect(useGraphStore.getState().pendingAuthoredMutations.length).toBeGreaterThan(0)
    await useGraphStore.getState().syncToSupabase({ trigger: 'autosave' })
    expect(countPosts(fetchMock)).toBe(2)
    expect(useGraphStore.getState().pendingAuthoredMutations).toHaveLength(0)
    expect(useGraphStore.getState().syncStatus).toBe('synced')
  })
})
