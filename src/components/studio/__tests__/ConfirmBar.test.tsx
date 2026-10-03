import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ConfirmBar } from '../ConfirmBar'
import type { DrawingSessionValue } from '../useDrawingSession'

let currentTool: string | null = 'route'

vi.mock('../useCurrentTool', () => ({
  useCurrentTool: () => currentTool,
}))

function createMockDrawing(overrides?: Partial<DrawingSessionValue>): DrawingSessionValue {
  return {
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
    confirm: vi.fn(),
    cancel: vi.fn(),
    setRouteWidth: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    ...overrides,
  }
}

describe('ConfirmBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    currentTool = 'route'
  })

  it('renders tool label for route', () => {
    render(<ConfirmBar drawing={createMockDrawing({ tracePoints: [{ lat: 1, lng: 2 }] })} />)
    expect(screen.getByText('Campus route')).toBeDefined()
  })

  it('renders tool label for building', () => {
    currentTool = 'building'
    render(<ConfirmBar drawing={createMockDrawing({ drawPoints: [{ lat: 1, lng: 2 }] })} />)
    expect(screen.getByText('Building footprint')).toBeDefined()
  })

  it('renders OSM import confirmation controls', () => {
    currentTool = 'import-osm'
    const requestConfirm = vi.fn()
    const drawing = createMockDrawing({
      drawPoints: [{ lat: 1, lng: 2 }, { lat: 1, lng: 3 }, { lat: 2, lng: 3 }],
      requestConfirm,
    })
    render(<ConfirmBar drawing={drawing} />)
    expect(screen.getByText('Import from OSM')).toBeDefined()
    expect(screen.getByText(/3 points/)).toBeDefined()
    fireEvent.click(screen.getByText('Confirm'))
    expect(requestConfirm).toHaveBeenCalledWith('import-osm')
  })

  it('renders campus boundary confirmation controls', () => {
    currentTool = 'set-boundary'
    const requestConfirm = vi.fn()
    const drawing = createMockDrawing({
      drawPoints: [{ lat: 1, lng: 2 }, { lat: 1, lng: 3 }, { lat: 2, lng: 3 }],
      requestConfirm,
    })
    render(<ConfirmBar drawing={drawing} />)
    expect(screen.getByText('Campus boundary')).toBeDefined()
    fireEvent.click(screen.getByText('Confirm'))
    expect(requestConfirm).toHaveBeenCalledWith('set-boundary')
  })

  it('shows point count', () => {
    const drawing = createMockDrawing({ tracePoints: [{ lat: 1, lng: 2 }] })
    render(<ConfirmBar drawing={drawing} />)
    expect(screen.getByText(/1 point/)).toBeDefined()
  })

  it('shows "need 2" when route has < 2 points', () => {
    const drawing = createMockDrawing({ tracePoints: [{ lat: 1, lng: 2 }] })
    render(<ConfirmBar drawing={drawing} />)
    expect(screen.getByText(/need 2/)).toBeDefined()
  })

  it('fires requestConfirm when confirm button clicked and canConfirm is true', () => {
    const requestConfirm = vi.fn()
    const drawing = createMockDrawing({
      tracePoints: [{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }],
      requestConfirm,
    })
    render(<ConfirmBar drawing={drawing} />)
    fireEvent.click(screen.getByText('Confirm'))
    expect(requestConfirm).toHaveBeenCalledTimes(1)
  })

  it('disables confirm button when canConfirm is false (route < 2 points)', () => {
    const drawing = createMockDrawing({ tracePoints: [{ lat: 1, lng: 2 }] })
    render(<ConfirmBar drawing={drawing} />)
    const btn = screen.getByText('Confirm').closest('button')
    expect(btn?.disabled).toBe(true)
  })

  it('fires cancel when cancel button clicked', () => {
    const cancel = vi.fn()
    const drawing = createMockDrawing({ tracePoints: [{ lat: 1, lng: 2 }], cancel })
    render(<ConfirmBar drawing={drawing} />)
    fireEvent.click(screen.getByText('Cancel'))
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('shows width controls for route tool', () => {
    const drawing = createMockDrawing({ tracePoints: [{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }], routeWidth: 8 })
    render(<ConfirmBar drawing={drawing} />)
    expect(screen.getByText('8')).toBeDefined()
  })

  it('does not crash when no points and undo clicked', () => {
    const drawing = createMockDrawing({ tracePoints: [{ lat: 1, lng: 2 }] })
    render(<ConfirmBar drawing={drawing} />)
    const undoBtn = screen.getByRole('button', { name: /undo/i })
    fireEvent.click(undoBtn)
  })

  it('returns null when tool is not a drawing tool', () => {
    currentTool = 'select'
    const { container } = render(<ConfirmBar drawing={createMockDrawing({ tracePoints: [{ lat: 1, lng: 2 }] })} />)
    expect(container.innerHTML).toBe('')
  })

  it('returns null when tool is drawing but no points placed', () => {
    const { container } = render(<ConfirmBar drawing={createMockDrawing()} />)
    expect(container.innerHTML).toBe('')
  })
})
