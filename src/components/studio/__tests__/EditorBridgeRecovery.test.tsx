import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { CoordinateTransformer } from '@navi/core'
import { createDocument, DocumentEventBus, DocumentStore, GraphAdapter } from '@navi/editor'
import type { EditorContext } from '@navi/editor'
import { Graph } from '@/engine/graph'
import { EditorBridge, reconcileAuthoritativeDocument } from '../EditorBridge'
import { useGraphStore } from '@/store/graph-store'

const MAP_ID = 'reload-convergence'

function makeGraph(name: string): Graph {
  const graph = new Graph()
  graph.campusId = MAP_ID
  graph.addBuilding({
    id: 'building-1',
    name,
    campusId: MAP_ID,
    footprint: [],
    floors: [],
  } as never)
  return graph
}

function makeContext(document: ReturnType<typeof createDocument>, documentStore: DocumentStore, history: { clear: () => void }, selection: { clear: () => void }) {
  return {
    document,
    transformer: new CoordinateTransformer(),
    services: {
      get(name: string) {
        if (name === 'documentStore') return documentStore
        if (name === 'history') return history
        if (name === 'selection') return selection
        return undefined
      },
    },
  } as never
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  useGraphStore.setState({ graph: new Graph(), currentMapId: null, syncStatus: 'idle', syncError: null })
})

describe('post-recovery reload convergence', () => {
  it('reconciles the active document before teardown can project it back into the graph', () => {
    const staleGraph = makeGraph('Before recovery')
    const authoritativeGraph = makeGraph('After recovery')
    const document = createDocument(staleGraph)
    const eventBus = new DocumentEventBus()
    const documentStore = new DocumentStore(document, eventBus)
    const history = { clear: vi.fn() }
    const selection = { clear: vi.fn() }
    const revisionCommitted = vi.fn()
    eventBus.on('revision.committed', revisionCommitted)
    const context = makeContext(document, documentStore, history, selection)

    reconcileAuthoritativeDocument(context, authoritativeGraph)

    // This is the exact beforeunload direction used by EditorBridge.
    const graphThatWillBePersisted = Graph.fromJSON(authoritativeGraph.toJSON())
    new GraphAdapter(graphThatWillBePersisted, context.transformer).sync(document)

    expect(graphThatWillBePersisted.buildings[0]?.name).toBe('After recovery')
    expect(documentStore.document).toBe(document)
    expect(documentStore.version).toBe(0)
    expect(revisionCommitted).not.toHaveBeenCalled()
    expect(history.clear).toHaveBeenCalledOnce()
    expect(selection.clear).toHaveBeenCalledOnce()
  })

  it('keeps the graph → document → graph projection fingerprint-stable', () => {
    const graph = makeGraph('Canonical')
    const document = createDocument(graph)
    const projected = Graph.fromJSON(graph.toJSON())

    new GraphAdapter(projected).sync(document)

    expect(projected.buildings.map((building) => ({ id: building.id, name: building.name }))).toEqual(
      graph.buildings.map((building) => ({ id: building.id, name: building.name })),
    )
  })

  it('updates a mounted EditorBridge document when recovery replaces the graph object', async () => {
    const initialGraph = makeGraph('Before recovery')
    useGraphStore.setState({ graph: initialGraph, currentMapId: MAP_ID, syncStatus: 'checking', syncError: null })

    render(
      <EditorBridge>
        <div />
      </EditorBridge>,
    )

    const editorContext = (window as unknown as { __naviContext: EditorContext }).__naviContext
    expect(editorContext.document.buildings[0]?.name).toBe('Before recovery')

    const authoritativeGraph = makeGraph('After recovery')
    act(() => {
      useGraphStore.setState({ graph: authoritativeGraph, currentMapId: MAP_ID, syncStatus: 'synced', syncError: null })
    })

    await waitFor(() => expect(editorContext.document.buildings[0]?.name).toBe('After recovery'))
    const persisted = Graph.fromJSON(authoritativeGraph.toJSON())
    new GraphAdapter(persisted, editorContext.transformer).sync(editorContext.document)
    expect(persisted.buildings[0]?.name).toBe('After recovery')
  })

  it('does not project hydration during teardown, while authored commits still project', async () => {
    const initialGraph = makeGraph('Before recovery')
    useGraphStore.setState({ graph: initialGraph, currentMapId: MAP_ID, syncStatus: 'checking', syncError: null })
    const syncSpy = vi.spyOn(GraphAdapter.prototype, 'sync')

    render(
      <EditorBridge>
        <div />
      </EditorBridge>,
    )
    expect(syncSpy).not.toHaveBeenCalled()

    const editorContext = (window as unknown as { __naviContext: EditorContext }).__naviContext
    const authoritativeGraph = makeGraph('After recovery')
    act(() => {
      useGraphStore.setState({ graph: authoritativeGraph, currentMapId: MAP_ID, syncStatus: 'synced', syncError: null })
    })
    await waitFor(() => expect(editorContext.document.buildings[0]?.name).toBe('After recovery'))

    syncSpy.mockClear()
    act(() => window.dispatchEvent(new Event('beforeunload')))
    expect(syncSpy).not.toHaveBeenCalled()

    const documentStore = editorContext.services.get('documentStore') as DocumentStore
    const eventBus = editorContext.services.get('eventBus') as DocumentEventBus
    act(() => {
      documentStore.commit()
      eventBus.emit('document.changed', { version: documentStore.version })
    })
    expect(syncSpy).toHaveBeenCalledOnce()
  })
})
