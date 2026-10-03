import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { ViewportController } from '../ViewportController'

vi.mock('@navi/editor', () => ({
  useEditor: vi.fn(),
}))

import { useEditor } from '@navi/editor'

describe('ViewportController', () => {
  const mockFlyTo = vi.fn()
  const mockFitBounds = vi.fn()
  const mockEaseTo = vi.fn()
  const mockConsume = vi.fn()
  const mockOn = vi.fn()

  const mockMap = {
    flyTo: mockFlyTo,
    fitBounds: mockFitBounds,
    easeTo: mockEaseTo,
  } as any

  beforeEach(() => {
    vi.clearAllMocks()
    mockOn.mockReturnValue(vi.fn())
    ;(useEditor as any).mockReturnValue({
      services: {
        get: (id: string) => {
          if (id === 'viewport') return {
            consumePendingCommand: mockConsume,
          }
          if (id === 'eventBus') return {
            on: mockOn,
          }
          return null
        },
      },
    })
  })

  it('calls map.flyTo on initial mount when center provided', () => {
    render(<ViewportController map={mockMap} initialCenter={{ lat: 10, lng: 20 }} />)
    expect(mockFlyTo).toHaveBeenCalledWith(
      expect.objectContaining({ center: [20, 10], zoom: 17 })
    )
  })

  it('does not flyTo on initial mount when no center provided', () => {
    render(<ViewportController map={mockMap} />)
    expect(mockFlyTo).not.toHaveBeenCalled()
  })

  it('subscribes to viewport.changed events', () => {
    render(<ViewportController map={mockMap} />)
    expect(mockOn).toHaveBeenCalledWith('viewport.changed', expect.any(Function))
  })

  it('executes flyTo command when consumed', () => {
    mockConsume.mockReturnValueOnce({ type: 'flyTo', center: { lat: 5, lng: 15 }, zoom: 18 })
    render(<ViewportController map={mockMap} />)
    expect(mockFlyTo).toHaveBeenCalledWith(
      expect.objectContaining({ center: [15, 5], zoom: 18 })
    )
  })

  it('executes fitBounds command when consumed', () => {
    mockConsume.mockReturnValueOnce({
      type: 'fitBounds',
      bounds: { sw: { lat: 0, lng: 0 }, ne: { lat: 1, lng: 1 } },
      padding: 50,
    })
    render(<ViewportController map={mockMap} />)
    expect(mockFitBounds).toHaveBeenCalled()
  })

  it('executes easeTo command when consumed', () => {
    mockConsume.mockReturnValueOnce({
      type: 'easeTo',
      center: { lat: 5, lng: 5 },
      zoom: 16,
    })
    render(<ViewportController map={mockMap} />)
    expect(mockEaseTo).toHaveBeenCalledWith(
      expect.objectContaining({ center: [5, 5], zoom: 16 })
    )
  })
})
