import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { CONNECTIVITY_CONTRACT_VERSION } from '@navi/core'
import { createDocument } from '@navi/editor'
import { Graph } from '@/engine/graph'
import { serializeAuthoredGraphPayload } from '@/services/authored-snapshot-persistence'
import {
  __resetGraphSaveQueuesForTests,
  useGraphStore,
} from '@/store/graph-store'
import { EditorBridge } from '../EditorBridge'
import { SaveStatus } from '../SaveStatus'

const MAP_ID = 'persisted-reload-lifecycle'
const CACHE_KEY = `navi-graph-${MAP_ID}`
const MARKER_KEY = `navi-sync-status-${MAP_ID}`

type StoredSnapshot = Record<string, unknown>
type PostedMutation = {
  body: StoredSnapshot
  expectedServerUpdatedAt: string | null
  forceServerOverwrite: boolean
  mutationId: string | null
}

function makeGraph(name: string): Graph {
  const graph = new Graph()
  graph.campusId = MAP_ID
  graph.setConnectivitySemanticsVersion(CONNECTIVITY_CONTRACT_VERSION)
  graph.addBuilding({
    id: 'building-1',
    name,
    campusId: MAP_ID,
    footprint: [],
    floors: [],
  } as never)
  return graph
}

function persistedPayload(name: string): StoredSnapshot {
  const graph = makeGraph(name)
  return serializeAuthoredGraphPayload(
    graph.toJSON() as unknown as Record<string, unknown>,
    createAuthoredDocument(graph),
  )
}

function createAuthoredDocument(graph: Graph) {
  // Kept behind one helper so every fixture stores the same production document
  // format as EditorBridge and the Graph-store persistence adapter.
  return createDocument(graph)
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function firstName(value: unknown, field: 'buildings' | 'authoredDocument' = 'buildings'): string | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const source = field === 'authoredDocument' ? record.authoredDocument : record
  if (!source || typeof source !== 'object') return null
  const buildings = (source as Record<string, unknown>).buildings
  if (!Array.isArray(buildings) || !buildings[0] || typeof buildings[0] !== 'object') return null
  const name = (buildings[0] as Record<string, unknown>).name
  return typeof name === 'string' ? name : null
}

class ControlledGraphServer {
  snapshot: StoredSnapshot
  revision = 'R0'
  posts: PostedMutation[] = []
  getCount = 0
  failPostAttempts = 0
  failCommittedReadBacks = 0
  omitRevisionFromNextPost = false
  holdNextPost = false
  holdNextGet = false
  private revisionNumber = 0
  private heldGet: ((response: Response) => void) | null = null
  private heldPost: { body: StoredSnapshot; resolve: (response: Response) => void } | null = null

  constructor(initial: StoredSnapshot) {
    this.snapshot = { ...initial, updatedAt: this.revision }
  }

  fetch = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (init?.method === 'POST') return this.post(init)

    this.getCount += 1
    if (this.failCommittedReadBacks > 0) {
      this.failCommittedReadBacks -= 1
      return jsonResponse({ error: 'controlled revision read-back outage' }, 503)
    }
    if (this.holdNextGet) {
      this.holdNextGet = false
      return new Promise<Response>((resolve) => { this.heldGet = resolve })
    }
    return jsonResponse({ ...this.snapshot, updatedAt: this.revision })
  }

  releaseHeldGet(): void {
    const release = this.heldGet
    this.heldGet = null
    if (!release) throw new Error('No controlled GET is being held')
    release(jsonResponse({ ...this.snapshot, updatedAt: this.revision }))
  }

  releaseHeldPostSuccessfully(): void {
    const held = this.heldPost
    this.heldPost = null
    if (!held) throw new Error('No controlled POST is being held')
    held.resolve(this.commit(held.body, false))
  }

  releaseHeldPostWithoutCommit(): void {
    const held = this.heldPost
    this.heldPost = null
    if (!held) throw new Error('No controlled POST is being held')
    held.resolve(jsonResponse({ error: 'controlled pre-ack crash' }, 503))
  }

  get serverBuildingName(): string | null {
    return firstName(this.snapshot, 'authoredDocument')
  }

  private post(init: RequestInit): Promise<Response> | Response {
    const body = JSON.parse(String(init.body ?? '{}')) as StoredSnapshot
    const expected = typeof body.expectedServerUpdatedAt === 'string'
      ? body.expectedServerUpdatedAt
      : null
    const mutation: PostedMutation = {
      body,
      expectedServerUpdatedAt: expected,
      forceServerOverwrite: body.forceServerOverwrite === true,
      mutationId: typeof body.mutationId === 'string' ? body.mutationId : null,
    }
    this.posts.push(mutation)

    if (this.holdNextPost) {
      this.holdNextPost = false
      return new Promise<Response>((resolve) => { this.heldPost = { body, resolve } })
    }
    if (this.failPostAttempts > 0) {
      this.failPostAttempts -= 1
      return jsonResponse({ error: 'controlled pre-commit outage' }, 503)
    }
    if (expected !== this.revision) {
      return jsonResponse({ error: 'The server changed since this editor loaded it.' }, 409)
    }
    return this.commit(body, this.omitRevisionFromNextPost)
  }

  private commit(body: StoredSnapshot, omitRevision: boolean): Response {
    this.revisionNumber += 1
    this.revision = `R${this.revisionNumber}`
    const serverRecord = { ...body }
    delete serverRecord.expectedServerUpdatedAt
    delete serverRecord.forceServerOverwrite
    delete serverRecord.mutationId
    serverRecord.updatedAt = this.revision
    this.snapshot = serverRecord

    if (omitRevision) {
      this.omitRevisionFromNextPost = false
      this.failCommittedReadBacks = 5
      return jsonResponse({ success: true })
    }
    return jsonResponse({ success: true, updatedAt: this.revision })
  }
}

