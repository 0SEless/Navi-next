import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { InteractionController } from '../InteractionController'
import { LAYER_IDS } from '@navi/editor'

const mockHistoryUndo = vi.hoisted(() => vi.fn())
const mockAutosave = vi.hoisted(() => ({
  setTransientInteractionActive: vi.fn(),
}))
const mockHistory = vi.hoisted(() => ({ undo: mockHistoryUndo }))
const mockToolRegistry = vi.hoisted(() => ({
  activeToolId: 'select',
  subscribe: vi.fn(() => vi.fn()),
  undo: mockHistoryUndo,
}))

let currentTool: string | null = 'select'

vi.mock('../useCurrentTool', () => ({
  useCurrentTool: () => currentTool,
}))

vi.mock('@navi/editor', async (importOriginal) => {
  const orig = await importOriginal() as Record<string, unknown>
  return {
    ...orig,
    useEditor: () => ({
      services: {
        get: (id: string) => id === 'autosave' ? mockAutosave : id === 'toolRegistry' ? mockToolRegistry : id === 'history' ? mockHistory : undefined,
      },
    }),
    genId: (prefix: string) => `${prefix}_test_1`,
  }
})

const mockSubscribeFn = vi.fn(() => vi.fn())
const mockDrawing = {
  tracePoints: [],
  drawPoints: [],
  routeWidth: 8,
  roomDrag: null,
  pendingConfirm: null,
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
}
const mockGetStudioState = vi.fn(() => ({
  tool: 'select',
  tracePoints: [],
  drawPoints: [],
  activeFloor: 0,
  activeBuildingId: null,
  selectedNodeId: null,
  adjustBuildingId: null,
  addTracePoint: vi.fn(),
  setTracePoints: vi.fn(),
  setDrawPoints: vi.fn(),
  setSelectedNodeId: vi.fn(),
  setSelectedTraceId: vi.fn(),
  setActiveBuilding: vi.fn(),
  setPendingConfirm: vi.fn(),
  setAdjustBuilding: vi.fn(),
  setVertexEditing: vi.fn(),
  setPositionEditTarget: vi.fn(),
  clearTracePoints: vi.fn(),
  clearDrawPoints: vi.fn(),
}))
const mockGetGraphState = vi.fn(() => ({
  graph: { nodes: [], edges: [], buildings: [], traces: [] } as any,
  addComponent: vi.fn(),
  addComponentWithPolygon: vi.fn(),
  updateBuilding: vi.fn(),
  save: vi.fn(),
}))

vi.mock('@/store/graph-store', () => ({
  useGraphStore: Object.assign(vi.fn(), { getState: vi.fn(), setState: vi.fn(), subscribe: vi.fn() }),
}))

vi.mock('@/store/studio-store', () => ({
  useStudioStore: Object.assign(vi.fn(), { getState: vi.fn(), subscribe: vi.fn() }),
}))

import { useGraphStore } from '@/store/graph-store'
import { useStudioStore } from '@/store/studio-store'

