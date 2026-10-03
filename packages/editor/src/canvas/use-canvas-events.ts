/**
 * P3-T3: Pointer/wheel event handling for the Canvas viewport.
 *
 * Attaches event listeners to the canvas element and converts
 * pointer events → camera state updates (pan, zoom) and
 * hit-test results (click, hover).
 */

import { useEffect, useRef, useCallback, type RefObject } from 'react'
import { createCamera, screenToWorld, type CameraState, type CanvasSize } from './viewport'

// ── Types ──

export interface CanvasEventHandlers {
  onPointerDown: (e: PointerEvent) => void
  onPointerMove: (e: PointerEvent) => void
  onPointerUp: (e: PointerEvent) => void
  onWheel: (e: WheelEvent) => void
}

export interface UseCanvasEventsOptions {
  canvasRef: RefObject<HTMLCanvasElement | null>
  camera: CameraState
  canvasSize: CanvasSize
  onCameraChange: (camera: CameraState) => void
  onClick?: (worldPoint: { x: number; y: number }) => void
  onHover?: (worldPoint: { x: number; y: number } | null) => void
}

// ── Constants ──

const ZOOM_FACTOR = 1.1
const ZOOM_MIN = 0.1
const ZOOM_MAX = 50

// ── Hook ──

export function useCanvasEvents({
  canvasRef,
  camera,
  canvasSize,
  onCameraChange,
  onClick,
  onHover,
}: UseCanvasEventsOptions): CanvasEventHandlers {
  const cameraRef = useRef(camera)
  const isDragging = useRef(false)
  const lastPointer = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => { cameraRef.current = camera }, [camera])

  const onPointerDown = useCallback((e: PointerEvent) => {
    isDragging.current = true
    lastPointer.current = { x: e.clientX, y: e.clientY }
    canvasRef.current?.setPointerCapture(e.pointerId)
  }, [canvasRef])

  const onPointerMove = useCallback((e: PointerEvent) => {
    // Hover (always fires)
    if (onHover && canvasSize.width > 0) {
      const world = screenToWorld(
        { x: e.clientX, y: e.clientY },
        cameraRef.current,
        canvasSize,
      )
      onHover(world)
    }

    // Pan (only during drag)
    if (!isDragging.current || !lastPointer.current) return

    const dx = e.clientX - lastPointer.current.x
    const dy = e.clientY - lastPointer.current.y
    lastPointer.current = { x: e.clientX, y: e.clientY }

    const cam = cameraRef.current
    const rad = -(cam.rotation * Math.PI) / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)

    // Convert screen delta to building-local delta
    const localDx = (dx * cos + dy * sin) / cam.zoom
    const localDy = (-dx * sin + dy * cos) / cam.zoom

    const newCam = createCamera({
      center: {
        x: cam.center.x - localDx,
        y: cam.center.y + localDy, // Y inverted
      },
      zoom: cam.zoom,
      rotation: cam.rotation,
    })

    onCameraChange(newCam)
  }, [canvasSize, onCameraChange, onHover])

  const onPointerUp = useCallback((e: PointerEvent) => {
    if (!isDragging.current) return

    const wasDrag = lastPointer.current && (
      Math.abs(e.clientX - lastPointer.current.x) > 3 ||
      Math.abs(e.clientY - lastPointer.current.y) > 3
    )

    isDragging.current = false
    lastPointer.current = null
    canvasRef.current?.releasePointerCapture(e.pointerId)

    // Click (only if not a drag)
    if (!wasDrag && onClick && canvasSize.width > 0) {
      const world = screenToWorld(
        { x: e.clientX, y: e.clientY },
        cameraRef.current,
        canvasSize,
      )
      onClick(world)
    }
  }, [canvasRef, canvasSize, onClick])

  const onWheel = useCallback((e: WheelEvent) => {
    e.preventDefault()
    const cam = cameraRef.current
    const factor = e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR
    const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, cam.zoom * factor))

    const newCam = createCamera({
      center: cam.center,
      zoom: newZoom,
      rotation: cam.rotation,
    })

    onCameraChange(newCam)
  }, [onCameraChange])

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onWheel,
  }
}
