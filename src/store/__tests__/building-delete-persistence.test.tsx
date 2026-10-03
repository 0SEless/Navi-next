import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import type { EditorContext } from '@navi/editor'
import { EditorBridge } from '@/components/studio/EditorBridge'
import { Graph } from '../../engine/graph'
import { useGraphStore, __resetGraphSaveQueuesForTests } from '../graph-store'

const MAP_ID = 'building-delete-persistence'
const CACHE_KEY = `navi-graph-${MAP_ID}`
const MARKER_KEY = `navi-sync-status-${MAP_ID}`

function makeGraph(): Graph {
  const graph = new Graph()
  graph.campusId = MAP_ID
  graph.addBuilding({ id: 'bld-1', name: 'Delete Me', campusId: MAP_ID, footprint: [] } as never)
  graph.addBuilding({ id: 'bld-2', name: 'Keep Me', campusId: MAP_ID, footprint: [] } as never)
  return graph
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('building delete persistence through Studio autosave', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    __resetGraphSaveQueuesForTests()
    useGraphStore.setState({
      graph: new Graph(),
      currentMapId: null,
      authoredDocument: null,
      pendingAuthoredMutations: [],
      syncStatus: 'idle',
      syncError: null,
      campusReady: true,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    cleanup()
  })

  it('sends one guarded normal POST after a committed building edit settles for 5 seconds', async () => {
    let serverSnapshot: Record<string, unknown> = {}
    let revision = 0
    const posted: Array<Record<string, any>> = []
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'POST') {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, any>
        posted.push(body)
        serverSnapshot = structuredClone(body)
        revision += 1
        return jsonResponse({ success: true, updatedAt: `R${revision}` })
      }
      return jsonResponse({ ...structuredClone(serverSnapshot), updatedAt: `R${revision}` })
    }))

    const graph = makeGraph()
    useGraphStore.setState({ graph, currentMapId: MAP_ID })
    await useGraphStore.getState().save()
    expect(posted).toHaveLength(1)

    render(
      <EditorBridge>
        <div />
      </EditorBridge>,
    )
    const context = (window as unknown as { __naviContext: EditorContext }).__naviContext
    const dispatcher = context.services.get('dispatcher')!
    await waitFor(() => expect(context.services.get('autosave')?.status).toBe('ready'))
    vi.useFakeTimers()

    act(() => {
      dispatcher.execute({
        id: 'entity.update',
        label: 'Rename Building',
        payload: { entityId: 'bld-1', changes: { name: 'Edited Me' } },
      })
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4999)
    })
    expect(posted).toHaveLength(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(posted).toHaveLength(2)
    expect(posted[1].forceServerOverwrite).toBe(false)
    expect(posted[1].buildings.find((building: { id: string }) => building.id === 'bld-1')?.name).toBe('Edited Me')
  })

  it('sends a normal POST for a committed building create', async () => {
    vi.useFakeTimers()
    const posted: Array<Record<string, any>> = []
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'POST') {
        posted.push(JSON.parse(String(init?.body ?? '{}')))
        return jsonResponse({ success: true, updatedAt: `R${posted.length}` })
      }
      return jsonResponse({ updatedAt: `R${posted.length}` })
    }))

    const graph = makeGraph()
    useGraphStore.setState({ graph, currentMapId: MAP_ID })
    await useGraphStore.getState().save()
    render(<EditorBridge><div /></EditorBridge>)
    const context = (window as unknown as { __naviContext: EditorContext }).__naviContext
    const dispatcher = context.services.get('dispatcher')!
    vi.useRealTimers()
    await waitFor(() => expect(context.services.get('autosave')?.status).toBe('ready'))
    vi.useFakeTimers()

    act(() => {
      dispatcher.execute({
        id: 'building.create',
        label: 'Create Building',
        payload: { id: 'bld-3', name: 'Created', code: 'C3' },
      })
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })

    expect(posted).toHaveLength(2)
    expect(posted[1].forceServerOverwrite).toBe(false)
    expect(posted[1].buildings.some((building: { id: string; name: string }) => building.id === 'bld-3' && building.name === 'Created')).toBe(true)
  })

  it('writes the delete to local draft, save payload, server, marker, and hard reload', async () => {
    let serverSnapshot: Record<string, unknown> = {}
    let revision = 0
    const posted: Array<Record<string, any>> = []
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'POST') {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, any>
        posted.push(body)
        serverSnapshot = structuredClone(body)
        revision += 1
        return jsonResponse({ success: true, updatedAt: `R${revision}` })
      }
      return jsonResponse({ ...structuredClone(serverSnapshot), updatedAt: `R${revision}` })
    }))

    const graph = makeGraph()
    useGraphStore.setState({ graph, currentMapId: MAP_ID })
    await useGraphStore.getState().save()
    expect(posted[0].buildings.map((building: { id: string }) => building.id)).toEqual(['bld-1', 'bld-2'])

    render(
      <EditorBridge>
        <div />
      </EditorBridge>,
    )
    const context = (window as unknown as { __naviContext: EditorContext }).__naviContext
    const dispatcher = context.services.get('dispatcher')!

    let deleteResult: any
    act(() => {
      deleteResult = dispatcher.execute({
        id: 'building.delete',
        label: 'Delete Building',
        payload: { buildingId: 'bld-1' },
      })
    })
    expect(deleteResult?.success).toBe(true)
    expect(context.document.buildings.map((building) => building.id)).toEqual(['bld-2'])
    expect(useGraphStore.getState().graph.buildings.map((building) => building.id)).toEqual(['bld-2'])
    expect(useGraphStore.getState().pendingAuthoredMutations).toEqual([
      expect.objectContaining({ kind: 'building', buildingId: 'bld-1' }),
    ])

    await useGraphStore.getState().save({ trigger: 'autosave' })

    expect(posted).toHaveLength(2)
    expect(posted[1].buildings.map((building: { id: string }) => building.id)).toEqual(['bld-2'])
    expect(JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}').buildings.map((building: { id: string }) => building.id)).toEqual(['bld-2'])
    expect((serverSnapshot.buildings as Array<{ id: string }>).map((building) => building.id)).toEqual(['bld-2'])
    expect(JSON.parse(localStorage.getItem(MARKER_KEY) ?? '{}').serverTimestamp).toBe('R2')
    expect(useGraphStore.getState().pendingAuthoredMutations).toHaveLength(0)

    useGraphStore.setState({ graph: new Graph(), currentMapId: null, syncStatus: 'idle', syncError: null })
    useGraphStore.getState().loadMapData(MAP_ID)
    await waitFor(() => expect(useGraphStore.getState().syncStatus).toBe('synced'))
    expect(useGraphStore.getState().graph.buildings.map((building) => building.id)).toEqual(['bld-2'])
    expect(posted).toHaveLength(2)
  })

  it('preserves an empty local draft when reload interrupts the delete debounce', async () => {
    let serverSnapshot: Record<string, unknown> = {}
    let revision = 0
    const posted: Array<Record<string, any>> = []
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'POST') {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, any>
        posted.push(body)
        serverSnapshot = structuredClone(body)
        revision += 1
        return jsonResponse({ success: true, updatedAt: `R${revision}` })
      }
      return jsonResponse({ ...structuredClone(serverSnapshot), updatedAt: `R${revision}` })
    }))

    const graph = new Graph()
    graph.campusId = MAP_ID
    graph.addBuilding({ id: 'bld-1', name: 'Delete Me', campusId: MAP_ID, footprint: [] } as never)
    useGraphStore.setState({ graph, currentMapId: MAP_ID })
    await useGraphStore.getState().save()

    useGraphStore.getState().removeBuilding('bld-1')
    const localDelete = useGraphStore.getState().graph.toJSON()
    expect(localDelete.buildings).toHaveLength(0)
    // Model the synchronous visibility/unload cache write while the 5s
    // editor debounce is still pending; the server remains at R1.
    localStorage.setItem(CACHE_KEY, JSON.stringify(localDelete))

    useGraphStore.setState({ graph: new Graph(), currentMapId: null, syncStatus: 'idle', syncError: null })
    useGraphStore.getState().loadMapData(MAP_ID)
    await waitFor(() => expect(useGraphStore.getState().syncStatus).toBe('conflict'))

    expect(useGraphStore.getState().graph.buildings).toHaveLength(0)
    expect(JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}').buildings).toHaveLength(0)
    expect(posted).toHaveLength(1)
    expect((serverSnapshot.buildings as Array<{ id: string }>).map((building) => building.id)).toEqual(['bld-1'])
  })
})
