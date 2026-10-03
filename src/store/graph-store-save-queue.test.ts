import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Graph } from '../engine/graph'
import { useGraphStore, __resetGraphSaveQueuesForTests } from './graph-store'

const MAP_ID = 'queue-map'
const CACHE_KEY = `navi-graph-${MAP_ID}`
const MARKER_KEY = `navi-sync-status-${MAP_ID}`

function makeGraph(name: string): Graph {
  const graph = new Graph()
  graph.campusId = MAP_ID
  graph.addBuilding({
    id: 'building-1',
    name,
    campusId: MAP_ID,
    footprint: [],
  } as never)
  return graph
}

interface MockServerOptions {
  /** Emulate migration 009 compare-and-swap (409 on stale expected revision). */
  enforceCas?: boolean
  /** Emulate the deployed 004/005 RPC, which returns no revision. */
  returnUpdatedAt?: boolean
  postStatus?: number
  failGet?: boolean
}

/**
 * Deterministic in-memory stand-in for `/api/graph` + `sync_graph_snapshot`.
 * No network. Used to reproduce the single-user save races in isolation.
 */
function createMockServer(options: MockServerOptions = {}) {
  const { enforceCas = true, returnUpdatedAt = true, postStatus = 200, failGet = false } = options

  let revision: string | null = 'R0'
  let revisionCounter = 0
  let graph: Record<string, unknown> = makeGraph('Server Hall').toJSON() as unknown as Record<string, unknown>
  let gate: Promise<void> | null = null
  let releaseGate: (() => void) | null = null

  let inFlight = 0
  const stats = { posts: [] as string[], postCount: 0, conflictCount: 0, maxInFlight: 0 }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (method === 'POST') {
      stats.postCount += 1
      stats.posts.push(String(init?.body ?? ''))
      inFlight += 1
      stats.maxInFlight = Math.max(stats.maxInFlight, inFlight)
      try {
        if (gate) await gate
        if (postStatus !== 200) return json({ error: 'server exploded' }, postStatus)
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
        if (enforceCas) {
          const expected = (body.expectedServerUpdatedAt as string | null | undefined) ?? null
          if (revision !== expected) {
            stats.conflictCount += 1
            return json(
              { error: 'The server changed since this editor loaded it. Your local changes were not overwritten.' },
              409,
            )
          }
        }
        revisionCounter += 1
        revision = `R${revisionCounter}`
        const stored = { ...body }
        delete stored.expectedServerUpdatedAt
        delete stored.forceServerOverwrite
        graph = stored
        return json(returnUpdatedAt ? { success: true, campus_id: MAP_ID, updatedAt: revision } : { success: true, campus_id: MAP_ID })
      } finally {
        inFlight -= 1
      }
    }
    if (failGet) return json({ error: 'read failed' }, 500)
    return json({ ...graph, updatedAt: revision })
  })

  vi.stubGlobal('fetch', fetchMock)

  return {
    fetchMock,
    stats,
    get revision() {
      return revision
    },
    get lastGraph() {
      return graph
    },
    closeGate() {
      gate = new Promise<void>((resolve) => {
        releaseGate = resolve
      })
    },
    openGate() {
      releaseGate?.()
      releaseGate = null
      gate = null
    },
    /** Simulate an external writer advancing the server revision. */
    advanceExternally(name: string, nextRevision: string) {
      graph = makeGraph(name).toJSON() as unknown as Record<string, unknown>
      revision = nextRevision
    },
    /** Set the stored server row directly (e.g. a metadata-only placeholder). */
    setServerGraph(payload: Record<string, unknown>) {
      graph = payload
    },
  }
}

function setClientGraph(name: string): void {
  useGraphStore.setState({ graph: makeGraph(name), currentMapId: MAP_ID, syncStatus: 'idle', syncError: null })
}

function readMarker(): { serverTimestamp?: string | null } {
  return JSON.parse(localStorage.getItem(MARKER_KEY) ?? '{}')
}

