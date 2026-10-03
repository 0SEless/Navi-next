import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, act, cleanup, waitFor } from '@testing-library/react'
import { EditorProvider, DocumentStore, DocumentEventBus, asEntityId, GraphAdapter } from '@navi/editor'
import {
  CommandRegistry,
  CommandDispatcher,
  entityUpdateHandler,
} from '@navi/editor'
import { SelectionManager, HistoryStack, SelectionOrigin } from '@navi/editor'
import { PropertiesPanel, findEntityById } from '@navi/editor'
import { Viewport } from '@navi/editor'
import type { EditorContext } from '@navi/editor'
import type { CampusDocument } from '@navi/core'
import { EditorBridge } from '../EditorBridge'
import { Graph } from '@/engine/graph'
import { useGraphStore } from '@/store/graph-store'
import { useStudioStore } from '@/store/studio-store'

afterEach(() => {
  cleanup()
  useStudioStore.setState({ selectedNodeId: null, activeBuildingId: null })
  useGraphStore.setState({ graph: { name: 'Campus', buildings: [] } as any })
})

/**
 * Mirrors `EditorBridge.buildContext` exactly (one document, one
 * SelectionManager, one dispatcher, one history), but uses a manual
 * `services` object — the same pattern as `PropertiesPanel.test.tsx` —
 * so we hold live references to `history`, `dispatcher`, `documentStore`,
 * and `selectionManager` for assertions.
 */
function buildEditorContext(graph: any) {
  const document: CampusDocument = createDocument(graph)
  const documentStore = new DocumentStore(document)

  const eventBus = new DocumentEventBus()
  const registryCmd = new CommandRegistry()
  registryCmd.register(entityUpdateHandler)

  const dispatcher = new CommandDispatcher(registryCmd, document, eventBus)
  const history = new HistoryStack(dispatcher, document, registryCmd, 200, documentStore)
  dispatcher.addPreHook(history)
  dispatcher.addPostHook(history)

  const selectionManager = new SelectionManager(document, eventBus)
  const viewport = new Viewport(eventBus)

  // Wire the dispatcher's (private) documentStore/document/eventBus the same
  // way `registry.init` would — done synchronously so `execute()` can commit.
  ;(dispatcher as any).document = document
  ;(dispatcher as any).eventBus = eventBus
  ;(dispatcher as any).documentStore = documentStore

  const services = {
    get(name: string) {
      if (name === 'dispatcher') return dispatcher
      if (name === 'selection') return selectionManager
      if (name === 'eventBus') return eventBus
      if (name === 'viewport') return viewport
      if (name === 'documentStore') return documentStore
      if (name === 'history') return history
    },
  }

  const context = { document, services } as unknown as EditorContext

  return { context, document, documentStore, dispatcher, history, selectionManager }
}

function createDocument(graph: any): CampusDocument {
  return {
    schemaVersion: 1,
    version: 0,
    metadata: {
      campusId: graph.campusId ?? 'Campus',
      name: graph.campusId ?? 'Campus',
      description: '',
      lastModified: '',
      editorVersion: '1.0.0',
    },
    buildings: (graph.buildings ?? []).map((b: any) => ({
      id: b.id,
      name: b.name ?? b.id,
      code: b.code ?? '',
      category: 'academic',
      description: '',
      floors: (b.floors ?? []).map((f: any) => ({
        id: f.id ?? `flr-${f.level}`,
        level: f.level,
        label: `${f.level}`,
        elevation: 0,
        rooms: (f.rooms ?? []).map((r: any) => ({ id: r.id, name: r.name ?? r.id, number: r.number ?? '', category: 'classroom', polygon: { points: [] }, capacity: 0, metadata: {} })),
        hallways: [],
        staircases: [],
        elevators: [],
        entrances: [],
        metadata: {},
      })),
      footprint: { points: (b.footprint?.points ?? []).map((p: any) => ({ lat: p.lat, lng: p.lng })) },
      baseElevation: 0,
      height: 10,
      color: b.color ?? '#1C6BEB',
      aliases: [],
      metadata: {},
    })),
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
  }
}

const roomId = 'room-1'
const originalName = 'Original Room'