type EditorContextLike = {
  document: { buildings: Array<{ name?: string }> }
  services: {
    get: (name: string) => unknown
    destroy: () => Promise<void>
  }
}

function currentEditorContext(): EditorContextLike {
  const context = (window as unknown as { __naviContext?: unknown }).__naviContext
  if (!context) throw new Error('EditorBridge did not expose the mounted context')
  return context as EditorContextLike
}

function readLocalRecords(): {
  graphName: string | null
  authoredName: string | null
  marker: Record<string, unknown>
} {
  const raw = localStorage.getItem(CACHE_KEY)
  const cache = raw ? JSON.parse(raw) as StoredSnapshot : null
  const markerRaw = localStorage.getItem(MARKER_KEY)
  return {
    graphName: firstName(cache),
    authoredName: firstName(cache, 'authoredDocument'),
    marker: markerRaw ? JSON.parse(markerRaw) as Record<string, unknown> : {},
  }
}

function workflowSnapshot(): {
  saveState: string
  lastSaveVersion: number
  lastSavedAt: number
} {
  const service = currentEditorContext().services.get('workflowStore') as {
    getSnapshot: () => { saveState: string; lastSaveVersion: number; lastSavedAt: number }
  } | undefined
  if (!service) throw new Error('WorkflowStore was not registered')
  return service.getSnapshot()
}

function mountEditorSession(): ReturnType<typeof render> {
  useGraphStore.getState().loadMapData(MAP_ID)
  return render(
    <EditorBridge>
      <SaveStatus />
    </EditorBridge>,
  )
}

async function waitForClean(view: ReturnType<typeof render>): Promise<void> {
  await waitFor(() => expect(useGraphStore.getState().syncStatus).toBe('synced'))
  await waitFor(() => expect(view.getByText('All changes saved')).toBeInTheDocument())
}

async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    for (let index = 0; index < 12; index += 1) await Promise.resolve()
  })
}

function dispatchBuildingRename(name: string): void {
  const dispatcher = currentEditorContext().services.get('dispatcher') as {
    execute: (command: {
      id: 'entity.update'
      label: string
      payload: { entityId: string; changes: { name: string } }
    }) => { success: boolean; error?: string }
  } | undefined
  if (!dispatcher) throw new Error('Editor dispatcher was not registered')
  const result = dispatcher.execute({
    id: 'entity.update',
    label: 'Rename Building',
    payload: { entityId: 'building-1', changes: { name } },
  })
  if (!result.success) throw new Error(result.error ?? 'Building edit was rejected')
}

async function destroyEditorSession(): Promise<void> {
  const context = currentEditorContext()
  act(() => window.dispatchEvent(new Event('beforeunload')))
  cleanup()
  for (const name of ['autosave', 'workflow']) {
    const service = context.services.get(name) as { destroy?: () => Promise<void> } | undefined
    if (typeof service?.destroy === 'function') await service.destroy()
  }
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
  Reflect.deleteProperty(window, '__naviContext')
}

