import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Graph } from '../../engine/graph'
import { useGraphStore, __resetGraphSaveQueuesForTests } from '../graph-store'

/**
 * Refresh-during-save recovery (focused).
 * CASE A: server committed but ack missed -> auto-heal on reload.
 * CASE B: local work ahead of acknowledged base, server unchanged -> "Re-sync" retry succeeds.
 * CASE C: genuine divergence -> never overwrite; local work preserved.
 * No-edit reload -> no POST.
 */

const MAP_ID = 'refresh-recovery'
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

function readMarker(): { serverTimestamp?: string | null; snapshotFingerprint?: string } {
  return JSON.parse(localStorage.getItem(MARKER_KEY) ?? '{}')
}

interface Harness {
  fetchMock: ReturnType<typeof vi.fn>
  posted: string[]
  setServer: (name: string, updatedAt: string) => void
  setPostFailure: (status: number, error?: string) => void
  setPostSuccess: () => void
}

function harness(): Harness {
  const state = {
    server: makeGraph('Base Hall').toJSON() as unknown as Record<string, unknown>,
    updatedAt: 'R1',
    postStatus: 200,
    postError: 'server exploded',
  }
  const posted: string[] = []
  let postCount = 0
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if ((init?.method ?? 'GET') === 'POST') {
      posted.push(String(init?.body ?? ''))
      if (state.postStatus !== 200) return jsonResponse({ error: state.postError }, state.postStatus)
      postCount += 1
      return jsonResponse({ success: true, updatedAt: 'R' + postCount })
    }
    return jsonResponse({ ...state.server, updatedAt: state.updatedAt })
  })
  vi.stubGlobal('fetch', fetchMock)
  return {
    fetchMock,
    posted,
    setServer: (name, updatedAt) => { state.server = makeGraph(name).toJSON() as unknown as Record<string, unknown>; state.updatedAt = updatedAt },
    setPostFailure: (status, error = 'server exploded') => {
      state.postStatus = status
      state.postError = error
    },
    setPostSuccess: () => { state.postStatus = 200 },
  }
}

/** Seed an acknowledged base via a real save (marker = base fingerprint @ R1). */
async function seedAcknowledged(): Promise<void> {
  useGraphStore.setState({ graph: makeGraph('Base Hall'), currentMapId: MAP_ID, syncStatus: 'idle', syncError: null })
  await useGraphStore.getState().save()
  expect(useGraphStore.getState().syncStatus).toBe('synced')
}

/** Simulate: user edited (cache+store = Edited) then refreshed (loadMapData). */
function refreshWithEditedCache(): void {
  localStorage.setItem(CACHE_KEY, JSON.stringify(makeGraph('Edited Hall').toJSON()))
  useGraphStore.setState({ graph: new Graph(), currentMapId: null, syncStatus: 'idle', syncError: null })
  useGraphStore.getState().loadMapData(MAP_ID)
}