describe('graph store per-campus save serialization and revision contract', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    __resetGraphSaveQueuesForTests()
    useGraphStore.setState({ graph: new Graph(), currentMapId: null, syncStatus: 'idle', syncError: null })
    localStorage.setItem(
      MARKER_KEY,
      JSON.stringify({
        snapshotFingerprint: 'seed',
        syncedAt: '2026-09-13T00:00:00.000Z',
        serverTimestamp: 'R0',
      }),
    )
  })

  it('advances A -> B -> C -> D for one user saving sequentially with zero conflicts', async () => {
    const server = createMockServer()

    setClientGraph('Edit A')
    await useGraphStore.getState().save()
    expect(readMarker().serverTimestamp).toBe('R1')

    setClientGraph('Edit B')
    await useGraphStore.getState().save()
    expect(readMarker().serverTimestamp).toBe('R2')

    setClientGraph('Edit C')
    await useGraphStore.getState().save()

    expect(server.stats.conflictCount).toBe(0)
    expect(
      server.stats.posts.map((raw) => JSON.parse(raw).expectedServerUpdatedAt),
    ).toEqual(['R0', 'R1', 'R2'])
    expect(server.revision).toBe('R3')
    expect(useGraphStore.getState().syncStatus).toBe('synced')
  })

  it('consumes the authoritative revision across ten sequential saves', async () => {
    const server = createMockServer()

    for (let i = 1; i <= 10; i += 1) {
      setClientGraph(`Edit ${i}`)
      await useGraphStore.getState().save()
      expect(readMarker().serverTimestamp).toBe(`R${i}`)
    }

    expect(server.stats.conflictCount).toBe(0)
    expect(server.revision).toBe('R10')
    expect(
      server.stats.posts.map((raw) => JSON.parse(raw).expectedServerUpdatedAt),
    ).toEqual(['R0', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9'])
    expect(useGraphStore.getState().syncStatus).toBe('synced')
  })

  it('coalesces rapid consecutive edits, keeps one write in flight, and never self-conflicts', async () => {
    const server = createMockServer()
    server.closeGate()

    setClientGraph('Edit A')
    const saveA = useGraphStore.getState().save()
    setClientGraph('Edit B')
    const saveB = useGraphStore.getState().save()
    setClientGraph('Edit C')
    const saveC = useGraphStore.getState().save()

    server.openGate()
    await Promise.all([saveA, saveB, saveC])

    expect(server.stats.conflictCount).toBe(0)
    expect(server.stats.maxInFlight).toBe(1)
    expect(server.stats.postCount).toBe(2)
    expect(
      server.stats.posts.map((raw) => JSON.parse(raw).expectedServerUpdatedAt),
    ).toEqual(['R0', 'R1'])
    expect((server.lastGraph.buildings as Array<{ name: string }>)[0]?.name).toBe('Edit C')
    expect(readMarker().serverTimestamp).toBe('R2')
    expect(useGraphStore.getState().syncStatus).toBe('synced')
  })

  it('records the authoritative revision when the RPC does not echo updatedAt (legacy 004/005)', async () => {
    const server = createMockServer({ returnUpdatedAt: false })

    setClientGraph('Edit A')
    await useGraphStore.getState().save()
    expect(readMarker().serverTimestamp).toBe('R1')

    setClientGraph('Edit B')
    await useGraphStore.getState().save()

    expect(server.stats.conflictCount).toBe(0)
    expect(readMarker().serverTimestamp).toBe('R2')
  })

  it('never reports synchronized when the revision cannot be confirmed', async () => {
    createMockServer({ returnUpdatedAt: false, failGet: true })

    setClientGraph('Edit A')
    await expect(useGraphStore.getState().save()).rejects.toThrow(/could not be confirmed|revision/i)

    expect(useGraphStore.getState().syncStatus).toBe('error')
    expect(useGraphStore.getState().syncStatus).not.toBe('synced')
    expect(readMarker().serverTimestamp).toBe('R0')
  })

  it('uses the POST response revision directly (migration 009 path, no GET confirmation)', async () => {
    const server = createMockServer({ returnUpdatedAt: true })

    setClientGraph('Edit A')
    await useGraphStore.getState().save()

    const getCalls = server.fetchMock.mock.calls.filter(([, init]) => (init?.method ?? 'GET') === 'GET')
    expect(getCalls).toHaveLength(0)
    expect(readMarker().serverTimestamp).toBe('R1')
    expect(server.stats.conflictCount).toBe(0)
  })

  it('adopts a metadata-only server revision so the first real save does not conflict', async () => {
    const server = createMockServer()
    server.setServerGraph({ campusId: MAP_ID, name: 'placeholder' })
    localStorage.removeItem(MARKER_KEY)
    useGraphStore.setState({ graph: new Graph(), currentMapId: null, syncStatus: 'idle', syncError: null })

    await useGraphStore.getState().fetchFromSupabase(MAP_ID)
    expect(readMarker().serverTimestamp).toBe('R0')
    // P0.14: model the real lifecycle — the fixture's campus is fully hydrated.
    useGraphStore.getState().completeCampusHydration()

    setClientGraph('First real edit')
    await useGraphStore.getState().save()

    expect(server.stats.conflictCount).toBe(0)
    expect(server.revision).toBe('R1')
  })

  it('keeps the dirty local graph and reports a conflict for a genuinely divergent writer', async () => {
    const server = createMockServer()
    server.advanceExternally('Server changed elsewhere', 'R1')

    setClientGraph('Local authored work')
    await expect(useGraphStore.getState().save()).rejects.toThrow(/server changed/i)

    expect(useGraphStore.getState().syncStatus).toBe('conflict')
    expect(useGraphStore.getState().graph.buildings[0]?.name).toBe('Local authored work')
    expect(localStorage.getItem(CACHE_KEY)).toContain('Local authored work')
  })

  it('never reports synchronized when the save request fails', async () => {
    createMockServer({ postStatus: 500 })

    setClientGraph('Edit A')
    await expect(useGraphStore.getState().save()).rejects.toThrow(/server exploded/)

    expect(useGraphStore.getState().syncStatus).toBe('error')
    expect(useGraphStore.getState().syncStatus).not.toBe('synced')
  })
})
