import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { PreviewOverlay } from '../PreviewOverlay'

vi.mock('../useDrawingSession', () => ({
  useDrawingSessionContext: vi.fn(),
}))

import { useDrawingSessionContext } from '../useDrawingSession'

describe('PreviewOverlay', () => {
  const mockMap = {
    getSource: vi.fn(),
  } as any

  beforeEach(() => {
    vi.clearAllMocks()
    ;(useDrawingSessionContext as any).mockReturnValue({
      pendingConfirm: null,
    })
    mockMap.getSource.mockReturnValue({ setData: vi.fn() })
  })

  it('renders nothing visible', () => {
    const { container } = render(<PreviewOverlay map={mockMap} />)
    expect(container.firstChild).toBeNull()
  })

  it('sets empty data when no pending confirm', () => {
    const setData = vi.fn()
    mockMap.getSource.mockReturnValue({ setData })
    render(<PreviewOverlay map={mockMap} />)
    const data = setData.mock.calls[0][0]
    expect(data.features).toEqual([])
  })

  it('renders LineString for route pending confirm', () => {
    const setData = vi.fn()
    mockMap.getSource.mockReturnValue({ setData })

    ;(useDrawingSessionContext as any).mockReturnValue({
      pendingConfirm: { type: 'route', points: [{ lat: 10, lng: 20 }, { lat: 11, lng: 21 }] },
    })

    render(<PreviewOverlay map={mockMap} />)

    const data = setData.mock.calls[0][0]
    expect(data.features.some((f: any) => f.geometry.type === 'LineString')).toBe(true)
  })

  it('renders Polygon for building pending confirm', () => {
    const setData = vi.fn()
    mockMap.getSource.mockReturnValue({ setData })

    ;(useDrawingSessionContext as any).mockReturnValue({
      pendingConfirm: {
        type: 'building',
        points: [{ lat: 10, lng: 20 }, { lat: 11, lng: 21 }, { lat: 12, lng: 22 }],
      },
    })

    render(<PreviewOverlay map={mockMap} />)

    const data = setData.mock.calls[0][0]
    expect(data.features.some((f: any) => f.geometry.type === 'Polygon')).toBe(true)
  })
})
