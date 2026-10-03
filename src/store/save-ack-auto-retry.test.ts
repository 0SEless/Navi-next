import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Graph } from '../engine/graph'
import { __resetGraphSaveQueuesForTests, useGraphStore } from './graph-store'

const MAP_ID = 'save-retry-map'
const MARKER_KEY = `navi-sync-status-${MAP_ID}`

function makeGraph(name: string, mapId = MAP_ID): Graph {
  const graph = new Graph()
  graph.campusId = mapId
  graph.addBuilding({ id: 'building-1', name, campusId: mapId, footprint: [] } as never)
  return graph
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function setClientGraph(name: string, mapId = MAP_ID): void {
  useGraphStore.setState({ graph: makeGraph(name, mapId), currentMapId: mapId, syncStatus: 'idle', syncError: null, campusReady: true })
}

describe('P0 save acknowledgement and guarded automatic retry', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.useRealTimers()
    __resetGraphSaveQueuesForTests()
    useGraphStore.setState({ graph: new Graph(), authoredDocument: null, currentMapId: null, syncStatus: 'idle', syncError: null, campusReady: true, pendingAuthoredMutations: [] })
    localStorage.setItem(MARKER_KEY, JSON.stringify({ snapshotFingerprint: 'seed', syncedAt: '2026-09-23T00:00:00.000Z', serverTimestamp: 'R0' }))
  })

  it('acknowledges the first save once, advances the marker, and clears included intent', async () => {
    let postCount = 0
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') !== 'POST') return json({})
      postCount += 1
      return json({ success: true, updatedAt: 'R1' })
    }))

    setClientGraph('Edit B')
    useGraphStore.getState().recordAuthoredMutation('building', 'building-1', null)
    await useGraphStore.getState().save()

    expect(postCount).toBe(1)
    expect(JSON.parse(localStorage.getItem(MARKER_KEY) ?? '{}').serverTimestamp).toBe('R1')
    expect(useGraphStore.getState().pendingAuthoredMutations).toEqual([])
    expect(useGraphStore.getState().syncStatus).toBe('synced')
  })

  it('recovers a retryable HTTP 503 without a browser reload', async () => {
    vi.useFakeTimers()
    let postCount = 0
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') !== 'POST') return json({})
      postCount += 1
      return postCount === 1
        ? json({ error: 'temporary upstream failure' }, 503)
        : json({ success: true, updatedAt: 'R1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    setClientGraph('Edit B')
    const savePromise = useGraphStore.getState().save()
    await vi.advanceTimersByTimeAsync(2000)

    await expect(savePromise).resolves.toBeUndefined()
    expect(postCount).toBe(2)
    expect(useGraphStore.getState().syncStatus).toBe('synced')
  })

  it('bounds one retry chain across multiple transient failures and eventually succeeds', async () => {
    vi.useFakeTimers()
    let postCount = 0
    let inFlight = 0
    let maxInFlight = 0
    const mutationIds: string[] = []
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') !== 'POST') return json({})
      postCount += 1
      mutationIds.push(String(JSON.parse(String(init?.body ?? '{}')).mutationId))
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      try {
        if (postCount < 3) return json({ error: 'temporary upstream failure' }, 503)
        return json({ success: true, updatedAt: 'R3' })
      } finally {
        inFlight -= 1
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    try {
      setClientGraph('Edit B')
      const savePromise = useGraphStore.getState().save()
      await vi.advanceTimersByTimeAsync(7000)
      await expect(savePromise).resolves.toBeUndefined()

      expect(postCount).toBe(3)
      expect(maxInFlight).toBe(1)
      expect(new Set(mutationIds).size).toBe(1)
      expect(useGraphStore.getState().syncStatus).toBe('synced')
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not retry an authentication failure', async () => {
    let postCount = 0
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') !== 'POST') return json({})
      postCount += 1
      return json({ error: 'Unauthorized' }, 401)
    }))

    setClientGraph('Auth-required edit')
    await expect(useGraphStore.getState().save()).rejects.toThrow(/authentication required/i)

    expect(postCount).toBe(1)
    expect(useGraphStore.getState().syncStatus).toBe('error')
    expect(useGraphStore.getState().syncError).toMatch(/authentication required/i)
  })

  it('drops a stale retry when a newer edit supersedes the failed snapshot', async () => {
    vi.useFakeTimers()
    let postCount = 0
    const postedNames: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') !== 'POST') return json({})
      postCount += 1
      const body = JSON.parse(String(init?.body ?? '{}')) as { buildings?: Array<{ name?: string }> }
      postedNames.push(body.buildings?.[0]?.name ?? '')
      return postCount === 1
        ? json({ error: 'temporary upstream failure' }, 503)
        : json({ success: true, updatedAt: 'R2' })
    }))

    try {
      setClientGraph('Edit B')
      const bSave = useGraphStore.getState().save()
      await vi.waitFor(() => expect(postCount).toBe(1))

      setClientGraph('Edit C')
      const cSave = useGraphStore.getState().save()
      await vi.advanceTimersByTimeAsync(2000)
      await expect(bSave).resolves.toBeUndefined()
      await expect(cSave).resolves.toBeUndefined()

      expect(postedNames).toEqual(['Edit B', 'Edit C'])
      expect(useGraphStore.getState().syncStatus).toBe('synced')
    } finally {
      vi.useRealTimers()
    }
  })

  it('retries acknowledgement read-back without issuing a second mutation', async () => {
    vi.useFakeTimers()
    let postCount = 0
    let readBackCount = 0
    const mutationIds: string[] = []
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'POST') {
        postCount += 1
        mutationIds.push(String(JSON.parse(String(init?.body ?? '{}')).mutationId))
        return postCount === 1
          ? json({ success: true })
          : json({ success: true, updatedAt: 'R1', idempotent_replay: true })
      }
      readBackCount += 1
      return readBackCount === 1
        ? json({ error: 'read-back unavailable' }, 503)
        : json({ updatedAt: 'R1', buildings: [], nodes: [], edges: [], components: [] })
    })
    vi.stubGlobal('fetch', fetchMock)

    setClientGraph('Edit B')
    const savePromise = useGraphStore.getState().save()
    await vi.advanceTimersByTimeAsync(2000)

    await expect(savePromise).resolves.toBeUndefined()
    expect(postCount).toBe(1)
    expect(readBackCount).toBe(2)
    expect(mutationIds).toHaveLength(1)
    expect(useGraphStore.getState().syncStatus).toBe('synced')
  })

  it('recovers a final offline state from the online event without a reload', async () => {
    vi.useFakeTimers()
    let phase: 'seed' | 'offline' | 'online' = 'seed'
    let postCount = 0
    let serverRevision = 'R0'
    let serverGraph = makeGraph('Seed A').toJSON() as unknown as Record<string, unknown>
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') !== 'POST') return json({ ...serverGraph, updatedAt: serverRevision })
      postCount += 1
      if (phase === 'offline') throw new TypeError('Failed to fetch')
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      const name = ((body.buildings as Array<{ name?: string }> | undefined)?.[0]?.name ?? 'Edit B')
      serverGraph = makeGraph(name).toJSON() as unknown as Record<string, unknown>
      serverRevision = phase === 'seed' ? 'R1' : 'R2'
      return json({ success: true, updatedAt: serverRevision })
    })
    vi.stubGlobal('fetch', fetchMock)

    try {
      setClientGraph('Seed A')
      await useGraphStore.getState().save()
      phase = 'offline'
      setClientGraph('Edit B')
      const savePromise = useGraphStore.getState().save()
      const rejection = expect(savePromise).rejects.toThrow(/Offline/)
      await vi.advanceTimersByTimeAsync(47_000)
      await rejection
      expect(useGraphStore.getState().syncStatus).toBe('error')

      phase = 'online'
      vi.useRealTimers()
      window.dispatchEvent(new Event('online'))
      await vi.waitFor(() => expect(useGraphStore.getState().syncStatus).toBe('synced'))

      expect(postCount).toBe(7) // seed + five bounded failures + one online recovery write
      expect((serverGraph.buildings as Array<{ name?: string }>)[0]?.name).toBe('Edit B')
      expect(useGraphStore.getState().syncError).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('never retries a true CAS conflict', async () => {
    const privateError = 'The server changed since this editor loaded it. PRIVATE_CAMPUS_ID PRIVATE_MUTATION_ID PRIVATE_TOKEN_VALUE'
    const lifecycleLog = vi.spyOn(console, 'info').mockImplementation(() => {})
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    let postCount = 0
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') !== 'POST') return json({})
      postCount += 1
      return json({ error: privateError }, 409)
    }))

    setClientGraph('Local B')
    await expect(useGraphStore.getState().save()).rejects.toThrow(privateError)
    expect(postCount).toBe(1)
    expect(useGraphStore.getState().syncStatus).toBe('conflict')
    const serializedLogs = JSON.stringify([...lifecycleLog.mock.calls, ...errorLog.mock.calls])
    for (const value of [privateError, 'PRIVATE_CAMPUS_ID', 'PRIVATE_MUTATION_ID', 'PRIVATE_TOKEN_VALUE']) {
      expect(serializedLogs).not.toContain(value)
    }
  })

  it('keeps entity and credential details out of failed-save logs', async () => {
    const privateError = 'Invalid save PRIVATE_CAMPUS_ID PRIVATE_BUILDING_ID PRIVATE_NODE_ID PRIVATE_ROAD_ID PRIVATE_TOKEN_VALUE'
    const lifecycleLog = vi.spyOn(console, 'info').mockImplementation(() => {})
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    let postCount = 0
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') !== 'POST') return json({})
      postCount += 1
      return json({ error: privateError }, 400)
    }))

    setClientGraph('Local B')
    await expect(useGraphStore.getState().save()).rejects.toThrow(privateError)

    expect(postCount).toBe(1)
    expect(useGraphStore.getState().syncError).toBe(privateError)
    const serializedLogs = JSON.stringify([...lifecycleLog.mock.calls, ...errorLog.mock.calls])
    for (const value of [privateError, 'PRIVATE_CAMPUS_ID', 'PRIVATE_BUILDING_ID', 'PRIVATE_NODE_ID', 'PRIVATE_ROAD_ID', 'PRIVATE_TOKEN_VALUE']) {
      expect(serializedLogs).not.toContain(value)
    }
  })

  it('does not let an old session response mark the new campus session failed', async () => {
    let releaseOldResponse!: (response: Response) => void
    const oldResponse = new Promise<Response>((resolve) => { releaseOldResponse = resolve })
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') !== 'POST') return json({})
      return oldResponse
    })
    vi.stubGlobal('fetch', fetchMock)

    setClientGraph('Old A')
    const oldSave = useGraphStore.getState().save()
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    useGraphStore.getState().setCurrentMapId('new-campus')
    useGraphStore.setState({ graph: makeGraph('New campus', 'new-campus'), syncStatus: 'idle', syncError: null, campusReady: true })
    releaseOldResponse(json({ error: 'late failure' }, 503))
    await oldSave

    expect(useGraphStore.getState().currentMapId).toBe('new-campus')
    expect(useGraphStore.getState().syncStatus).toBe('idle')
    expect(useGraphStore.getState().syncError).toBeNull()
  })
})
