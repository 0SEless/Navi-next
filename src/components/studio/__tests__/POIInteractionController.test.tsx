import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { act, screen } from '@testing-library/react'
import { CoordinateTransformer, type CampusDocument } from '@navi/core'

const state = vi.hoisted(() => ({
  currentTool: 'poi',
  document: null as CampusDocument | null,
  transformer: null as CoordinateTransformer | null,
  dispatcher: { execute: vi.fn(() => ({ success: true })) },
  history: { undo: vi.fn() },
  selection: { select: vi.fn() },
  toolRegistry: { activeToolId: 'poi', subscribe: vi.fn(() => vi.fn()) },
}))

vi.mock('../useCurrentTool', () => ({
  useCurrentTool: () => state.currentTool,
}))

vi.mock('@navi/editor', async (importOriginal) => {
  const original = await importOriginal() as Record<string, unknown>
  return {
    ...original,
    genId: (prefix: string) => `${prefix}_test_1`,
    useEditor: () => ({
      document: state.document,
      transformer: state.transformer,
      services: {
        get: (name: string) => {
          if (name === 'dispatcher') return state.dispatcher
          if (name === 'history') return state.history
          if (name === 'selection') return state.selection
          if (name === 'toolRegistry') return state.toolRegistry
          return undefined
        },
      },
    }),
  }
})

const studioState = {
  activeFloor: 0,
  activeBuildingId: 'bld-1',
  selectedNodeId: null,
  selectedTraceId: null,
  positionEditTarget: null,
  setSelectedNodeId: vi.fn(),
  setSelectedTraceId: vi.fn(),
  setActiveBuilding: vi.fn(),
  setPositionEditTarget: vi.fn(),
  setVertexEditing: vi.fn(),
  clearTracePoints: vi.fn(),
  clearDrawPoints: vi.fn(),
}

vi.mock('@/store/studio-store', () => ({
  useStudioStore: Object.assign(vi.fn(), {
    getState: vi.fn(() => studioState),
    subscribe: vi.fn(() => vi.fn()),
    setState: vi.fn(),
  }),
}))

vi.mock('@/store/graph-store', () => ({
  useGraphStore: Object.assign(vi.fn(), {
    getState: vi.fn(() => ({ graph: { buildings: [], nodes: [], traces: [], roads: [] } })),
    subscribe: vi.fn(() => vi.fn()),
    setState: vi.fn(),
  }),
}))

import { InteractionController } from '../InteractionController'
import { ImportToast } from '../ImportToast'

afterEach(cleanup)

function makeDocument(): CampusDocument {
  return {
    schemaVersion: 1,
    version: 1,
    metadata: { campusId: 'test', name: 'test', description: '', lastModified: '', editorVersion: '0.1.0' },
    buildings: [{
      id: 'bld-1',
      name: 'Main',
      code: 'MAIN',
      category: 'academic',
      description: '',
      footprint: { points: [{ lat: 14, lng: 121 }, { lat: 14, lng: 121.001 }, { lat: 14.001, lng: 121.001 }, { lat: 14.001, lng: 121 }, { lat: 14, lng: 121 }] },
      baseElevation: 0,
      height: 20,
      color: '#4A90D9',
      aliases: [],
      metadata: {},
      verticalConnectors: [],
      floors: [{
        id: 'floor-1',
        level: 0,
        label: 'Ground',
        elevation: 0,
        height: 3.5,
        rooms: [],
        hallways: [],
        staircases: [],
        elevators: [],
        entrances: [],
        connectorStops: [],
        parametricComponents: [],
        pois: [],
      }],
    }],
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
  } as CampusDocument
}

function makeTransformer(): CoordinateTransformer {
  const transformer = new CoordinateTransformer()
  transformer.registerBuilding({ buildingId: 'bld-1', origin: { lat: 14, lng: 121 }, rotation: 0 })
  transformer.registerFloor('bld-1', 0, { offset: { x: 8, y: -4 }, rotation: 20 })
  return transformer
}

