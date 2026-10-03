import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createDocument } from '@navi/editor'
import { Graph } from '../../engine/graph'
import { serializeAuthoredGraphPayload } from '../../services/authored-snapshot-persistence'
import { useGraphStore, __resetGraphSaveQueuesForTests } from '../graph-store'

const MAP_ID = 'canonical-convergence'
const CACHE_KEY = `navi-graph-${MAP_ID}`
const MARKER_KEY = `navi-sync-status-${MAP_ID}`

function makeGraph(name: string): Graph {
  const graph = new Graph()
  graph.campusId = MAP_ID
  graph.addBuilding({ id: 'building-1', name, campusId: MAP_ID, footprint: [] } as never)
  return graph
}

function authoredPayload(name: string): Record<string, unknown> {
  const graph = makeGraph(name)
  return serializeAuthoredGraphPayload(
    graph.toJSON() as unknown as Record<string, unknown>,
    createDocument(graph),
  )
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function harness(initialName = 'Baseline Hall') {
  let server = authoredPayload(initialName)
  let revision = 'R1'
  const posts: Array<Record<string, unknown>> = []
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if ((init?.method ?? 'GET') === 'POST') {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      posts.push(body)
      revision = `R${posts.length + 1}`
      server = body
      return jsonResponse({ success: true, updatedAt: revision })
    }
    return jsonResponse({ ...server, updatedAt: revision })
  })
  vi.stubGlobal('fetch', fetchMock)
  return {
    fetchMock,
    posts,
    setServer(name: string, updatedAt: string) {
      server = authoredPayload(name)
      revision = updatedAt
    },
  }
}

async function primeAcknowledgedBaseline(h: ReturnType<typeof harness>): Promise<void> {
  localStorage.setItem(CACHE_KEY, JSON.stringify(authoredPayload('Baseline Hall')))
  useGraphStore.getState().loadMapData(MAP_ID)
  await vi.waitFor(() => expect(useGraphStore.getState().syncStatus).toBe('synced'))
  expect(h.posts).toHaveLength(0)
}

function reloadAuthoredLocal(name: string): void {
  localStorage.setItem(CACHE_KEY, JSON.stringify(authoredPayload(name)))
  useGraphStore.setState({ graph: new Graph(), authoredDocument: null, currentMapId: null, syncStatus: 'idle', syncError: null })
  useGraphStore.getState().loadMapData(MAP_ID)
}

