import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Graph } from '../engine/graph'
import {
  __getGraphSaveSessionContextForTests,
  __getSyncStatusTraceForTests,
  __resetGraphSaveQueuesForTests,
  __resetSyncStatusTraceForTests,
  useGraphStore,
} from './graph-store'

const MAP_ID = 'save-lifecycle-trace'
const CACHE_KEY = `navi-graph-${MAP_ID}`

function makeGraph(name: string): Graph {
  const graph = new Graph()
  graph.campusId = MAP_ID
  graph.addBuilding({ id: 'building-1', name, campusId: MAP_ID, footprint: [] } as never)
  return graph
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('P0 save acknowledgement lifecycle trace', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    __resetGraphSaveQueuesForTests()
    __resetSyncStatusTraceForTests()
    useGraphStore.setState({
      graph: new Graph(),
      authoredDocument: null,
      currentMapId: null,
      syncStatus: 'idle',
      syncError: null,
      pendingAuthoredMutations: [],
      campusReady: true,
    })
  })

  it('traces a successful POST followed by bounded acknowledgement read-back retries', async () => {
    vi.useFakeTimers()
    const timeline: Array<Record<string, unknown>> = []
    let serverPayload: Record<string, unknown> | null = null
    let serverUpdatedAt = 'R0'
    let postCount = 0

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (method === 'POST') {
        postCount += 1
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
        timeline.push({
          phase: 'T4 POST dispatched',
          requestSequence: postCount,
          mutationId: body.mutationId,
          campusId: body.campusId,
          expectedServerUpdatedAt: body.expectedServerUpdatedAt,
          forceServerOverwrite: body.forceServerOverwrite,
          sessionGeneration: sessionContext.sessionGeneration,
          campusEpoch: sessionContext.campusEpoch,
          authoredFingerprint: null,
          graphFingerprint: JSON.stringify(body.buildings ?? []),
        })
        // Model the production observation: the server commits B, but the
        // successful RPC response omits its authoritative revision.
        serverPayload = { ...body }
        delete serverPayload.expectedServerUpdatedAt
        delete serverPayload.forceServerOverwrite
        serverUpdatedAt = 'R1'
        timeline.push({ phase: 'T5 HTTP response', status: 200, updatedAt: null, serverUpdatedAt, mutationIdAcknowledged: null })
        return json({ success: true, campus_id: MAP_ID })
      }

      timeline.push({ phase: 'T5 revision read-back', status: 500, serverUpdatedAt })
      return json({ error: 'read-back unavailable' }, 500)
    })
    vi.stubGlobal('fetch', fetchMock)

    useGraphStore.setState({ graph: makeGraph('Edit B'), currentMapId: MAP_ID })
    timeline.push({ phase: 'T0 authored commit', name: 'Edit B' })
    useGraphStore.getState().persistLocalDraft()
    timeline.push({ phase: 'T1 local draft write', localDraftPresent: Boolean(localStorage.getItem(CACHE_KEY)) })

    timeline.push({ phase: 'T2 5-second debounce', status: 'covered by AutosaveService contract; direct trace starts at queue entry' })
    timeline.push({ phase: 'T3 save enters queue', queue: 'campusSaveQueues' })
    const sessionContext = __getGraphSaveSessionContextForTests(MAP_ID)
    const savePromise = useGraphStore.getState().save()
    const rejection = expect(savePromise).rejects.toThrow(/could not be confirmed/i)
    await vi.advanceTimersByTimeAsync(47000)
    await rejection
    timeline.push({ phase: 'T6 acknowledgement application', status: 'not applied; authoritative revision unavailable' })
    timeline.push({ phase: 'T7 syncStatus', status: useGraphStore.getState().syncStatus })
    timeline.push({ phase: 'T8 workflow saveState', status: 'not connected in direct graph-store trace' })
    timeline.push({ phase: 'T9 subsequent save request', postCount })

    const localDraft = JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}') as Record<string, unknown>
    expect(postCount).toBe(1)
    expect((serverPayload?.buildings as Array<{ name?: string }> | undefined)?.[0]?.name).toBe('Edit B')
    expect((localDraft.buildings as Array<{ name?: string }> | undefined)?.[0]?.name).toBe('Edit B')
    expect(serverUpdatedAt).toBe('R1')
    expect(useGraphStore.getState().syncStatus).toBe('error')
    const statusTrace = __getSyncStatusTraceForTests()
    expect(statusTrace.at(-1)?.to).toBe('error')
    expect(statusTrace.at(-1)?.source).toBe('performSyncToSupabase')

    // Keep the exact evidence visible in the test output for the root-cause log.
    console.info('[save-lifecycle-trace]', JSON.stringify({ timeline, statusTrace }))
    vi.useRealTimers()
  })
})