describe('refresh-during-save recovery', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    __resetGraphSaveQueuesForTests()
    useGraphStore.setState({ graph: new Graph(), currentMapId: null, syncStatus: 'idle', syncError: null })
  })

  it('CASE A — server committed but ack was missed: reload auto-heals to synced', async () => {
    const h = harness()
    await seedAcknowledged()
    h.setServer('Edited Hall', 'R2') // server DID receive the edit
    refreshWithEditedCache()

    await vi.waitFor(() => expect(useGraphStore.getState().syncStatus).toBe('synced'))
    expect(readMarker().serverTimestamp).toBe('R2')
    expect(h.posted).toHaveLength(1) // only the seed save; auto-heal performs no new POST
  })

  it('CASE A2 — Re-sync auto-heals a stale marker when server and local graphs already match', async () => {
    const h = harness()
    await seedAcknowledged()
    h.setServer('Edited Hall', 'R2')
    localStorage.setItem(CACHE_KEY, JSON.stringify(makeGraph('Edited Hall').toJSON()))
    useGraphStore.setState({
      graph: makeGraph('Edited Hall'),
      currentMapId: MAP_ID,
      syncStatus: 'conflict',
      syncError: 'stale acknowledgement',
    })
    useGraphStore.getState().recordAuthoredMutation('building', 'building-1', null)
    expect(useGraphStore.getState().pendingAuthoredMutations).toHaveLength(1)

    await useGraphStore.getState().syncLocalChanges()

    expect(h.posted).toHaveLength(1)
    expect(readMarker().serverTimestamp).toBe('R2')
    expect(useGraphStore.getState().syncStatus).toBe('synced')
    expect(useGraphStore.getState().pendingAuthoredMutations).toHaveLength(0)
    expect(useGraphStore.getState().graph.buildings[0]?.name).toBe('Edited Hall')
  })

  it('CASE B — safe local-ahead (server == acknowledged, local newer) auto-resumes through the guarded pipeline', async () => {
    const h = harness()
    await seedAcknowledged()
    // Server is still at the acknowledged base (save never landed).
    h.setServer('Base Hall', 'R7')
    refreshWithEditedCache()
    // Approved Phase 3C contract: this is NOT genuine divergence.
    await vi.waitFor(() => expect(useGraphStore.getState().syncStatus).toBe('idle'))
    expect(h.posted).toHaveLength(1) // nothing posted during hydration

    useGraphStore.getState().completeCampusHydration()
    await vi.waitFor(() => expect(useGraphStore.getState().syncStatus).toBe('synced'))

    expect(h.posted).toHaveLength(2) // exactly one guarded resume
    const resumeBody = JSON.parse(h.posted[1])
    expect(typeof resumeBody.expectedServerUpdatedAt).toBe('string')
    expect(useGraphStore.getState().graph.buildings[0]?.name).toBe('Edited Hall')
  })

  it('CASE C — genuine divergence: no overwrite, local work preserved, conflict kept', async () => {
    const h = harness()
    await seedAcknowledged()
    h.setServer('Other Writer Hall', 'R9') // third-party divergence
    refreshWithEditedCache()
    await vi.waitFor(() => expect(useGraphStore.getState().syncStatus).toBe('conflict'))
    useGraphStore.getState().completeCampusHydration()

    await expect(useGraphStore.getState().syncLocalChanges()).rejects.toThrow(/differ/i)
    expect(useGraphStore.getState().syncStatus).toBe('conflict')
    expect(h.posted).toHaveLength(1) // no retry POST on divergence
    expect(useGraphStore.getState().graph.buildings[0]?.name).toBe('Edited Hall')
  })

  it('failed retry preserves local work and restores the conflict state', async () => {
    vi.useFakeTimers()
    try {
    const h = harness()
    await seedAcknowledged()
    h.setServer('Base Hall', 'R7')
    // Manual conflict (e.g. after a failed auto-resume): server still at the
    // acknowledged base, local work ahead. Re-sync CASE B must fail cleanly.
    useGraphStore.setState({
      graph: makeGraph('Edited Hall'),
      currentMapId: MAP_ID,
      syncStatus: 'conflict',
      syncError: 'stale acknowledgement',
    })
    h.setPostFailure(500)

    const recovery = useGraphStore.getState().syncLocalChanges()
    const rejection = expect(recovery).rejects.toThrow(/exploded/i)
    await vi.advanceTimersByTimeAsync(47_000)
    await rejection
    expect(useGraphStore.getState().syncStatus).toBe('conflict')
    expect(useGraphStore.getState().graph.buildings[0]?.name).toBe('Edited Hall')
    } finally {
      vi.useRealTimers()
    }
  })

  it('an A → B → A switch during authentication preflight cannot change the new A session or clear its intents', async () => {
    const h = harness()
    await seedAcknowledged()
    useGraphStore.setState({
      graph: makeGraph('Edited Hall'),
      currentMapId: MAP_ID,
      syncStatus: 'conflict',
      syncError: 'stale acknowledgement',
    })

    let resolveGet!: (response: Response) => void
    const deferredGet = new Promise<Response>((resolve) => { resolveGet = resolve })
    vi.stubGlobal('fetch', vi.fn(() => deferredGet))
    const recovery = useGraphStore.getState().syncLocalChanges()

    useGraphStore.getState().setCurrentMapId('next-map')
    const nextMap = makeGraph('Next Map Hall')
    nextMap.campusId = 'next-map'
    useGraphStore.setState({
      graph: nextMap,
      currentMapId: 'next-map',
      syncStatus: 'idle',
      syncError: null,
      pendingAuthoredMutations: [],
    })
    useGraphStore.getState().setCurrentMapId(MAP_ID)
    const reopenedMap = makeGraph('Reopened A Hall')
    useGraphStore.setState({
      graph: reopenedMap,
      syncStatus: 'idle',
      syncError: null,
      pendingAuthoredMutations: [],
      campusReady: true,
    })
    useGraphStore.getState().recordAuthoredMutation('building', 'reopened-building', null)
    resolveGet(jsonResponse({ error: 'Unauthorized' }, 401))

    await recovery

    expect(useGraphStore.getState().currentMapId).toBe(MAP_ID)
    expect(useGraphStore.getState().syncStatus).toBe('idle')
    expect(useGraphStore.getState().syncError).toBeNull()
    expect(useGraphStore.getState().pendingAuthoredMutations).toHaveLength(1)
    expect(useGraphStore.getState().graph.buildings[0]?.name).toBe('Reopened A Hall')
    expect(h.posted).toHaveLength(1)
  })

  it('authentication failure is labeled specifically and is not restored as a revision conflict', async () => {
    const h = harness()
    await seedAcknowledged()
    // Manual conflict after a failed auto-resume: server at the acknowledged
    // base, local work ahead; auth failures must stay labeled specifically.
    useGraphStore.setState({
      graph: makeGraph('Edited Hall'),
      currentMapId: MAP_ID,
      syncStatus: 'conflict',
      syncError: 'stale acknowledgement',
    })
    h.setPostFailure(401, 'Unauthorized')

    await expect(useGraphStore.getState().syncLocalChanges()).rejects.toThrow(
      'Saving failed: authentication required. Sign in again to continue.'
    )
    expect(useGraphStore.getState().syncStatus).toBe('error')
    expect(useGraphStore.getState().syncError).toBe(
      'Saving failed: authentication required. Sign in again to continue.'
    )
    expect(useGraphStore.getState().syncError).not.toMatch(/server unreachable|server changed/i)
    expect(useGraphStore.getState().graph.buildings[0]?.name).toBe('Edited Hall')

    h.setPostSuccess()
    await useGraphStore.getState().syncLocalChanges()
    expect(useGraphStore.getState().syncStatus).toBe('synced')
    expect(h.posted).toHaveLength(3)
  })

  it('no-edit reload performs no POST and stays synced', async () => {
    const h = harness()
    await seedAcknowledged()
    useGraphStore.setState({ graph: new Graph(), currentMapId: null, syncStatus: 'idle', syncError: null })
    useGraphStore.getState().loadMapData(MAP_ID)

    await vi.waitFor(() => expect(useGraphStore.getState().syncStatus).toBe('synced'))
    expect(h.posted).toHaveLength(1)
  })

  it('TEST 1/2 — Load server version converges: graph/cache/marker all server, intents cleared, reload stays clean', async () => {
    const h = harness()
    await seedAcknowledged(h)
    h.setServer('Other Writer Hall', 'R9')
    refreshWithEditedCache()
    await vi.waitFor(() => expect(useGraphStore.getState().syncStatus).toBe('conflict'))
    useGraphStore.getState().completeCampusHydration()
    useGraphStore.getState().recordAuthoredMutation('building', 'building-1')

    // Adopt the authoritative server version (Load server version).
    await useGraphStore.getState().adoptServerSnapshot()

    const state = useGraphStore.getState()
    expect(state.syncStatus).toBe('synced')
    expect(state.graph.buildings[0]?.name).toBe('Other Writer Hall')
    expect(state.pendingAuthoredMutations).toHaveLength(0)
    // Persisted cache must be the server graph, not the discarded local edit.
    expect(localStorage.getItem(CACHE_KEY)).toContain('Other Writer Hall')
    expect(localStorage.getItem(CACHE_KEY)).not.toContain('Edited Hall')
    // Marker must be the authoritative server revision.
    expect(readMarker().serverTimestamp).toBe('R9')
    const postsAfterAdopt = h.posted.length

    // TEST 2 — full reload rehydrates the server graph with no conflict.
    useGraphStore.setState({ graph: new Graph(), currentMapId: null, syncStatus: 'idle', syncError: null })
    useGraphStore.getState().loadMapData(MAP_ID)
    await vi.waitFor(() => expect(useGraphStore.getState().syncStatus).toBe('synced'))
    expect(useGraphStore.getState().graph.buildings[0]?.name).toBe('Other Writer Hall')
    expect(h.posted).toHaveLength(postsAfterAdopt) // no new POST from reload
  })

  it('TEST 3 — a queued stale save cannot resurrect the discarded local graph', async () => {
    const h = harness()
    await seedAcknowledged(h)
    h.setServer('Other Writer Hall', 'R9')
    refreshWithEditedCache()
    await vi.waitFor(() => expect(useGraphStore.getState().syncStatus).toBe('conflict'))
    useGraphStore.getState().completeCampusHydration()

    // Hold the first save in flight so a second one is QUEUED, then adopt.
    let releaseGate: (() => void) | null = null
    const gate = new Promise<void>((resolve) => { releaseGate = resolve })
    const originalFetch = globalThis.fetch as ReturnType<typeof vi.fn>
    originalFetch.mockImplementationOnce(async (input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'POST') { await gate; return jsonResponse({ success: true, updatedAt: 'R10' }) }
      return originalFetch(input as RequestInfo, init)
    })

    // Clear conflict so saves are allowed, then start save A (gated) + save B (queued).
    useGraphStore.setState({ syncStatus: 'idle', syncError: null })
    const saveA = useGraphStore.getState().save()
    const saveB = useGraphStore.getState().save()

    const rejectedQueuedSave = expect(saveB).rejects.toThrow(/Superseded by authoritative server adoption/i)
    const adoption = useGraphStore.getState().adoptServerSnapshot()
    await rejectedQueuedSave
    releaseGate?.()
    await adoption
    await saveA.catch(() => {})
    expect(useGraphStore.getState().graph.buildings[0]?.name).toBe('Other Writer Hall')
    expect(readMarker().serverTimestamp).toBe('R9')
  })
})
