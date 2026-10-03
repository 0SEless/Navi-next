import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useRef, useCallback } from 'react'
import { useCanvasViewport, type CanvasViewportRef } from './use-canvas-viewport'
import { createCamera, type CameraState, type CanvasSize } from './viewport'
import type { FloorGeometryFloor } from '@navi/core'

// ── Mock requestAnimationFrame ──

let rafCallbacks: FrameRequestCallback[] = []
let rafId = 0

beforeEach(() => {
  rafCallbacks = []
  rafId = 0
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    rafCallbacks.push(cb)
    return ++rafId
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ── Test data ──

const emptyFloor: FloorGeometryFloor = {
  level: 0,
  label: 'Ground',
  elevation: 0,
  offset: { x: 0, y: 0 },
  rooms: [],
  hallways: [],
  staircases: [],
  elevators: [],
  doors: [],
  pois: [],
  qrCheckpoints: [],
}

// ── Tests ──

describe('useCanvasViewport', () => {
  it('returns camera state and setter', () => {
    const { result } = renderHook(() => {
      const ref = useRef<CanvasViewportRef>(null)
      const viewport = useCanvasViewport(ref)
      return viewport
    })

    expect(result.current.camera).toBeDefined()
    expect(result.current.camera.zoom).toBe(1)
    expect(typeof result.current.setCamera).toBe('function')
  })

  it('setCamera updates camera state', () => {
    const { result } = renderHook(() => {
      const ref = useRef<CanvasViewportRef>(null)
      return useCanvasViewport(ref)
    })

    act(() => {
      result.current.setCamera(createCamera({ zoom: 2 }))
    })

    expect(result.current.camera.zoom).toBe(2)
  })

  it('canvasSize defaults to {0, 0} before mount', () => {
    const { result } = renderHook(() => {
      const ref = useRef<CanvasViewportRef>(null)
      return useCanvasViewport(ref)
    })

    expect(result.current.canvasSize.width).toBe(0)
    expect(result.current.canvasSize.height).toBe(0)
  })
})
