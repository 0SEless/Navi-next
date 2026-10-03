import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Graph } from '../../engine/graph'
import { useGraphStore, __resetGraphSaveQueuesForTests } from '../graph-store'

/**
 * Phase 3A — recovery supersession composed with campus session guards.
 * Load server version converges; stale queued saves and stale in-flight
 * acknowledgements cannot resurrect the discarded local graph.
 */

const MAP_ID = 'recovery-supersession'
const CACHE_KEY = `navi-graph-${MAP_ID}`
const MARKER_KEY = `navi-sync-status-${MAP_ID}`

function makeGraph(name: string): Graph {
  const graph = new Graph()
  graph.campusId = MAP_ID
  graph.addBuilding({ id: 'building-1', name, campusId: MAP_ID, footprint: [] } as never)
  return graph
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function harness() {
  const state = {
    server: makeGraph('Base Hall').toJSON() as unknown as Record<string, unknown>,
    updatedAt: 'R1',
    postStatus: 200,
  }
  const posted: string[] = []
  let postCount = 0
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if ((init?.method ?? 'GET') === 'POST') {
      posted.push(String(init?.body ?? ''))
      if (state.postStatus !== 200) return jsonResponse({ error: 'server exploded' }, state.postStatus)
      postCount += 1
      return jsonResponse({ success: true, updatedAt: 'R' + postCount })
    }
    return jsonResponse({ ...state.server, updatedAt: state.updatedAt })
  })
  vi.stubGlobal('fetch', fetchMock)
  return {
    fetchMock,
    posted,
    setServer: (name: string, updatedAt: string) => {
      state.server = makeGraph(name).toJSON() as unknown as Record<string, unknown>
      state.updatedAt = updatedAt
    },
  }
}

function readMarker(): { serverTimestamp?: string | null } {
  return JSON.parse(localStorage.getItem(MARKER_KEY) ?? '{}')
}

async function seedAcknowledged(h: ReturnType<typeof harness>): Promise<void> {
  useGraphStore.setState({ graph: makeGraph('Base Hall'), currentMapId: MAP_ID, syncStatus: 'idle', syncError: null })
  await useGraphStore.getState().save()
  expect(useGraphStore.getState().syncStatus).toBe('synced')
}

function refreshWithEditedCache(): void {
  localStorage.setItem(CACHE_KEY, JSON.stringify(makeGraph('Edited Hall').toJSON()))
  useGraphStore.setState({ graph: new Graph(), currentMapId: null, syncStatus: 'idle', syncError: null })
  useGraphStore.getState().loadMapData(MAP_ID)
}

describe('Phase 3A recovery supersession', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    __resetGraphSaveQueuesForTests()
    useGraphStore.setState({ graph: new Graph(), currentMapId: null, syncStatus: 'idle', syncError: null })
  })

  it('A/B/C — Load server version converges; freshness and a full reload stay clean', async () => {
    const h = harness()
    await seedAcknowledged(h)
    h.setServer('Other Writer Hall', 'R9')
    refreshWithEditedCache()
    await vi.waitFor(() => expect(useGraphStore.getState().syncStatus).toBe('conflict'))
    useGraphStore.getState().completeCampusHydration()

    await useGraphStore.getState().adoptServerSnapshot()

    const state = useGraphStore.getState()
    expect(state.syncStatus).toBe('synced')
    expect(state.graph.buildings[0]?.name).toBe('Other Writer Hall')
    expect(state.pendingAuthoredMutations).toHaveLength(0)
    expect(localStorage.getItem(CACHE_KEY)).toContain('Other Writer Hall')
    expect(localStorage.getItem(CACHE_KEY)).not.toContain('Edited Hall')
    expect(readMarker().serverTimestamp).toBe('R9')
    const postsAfterAdopt = h.posted.length

    // Full reload rehydrates the server graph with no conflict.
    useGraphStore.setState({ graph: new Graph(), currentMapId: null, syncStatus: 'idle', syncError: null })
    useGraphStore.getState().loadMapData(MAP_ID)
    await vi.waitFor(() => expect(useGraphStore.getState().syncStatus).toBe('synced'))
    expect(useGraphStore.getState().graph.buildings[0]?.name).toBe('Other Writer Hall')
    expect(h.posted).toHaveLength(postsAfterAdopt)
  })

  it('D/E — queued stale save rejected; stale in-flight ack discarded after adoption', async () => {
    const h = harness()
    await seedAcknowledged(h)
    h.setServer('Other Writer Hall', 'R9')
    refreshWithEditedCache()
    await vi.waitFor(() => expect(useGraphStore.getState().syncStatus).toBe('conflict'))
    useGraphStore.getState().completeCampusHydration()

    // Hold the first save in flight so the second is QUEUED, then adopt.
    let releaseGate: (() => void) | null = null
    const gate = new Promise<void>((resolve) => { releaseGate = resolve })
    const originalFetch = globalThis.fetch as ReturnType<typeof vi.fn>
    originalFetch.mockImplementationOnce(async (input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'POST') {
        await gate
        return jsonResponse({ success: true, updatedAt: 'R10' })
      }
      return originalFetch(input as RequestInfo, init)
    })

    useGraphStore.setState({ syncStatus: 'idle', syncError: null })
    const saveA = useGraphStore.getState().save()
    const saveB = useGraphStore.getState().save()

    const rejectedQueuedSave = expect(saveB).rejects.toThrow(/Superseded by authoritative server adoption/i)
    const adoption = useGraphStore.getState().adoptServerSnapshot()
    await rejectedQueuedSave
    releaseGate?.()
    await adoption
    await saveA.catch(() => {})
    // Stale in-flight ack must not stamp the marker over the adopted base.
    expect(readMarker().serverTimestamp).toBe('R9')
    expect(useGraphStore.getState().graph.buildings[0]?.name).toBe('Other Writer Hall')
  })

  it('F/G/H — re-sync converged, missed-ack healed, genuine divergence preserved', async () => {
    const h = harness()
    await seedAcknowledged(h)
    refreshWithEditedCache()
    // F — safe local-ahead now auto-resumes after readiness (Phase 3C contract).
    await vi.waitFor(() => expect(useGraphStore.getState().syncStatus).toBe('idle'))
    useGraphStore.getState().completeCampusHydration()
    await vi.waitFor(() => expect(useGraphStore.getState().syncStatus).toBe('synced'))
    expect(useGraphStore.getState().graph.buildings[0]?.name).toBe('Edited Hall')

    // H — genuine divergence after independent server change.
    h.setServer('Third Writer Hall', 'R99')
    useGraphStore.setState({ syncStatus: 'conflict', syncError: 'The server has a different version of this map.' })
    const postsBefore = h.posted.length
    await expect(useGraphStore.getState().syncLocalChanges()).rejects.toThrow(/differ/i)
    expect(h.posted).toHaveLength(postsBefore)
    expect(useGraphStore.getState().graph.buildings[0]?.name).toBe('Edited Hall')
  })
})