function makeMap(features: any[] = []) {
  const listeners: Record<string, (...args: any[]) => void> = {}
  const canvas = { style: {} as CSSStyleDeclaration }
  return {
    on: vi.fn((event: string, ...args: any[]) => {
      listeners[event] = args.at(-1)
    }),
    off: vi.fn(),
    getCanvas: () => canvas,
    queryRenderedFeatures: vi.fn(() => features),
    getSource: vi.fn(),
    getLayer: vi.fn(() => null),
    setFeatureState: vi.fn(),
    dragPan: { enable: vi.fn(), disable: vi.fn() },
    listeners,
    canvas,
  } as any
}

function makeDrawing() {
  return {
    tracePoints: [],
    drawPoints: [],
    routeWidth: 8,
    roomDrag: null,
    pendingConfirm: null,
    pendingRoadConnection: null as null | Record<string, unknown>,
    addTracePoint: vi.fn(),
    setTracePoints: vi.fn(),
    undoLastPoint: vi.fn(),
    clearTracePoints: vi.fn(),
    addDrawPoint: vi.fn(),
    setDrawPoints: vi.fn(),
    undoLastDrawPoint: vi.fn(),
    clearDrawPoints: vi.fn(),
    setRoomDrag: vi.fn(),
    requestConfirm: vi.fn(),
    confirm: vi.fn(() => []),
    cancel: vi.fn(),
    setRouteWidth: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
    setPendingRoadConnection: vi.fn(),
  }
}