describe('InteractionController', () => {
  const mockOn = vi.fn()
  const mockOff = vi.fn()
  const mockCanvas = {
    style: {},
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }
  const mockMap = {
    on: mockOn,
    off: mockOff,
    getCanvas: () => mockCanvas,
    project: vi.fn(() => ({ x: 0, y: 0 })),
    queryRenderedFeatures: vi.fn(() => []),
    getLayer: vi.fn(() => null),
    getSource: vi.fn(),
    dragPan: { enable: vi.fn(), disable: vi.fn() },
  } as any

  beforeEach(() => {
    vi.clearAllMocks()
    mockHistoryUndo.mockClear()
    mockAutosave.setTransientInteractionActive.mockClear()
    currentTool = 'select'
    mockToolRegistry.activeToolId = 'select'
    ;(useGraphStore as any).getState.mockReturnValue(mockGetGraphState())
    ;(useGraphStore as any).subscribe.mockImplementation(mockSubscribeFn)
    ;(useStudioStore as any).getState.mockReturnValue(mockGetStudioState())
    ;(useStudioStore as any).subscribe.mockImplementation(mockSubscribeFn)
  })

  it('registers map event listeners on mount', () => {
    render(<InteractionController map={mockMap} drawing={mockDrawing} />)
    expect(mockOn).toHaveBeenCalledWith('click', expect.any(Function))
    expect(mockOn).toHaveBeenCalledWith('dblclick', expect.any(Function))
    expect(mockOn).toHaveBeenCalledWith('mousedown', expect.any(Function))
    expect(mockOn).toHaveBeenCalledWith('mousemove', expect.any(Function))
    expect(mockOn).toHaveBeenCalledWith('mouseup', expect.any(Function))
  })

  it('unregisters event listeners on unmount', () => {
    const { unmount } = render(<InteractionController map={mockMap} drawing={mockDrawing} />)
    unmount()
    expect(mockOff).toHaveBeenCalledWith('click', expect.any(Function))
    expect(mockOff).toHaveBeenCalledWith('dblclick', expect.any(Function))
    expect(mockOff).toHaveBeenCalledWith('mousedown', expect.any(Function))
    expect(mockOff).toHaveBeenCalledWith('mousemove', expect.any(Function))
    expect(mockOff).toHaveBeenCalledWith('mouseup', expect.any(Function))
  })

  it('subscribes to drawing context on mount', () => {
    render(<InteractionController map={mockMap} drawing={mockDrawing} />)
    expect(mockDrawing.subscribe).toHaveBeenCalled()
  })

  it('subscribes to studio store on mount', () => {
    render(<InteractionController map={mockMap} drawing={mockDrawing} />)
    expect(useStudioStore.subscribe).toHaveBeenCalled()
  })

  it('subscribes to graph store on mount', () => {
    render(<InteractionController map={mockMap} drawing={mockDrawing} />)
    expect(useGraphStore.subscribe).toHaveBeenCalled()
  })

  it('renders nothing visible', () => {
    const { container } = render(<InteractionController map={mockMap} drawing={mockDrawing} />)
    expect(container.firstChild).toBeNull()
  })

  it('delegates keyboard undo to editor history when no draft points remain', () => {
    render(<InteractionController map={mockMap} drawing={mockDrawing} />)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }))

    expect(mockHistoryUndo).toHaveBeenCalledTimes(1)
  })

  it('notifies the workspace when select clicks empty map space', () => {
    const onEmptyMapClick = vi.fn()
    render(<InteractionController map={mockMap} drawing={mockDrawing} onEmptyMapClick={onEmptyMapClick} />)

    const clickHandler = mockOn.mock.calls.find(([event]) => event === 'click')?.[1]
    clickHandler?.({ point: { x: 12, y: 18 }, lngLat: { lat: 10, lng: 20 } })

    expect(onEmptyMapClick).toHaveBeenCalledTimes(1)
  })

  it('keeps the transient gate inactive for a selected-but-idle building', () => {
    const studioState = mockGetStudioState()
    const graphState = mockGetGraphState()
    ;(useStudioStore as any).getState.mockReturnValue({
      ...studioState,
      positionEditTarget: { type: 'building', id: 'b1' },
    })
    ;(useGraphStore as any).getState.mockReturnValue({
      ...graphState,
      graph: {
        ...graphState.graph,
        buildings: [{ id: 'b1', footprint: [{ lat: 1, lng: 2 }, { lat: 1, lng: 2.001 }] }],
      },
    })
    mockMap.queryRenderedFeatures.mockReturnValue([
      { layer: { id: LAYER_IDS.BUILDING_FILL }, properties: { id: 'b1' } },
    ])

    render(<InteractionController map={mockMap} drawing={mockDrawing} />)
    const mouseDown = mockOn.mock.calls.find(([event]) => event === 'mousedown')?.[1]
    mouseDown?.({ originalEvent: { button: 0 }, point: { x: 0, y: 0 }, lngLat: { lat: 1, lng: 2 } })

    expect(mockAutosave.setTransientInteractionActive).not.toHaveBeenCalledWith(true)
  })

  it('activates and releases the transient gate around a real building drag', () => {
    const studioState = mockGetStudioState()
    const graphState = mockGetGraphState()
    const save = vi.fn(() => Promise.resolve())
    ;(useStudioStore as any).getState.mockReturnValue({
      ...studioState,
      positionEditTarget: { type: 'building', id: 'b1' },
    })
    ;(useGraphStore as any).getState.mockReturnValue({
      ...graphState,
      save,
      graph: {
        ...graphState.graph,
        buildings: [{ id: 'b1', name: 'Building', footprint: [{ lat: 1, lng: 2 }, { lat: 1, lng: 2.001 }] }],
      },
    })
    mockMap.queryRenderedFeatures.mockReturnValue([
      { layer: { id: LAYER_IDS.BUILDING_FILL }, properties: { id: 'b1' } },
    ])

    render(<InteractionController map={mockMap} drawing={mockDrawing} />)
    const mouseDown = mockOn.mock.calls.find(([event]) => event === 'mousedown')?.[1]
    const mouseMove = mockOn.mock.calls.find(([event]) => event === 'mousemove')?.[1]
    const mouseUp = mockOn.mock.calls.find(([event]) => event === 'mouseup')?.[1]
    mouseDown?.({ originalEvent: { button: 0 }, point: { x: 0, y: 0 }, lngLat: { lat: 1, lng: 2 } })
    mouseMove?.({ point: { x: 4, y: 4 }, lngLat: { lat: 1.01, lng: 2.01 } })
    expect(mockAutosave.setTransientInteractionActive).toHaveBeenLastCalledWith(true)

    mouseUp?.({ point: { x: 4, y: 4 }, lngLat: { lat: 1.01, lng: 2.01 } })
    expect(mockAutosave.setTransientInteractionActive).toHaveBeenLastCalledWith(false)
  })

  it('releases the transient gate when a building drag is cancelled', () => {
    const studioState = mockGetStudioState()
    const graphState = mockGetGraphState()
    ;(useStudioStore as any).getState.mockReturnValue({
      ...studioState,
      positionEditTarget: { type: 'building', id: 'b1' },
    })
    ;(useGraphStore as any).getState.mockReturnValue({
      ...graphState,
      graph: {
        ...graphState.graph,
        buildings: [{ id: 'b1', footprint: [{ lat: 1, lng: 2 }, { lat: 1, lng: 2.001 }] }],
      },
    })
    mockMap.queryRenderedFeatures.mockReturnValue([
      { layer: { id: LAYER_IDS.BUILDING_FILL }, properties: { id: 'b1' } },
    ])

    render(<InteractionController map={mockMap} drawing={mockDrawing} />)
    const mouseDown = mockOn.mock.calls.find(([event]) => event === 'mousedown')?.[1]
    const mouseMove = mockOn.mock.calls.find(([event]) => event === 'mousemove')?.[1]
    mouseDown?.({ originalEvent: { button: 0 }, point: { x: 0, y: 0 }, lngLat: { lat: 1, lng: 2 } })
    mouseMove?.({ point: { x: 4, y: 4 }, lngLat: { lat: 1.01, lng: 2.01 } })
    const pointerCancel = mockCanvas.addEventListener.mock.calls.find(([event]) => event === 'pointercancel')?.[1]
    pointerCancel?.({})
    expect(mockAutosave.setTransientInteractionActive).toHaveBeenLastCalledWith(false)

    mouseDown?.({ originalEvent: { button: 0 }, point: { x: 0, y: 0 }, lngLat: { lat: 1, lng: 2 } })
    mouseMove?.({ point: { x: 4, y: 4 }, lngLat: { lat: 1.01, lng: 2.01 } })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

    expect(mockAutosave.setTransientInteractionActive).toHaveBeenLastCalledWith(false)
  })

  it('activates and releases the transient gate around a real vertex drag', () => {
    currentTool = 'route'
    mockToolRegistry.activeToolId = 'route'
    const drawing = { ...mockDrawing, tracePoints: [{ lat: 1, lng: 2 }, { lat: 1.001, lng: 2.001 }] }
    const source = { setData: vi.fn() }
    mockMap.getSource.mockReturnValue(source)
    mockMap.project.mockReturnValue({ x: 0, y: 0 })

    render(<InteractionController map={mockMap} drawing={drawing} />)
    const mouseDown = mockOn.mock.calls.find(([event]) => event === 'mousedown')?.[1]
    const mouseMove = mockOn.mock.calls.find(([event]) => event === 'mousemove')?.[1]
    const mouseUp = mockOn.mock.calls.find(([event]) => event === 'mouseup')?.[1]
    mouseDown?.({ originalEvent: { button: 0 }, point: { x: 0, y: 0 }, lngLat: { lat: 1, lng: 2 } })
    mouseMove?.({ point: { x: 5, y: 5 }, lngLat: { lat: 1.01, lng: 2.01 } })
    expect(mockAutosave.setTransientInteractionActive).toHaveBeenLastCalledWith(true)

    mouseUp?.({ point: { x: 5, y: 5 }, lngLat: { lat: 1.01, lng: 2.01 } })
    expect(mockAutosave.setTransientInteractionActive).toHaveBeenLastCalledWith(false)
  })

  it('releases the transient gate on pointer cancellation and teardown', () => {
    currentTool = 'route'
    mockToolRegistry.activeToolId = 'route'
    const drawing = { ...mockDrawing, tracePoints: [{ lat: 1, lng: 2 }, { lat: 1.001, lng: 2.001 }] }
    mockMap.getSource.mockReturnValue({ setData: vi.fn() })
    mockMap.project.mockReturnValue({ x: 0, y: 0 })

    const { unmount } = render(<InteractionController map={mockMap} drawing={drawing} />)
    const mouseDown = mockOn.mock.calls.find(([event]) => event === 'mousedown')?.[1]
    const mouseMove = mockOn.mock.calls.find(([event]) => event === 'mousemove')?.[1]
    mouseDown?.({ originalEvent: { button: 0 }, point: { x: 0, y: 0 }, lngLat: { lat: 1, lng: 2 } })
    mouseMove?.({ point: { x: 5, y: 5 }, lngLat: { lat: 1.01, lng: 2.01 } })
    const pointerCancel = mockCanvas.addEventListener.mock.calls.find(([event]) => event === 'pointercancel')?.[1]
    pointerCancel?.({})
    expect(mockAutosave.setTransientInteractionActive).toHaveBeenLastCalledWith(false)

    mouseDown?.({ originalEvent: { button: 0 }, point: { x: 0, y: 0 }, lngLat: { lat: 1, lng: 2 } })
    mouseMove?.({ point: { x: 5, y: 5 }, lngLat: { lat: 1.01, lng: 2.01 } })
    unmount()
    expect(mockAutosave.setTransientInteractionActive).toHaveBeenLastCalledWith(false)
  })
  it('keeps map panning enabled while vertex editing is idle', () => {
    currentTool = 'vertex'
    render(<InteractionController map={mockMap} drawing={mockDrawing} />)

    expect(mockMap.dragPan.disable).not.toHaveBeenCalled()
    expect(mockMap.dragPan.enable).toHaveBeenCalled()
  })
})
