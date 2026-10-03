import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { DrawingOverlay } from '../DrawingOverlay'

vi.mock('../useDrawingSession', () => ({
  useDrawingSessionContext: vi.fn(),
}))

import { useDrawingSessionContext } from '../useDrawingSession'

describe('DrawingOverlay', () => {
  const mockMap = {
    getSource: vi.fn(),
  } as any

  beforeEach(() => {
    vi.clearAllMocks()
    ;(useDrawingSessionContext as any).mockReturnValue({
      tracePoints: [],
      drawPoints: [],
      roomDrag: null,
      pendingConfirm: null,
    })
    mockMap.getSource.mockReturnValue({ setData: vi.fn() })
  })

  it('renders nothing visible', () => {
    const { container } = render(<DrawingOverlay map={mockMap} />)
    expect(container.firstChild).toBeNull()
  })

  it('sets drawing source data when trace points exist', () => {
    const setData = vi.fn()
    mockMap.getSource.mockReturnValue({ setData })

    ;(useDrawingSessionContext as any).mockReturnValue({
      tracePoints: [{ lat: 10, lng: 20 }, { lat: 11, lng: 21 }],
      drawPoints: [],
      roomDrag: null,
      pendingConfirm: null,
    })

    render(<DrawingOverlay map={mockMap} />)

    expect(setData).toHaveBeenCalledTimes(1)
    const data = setData.mock.calls[0][0]
    expect(data.type).toBe('FeatureCollection')
    expect(data.features.length).toBeGreaterThan(0)
  })

  it('skips rendering when pendingConfirm is active', () => {
    const setData = vi.fn()
    mockMap.getSource.mockReturnValue({ setData })

    ;(useDrawingSessionContext as any).mockReturnValue({
      tracePoints: [{ lat: 10, lng: 20 }],
      drawPoints: [],
      roomDrag: null,
      pendingConfirm: { type: 'route', points: [{ lat: 10, lng: 20 }] },
    })

    render(<DrawingOverlay map={mockMap} />)

    expect(setData).not.toHaveBeenCalled()
  })
})
