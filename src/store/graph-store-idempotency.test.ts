import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Graph } from '../engine/graph'
import { useGraphStore, __resetGraphSaveQueuesForTests } from './graph-store'

const MAP_ID = 'idem-map'
const MARKER_KEY = `navi-sync-status-${MAP_ID}`

function makeGraph(name: string): Graph {
  const graph = new Graph()
  graph.campusId = MAP_ID
  graph.addBuilding({ id: 'building-1', name, campusId: MAP_ID, footprint: [] } as never)
  return graph
}

function setClientGraph(name: string): void {
  useGraphStore.setState({ graph: makeGraph(name), currentMapId: MAP_ID, syncStatus: 'idle', syncError: null })
}

function readMarker(): { serverTimestamp?: string | null } {
  return JSON.parse(localStorage.getItem(MARKER_KEY) ?? '{}')
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('graph store mutation idempotency', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    __resetGraphSaveQueuesForTests()
    useGraphStore.setState({ graph: new Graph(), currentMapId: null, syncStatus: 'idle', syncError: null })
    localStorage.setItem(MARKER_KEY, JSON.stringify({ snapshotFingerprint: 'seed', syncedAt: '2026-09-16T00:00:00.000Z', serverTimestamp: 'R0' }))
  })

  it('sends a mutationId with every save and keeps it stable across transport retries', async () => {
    const bodies: string[] = []
    let calls = 0
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (method !== 'POST') return json({})
      calls += 1
      bodies.push(String(init?.body ?? ''))
      if (calls === 1) throw new TypeError('Failed to fetch')
      return json({ success: true, campus_id: MAP_ID, updatedAt: 'R1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    setClientGraph('Edit A')
    await useGraphStore.getState().save()

    expect(bodies.length).toBe(2)
    const first = JSON.parse(bodies[0])
    const second = JSON.parse(bodies[1])
    expect(typeof first.mutationId).toBe('string')
    expect(first.mutationId.length).toBeGreaterThan(8)
    expect(first.mutationId).toBe(second.mutationId) // retry, same logical mutation
    expect(readMarker().serverTimestamp).toBe('R1')
  })

  it('assigns a new mutationId to each coalesced follow-up save', async () => {
    const bodies: string[] = []
    let releaseGate: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { releaseGate = resolve })
    let hold = true
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (method !== 'POST') return json({})
      bodies.push(String(init?.body ?? ''))
      if (hold) { hold = false; await gate }
      return json({ success: true, campus_id: MAP_ID, updatedAt: `R${bodies.length}` })
    })
    vi.stubGlobal('fetch', fetchMock)

    setClientGraph('Edit A')
    const p1 = useGraphStore.getState().save()
    setClientGraph('Edit B')
    const p2 = useGraphStore.getState().save()
    releaseGate?.()
    await Promise.all([p1, p2])

    expect(bodies.length).toBe(2)
    const ids = bodies.map((b) => JSON.parse(b).mutationId)
    expect(ids[0]).toBeTruthy()
    expect(ids[1]).toBeTruthy()
    expect(ids[0]).not.toBe(ids[1]) // genuinely new logical save
  })

  it('adopts the original revision on an idempotent replay response', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (method !== 'POST') return json({})
      return json({ success: true, campus_id: MAP_ID, updatedAt: 'R7', idempotent_replay: true })
    }))

    setClientGraph('Edit A')
    await useGraphStore.getState().save()

    expect(readMarker().serverTimestamp).toBe('R7')
    expect(useGraphStore.getState().syncStatus).toBe('synced')
  })

  it('treats a mutation id collision as an error and never reports synchronized', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (method !== 'POST') return json({})
      return json({ error: 'MUTATION_ID_COLLISION: mutation X already committed for campus idem-map with different content' }, 409)
    }))

    setClientGraph('Local authored work')
    await expect(useGraphStore.getState().save()).rejects.toThrow(/collision/i)

    expect(useGraphStore.getState().syncStatus).toBe('error')
    expect(useGraphStore.getState().syncStatus).not.toBe('synced')
    expect(useGraphStore.getState().graph.buildings[0]?.name).toBe('Local authored work')
    expect(localStorage.getItem(`navi-graph-${MAP_ID}`)).toContain('Local authored work')
  })
})