function clearRuntimeForTest(): void {
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
}

afterEach(async () => {
  const context = (window as unknown as { __naviContext?: EditorContextLike }).__naviContext
  cleanup()
  if (context) {
    for (const name of ['autosave', 'workflow']) {
      const service = context.services.get(name) as { destroy?: () => Promise<void> } | undefined
      if (typeof service?.destroy === 'function') await service.destroy()
    }
  }
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  localStorage.clear()
  clearRuntimeForTest()
  Reflect.deleteProperty(window, '__naviContext')
})

describe('persisted save lifecycle across real editor-session teardown', () => {
  it('does not need a second reload after first-reload local-ahead recovery', async () => {
    const server = new ControlledGraphServer(persistedPayload('Hall A'))
    server.failPostAttempts = 5
    vi.stubGlobal('fetch', server.fetch)
    localStorage.setItem(CACHE_KEY, JSON.stringify(persistedPayload('Hall A')))

    const session1 = mountEditorSession()
    await waitForClean(session1)
    expect(readLocalRecords().marker.serverTimestamp).toBe('R0')
    expect(server.serverBuildingName).toBe('Hall A')

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    act(() => dispatchBuildingRename('Hall B'))
    expect(readLocalRecords()).toMatchObject({ graphName: 'Hall B', authoredName: 'Hall B' })
    expect(readLocalRecords().marker.serverTimestamp).toBe('R0')
    expect(useGraphStore.getState().pendingAuthoredMutations.length).toBeGreaterThan(0)

    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    await act(async () => { await vi.advanceTimersByTimeAsync(47_000) })
    expect(session1.getByText('Save failed — changes preserved')).toBeInTheDocument()
    expect(server.serverBuildingName).toBe('Hall A')
    expect(readLocalRecords()).toMatchObject({ graphName: 'Hall B', authoredName: 'Hall B' })
    expect(readLocalRecords().marker.serverTimestamp).toBe('R0')
    expect(useGraphStore.getState().pendingAuthoredMutations.length).toBeGreaterThan(0)

    const originalPostCount = server.posts.length
    await destroyEditorSession()
    vi.useRealTimers()

    // Session 2 restores the persisted B draft against unchanged server A.
    // Hold the actual freshness GET and guarded recovery POST to capture both
    // sides of the hydration/recovery boundary without replacing localStorage.
    server.holdNextGet = true
    server.holdNextPost = true
    const session2 = mountEditorSession()
    expect(useGraphStore.getState().syncStatus).toBe('idle')
    expect(useGraphStore.getState().authoredDocument?.buildings[0]?.name).toBe('Hall B')
    expect(readLocalRecords()).toMatchObject({ graphName: 'Hall B', authoredName: 'Hall B' })
    expect(readLocalRecords().marker.serverTimestamp).toBe('R0')
    expect(server.getCount).toBeGreaterThan(0)
    await waitFor(() => expect(workflowSnapshot().saveState).toBe('dirty'))

    server.releaseHeldGet()
    await waitFor(() => expect(server.posts).toHaveLength(originalPostCount + 1))
    expect(useGraphStore.getState().syncStatus).toBe('syncing')
    expect(session2.getByText('Saving...')).toBeInTheDocument()
    expect(server.serverBuildingName).toBe('Hall A')
    expect(readLocalRecords().marker.serverTimestamp).toBe('R0')

    server.releaseHeldPostSuccessfully()
    await waitFor(() => expect(useGraphStore.getState().syncStatus).toBe('synced'))
    const afterSession2 = {
      serverName: server.serverBuildingName,
      local: readLocalRecords(),
      workflow: workflowSnapshot(),
      label: session2.getByRole('status').textContent,
      pendingIntentCount: useGraphStore.getState().pendingAuthoredMutations.length,
      postCount: server.posts.length,
    }
    expect(afterSession2.serverName).toBe('Hall B')
    expect(afterSession2.local).toMatchObject({
      graphName: 'Hall B',
      authoredName: 'Hall B',
      marker: { serverTimestamp: 'R1' },
    })
    expect(afterSession2.pendingIntentCount).toBe(0)
    expect(server.posts.at(-1)).toMatchObject({
      expectedServerUpdatedAt: 'R0',
      forceServerOverwrite: false,
    })

    await destroyEditorSession()

    // Session 3 reads the marker advanced by session 2. It must not be the
    // first point at which the workflow changes from dirty to saved.
    const session3 = mountEditorSession()
    const session3AtHydration = {
      syncStatus: useGraphStore.getState().syncStatus,
      local: readLocalRecords(),
      serverName: server.serverBuildingName,
    }
    await waitForClean(session3)
    const afterSession3 = {
      serverName: server.serverBuildingName,
      local: readLocalRecords(),
      workflow: workflowSnapshot(),
      label: session3.getByRole('status').textContent,
      pendingIntentCount: useGraphStore.getState().pendingAuthoredMutations.length,
      postCount: server.posts.length,
    }

    expect({
      originalPosts: originalPostCount,
      afterSession2,
      session3AtHydration,
      afterSession3,
    }).toMatchObject({
      originalPosts: 5,
      afterSession2: {
        serverName: 'Hall B',
        workflow: { saveState: 'saved' },
        label: expect.stringContaining('All changes saved'),
        pendingIntentCount: 0,
        postCount: 6,
      },
      session3AtHydration: {
        syncStatus: 'checking',
        local: { graphName: 'Hall B', authoredName: 'Hall B', marker: { serverTimestamp: 'R1' } },
        serverName: 'Hall B',
      },
      afterSession3: {
        workflow: { saveState: 'saved' },
        label: expect.stringContaining('All changes saved'),
        pendingIntentCount: 0,
        postCount: 6,
      },
    })
  })

  it('converges on the first reload when the original POST committed B but its ACK revision was unavailable', async () => {
    const server = new ControlledGraphServer(persistedPayload('Hall A'))
    vi.stubGlobal('fetch', server.fetch)
    localStorage.setItem(CACHE_KEY, JSON.stringify(persistedPayload('Hall A')))

    const session1 = mountEditorSession()
    await waitForClean(session1)
    server.omitRevisionFromNextPost = true

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    act(() => dispatchBuildingRename('Hall B'))
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    await act(async () => { await vi.advanceTimersByTimeAsync(47_000) })

    expect(session1.getByText('Save failed — changes preserved')).toBeInTheDocument()
    expect(server.serverBuildingName).toBe('Hall B')
    expect(readLocalRecords()).toMatchObject({ graphName: 'Hall B', authoredName: 'Hall B' })
    expect(readLocalRecords().marker.serverTimestamp).toBe('R0')
    expect(server.posts).toHaveLength(1)

    await destroyEditorSession()
    vi.useRealTimers()

    const beforeReloadPostCount = server.posts.length
    const session2 = mountEditorSession()
    await waitForClean(session2)
    const session2State = {
      serverName: server.serverBuildingName,
      local: readLocalRecords(),
      label: session2.getByRole('status').textContent,
      postCount: server.posts.length,
    }
    await destroyEditorSession()

    const session3 = mountEditorSession()
    await waitForClean(session3)
    expect({ session2State, session3Label: session3.getByRole('status').textContent, posts: server.posts.length })
      .toMatchObject({
        session2State: {
          serverName: 'Hall B',
          local: { graphName: 'Hall B', authoredName: 'Hall B', marker: { serverTimestamp: 'R1' } },
          label: expect.stringContaining('All changes saved'),
          postCount: beforeReloadPostCount,
        },
        session3Label: expect.stringContaining('All changes saved'),
        posts: 1,
      })
  })

  it('preserves B and resumes a guarded save when the browser crashes before POST acknowledgement', async () => {
    const server = new ControlledGraphServer(persistedPayload('Hall A'))
    vi.stubGlobal('fetch', server.fetch)
    localStorage.setItem(CACHE_KEY, JSON.stringify(persistedPayload('Hall A')))

    const session1 = mountEditorSession()
    await waitForClean(session1)
    server.holdNextPost = true

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    act(() => dispatchBuildingRename('Hall B'))
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    expect(server.posts).toHaveLength(1)
    expect(server.serverBuildingName).toBe('Hall A')
    expect(readLocalRecords()).toMatchObject({ graphName: 'Hall B', authoredName: 'Hall B' })

    await destroyEditorSession()
    vi.useRealTimers()

    server.holdNextGet = true
    const session2 = mountEditorSession()
    expect(useGraphStore.getState().syncStatus).toBe('idle')
    await waitFor(() => expect(workflowSnapshot().saveState).toBe('dirty'))
    server.releaseHeldGet()
    await waitFor(() => expect(server.posts).toHaveLength(2))
    await waitFor(() => expect(useGraphStore.getState().syncStatus).toBe('synced'))
    expect(server.serverBuildingName).toBe('Hall B')
    expect(server.posts[1]).toMatchObject({ expectedServerUpdatedAt: 'R0', forceServerOverwrite: false })
    expect(session2.getByText('All changes saved')).toBeInTheDocument()

    // The old tab's request settles after this session is current; its stale
    // failure must not replace the acknowledged session's final state.
    server.releaseHeldPostWithoutCommit()
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(useGraphStore.getState().syncStatus).toBe('synced')
    expect(server.serverBuildingName).toBe('Hall B')
  })

  it('keeps a newer authored edit dirty when it lands during local-ahead recovery', async () => {
    const server = new ControlledGraphServer(persistedPayload('Hall A'))
    vi.stubGlobal('fetch', server.fetch)
    localStorage.setItem(CACHE_KEY, JSON.stringify(persistedPayload('Hall A')))

    const session1 = mountEditorSession()
    await waitForClean(session1)
    server.holdNextPost = true
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    act(() => dispatchBuildingRename('Hall B'))
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    expect(server.posts).toHaveLength(1)
    await destroyEditorSession()
    vi.useRealTimers()

    // The first request did not commit before the browser went away.
    server.releaseHeldPostWithoutCommit()
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    // Hold freshness until the new WorkflowService has captured its initial
    // dirty baseline, then hold the automatic guarded recovery POST for B.
    server.holdNextGet = true
    server.holdNextPost = true
    const session2 = mountEditorSession()
    await waitFor(() => expect(workflowSnapshot().saveState).toBe('dirty'))
    server.releaseHeldGet()
    await waitFor(() => expect(server.posts).toHaveLength(2))
    expect(useGraphStore.getState().syncStatus).toBe('syncing')

    act(() => dispatchBuildingRename('Hall C'))
    expect(readLocalRecords()).toMatchObject({ graphName: 'Hall C', authoredName: 'Hall C' })
    server.releaseHeldPostSuccessfully()
    await waitFor(() => expect(useGraphStore.getState().syncStatus).toBe('synced'))

    expect(server.serverBuildingName).toBe('Hall B')
    expect(readLocalRecords()).toMatchObject({
      graphName: 'Hall C',
      authoredName: 'Hall C',
      marker: { serverTimestamp: 'R1' },
    })
    expect(useGraphStore.getState().pendingAuthoredMutations.length).toBeGreaterThan(0)
    expect(workflowSnapshot().saveState).toBe('dirty')
    expect(session2.getByText('Unsaved changes')).toBeInTheDocument()
  })

  it('stays green without reload for 30 seconds and remains clean across two reloads after ACK', async () => {
    const server = new ControlledGraphServer(persistedPayload('Hall A'))
    vi.stubGlobal('fetch', server.fetch)
    localStorage.setItem(CACHE_KEY, JSON.stringify(persistedPayload('Hall A')))

    vi.useFakeTimers()
    const session1 = mountEditorSession()
    await flushMicrotasks()
    expect(useGraphStore.getState().syncStatus).toBe('synced')
    expect(session1.getByText('All changes saved')).toBeInTheDocument()
    act(() => dispatchBuildingRename('Hall B'))
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    await flushMicrotasks()
    expect(useGraphStore.getState().syncStatus).toBe('synced')
    expect(session1.getByText('All changes saved')).toBeInTheDocument()
    expect(server.serverBuildingName).toBe('Hall B')
    expect(readLocalRecords().marker.serverTimestamp).toBe('R1')

    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(session1.getByText('All changes saved')).toBeInTheDocument()
    expect(server.posts).toHaveLength(1)
    await destroyEditorSession()
    vi.useRealTimers()

    const session2 = mountEditorSession()
    await waitForClean(session2)
    const firstReloadState = {
      label: session2.getByRole('status').textContent,
      syncStatus: useGraphStore.getState().syncStatus,
      postCount: server.posts.length,
    }
    await destroyEditorSession()

    const session3 = mountEditorSession()
    await waitForClean(session3)
    expect({
      firstReloadState,
      secondReloadLabel: session3.getByRole('status').textContent,
      posts: server.posts.length,
      serverName: server.serverBuildingName,
    }).toMatchObject({
      firstReloadState: {
        label: expect.stringContaining('All changes saved'),
        syncStatus: 'synced',
        postCount: 1,
      },
      secondReloadLabel: expect.stringContaining('All changes saved'),
      posts: 1,
      serverName: 'Hall B',
    })
  })
})
