import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCanvasSelection } from './use-canvas-selection'
import { createCamera, type CameraState, type CanvasSize } from './viewport'
import type { FloorGeometryFloor } from '@navi/core'
import type { HitResult } from './hit-test'

const floor: FloorGeometryFloor = {
  level: 0,
  label: 'Ground',
  elevation: 0,
  offset: { x: 0, y: 0 },
  rooms: [
    {
      id: 'r1',
      name: 'Room 101',
      number: '101',
      polygon: {
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 8 },
          { x: 0, y: 8 },
        ],
      },
    },
  ],
  hallways: [],
  staircases: [],
  elevators: [],
  doors: [],
  pois: [],
  qrCheckpoints: [],
}

const canvasSize: CanvasSize = { width: 800, height: 600 }

describe('useCanvasSelection', () => {
  it('returns selection state and click handler', () => {
    const onSelect = vi.fn()
    const { result } = renderHook(() =>
      useCanvasSelection({
        camera: createCamera(),
        canvasSize,
        floor,
        onSelect,
      })
    )

    expect(result.current.selection).toBeNull()
    expect(typeof result.current.handleClick).toBe('function')
  })

  it('selects entity on click inside room', () => {
    const onSelect = vi.fn()
    const { result } = renderHook(() =>
      useCanvasSelection({
        camera: createCamera(),
        canvasSize,
        floor,
        onSelect,
      })
    )

    // Click at screen center = world (0,0) = inside room r1
    act(() => {
      result.current.handleClick({ x: 400, y: 300 })
    })

    expect(onSelect).toHaveBeenCalledWith('r1')
    expect(result.current.selection).not.toBeNull()
    expect(result.current.selection!.id).toBe('r1')
  })

  it('clears selection on click outside geometry', () => {
    const onSelect = vi.fn()
    const { result } = renderHook(() =>
      useCanvasSelection({
        camera: createCamera(),
        canvasSize,
        floor,
        onSelect,
      })
    )

    // Click far from center = outside all geometry
    act(() => {
      result.current.handleClick({ x: 10, y: 10 })
    })

    expect(onSelect).toHaveBeenCalledWith(null)
    expect(result.current.selection).toBeNull()
  })
})