describe('canonical three-way convergence', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    __resetGraphSaveQueuesForTests()
    useGraphStore.setState({
      graph: new Graph(),
      authoredDocument: null,
      currentMapId: null,
      syncStatus: 'idle',
      syncError: null,
      campusReady: false,
      pendingAuthoredMutations: [],
    })
  })

  it('settles synced when persisted local and server authored content agree despite a stale in-memory projection', async () => {
    const payload = authoredPayload('Canonical Hall')
    localStorage.setItem(CACHE_KEY, JSON.stringify(payload))
    localStorage.setItem(MARKER_KEY, JSON.stringify({
      snapshotFingerprint: 'stale-graph-marker',
      serverTimestamp: '2026-09-21T00:00:00.000Z',
    }))

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'POST') return jsonResponse({ success: true }, 500)
      return jsonResponse({ ...payload, updatedAt: '2026-09-22T00:00:00.000Z' })
    })
    vi.stubGlobal('fetch', fetchMock)

    useGraphStore.getState().loadMapData(MAP_ID)
    // The reload race can leave the bridge's in-memory projection one revision
    // behind while the durable local payload and server are already converged.
    useGraphStore.setState({
      graph: makeGraph('Stale Projection'),
      authoredDocument: createDocument(makeGraph('Stale Projection')),
    })

    await vi.waitFor(() => expect(useGraphStore.getState().syncStatus).toBe('synced'))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(useGraphStore.getState().graph.buildings[0]?.name).toBe('Canonical Hall')
    expect(useGraphStore.getState().authoredDocument?.buildings[0]?.name).toBe('Canonical Hall')
    expect(JSON.parse(localStorage.getItem(MARKER_KEY) ?? '{}').serverTimestamp).toBe('2026-09-22T00:00:00.000Z')
  })

  it('treats authored equality as canonical when the persisted Graph projection drifts', async () => {
    const local = authoredPayload('Canonical Hall')
    const server = authoredPayload('Canonical Hall')
    const serverBuilding = (server.buildings as Array<Record<string, unknown>>)[0]
    serverBuilding.name = 'Derived Projection Drift'

    localStorage.setItem(CACHE_KEY, JSON.stringify(local))
    localStorage.setItem(MARKER_KEY, JSON.stringify({
      snapshotFingerprint: 'stale-graph-marker',
      serverTimestamp: '2026-09-21T00:00:00.000Z',
    }))
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'POST') return jsonResponse({ success: true }, 500)
      return jsonResponse({ ...server, updatedAt: '2026-09-22T00:00:00.000Z' })
    })
    vi.stubGlobal('fetch', fetchMock)

    useGraphStore.getState().loadMapData(MAP_ID)
    await vi.waitFor(() => expect(useGraphStore.getState().syncStatus).toBe('synced'))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(useGraphStore.getState().authoredDocument?.buildings[0]?.name).toBe('Canonical Hall')
  })

  it('TEST B — remains synced across two consecutive authored reloads with no hydration writes', async () => {
    const h = harness()
    await primeAcknowledgedBaseline(h)
    h.setServer('Reloaded Hall', 'R2')

    reloadAuthoredLocal('Reloaded Hall')
    await vi.waitFor(() => expect(useGraphStore.getState().syncStatus).toBe('synced'))
    reloadAuthoredLocal('Reloaded Hall')
    await vi.waitFor(() => expect(useGraphStore.getState().syncStatus).toBe('synced'))

    expect(h.posts).toHaveLength(0)
    expect(JSON.parse(localStorage.getItem(MARKER_KEY) ?? '{}').serverTimestamp).toBe('R2')
  })

  it('TEST E — ignores Graph runtime flags when authored and persistent content are unchanged', async () => {
    const h = harness()
    await primeAcknowledgedBaseline(h)
    h.setServer('Volatile Runtime Hall', 'R2')

    reloadAuthoredLocal('Volatile Runtime Hall')
    useGraphStore.getState().graph.setAllowGeometricInference(false)
    await vi.waitFor(() => expect(useGraphStore.getState().syncStatus).toBe('synced'))

    expect(h.posts).toHaveLength(0)
    expect(useGraphStore.getState().authoredDocument?.buildings[0]?.name).toBe('Volatile Runtime Hall')
  })

  it('CASE 2 — preserves a local-ahead authored draft and resumes through the guarded save', async () => {
    const h = harness()
    await primeAcknowledgedBaseline(h)

    reloadAuthoredLocal('Local Draft Hall')
    await vi.waitFor(() => expect(useGraphStore.getState().syncStatus).toBe('idle'))
    expect(h.posts).toHaveLength(0)

    useGraphStore.getState().completeCampusHydration()
    await vi.waitFor(() => expect(useGraphStore.getState().syncStatus).toBe('synced'))

    expect(h.posts).toHaveLength(1)
    expect(h.posts[0].expectedServerUpdatedAt).toBe('R1')
    expect(useGraphStore.getState().graph.buildings[0]?.name).toBe('Local Draft Hall')
  })

  it('CASE 3 — adopts a server-ahead authored snapshot without conflict or POST', async () => {
    const h = harness()
    await primeAcknowledgedBaseline(h)
    h.setServer('Server Ahead Hall', 'R2')

    reloadAuthoredLocal('Baseline Hall')
    await vi.waitFor(() => expect(useGraphStore.getState().syncStatus).toBe('synced'))

    expect(h.posts).toHaveLength(0)
    expect(useGraphStore.getState().graph.buildings[0]?.name).toBe('Server Ahead Hall')
    expect(useGraphStore.getState().authoredDocument?.buildings[0]?.name).toBe('Server Ahead Hall')
  })

  it('CASE 4 — keeps true authored divergence as conflict with no force or retry', async () => {
    const h = harness()
    await primeAcknowledgedBaseline(h)
    h.setServer('Server Divergence Hall', 'R2')

    reloadAuthoredLocal('Local Divergence Hall')
    await vi.waitFor(() => expect(useGraphStore.getState().syncStatus).toBe('conflict'))

    expect(h.posts).toHaveLength(0)
    expect(useGraphStore.getState().graph.buildings[0]?.name).toBe('Local Divergence Hall')
  })

  it('CASE I — marks both-changed-but-equal authored content synced despite revision drift', async () => {
    const h = harness()
    await primeAcknowledgedBaseline(h)
    h.setServer('Converged Hall', 'R2')

    reloadAuthoredLocal('Converged Hall')
    await vi.waitFor(() => expect(useGraphStore.getState().syncStatus).toBe('synced'))

    expect(h.posts).toHaveLength(0)
    expect(JSON.parse(localStorage.getItem(MARKER_KEY) ?? '{}').serverTimestamp).toBe('R2')
  })
})
