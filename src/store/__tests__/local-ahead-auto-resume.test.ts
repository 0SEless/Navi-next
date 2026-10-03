import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Graph } from '../../engine/graph'
import { useGraphStore, __resetGraphSaveQueuesForTests } from '../graph-store'

/**
 * Phase 3C — safe local-ahead auto-resume.
 * server == acknowledged && local newer (server unchanged) is NOT divergence:
 * the preserved local draft auto-resumes once through the guarded save pipeline.
 */

const MAP_ID = 'local-ahead-resume'
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
    setPostStatus: (status: number) => {
      state.postStatus = status
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

/** Simulate the interrupted-debounce state: local draft B, server still A. */
function writeLocalDraftAndReload(): void {
  localStorage.setItem(CACHE_KEY, JSON.stringify(makeGraph('Draft Hall').toJSON()))
  useGraphStore.setState({ graph: new Graph(), currentMapId: null, syncStatus: 'idle', syncError: null })
  useGraphStore.getState().loadMapData(MAP_ID)
}

describe('Phase 3C safe local-ahead auto-resume', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    __resetGraphSaveQueuesForTests()
    useGraphStore.setState({ graph: new Graph(), currentMapId: null, syncStatus: 'idle', syncError: null })
  })

  it('TEST J/K/M — safe local-ahead classified as pending (not divergence) and resumes with exactly one POST', async () => {
    const h = harness()
    await seedAcknowledged(h)
    const postsAfterSeed = h.posted.length

    writeLocalDraftAndReload()

    // Classification: retained local draft, NOT a genuine-divergence conflict.
    await vi.waitFor(() => expect(useGraphStore.getState().graph.buildings[0]?.name).toBe('Draft Hall'))
    await vi.waitFor(() => expect(useGraphStore.getState().syncStatus).toBe('idle'))
    expect(h.posted).toHaveLength(postsAfterSeed) // no POST during hydration

    // Readiness completion drains the single-shot resume through the guarded path.
    useGraphStore.getState().completeCampusHydration()
    await vi.waitFor(() => expect(useGraphStore.getState().syncStatus).toBe('synced'))

    expect(h.posted).toHaveLength(postsAfterSeed + 1)
    const resumeBody = JSON.parse(h.posted[postsAfterSeed])
    expect(resumeBody.expectedServerUpdatedAt).toBe('R1') // CAS against authoritative A
    expect(useGraphStore.getState().graph.buildings[0]?.name).toBe('Draft Hall')
    expect(readMarker().serverTimestamp).toBe('R2')

    // Single-shot: completing again must not enqueue another save.
    useGraphStore.getState().completeCampusHydration()
    useGraphStore.getState().completeCampusHydration()
    await new Promise((r) => setTimeout(r, 10))
    expect(h.posted).toHaveLength(postsAfterSeed + 1)
  })

  it('TEST L — full reload after resume stays clean with no new POST', async () => {
    const h = harness()
    await seedAcknowledged(h)
    writeLocalDraftAndReload()
    await vi.waitFor(() => expect(useGraphStore.getState().syncStatus).toBe('idle'))
    useGraphStore.getState().completeCampusHydration()
    await vi.waitFor(() => expect(useGraphStore.getState().syncStatus).toBe('synced'))
    const postsAfterResume = h.posted.length

    // The server now holds the resumed content (incrementing-revision mock).
    h.setServer('Draft Hall', 'R2')
    useGraphStore.setState({ graph: new Graph(), currentMapId: null, syncStatus: 'idle', syncError: null })
    useGraphStore.getState().loadMapData(MAP_ID)
    await vi.waitFor(() => expect(useGraphStore.getState().syncStatus).toBe('synced'))
    expect(useGraphStore.getState().graph.buildings[0]?.name).toBe('Draft Hall')
    expect(h.posted).toHaveLength(postsAfterResume)
  })

  it('TEST Q — true divergence is preserved: no auto-resume POST, conflict remains', async () => {
    const h = harness()
    await seedAcknowledged(h)
    h.setServer('Third Writer Hall', 'R9') // server changed independently
    writeLocalDraftAndReload()
    await vi.waitFor(() => expect(useGraphStore.getState().syncStatus).toBe('conflict'))
    const postsAtConflict = h.posted.length

    useGraphStore.getState().completeCampusHydration()
    await new Promise((r) => setTimeout(r, 10))
    expect(h.posted).toHaveLength(postsAtConflict) // zero automatic POST
    expect(useGraphStore.getState().graph.buildings[0]?.name).toBe('Draft Hall')
    expect(useGraphStore.getState().syncStatus).toBe('conflict')
  })

  it('TEST B5/B6 — auto-resume failure preserves the local draft and surfaces state', async () => {
    vi.useFakeTimers()
    try {
    const h = harness()
    await seedAcknowledged(h)
    writeLocalDraftAndReload()
    await vi.waitFor(() => expect(useGraphStore.getState().syncStatus).toBe('idle'))
    h.setPostStatus(500)

    useGraphStore.getState().completeCampusHydration()
    await vi.advanceTimersByTimeAsync(47000)
    await vi.waitFor(() => expect(useGraphStore.getState().syncStatus).toBe('error'), { timeout: 50000 })
    expect(useGraphStore.getState().graph.buildings[0]?.name).toBe('Draft Hall')
    expect(localStorage.getItem(CACHE_KEY)).toContain('Draft Hall')
    } finally { vi.useRealTimers() }
  })

  it('TEST P — missed ack (server == local, stale marker) heals without a POST', async () => {
    const h = harness()
    await seedAcknowledged(h)
    // Local cache equals the current server content, but the marker is stale.
    localStorage.setItem(CACHE_KEY, JSON.stringify(makeGraph('Base Hall').toJSON()))
    localStorage.setItem(MARKER_KEY, JSON.stringify({ snapshotFingerprint: 'stale', syncedAt: 'x', serverTimestamp: 'R0' }))
    useGraphStore.setState({ graph: new Graph(), currentMapId: null, syncStatus: 'idle', syncError: null })
    const postsBefore = h.posted.length

    useGraphStore.getState().loadMapData(MAP_ID)
    await vi.waitFor(() => expect(useGraphStore.getState().syncStatus).toBe('synced'))
    expect(h.posted).toHaveLength(postsBefore) // no duplicate POST
    expect(readMarker().serverTimestamp).toBe('R1')
  })
})
