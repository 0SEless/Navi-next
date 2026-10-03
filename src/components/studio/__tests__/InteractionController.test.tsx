import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { InteractionController } from '../InteractionController'

const mockHistoryUndo = vi.hoisted(() => vi.fn())

let currentTool: string | null = 'select'

vi.mock('../useCurrentTool', () => ({
  useCurrentTool: () => currentTool,
}))

vi.mock('@navi/editor', async (importOriginal) => {
  const orig = await importOriginal() as Record<string, unknown>
  const mockToolRegistry = {
    activeToolId: 'select',
    subscribe: vi.fn(() => vi.fn()),
    undo: mockHistoryUndo,
  }
  return {
    ...orig,
    useEditor: () => ({
      services: { get: () => mockToolRegistry },
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
  useGraphStore: Object.assign(vi.fn(), { getState: vi.fn(), subscribe: vi.fn() }),
}))

vi.mock('@/store/studio-store', () => ({
  useStudioStore: Object.assign(vi.fn(), { getState: vi.fn(), subscribe: vi.fn() }),
}))

import { useGraphStore } from '@/store/graph-store'
import { useStudioStore } from '@/store/studio-store'

describe('InteractionController', () => {
  const mockOn = vi.fn()
  const mockOff = vi.fn()
  const mockMap = {
    on: mockOn,
    off: mockOff,
    getCanvas: () => ({ style: {} }),
    project: vi.fn(() => ({ x: 0, y: 0 })),
    queryRenderedFeatures: vi.fn(() => []),
    getSource: vi.fn(),
    dragPan: { enable: vi.fn(), disable: vi.fn() },
  } as any

  beforeEach(() => {
    vi.clearAllMocks()
    mockHistoryUndo.mockClear()
    currentTool = 'select'
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

  it('keeps map panning enabled while vertex editing is idle', () => {
    currentTool = 'vertex'
    render(<InteractionController map={mockMap} drawing={mockDrawing} />)

    expect(mockMap.dragPan.enable).toHaveBeenCalled()
    expect(mockMap.dragPan.disable).not.toHaveBeenCalled()
  })
})
