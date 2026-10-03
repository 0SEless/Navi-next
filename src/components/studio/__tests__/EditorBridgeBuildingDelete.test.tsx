import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import type { EditorContext } from '@navi/editor'
import { EditorBridge } from '../EditorBridge'
import { Graph } from '@/engine/graph'
import { useGraphStore } from '@/store/graph-store'

describe('EditorBridge building delete persistence intent', () => {
  afterEach(() => {
    cleanup()
    useGraphStore.setState({
      graph: new Graph(),
      currentMapId: null,
      pendingAuthoredMutations: [],
      syncStatus: 'idle',
      syncError: null,
      campusReady: true,
    })
  })

  it('records a first-class building delete intent for guarded autosave', () => {
    const graph = new Graph()
    graph.campusId = 'building-delete-intent'
    graph.addBuilding({ id: 'bld-1', name: 'Delete Me', campusId: graph.campusId, footprint: [] } as never)
    graph.addBuilding({ id: 'bld-2', name: 'Keep Me', campusId: graph.campusId, footprint: [] } as never)
    useGraphStore.setState({ graph, currentMapId: graph.campusId })

    render(
      <EditorBridge>
        <div />
      </EditorBridge>,
    )

    const context = (window as unknown as { __naviContext: EditorContext }).__naviContext
    const dispatcher = context.services.get('dispatcher')!

    act(() => {
      dispatcher.execute({
        id: 'building.delete',
        label: 'Delete Building',
        payload: { buildingId: 'bld-1' },
      })
    })

    expect(useGraphStore.getState().pendingAuthoredMutations).toEqual([
      expect.objectContaining({ kind: 'building', buildingId: 'bld-1', floor: null }),
    ])
  })

  it('records a first-class building edit intent for normal autosave', () => {
    const graph = new Graph()
    graph.campusId = 'building-edit-intent'
    graph.addBuilding({ id: 'bld-1', name: 'Before', campusId: graph.campusId, footprint: [] } as never)
    useGraphStore.setState({ graph, currentMapId: graph.campusId })

    render(
      <EditorBridge>
        <div />
      </EditorBridge>,
    )

    const context = (window as unknown as { __naviContext: EditorContext }).__naviContext
    const dispatcher = context.services.get('dispatcher')!

    act(() => {
      dispatcher.execute({
        id: 'entity.update',
        label: 'Rename Building',
        payload: { entityId: 'bld-1', changes: { name: 'After' } },
      })
    })

    expect(useGraphStore.getState().pendingAuthoredMutations).toEqual([
      expect.objectContaining({ kind: 'building', buildingId: 'bld-1', floor: null }),
    ])
  })

  it('keeps delete undo semantics intact while the projection is authoritative', async () => {
    const graph = new Graph()
    graph.campusId = 'building-delete-undo'
    graph.addBuilding({ id: 'bld-1', name: 'Delete Me', campusId: graph.campusId, footprint: [] } as never)
    useGraphStore.setState({ graph, currentMapId: graph.campusId })

    render(
      <EditorBridge>
        <div />
      </EditorBridge>,
    )
    const context = (window as unknown as { __naviContext: EditorContext }).__naviContext
    const dispatcher = context.services.get('dispatcher')!
    const history = context.services.get('history')!
    await waitFor(() => expect((history as { status?: string }).status).toBe('ready'))

    act(() => {
      dispatcher.execute({
        id: 'building.delete',
        label: 'Delete Building',
        payload: { buildingId: 'bld-1' },
      })
    })
    expect(context.document.buildings).toHaveLength(0)
    expect(graph.buildings).toHaveLength(0)

    act(() => {
      history?.undo()
    })
    expect(context.document.buildings.map((building) => building.id)).toEqual(['bld-1'])
    expect(graph.buildings.map((building) => building.id)).toEqual(['bld-1'])
  })
})
