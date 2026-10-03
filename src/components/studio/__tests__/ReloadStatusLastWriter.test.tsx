import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import {
  createDocument,
  __getWorkflowStatusTraceForTests,
  __resetWorkflowStatusTraceForTests,
} from '@navi/editor'
import { CONNECTIVITY_CONTRACT_VERSION } from '@navi/core'
import { Graph } from '@/engine/graph'
import { serializeAuthoredGraphPayload } from '@/services/authored-snapshot-persistence'
import {
  __getSyncStatusTraceForTests,
  __resetSyncStatusTraceForTests,
  useGraphStore,
} from '@/store/graph-store'
import { EditorBridge } from '../EditorBridge'
import { SaveStatus } from '../SaveStatus'

const MAP_ID = 'reload-status-last-writer'
const CACHE_KEY = `navi-graph-${MAP_ID}`
const MARKER_KEY = `navi-sync-status-${MAP_ID}`
const SAFE_SAVE_LIFECYCLE_FIELDS = new Set([
  'event',
  'attemptNumber',
  'httpStatus',
  'retryable',
  'retryScheduled',
  'retryDelayMs',
  'finalClientStatus',
  'readOutcome',
  'outcome',
  'staleDiscarded',
  'statusWriteApplied',
  'canonicalMatch',
  'graphMatch',
  'authoredMatch',
])
const GUARD_COLLECTIONS = ['buildings', 'components', 'nodes', 'edges', 'traces', 'doors'] as const
type GuardCollectionName = (typeof GUARD_COLLECTIONS)[number]
type GuardCollectionIdSnapshot = Record<GuardCollectionName, string[]>

function captureGuardCollectionIds(): GuardCollectionIdSnapshot {
  const graph = useGraphStore.getState().graph.toJSON() as unknown as Record<string, unknown>
  return Object.fromEntries(GUARD_COLLECTIONS.map((kind) => [
    kind,
    (Array.isArray(graph[kind]) ? graph[kind] : []).flatMap((raw) => {
      if (typeof raw !== 'object' || raw === null || !('id' in raw)) return []
      const id = (raw as { id?: unknown }).id
      return typeof id === 'string' ? [id] : []
    }),
  ])) as GuardCollectionIdSnapshot
}

function removedGuardCollectionCounts(
  previous: GuardCollectionIdSnapshot,
  candidate: GuardCollectionIdSnapshot,
): Record<GuardCollectionName, number> {
  return Object.fromEntries(GUARD_COLLECTIONS.map((kind) => {
    const candidateIds = new Set(candidate[kind])
    return [kind, previous[kind].filter((id) => !candidateIds.has(id)).length]
  })) as Record<GuardCollectionName, number>
}

function expectSafeSaveLifecycleEntries(entries: Array<Record<string, unknown>>): void {
  expect(entries.length).toBeGreaterThan(0)
  for (const entry of entries) {
    expect(Object.keys(entry).every((field) => SAFE_SAVE_LIFECYCLE_FIELDS.has(field))).toBe(true)
    const serialized = JSON.stringify(entry)
    expect(serialized).not.toContain(MAP_ID)
    expect(serialized).not.toMatch(/building-1|Newer Saved Hall|Retry Saved Hall|PRIVATE_AUTHORED/i)
  }
}

function makeGraph(name: string): Graph {
  const graph = new Graph()
  graph.campusId = MAP_ID
  graph.setConnectivitySemanticsVersion(CONNECTIVITY_CONTRACT_VERSION)
  graph.addBuilding({ id: 'building-1', name, campusId: MAP_ID, footprint: [], floors: [] } as never)
  return graph
}