describe('Phase 3A point POI map interaction', () => {
  beforeEach(() => {
    state.currentTool = 'poi'
    state.toolRegistry.activeToolId = 'poi'
    state.document = makeDocument()
    state.transformer = makeTransformer()
    state.dispatcher.execute.mockClear()
    state.selection.select.mockClear()
  })

  it('places a stable floor-local point through poi.create and selects it', () => {
    const map = makeMap()
    render(<InteractionController map={map} drawing={makeDrawing() as any} />)
    const world = { lat: 14.00012, lng: 121.00015 }
    const expectedPosition = state.transformer!.worldToFloorLocal(world, 'bld-1', 0)

    map.listeners.click({ point: { x: 12, y: 18 }, lngLat: world })

    expect(map.dragPan.disable).toHaveBeenCalled()
    expect(state.dispatcher.execute).toHaveBeenCalledWith({
      id: 'poi.create',
      label: 'Create POI',
      payload: {
        id: 'poi_test_1',
        buildingId: 'bld-1',
        floorId: 'floor-1',
        name: '',
        category: 'other',
        position: expectedPosition,
      },
    })
    expect(state.selection.select).toHaveBeenCalledWith({
      type: 'poi',
      id: 'poi_test_1',
      buildingId: 'bld-1',
      floorId: 'floor-1',
    }, 'canvas')
  })

  it('selects a rendered point POI with its building and floor identity', () => {
    state.currentTool = 'select'
    state.toolRegistry.activeToolId = 'select'
    const map = makeMap([{
      layer: { id: 'navi-poi-icon' },
      properties: { id: 'poi-1', buildingId: 'bld-1', floorId: 'floor-1', floor: 0 },
    }])

    render(<InteractionController map={map} drawing={makeDrawing() as any} />)
    map.listeners.click({ point: { x: 12, y: 18 }, lngLat: { lat: 14, lng: 121 } })

    expect(state.selection.select).toHaveBeenCalledWith({
      type: 'poi',
      id: 'poi-1',
      buildingId: 'bld-1',
      floorId: 'floor-1',
    }, 'canvas')
  })

  it('selects a rendered polygon POI through the same scoped selector', () => {
    state.currentTool = 'select'
    state.toolRegistry.activeToolId = 'select'
    const map = makeMap([{
      layer: { id: 'navi-poi-fill' },
      properties: { id: 'poi-polygon', buildingId: 'bld-1', floorId: 'floor-1', floor: 0 },
    }])

    render(<InteractionController map={map} drawing={makeDrawing() as any} />)
    map.listeners.click({ point: { x: 12, y: 18 }, lngLat: { lat: 14, lng: 121 } })

    expect(state.selection.select).toHaveBeenCalledWith({
      type: 'poi',
      id: 'poi-polygon',
      buildingId: 'bld-1',
      floorId: 'floor-1',
    }, 'canvas')
  })

  it('selects a rendered 2.5D POI through the same scoped selector', () => {
    state.currentTool = 'select'
    state.toolRegistry.activeToolId = 'select'
    const map = makeMap([{
      layer: { id: 'navi-poi-extrusion' },
      properties: { id: 'poi-volume', buildingId: 'bld-1', floorId: 'floor-1', floor: 0 },
    }])

    render(<InteractionController map={map} drawing={makeDrawing() as any} />)
    map.listeners.click({ point: { x: 12, y: 18 }, lngLat: { lat: 14, lng: 121 } })

    expect(state.selection.select).toHaveBeenCalledWith({
      type: 'poi',
      id: 'poi-volume',
      buildingId: 'bld-1',
      floorId: 'floor-1',
    }, 'canvas')
  })

  it.each(['navi-poi-fill', 'navi-poi-outline', 'navi-poi-extrusion', 'navi-poi-icon'])(
    'resolves the same POI identity from the %s hit path',
    (layerId) => {
      state.currentTool = 'select'
      state.toolRegistry.activeToolId = 'select'
      const map = makeMap([{
        layer: { id: layerId },
        properties: { id: 'poi-hit', buildingId: 'bld-1', floorId: 'floor-1', floor: 0 },
      }])

      render(<InteractionController map={map} drawing={makeDrawing() as any} />)
      map.listeners.click({ point: { x: 12, y: 18 }, lngLat: { lat: 14, lng: 121 } })

      expect(state.selection.select).toHaveBeenCalledWith({
        type: 'poi',
        id: 'poi-hit',
        buildingId: 'bld-1',
        floorId: 'floor-1',
      }, 'canvas')
    },
  )

  it('applies the crosshair cursor while the POI tool is active', () => {
    const map = makeMap()
    render(<InteractionController map={map} drawing={makeDrawing() as any} />)

    expect(map.getCanvas().style.cursor).toBe('crosshair')
  })

  it('creates an outdoor/campus POI when no building is active', () => {
    const map = makeMap()
    studioState.activeBuildingId = null
    try {
      render(
        <>
          <InteractionController map={map} drawing={makeDrawing() as any} />
          <ImportToast />
        </>,
      )
      act(() => {
        map.listeners.click({ point: { x: 12, y: 18 }, lngLat: { lat: 14.0001, lng: 121.0001 } })
      })

      expect(state.dispatcher.execute).toHaveBeenCalledWith({
        id: 'poi.create',
        label: 'Create POI',
        payload: {
          id: 'poi_test_1',
          scope: 'outdoor',
          name: '',
          category: 'other',
          geometry: { type: 'point', position: { lat: 14.0001, lng: 121.0001 } },
        },
      })
      expect(state.selection.select).toHaveBeenCalledWith({ type: 'poi', id: 'poi_test_1' }, 'canvas')
      // No feedback toast on a successful outdoor placement.
      expect(screen.queryByText(/select a building/i)).toBeNull()
    } finally {
      studioState.activeBuildingId = 'bld-1'
    }
  })

  it('still creates a POI while a road-connection pending decision payload exists', () => {
    const map = makeMap()
    const drawing = makeDrawing()
    drawing.pendingRoadConnection = {
      point: { lat: 14, lng: 121 },
      candidate: { id: 'cand-1', label: 'Main Road', position: { lat: 14, lng: 121 } },
    }

    render(<InteractionController map={map} drawing={drawing as any} />)
    act(() => {
      map.listeners.click({ point: { x: 12, y: 18 }, lngLat: { lat: 14.00012, lng: 121.00015 } })
    })

    expect(state.dispatcher.execute).toHaveBeenCalledWith(expect.objectContaining({ id: 'poi.create' }))
  })
})
