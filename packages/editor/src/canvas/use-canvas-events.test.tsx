import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useRef } from 'react'
import { useCanvasEvents, type CanvasEventHandlers } from './use-canvas-events'
import { createCamera, type CameraState, type CanvasSize } from './viewport'

describe('useCanvasEvents', () => {
  const canvasSize: CanvasSize = { width: 800, height: 600 }
  let camera: CameraState
  let onCameraChange: (cam: CameraState) => void
  let onClick: (wp: { x: number; y: number }) => void
  let onHover: (wp: { x: number; y: number } | null) => void
  let onCameraChangeSpy: ReturnType<typeof vi.fn>
  let onClickSpy: ReturnType<typeof vi.fn>
  let onHoverSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    camera = createCamera()
    onCameraChangeSpy = vi.fn()
    onClickSpy = vi.fn()
    onHoverSpy = vi.fn()
    onCameraChange = onCameraChangeSpy as unknown as (cam: CameraState) => void
    onClick = onClickSpy as unknown as (wp: { x: number; y: number }) => void
    onHover = onHoverSpy as unknown as (wp: { x: number; y: number } | null) => void
  })

  it('returns handlers object', () => {
    const { result } = renderHook(() => {
      const canvasRef = useRef<HTMLCanvasElement>(null)
      const handlers = useCanvasEvents({
        canvasRef,
        camera,
        canvasSize,
        onCameraChange,
        onClick,
        onHover,
      })
      return handlers
    })

    expect(result.current.onPointerDown).toBeDefined()
    expect(result.current.onPointerMove).toBeDefined()
    expect(result.current.onPointerUp).toBeDefined()
    expect(result.current.onWheel).toBeDefined()
  })

  it('wheel event zooms camera', () => {
    const { result } = renderHook(() => {
      const canvasRef = useRef<HTMLCanvasElement>(null)
      return useCanvasEvents({
        canvasRef,
        camera,
        canvasSize,
        onCameraChange,
        onClick,
        onHover,
      })
    })

    const wheelEvent = new WheelEvent('wheel', {
      deltaY: -100,
      clientX: 400,
      clientY: 300,
    })

    act(() => {
      result.current.onWheel(wheelEvent)
    })

    expect(onCameraChangeSpy).toHaveBeenCalled()
    const newCam = onCameraChangeSpy.mock.calls[0][0] as CameraState
    expect(newCam.zoom).toBeGreaterThan(1) // zoomed in
  })

  it('pan changes camera center', () => {
    const { result } = renderHook(() => {
      const canvasRef = useRef<HTMLCanvasElement>(null)
      return useCanvasEvents({
        canvasRef,
        camera,
        canvasSize,
        onCameraChange,
        onClick,
        onHover,
      })
    })

    // Simulate drag: down at (400,300), move to (450,300), up
    const down = new PointerEvent('pointerdown', { clientX: 400, clientY: 300, pointerId: 1 })
    const move = new PointerEvent('pointermove', { clientX: 450, clientY: 300, pointerId: 1 })
    const up = new PointerEvent('pointerup', { clientX: 450, clientY: 300, pointerId: 1 })

    act(() => { result.current.onPointerDown(down) })
    act(() => { result.current.onPointerMove(move) })
    act(() => { result.current.onPointerUp(up) })

    expect(onCameraChangeSpy).toHaveBeenCalled()
  })
})