function payload(name: string): Record<string, unknown> {
  const graph = makeGraph(name)
  return serializeAuthoredGraphPayload(
    graph.toJSON() as unknown as Record<string, unknown>,
    createDocument(graph),
  )
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function clearActiveGraph(): void {
  useGraphStore.setState({
    graph: new Graph(),
    authoredDocument: null,
    currentMapId: null,
    syncStatus: 'idle',
    syncError: null,
    campusReady: false,
    pendingAuthoredMutations: [],
  })
}

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
  __resetSyncStatusTraceForTests()
  __resetWorkflowStatusTraceForTests()
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

describe('full reload status lifecycle', () => {
  it('keeps the final header saved after all hydration effects settle', async () => {
    const server = payload('Canonical Hall')
    localStorage.setItem(CACHE_KEY, JSON.stringify(server))
    localStorage.setItem(MARKER_KEY, JSON.stringify({
      snapshotFingerprint: 'stale-marker',
      serverTimestamp: '2026-09-21T00:00:00.000Z',
    }))
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      ...server,
      updatedAt: '2026-09-22T00:00:00.000Z',
    })))

    useGraphStore.getState().loadMapData(MAP_ID)
    const view = render(
      <EditorBridge>
        <SaveStatus />
      </EditorBridge>,
    )

    await waitFor(() => expect(useGraphStore.getState().syncStatus).toBe('synced'))
    await waitFor(() => expect(view.getByText('All changes saved')).toBeInTheDocument())
    expect(view.queryByText('Changes not synced')).not.toBeInTheDocument()

    const trace = __getSyncStatusTraceForTests()
    expect(trace.at(-1)?.to).toBe('synced')
    expect(trace.at(-1)?.source).toBe('checkServerFreshness')
    expect(trace.some((entry) => entry.to === 'conflict')).toBe(false)
  })

  it('keeps a clean acknowledged reload saved after a second hydration', async () => {
    const local = payload('Canonical Hall')
    localStorage.setItem(CACHE_KEY, JSON.stringify(local))
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ...local, updatedAt: 'R-current' })))

    useGraphStore.getState().loadMapData(MAP_ID)
    await waitFor(() => expect(useGraphStore.getState().syncStatus).toBe('synced'))
    clearActiveGraph()

    useGraphStore.getState().loadMapData(MAP_ID)
    const view = render(
      <EditorBridge>
        <SaveStatus />
      </EditorBridge>,
    )
    await waitFor(() => expect(view.getByText('All changes saved')).toBeInTheDocument())
    expect(useGraphStore.getState().syncStatus).toBe('synced')
  })

  it('ignores a stale freshness response from an earlier reload', async () => {
    const local = payload('Canonical Hall')
    localStorage.setItem(CACHE_KEY, JSON.stringify(local))
    localStorage.setItem(MARKER_KEY, JSON.stringify({
      snapshotFingerprint: 'stale-marker',
      serverTimestamp: '2026-09-21T00:00:00.000Z',
    }))

    const responses: Array<(response: Response) => void> = []
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => {
      responses.push(resolve)
    })))

    useGraphStore.getState().loadMapData(MAP_ID)
    useGraphStore.getState().loadMapData(MAP_ID)
    const view = render(
      <EditorBridge>
        <SaveStatus />
      </EditorBridge>,
    )

    await waitFor(() => expect(responses).toHaveLength(2))
    // The second reload receives the current converged server snapshot first.
    responses[1](jsonResponse({ ...local, updatedAt: 'R-current' }))
    await waitFor(() => expect(useGraphStore.getState().syncStatus).toBe('synced'))

    // The first reload's delayed replica is stale and differs in content. It
    // must not be allowed to overwrite the final state established by reload 2.
    responses[0](jsonResponse({ ...payload('Stale Replica Hall'), updatedAt: 'R-old' }))
    await waitFor(() => expect(view.getByText('All changes saved')).toBeInTheDocument())
    expect(useGraphStore.getState().syncStatus).toBe('synced')
    expect(useGraphStore.getState().graph.buildings[0]?.name).toBe('Canonical Hall')
  })

  it('does not let an earlier reload reassert conflict from a stale local draft', async () => {
    const firstLocal = payload('Old Draft Hall')
    const currentLocal = payload('Canonical Hall')
    localStorage.setItem(CACHE_KEY, JSON.stringify(firstLocal))
    localStorage.setItem(MARKER_KEY, JSON.stringify({
      snapshotFingerprint: 'stale-marker',
      serverTimestamp: '2026-09-21T00:00:00.000Z',
    }))

    const responses: Array<(response: Response) => void> = []
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => {
      responses.push(resolve)
    })))

    // Reload 1 starts with the old cache and is still waiting on the server.
    useGraphStore.getState().loadMapData(MAP_ID)
    // Reload 2 paints the current canonical cache and settles cleanly first.
    localStorage.setItem(CACHE_KEY, JSON.stringify(currentLocal))
    useGraphStore.getState().loadMapData(MAP_ID)
    const view = render(
      <EditorBridge>
        <SaveStatus />
      </EditorBridge>,
    )

    await waitFor(() => expect(responses).toHaveLength(2))
    responses[1](jsonResponse({ ...currentLocal, updatedAt: 'R-current' }))
    await waitFor(() => expect(useGraphStore.getState().syncStatus).toBe('synced'))

    // A teardown/visibility writer from reload 1 lands after reload 2. The
    // active graph is still canonical B, but the stale local cache is A.
    localStorage.setItem(CACHE_KEY, JSON.stringify(firstLocal))
    responses[0](jsonResponse({ ...currentLocal, updatedAt: 'R-current' }))

    await waitFor(() => expect(view.getByText('All changes saved')).toBeInTheDocument())
    expect(useGraphStore.getState().syncStatus).toBe('synced')
    expect(useGraphStore.getState().graph.buildings[0]?.name).toBe('Canonical Hall')
    expect(__getSyncStatusTraceForTests().some((entry) => entry.to === 'conflict')).toBe(false)
  })

  it('heals a stale workflow baseline when the same canonical document reloads', async () => {
    const local = payload('Canonical Hall')
    localStorage.setItem(CACHE_KEY, JSON.stringify(local))
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ...local, updatedAt: 'R-current' })))

    useGraphStore.getState().loadMapData(MAP_ID)
    const view = render(
      <EditorBridge>
        <SaveStatus />
      </EditorBridge>,
    )
    await waitFor(() => expect(useGraphStore.getState().syncStatus).toBe('synced'))

    __resetWorkflowStatusTraceForTests()
    const context = (window as unknown as {
      __naviContext: { services: { get: (name: string) => { updateLifecycle?: (update: { saveState: 'dirty' }) => void } | undefined } }
    }).__naviContext
    context.services.get('workflowStore')?.updateLifecycle?.({ saveState: 'dirty' })

    // A client-side reload reuses the mounted editor context, so the workflow
    // baseline is intentionally stale while the Graph store hydrates again.
    useGraphStore.getState().loadMapData(MAP_ID)
    await waitFor(() => expect(view.getByText('All changes saved')).toBeInTheDocument())
    expect(useGraphStore.getState().syncStatus).toBe('synced')
    expect(__getWorkflowStatusTraceForTests().some((entry) => entry.field === 'saveState' && entry.to === 'saved')).toBe(true)
  })

  it('allows an intermediate stale in-memory projection and settles saved after server hydration', async () => {
    const local = payload('Canonical Hall')
    localStorage.setItem(CACHE_KEY, JSON.stringify(local))
    localStorage.setItem(MARKER_KEY, JSON.stringify({
      snapshotFingerprint: 'stale-marker',
      serverTimestamp: 'R1',
    }))
    let resolveServer: ((response: Response) => void) | null = null
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => {
      resolveServer = resolve
    })))

    useGraphStore.getState().loadMapData(MAP_ID)
    useGraphStore.setState({
      graph: makeGraph('Stale Projection Hall'),
      authoredDocument: createDocument(makeGraph('Stale Projection Hall')),
    })
    const view = render(
      <EditorBridge>
        <SaveStatus />
      </EditorBridge>,
    )
    await waitFor(() => expect(resolveServer).not.toBeNull())
    resolveServer?.(jsonResponse({ ...local, updatedAt: 'R2' }))

    await waitFor(() => expect(view.getByText('All changes saved')).toBeInTheDocument())
    expect(useGraphStore.getState().syncStatus).toBe('synced')
    expect(useGraphStore.getState().graph.buildings[0]?.name).toBe('Canonical Hall')
  })

  it('settles the final header as conflict for true local/server divergence', async () => {
    const local = payload('Local Divergence Hall')
    localStorage.setItem(CACHE_KEY, JSON.stringify(local))
    localStorage.setItem(MARKER_KEY, JSON.stringify({
      snapshotFingerprint: 'acknowledged-baseline',
      serverTimestamp: 'R1',
    }))
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      ...payload('Server Divergence Hall'),
      updatedAt: 'R2',
    })))

    useGraphStore.getState().loadMapData(MAP_ID)
    const view = render(
      <EditorBridge>
        <SaveStatus />
      </EditorBridge>,
    )
    await waitFor(() => expect(view.getByText('Changes not synced')).toBeInTheDocument())
    expect(useGraphStore.getState().syncStatus).toBe('conflict')
  })

  it('converges a local-ahead draft through the guarded save and ends saved', async () => {
    const baseline = payload('Baseline Hall')
    const local = payload('Local Draft Hall')
    localStorage.setItem(CACHE_KEY, JSON.stringify(baseline))
    const posts: RequestInit[] = []
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'POST') {
        posts.push(init ?? {})
        return jsonResponse({ success: true, updatedAt: 'R2' })
      }
      return jsonResponse({ ...baseline, updatedAt: 'R1' })
    }))

    // Prime an acknowledged baseline so the second load is classified as
    // local-ahead rather than an unknown-baseline divergence.
    useGraphStore.getState().loadMapData(MAP_ID)
    await waitFor(() => expect(useGraphStore.getState().syncStatus).toBe('synced'))
    localStorage.setItem(CACHE_KEY, JSON.stringify(local))
    clearActiveGraph()
    useGraphStore.getState().loadMapData(MAP_ID)
    const view = render(
      <EditorBridge>
        <SaveStatus />
      </EditorBridge>,
    )

    await waitFor(() => expect(view.getByText('All changes saved')).toBeInTheDocument())
    expect(useGraphStore.getState().syncStatus).toBe('synced')
    expect(posts).toHaveLength(1)
    const trace = __getSyncStatusTraceForTests()
    expect(trace.at(-1)?.source).toBe('performSyncToSupabase')
    expect(trace.at(-1)?.to).toBe('synced')
    expect(trace.some((entry) => entry.to === 'conflict')).toBe(false)
  })

  it('keeps a normal HTTP-200 save green through duplicate callbacks, idle, C, and one reload', async () => {
    const baseline = payload('Baseline Hall')
    localStorage.setItem(CACHE_KEY, JSON.stringify(baseline))
    let serverSnapshot: Record<string, unknown> = { ...baseline, updatedAt: 'R1' }
    const postedBodies: Array<Record<string, unknown>> = []
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>
        postedBodies.push(body)
        const updatedAt = `R${postedBodies.length + 1}`
        const snapshot = { ...body }
        delete snapshot.expectedServerUpdatedAt
        delete snapshot.forceServerOverwrite
        delete snapshot.mutationId
        serverSnapshot = { ...snapshot, updatedAt }
        return jsonResponse({ success: true, updatedAt })
      }
      return jsonResponse(serverSnapshot)
    }))

    useGraphStore.getState().loadMapData(MAP_ID)
    await waitFor(() => expect(useGraphStore.getState().syncStatus).toBe('synced'))

    vi.useFakeTimers()
    const view = render(
      <EditorBridge>
        <SaveStatus />
      </EditorBridge>,
    )
    await vi.waitFor(() => expect(view.getByText('All changes saved')).toBeInTheDocument())

    const context = (window as unknown as {
      __naviContext: { services: { get: (name: string) => unknown } }
    }).__naviContext
    const dispatcher = context.services.get('dispatcher') as {
      execute: (command: {
        id: 'entity.update'
        label: string
        payload: { entityId: string; changes: Record<string, string> }
      }) => { success: boolean; error?: string }
    }
    const eventBus = context.services.get('eventBus') as {
      emit: (event: 'revision.committed', payload: { version: number }) => void
    }
    const documentStore = context.services.get('documentStore') as { version: number }
    const workflow = context.services.get('workflow') as { save: (reason: 'autosave') => Promise<void> }
    const workflowStore = context.services.get('workflowStore') as {
      getSnapshot: () => { saveState: string; saveError: string | null }
    }
    await vi.waitFor(() => expect((dispatcher as unknown as { status: string }).status).toBe('ready'))
    await vi.waitFor(() => expect(workflowStore.getSnapshot().saveState).toBe('saved'))

    act(() => {
      const result = dispatcher.execute({
        id: 'entity.update',
        label: 'Edit Building Color',
        payload: { entityId: 'building-1', changes: { color: '#EF4444' } },
      })
      expect(result.success).toBe(true)
    })
    const bRevision = documentStore.version
    expect(bRevision).toBeGreaterThan(0)
    expect(useGraphStore.getState().pendingAuthoredMutations.length).toBeGreaterThan(0)

    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    await vi.waitFor(() => expect(postedBodies).toHaveLength(1))
    await vi.waitFor(() => expect(view.getByText('All changes saved')).toBeInTheDocument())
    expect(useGraphStore.getState().syncStatus).toBe('synced')
    expect(useGraphStore.getState().syncError).toBeNull()
    expect(useGraphStore.getState().pendingAuthoredMutations).toEqual([])
    expect(workflowStore.getSnapshot()).toMatchObject({ saveState: 'saved', saveError: null })
    expect((postedBodies[0]?.authoredDocument as { buildings: Array<{ color: string }> }).buildings[0]?.color)
      .toBe('#EF4444')
    const guardCollectionsAfterB = captureGuardCollectionIds()
    const graphAck = __getSyncStatusTraceForTests().filter((entry) => entry.to === 'synced').at(-1)
    expect(graphAck?.source).toBe('performSyncToSupabase')
    const workflowAck = __getWorkflowStatusTraceForTests()
      .filter((entry) => entry.field === 'saveState')
      .at(-1)
    expect(workflowAck).toMatchObject({ from: 'saving', to: 'saved', source: 'updateLifecycle' })

    // Duplicate revision notifications can make WorkflowStore briefly dirty,
    // but they carry no new authored intent and must not reach the POST path.
    act(() => {
      eventBus.emit('revision.committed', { version: bRevision })
      eventBus.emit('revision.committed', { version: bRevision })
      eventBus.emit('revision.committed', { version: bRevision })
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    await vi.waitFor(() => expect(workflowStore.getSnapshot().saveState).toBe('saved'))
    expect(view.getByText('All changes saved')).toBeInTheDocument()
    expect(postedBodies).toHaveLength(1)
    expect(warning.mock.calls.some(([message]) => String(message).includes('save blocked by safety guard'))).toBe(false)

    // Force the real workflow save entry once as an additional redundant
    // callback. GraphStore must quietly suppress autosave with no pending intent.
    await act(async () => { await workflow.save('autosave') })
    expect(postedBodies).toHaveLength(1)
    expect(useGraphStore.getState().syncStatus).toBe('synced')
    expect(view.getByText('All changes saved')).toBeInTheDocument()

    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(postedBodies).toHaveLength(1)
    expect(useGraphStore.getState().syncStatus).toBe('synced')
    expect(workflowStore.getSnapshot()).toMatchObject({ saveState: 'saved', saveError: null })
    expect(view.getByText('All changes saved')).toBeInTheDocument()

    act(() => {
      const result = dispatcher.execute({
        id: 'entity.update',
        label: 'Edit Building Name',
        payload: { entityId: 'building-1', changes: { name: 'C Saved Hall' } },
      })
      expect(result.success).toBe(true)
    })
    const cRevision = documentStore.version
    expect(cRevision).toBeGreaterThan(bRevision)
    expect(useGraphStore.getState().pendingAuthoredMutations.length).toBeGreaterThan(0)
    expect(removedGuardCollectionCounts(guardCollectionsAfterB, captureGuardCollectionIds())).toEqual({
      buildings: 0,
      components: 0,
      nodes: 0,
      edges: 0,
      traces: 0,
      doors: 0,
    })

    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    await vi.waitFor(() => expect(postedBodies).toHaveLength(2))
    await vi.waitFor(() => expect(view.getByText('All changes saved')).toBeInTheDocument())
    expect(useGraphStore.getState().syncStatus).toBe('synced')
    expect(useGraphStore.getState().syncError).toBeNull()
    expect(useGraphStore.getState().pendingAuthoredMutations).toEqual([])
    expect(workflowStore.getSnapshot()).toMatchObject({ saveState: 'saved', saveError: null })
    expect((postedBodies[1]?.authoredDocument as { buildings: Array<{ name: string; color: string }> }).buildings[0])
      .toMatchObject({ name: 'C Saved Hall', color: '#EF4444' })
    expect(warning.mock.calls.some(([message]) => String(message).includes('save blocked by safety guard'))).toBe(false)

    view.unmount()
    clearActiveGraph()
    useGraphStore.getState().loadMapData(MAP_ID)
    const reloaded = render(
      <EditorBridge>
        <SaveStatus />
      </EditorBridge>,
    )
    await vi.waitFor(() => expect(reloaded.getByText('All changes saved')).toBeInTheDocument())
    expect(useGraphStore.getState().syncStatus).toBe('synced')
    expect(useGraphStore.getState().graph.buildings[0]).toMatchObject({ name: 'C Saved Hall', color: '#EF4444' })
    expect(useGraphStore.getState().authoredDocument?.buildings[0]).toMatchObject({ name: 'C Saved Hall', color: '#EF4444' })
    expect(postedBodies).toHaveLength(2)
    expect(warning.mock.calls.some(([message]) => String(message).includes('save blocked by safety guard'))).toBe(false)
  })

  it('keeps a successful five-second editor save saved when an older recovery read fails late', async () => {
    const baseline = payload('Baseline Hall')
    localStorage.setItem(CACHE_KEY, JSON.stringify(baseline))
    const clientTrace = vi.spyOn(console, 'info').mockImplementation(() => {})

    let getCount = 0
    let recoveryReadStarted = false
    let releaseRecoveryRead!: (response: Response) => void
    const pendingRecoveryRead = new Promise<Response>((resolve) => {
      releaseRecoveryRead = resolve
    })
    const postedBodies: Array<Record<string, unknown>> = []
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>
        postedBodies.push(body)
        return jsonResponse({ success: true, updatedAt: 'R2' })
      }
      getCount += 1
      if (getCount === 2) {
        recoveryReadStarted = true
        return pendingRecoveryRead
      }
      return jsonResponse({ ...baseline, updatedAt: 'R1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    useGraphStore.getState().loadMapData(MAP_ID)
    const view = render(
      <EditorBridge>
        <SaveStatus />
      </EditorBridge>,
    )
    await waitFor(() => expect(useGraphStore.getState().syncStatus).toBe('synced'))
    await waitFor(() => expect(view.getByText('All changes saved')).toBeInTheDocument())

    act(() => useGraphStore.setState({ syncStatus: 'error', syncError: 'previous attempt failed' }))
    await waitFor(() => expect(view.getByText('Save failed — changes preserved')).toBeInTheDocument())

    const olderRecovery = useGraphStore.getState().syncLocalChanges()
    const olderRecoveryOutcome = olderRecovery.then(
      () => null,
      (error: unknown) => error,
    )
    await waitFor(() => expect(recoveryReadStarted).toBe(true))

    vi.useFakeTimers()
    try {
      const context = (window as unknown as {
        __naviContext: { services: { get: (name: string) => unknown } }
      }).__naviContext
      const dispatcher = context.services.get('dispatcher') as {
        execute: (command: {
          id: 'entity.update'
          label: string
          payload: { entityId: string; changes: { name: string } }
        }) => { success: boolean; error?: string }
      }

      act(() => {
        const result = dispatcher.execute({
          id: 'entity.update',
          label: 'Edit Building',
          payload: { entityId: 'building-1', changes: { name: 'Newer Saved Hall' } },
        })
        expect(result.success).toBe(true)
      })

      const localDraft = JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}') as {
        authoredDocument?: { buildings?: Array<{ name?: string }> }
      }
      expect(localDraft.authoredDocument?.buildings?.[0]?.name).toBe('Newer Saved Hall')
      expect(postedBodies).toHaveLength(0)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })
      await vi.waitFor(() => expect(postedBodies).toHaveLength(1))
      await vi.waitFor(() => expect(view.getByText('All changes saved')).toBeInTheDocument())

      expect(postedBodies).toHaveLength(1)
      expect(postedBodies[0]).toMatchObject({
        expectedServerUpdatedAt: 'R1',
        forceServerOverwrite: false,
        mutationId: expect.any(String),
      })
      expect((postedBodies[0].authoredDocument as { buildings: Array<{ name: string }> }).buildings[0]?.name)
        .toBe('Newer Saved Hall')
      expect(useGraphStore.getState().syncStatus).toBe('synced')

      releaseRecoveryRead(jsonResponse({ error: 'temporary recovery read failure' }, 503))
      await olderRecoveryOutcome

      expect(view.getByText('All changes saved')).toBeInTheDocument()
      expect(view.queryByText('Save failed — changes preserved')).not.toBeInTheDocument()
      expect(useGraphStore.getState().syncStatus).toBe('synced')
      expect(useGraphStore.getState().syncError).toBeNull()

      const traceEntries = clientTrace.mock.calls
        .map(([line]) => String(line))
        .filter((line) => line.startsWith('[graph-store] save lifecycle '))
        .map((line) => JSON.parse(line.slice('[graph-store] save lifecycle '.length)) as Record<string, unknown>)
      expectSafeSaveLifecycleEntries(traceEntries)
      const lateRead = traceEntries.find((entry) => entry.event === 'recovery-read-response' && entry.httpStatus === 503)
      expect(lateRead).toMatchObject({
        readOutcome: 'http-error',
      })
      const lateDisposition = traceEntries.find((entry) => entry.event === 'recovery-read-disposition')
      expect(lateDisposition).toMatchObject({
        httpStatus: 503,
        readOutcome: 'http-error',
        outcome: 'ignored-stale-failure',
        staleDiscarded: true,
        statusWriteApplied: false,
        finalClientStatus: 'synced',
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('clears the visible error after the first guarded two-second autosave retry succeeds', async () => {
    const baseline = payload('Baseline Hall')
    localStorage.setItem(CACHE_KEY, JSON.stringify(baseline))

    let getCount = 0
    const postedBodies: Array<Record<string, unknown>> = []
    const postHeaders: Headers[] = []
    const postStatuses: number[] = []
    const postTimes: number[] = []
    const clientTrace = vi.spyOn(console, 'info').mockImplementation(() => {})
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        postedBodies.push(JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>)
        postHeaders.push(new Headers(init.headers))
        postTimes.push(Date.now())
        const status = postedBodies.length === 1 ? 503 : 200
        postStatuses.push(status)
        return status === 503
          ? jsonResponse({ error: 'temporary upstream failure' }, status)
          : jsonResponse({ success: true, updatedAt: 'R2' }, status)
      }
      getCount += 1
      return jsonResponse({ ...baseline, updatedAt: 'R1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    useGraphStore.getState().loadMapData(MAP_ID)
    const view = render(
      <EditorBridge>
        <SaveStatus />
      </EditorBridge>,
    )
    await waitFor(() => expect(getCount).toBe(1))
    await waitFor(() => expect(useGraphStore.getState().syncStatus).toBe('synced'))
    await waitFor(() => expect(view.getByText('All changes saved')).toBeInTheDocument())

    vi.useFakeTimers()
    try {
      const context = (window as unknown as {
        __naviContext: { services: { get: (name: string) => unknown } }
      }).__naviContext
      const dispatcher = context.services.get('dispatcher') as {
        execute: (command: {
          id: 'entity.update'
          label: string
          payload: { entityId: string; changes: { name: string } }
        }) => { success: boolean; error?: string }
      }

      act(() => {
        const result = dispatcher.execute({
          id: 'entity.update',
          label: 'Edit Building',
          payload: { entityId: 'building-1', changes: { name: 'Retry Saved Hall' } },
        })
        expect(result.success).toBe(true)
      })

      const localDraft = JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}') as {
        authoredDocument?: { buildings?: Array<{ name?: string }> }
      }
      expect(localDraft.authoredDocument?.buildings?.[0]?.name).toBe('Retry Saved Hall')

      await act(async () => { await vi.advanceTimersByTimeAsync(4999) })
      expect(postedBodies).toHaveLength(0)
      await act(async () => { await vi.advanceTimersByTimeAsync(1) })
      expect(postedBodies).toHaveLength(1)
      expect(useGraphStore.getState().syncStatus).toBe('syncing')
      expect(useGraphStore.getState().syncError).toBe('Save failed — retrying automatically')
      expect(view.getByText('Save failed — retrying automatically')).toBeInTheDocument()
      expect(postStatuses).toEqual([503])

      await act(async () => { await vi.advanceTimersByTimeAsync(1999) })
      expect(postedBodies).toHaveLength(1)
      await act(async () => { await vi.advanceTimersByTimeAsync(1) })
      await vi.waitFor(() => expect(postedBodies).toHaveLength(2))
      await vi.waitFor(() => expect(view.getByText('All changes saved')).toBeInTheDocument())

      expect(postStatuses).toEqual([503, 200])
      expect(postTimes[1] - postTimes[0]).toBe(2000)
      expect(postedBodies[0]?.mutationId).toEqual(expect.any(String))
      expect(postedBodies[1]?.mutationId).toBe(postedBodies[0]?.mutationId)
      expect(postHeaders.map((headers) => headers.get('x-navi-save-attempt'))).toEqual(['1', '2'])
      expect(postHeaders.map((headers) => headers.get('x-navi-save-chain-id'))).toEqual([
        postedBodies[0]?.mutationId,
        postedBodies[0]?.mutationId,
      ])
      const sessionGenerations = postHeaders.map((headers) => headers.get('x-navi-session-generation'))
      const campusEpochs = postHeaders.map((headers) => headers.get('x-navi-campus-epoch'))
      expect(sessionGenerations[0]).toMatch(/^\d+$/)
      expect(sessionGenerations[1]).toBe(sessionGenerations[0])
      expect(campusEpochs[0]).toMatch(/^\d+$/)
      expect(campusEpochs[1]).toBe(campusEpochs[0])
      expect(postHeaders[0]?.get('x-navi-graph-fingerprint')).toEqual(expect.any(String))
      expect(postHeaders[0]?.get('x-navi-authored-fingerprint')).toEqual(expect.any(String))
      expect(postedBodies.map((body) => body.forceServerOverwrite)).toEqual([false, false])
      expect(postedBodies.map((body) => body.expectedServerUpdatedAt)).toEqual(['R1', 'R1'])
      expect(useGraphStore.getState().syncStatus).toBe('synced')
      expect(useGraphStore.getState().syncError).toBeNull()
      expect(JSON.parse(localStorage.getItem(MARKER_KEY) ?? '{}').serverTimestamp).toBe('R2')
      expect(view.queryByText('Save failed — changes preserved')).not.toBeInTheDocument()

      const traceEntries = clientTrace.mock.calls
        .map(([line]) => String(line))
        .filter((line) => line.startsWith('[graph-store] save lifecycle '))
        .map((line) => JSON.parse(line.slice('[graph-store] save lifecycle '.length)) as Record<string, unknown>)
      expectSafeSaveLifecycleEntries(traceEntries)
      expect(traceEntries.filter((entry) => entry.event === 'request').map((entry) => entry.attemptNumber))
        .toEqual([1, 2])
      expect(traceEntries.find((entry) => entry.event === 'response' && entry.attemptNumber === 1))
        .toMatchObject({ httpStatus: 503, retryable: true, retryScheduled: true, retryDelayMs: 2000, finalClientStatus: 'syncing' })
      expect(traceEntries.find((entry) => entry.event === 'response' && entry.attemptNumber === 2))
        .toMatchObject({ httpStatus: 200, retryable: false, retryScheduled: false, retryDelayMs: null, finalClientStatus: 'synced' })
      expect(traceEntries.some((entry) => JSON.stringify(entry).includes('Retry Saved Hall'))).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
