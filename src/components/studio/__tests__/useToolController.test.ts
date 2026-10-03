import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

vi.mock('@navi/editor', () => ({
  useEditor: vi.fn(),
}))

import { useEditor } from '@navi/editor'
import { useToolController } from '../useToolController'

describe('useToolController', () => {
  let mockExecute: ReturnType<typeof vi.fn>
  let mockUnsubscribe: ReturnType<typeof vi.fn>
  let mockOn: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    mockExecute = vi.fn()
    mockUnsubscribe = vi.fn()
    mockOn = vi.fn().mockReturnValue(mockUnsubscribe)

    ;(useEditor as any).mockReturnValue({
      services: {
        get: (id: string) => {
          if (id === 'dispatcher') return { execute: mockExecute }
          if (id === 'eventBus') return { on: mockOn }
          return null
        },
      },
    })
  })

  it('subscribes to tool completion events', () => {
    renderHook(() => useToolController())
    expect(mockOn).toHaveBeenCalled()
  })

  it('unsubscribes on unmount', () => {
    const { unmount } = renderHook(() => useToolController())
    unmount()
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1)
  })

  it('executes command when tool completes', () => {
    renderHook(() => useToolController())

    const callback = mockOn.mock.calls[0][1]

    callback({ command: 'room.create', payload: { name: 'Room 101' } })

    expect(mockExecute).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'room.create' }),
      expect.any(Object),
    )
  })

  it('ignores events without a command', () => {
    renderHook(() => useToolController())

    const callback = mockOn.mock.calls[0][1]
    callback({ payload: { name: 'Room' } })
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('ignores null/undefined results', () => {
    renderHook(() => useToolController())

    const callback = mockOn.mock.calls[0][1]
    callback(null)
    expect(mockExecute).not.toHaveBeenCalled()
  })
})