// Full RoomSelector (EntitySelector requires buildingId + floorId).
function roomSelector(id: string) {
  return {
    type: 'room' as const,
    id: asEntityId(id),
    buildingId: asEntityId('bld-1'),
    floorId: asEntityId('flr-1'),
  }
}

const sampleGraph = {
  name: 'Test Campus',
  buildings: [{
    id: 'bld-1',
    name: 'Main',
    code: 'M',
    category: 'academic',
    floors: [{
      id: 'flr-1',
      level: 0,
      rooms: [{ id: roomId, name: originalName, number: '101', category: 'classroom' }],
    }],
  }],
}

describe('InspectorMigration (M2.3 T6)', () => {
  it('select entity → correct panel + fields', () => {
    const { context, selectionManager } = buildEditorContext(sampleGraph)

    act(() => {
      selectionManager.select(roomSelector(roomId), SelectionOrigin.Programmatic)
    })

    render(
      <EditorProvider context={context}>
        <PropertiesPanel />
      </EditorProvider>,
    )

    expect(screen.getByText('Room')).toBeDefined()
    expect(screen.getByDisplayValue(originalName)).toBeDefined()
  })

  it('edit field → document updated + re-render', () => {
    const { context, selectionManager, documentStore } = buildEditorContext(sampleGraph)

    act(() => {
      selectionManager.select(roomSelector(roomId), SelectionOrigin.Programmatic)
    })

    render(
      <EditorProvider context={context}>
        <PropertiesPanel />
      </EditorProvider>,
    )

    const before = documentStore.version
    const input = screen.getByDisplayValue(originalName) as HTMLInputElement

    fireEvent.change(input, { target: { value: 'Renamed Room' } })

    // (a) input reflects new value
    expect((screen.getByDisplayValue('Renamed Room') as HTMLInputElement).value).toBe('Renamed Room')
    // (b) document mutated in place
    expect(findEntityById(documentStore.document, roomId)?.entity.name).toBe('Renamed Room')
    // (c) version incremented by exactly 1
    expect(documentStore.version).toBe(before + 1)
  })

  it('undo → reverts', () => {
    const { context, selectionManager, documentStore, history } = buildEditorContext(sampleGraph)

    act(() => {
      selectionManager.select(roomSelector(roomId), SelectionOrigin.Programmatic)
    })

    render(
      <EditorProvider context={context}>
        <PropertiesPanel />
      </EditorProvider>,
    )

    fireEvent.change(screen.getByDisplayValue(originalName) as HTMLInputElement, {
      target: { value: 'Renamed Room' },
    })

    const beforeUndo = documentStore.version
    act(() => {
      history.undo()
    })

    // input shows original name again
    expect((screen.getByDisplayValue(originalName) as HTMLInputElement).value).toBe(originalName)
    // document reverted
    expect(findEntityById(documentStore.document, roomId)?.entity.name).toBe(originalName)
    // version incremented again
    expect(documentStore.version).toBe(beforeUndo + 1)
  })

  it('selection persists across edit (invariant)', () => {
    const { context, selectionManager } = buildEditorContext(sampleGraph)

    act(() => {
      selectionManager.select(roomSelector(roomId), SelectionOrigin.Programmatic)
    })

    render(
      <EditorProvider context={context}>
        <PropertiesPanel />
      </EditorProvider>,
    )

    fireEvent.change(screen.getByDisplayValue(originalName) as HTMLInputElement, {
      target: { value: 'Renamed Room' },
    })

    expect(selectionManager.lastSelectedId).toBe(roomId)
  })

  it('document reference stable across edit (invariant)', () => {
    const { context, document, selectionManager } = buildEditorContext(sampleGraph)
    const docRef = document

    act(() => {
      selectionManager.select(roomSelector(roomId), SelectionOrigin.Programmatic)
    })

    render(
      <EditorProvider context={context}>
        <PropertiesPanel />
      </EditorProvider>,
    )

    fireEvent.change(screen.getByDisplayValue(originalName) as HTMLInputElement, {
      target: { value: 'Renamed Room' },
    })

    expect(document).toBe(docRef)
  })

  it('undoing confirmed area/building creation refreshes the legacy render graph', () => {
    const graph = new Graph()
    graph.campusId = 'undo-test-campus'
    useGraphStore.setState({ graph, currentMapId: graph.campusId })

    render(
      <EditorBridge>
        <div />
      </EditorBridge>,
    )

    const context = (window as any).__naviContext as EditorContext
    const dispatcher = context.services.get('dispatcher')!
    const history = context.services.get('history')!

    act(() => {
      dispatcher.execute({
        id: 'area.create',
        label: 'Create Area',
        payload: {
          id: 'undo-area',
          name: 'Undo Area',
          points: [
            { lat: 1, lng: 1 },
            { lat: 1, lng: 1.001 },
            { lat: 1.001, lng: 1.001 },
          ],
          color: '#8B5CF6',
        },
      })
    })

    // Model a previously saved projection so the regression is observable in
    // the same legacy graph that NavigationGraphRenderer uses.
    new GraphAdapter(graph, context.transformer).sync(context.document)
    expect(graph.areas).toHaveLength(1)

    act(() => {
      history.undo()
    })

    expect(context.document.areas ?? []).toHaveLength(0)
    expect(graph.areas).toHaveLength(0)

    act(() => {
      dispatcher.execute({
        id: 'building.create',
        label: 'Create Building',
        payload: {
          id: 'undo-building',
          name: 'Undo Building',
          footprint: {
            points: [
              { lat: 2, lng: 2 },
              { lat: 2, lng: 2.001 },
              { lat: 2.001, lng: 2.001 },
              { lat: 2.001, lng: 2 },
            ],
          },
          floors: [],
        },
      })
    })

    new GraphAdapter(graph, context.transformer).sync(context.document)
    expect(graph.buildings.some((building) => building.id === 'undo-building')).toBe(true)

    act(() => {
      useStudioStore.getState().setActiveBuilding('undo-building')
    })

    act(() => {
      history.undo()
    })

    expect(context.document.buildings.some((building) => building.id === 'undo-building')).toBe(false)
    expect(graph.buildings.some((building) => building.id === 'undo-building')).toBe(false)
    expect(useStudioStore.getState().activeBuildingId).toBeNull()
  })

  it('canvas selection (useStudioStore) → PropertiesPanel shows entity via SelectionBridge', () => {
    const canvasRoomId = 'canvas-room-1'

    // Drive the real bridge from a legacy graph-store snapshot.
    useGraphStore.setState({
      graph: {
        name: 'Canvas Campus',
        buildings: [{
          id: 'b-c1',
          name: 'Canvas Building',
          floors: [{
            id: 'f-c1',
            level: 0,
            rooms: [{ id: canvasRoomId, name: 'Canvas Room', number: 'C1', category: 'classroom' }],
          }],
        }],
      } as any,
    })

    render(
      <EditorBridge>
        <PropertiesPanel />
      </EditorBridge>,
    )

    // Empty state before any canvas selection — nothing shown
    expect(screen.queryByText('Workflow')).toBeNull()

    // Selection arrives from the legacy store (canvas click simulation).
    act(() => {
      useStudioStore.setState({ selectedNodeId: canvasRoomId })
    })

    expect(screen.getByText('Room')).toBeDefined()
    expect(screen.getByDisplayValue('Canvas Room')).toBeDefined()
  })

  it('rebuilds derived road endpoint markers when the bridge mounts over a persisted graph', async () => {
    const graph = new Graph()
    graph.campusId = 'load-sync-campus'
    graph.addTrace({
      id: 'persisted-road',
      name: 'Persisted Road',
      floor: 0,
      points: [
        { lat: 10, lng: 20 },
        { lat: 10.001, lng: 20.001 },
      ],
      type: 'arterial',
    })
    useGraphStore.setState({ graph, currentMapId: graph.campusId })

    render(
      <EditorBridge>
        <div />
      </EditorBridge>,
    )

    await waitFor(() => {
      const endpointMarkers = graph.nodes.filter((node) => node.metadata?.roadEndpoint === true)
      expect(endpointMarkers).toHaveLength(2)
      expect(endpointMarkers.map((node) => node.position)).toEqual([
        { lat: 10, lng: 20 },
        { lat: 10.001, lng: 20.001 },
      ])
    })
  })
})
