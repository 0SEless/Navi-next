import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Graph } from '../../engine/graph'
import { useGraphStore, __resetGraphSaveQueuesForTests } from '../graph-store'

/**
 * P0.12 — CASE E (unattributed manual-save delta) + clean manual save +
 * autosave-no-intent, exercised against the REAL save entry
 * (performSyncToSupabase via save()/syncToSupabase), not only the intent helper.
 */

const MAP_ID = 'case-e-attribution'
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

function setClientGraphDirect(name: string): void {
  // Hydration/internal boundary: direct state injection, NO authored intent.
  useGraphStore.setState({ graph: makeGraph(name), currentMapId: MAP_ID, syncStatus: 'idle', syncError: null })
}

function countPosts(fetchMock: ReturnType<typeof vi.fn>): number {
  return fetchMock.mock.calls.filter(([, init]) => ((init as RequestInit | undefined)?.method ?? 'GET') === 'POST').length
}

function readMarker(): { serverTimestamp?: string | null } {
  return JSON.parse(localStorage.getItem(MARKER_KEY) ?? '{}') as { serverTimestamp?: string | null }
}

function stubServer(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if ((init?.method ?? 'GET') === 'POST') return jsonResponse({ success: true, updatedAt: 'R1' })
    return jsonResponse({})
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('P0.12 CASE E — authored attribution at the real save entry', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    __resetGraphSaveQueuesForTests()
    useGraphStore.setState({ graph: new Graph(), currentMapId: null, syncStatus: 'idle', syncError: null, campusReady: true })
  })

  it('TEST A — clean manual save still POSTs and preserves the revision handshake', async () => {
    const fetchMock = stubServer()
    setClientGraphDirect('Seed Hall')
    await useGraphStore.getState().save()
    expect(useGraphStore.getState().syncStatus).toBe('synced')
    expect(readMarker().serverTimestamp).toBe('R1')

    // Candidate is semantically identical to the acknowledged baseline: CASE D.
    await useGraphStore.getState().save()
    expect(countPosts(fetchMock)).toBe(2)
    const lastBody = JSON.parse(fetchMock.mock.calls.filter(([, init]) => ((init as RequestInit | undefined)?.method) === 'POST').at(-1)![1].body as string)
    expect(lastBody.expectedServerUpdatedAt).toBe('R1')
  })

  it('TEST B — unattributed hydration delta fails closed on manual save (0 POST)', async () => {
    const fetchMock = stubServer()
    setClientGraphDirect('Seed Hall')
    await useGraphStore.getState().save() // acknowledged baseline captured

    // Real authored edit (records an intent), then acknowledged.
    useGraphStore.getState().updateBuilding('building-1', { name: 'Authored Hall' } as never)
    await useGraphStore.getState().save()
    const postsAfterAuthored = countPosts(fetchMock)
    expect(postsAfterAuthored).toBe(2)

    // Unattributed persistent delta via hydration/internal path — no intent.
    setClientGraphDirect('Unattributed Hall')
    await useGraphStore.getState().save()

    expect(countPosts(fetchMock)).toBe(postsAfterAuthored) // 0 additional POSTs
    const state = useGraphStore.getState()
    expect(state.syncStatus).toBe('error')
    expect(state.syncError).toMatch(/Unattributed persistent graph mutation/i)
    expect(state.graph.buildings[0]?.name).toBe('Unattributed Hall') // client state recoverable
  })

  it('TEST C — a real authored command saves normally through the guard', async () => {
    const fetchMock = stubServer()
    setClientGraphDirect('Seed Hall')
    useGraphStore.getState().updateBuilding('building-1', { name: 'Authored Hall' } as never)
    await useGraphStore.getState().save()
    expect(countPosts(fetchMock)).toBe(1)
    expect(useGraphStore.getState().syncStatus).toBe('synced')
    expect(useGraphStore.getState().pendingAuthoredMutations).toHaveLength(0)
  })

  it('TEST E — autosave with no authored intent performs no network write', async () => {
    const fetchMock = stubServer()
    setClientGraphDirect('Seed Hall')
    await useGraphStore.getState().syncToSupabase({ trigger: 'autosave' })
    expect(countPosts(fetchMock)).toBe(0)
  })
})
