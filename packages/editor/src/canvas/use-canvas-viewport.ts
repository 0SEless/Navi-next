/**
 * P3-T1: React hook for the Canvas viewport.
 *
 * Manages the <canvas> element lifecycle, camera state, and render loop.
 * Does NOT handle events (P3-T3) or document state (P3-T2).
 */

import { useState, useEffect, useRef, useCallback, type RefObject } from 'react'
import { createCamera, applyCamera, resetCamera, type CameraState, type CanvasSize, type CameraOverrides } from './viewport'
import { renderFloor, renderInteractionOverlays, renderEditingHandles, type FloorRenderContext, type HandleState } from './floor-renderer'
import type { FloorGeometryFloor, LatLng } from '@navi/core'
import type { MapLibreCameraState } from './use-maplibre-camera'

export type { HandleState } from './floor-renderer'

// ── Types ──

export interface CanvasViewportRef {
  canvas: HTMLCanvasElement | null
  camera: CameraState
  setCamera: (camera: CameraState) => void
  canvasSize: CanvasSize
}

export interface UseCanvasViewportResult {
  camera: CameraState
  setCamera: (camera: CameraState | CameraOverrides) => void
  canvasSize: CanvasSize
  containerRef: RefObject<HTMLDivElement | null>
  canvasRef: RefObject<HTMLCanvasElement | null>
}

const DEFAULT_STYLE: FloorRenderContext = {
  strokeStyle: '#333',
  fillStyle: 'rgba(200,200,255,0.3)',
  lineWidth: 1,
}

// ── Hook ──

interface SelectionLike {
  type: string
  id: string
  name: string
}

export function useCanvasViewport(
  viewportRef: RefObject<CanvasViewportRef | null>,
  options?: {
    floor?: FloorGeometryFloor | null
    style?: FloorRenderContext
    selection?: SelectionLike | null
    hover?: SelectionLike | null
    handleState?: HandleState | null
    handleVertices?: Array<{ x: number; y: number; id?: string }>
    externalCamera?: CameraState | null
    maplibreCamera?: MapLibreCameraState | null
    mapOrigin?: LatLng | null
  },
): UseCanvasViewportResult {
  const [camera, setCameraState] = useState<CameraState>(() => createCamera())
  const [canvasSize, setCanvasSize] = useState<CanvasSize>({ width: 0, height: 0 })

  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const cameraRef = useRef<CameraState>(camera)
  const floorRef = useRef<FloorGeometryFloor | null>(options?.floor ?? null)
  const styleRef = useRef<FloorRenderContext>(options?.style ?? DEFAULT_STYLE)
  const selectionRef = useRef<SelectionLike | null>(options?.selection ?? null)
  const hoverRef = useRef<SelectionLike | null>(options?.hover ?? null)
  const handleStateRef = useRef<HandleState | null>(options?.handleState ?? null)
  const handleVerticesRef = useRef<Array<{ x: number; y: number; id?: string }>>(options?.handleVertices ?? [])
  const externalCameraRef = useRef<CameraState | null>(options?.externalCamera ?? null)
  const maplibreCameraRef = useRef<MapLibreCameraState | null>(options?.maplibreCamera ?? null)
  const mapOriginRef = useRef<LatLng | null>(options?.mapOrigin ?? null)
  const rafRef = useRef<number>(0)

  // Keep refs in sync
  useEffect(() => { cameraRef.current = camera }, [camera])
  useEffect(() => { externalCameraRef.current = options?.externalCamera ?? null }, [options?.externalCamera])
  useEffect(() => { maplibreCameraRef.current = options?.maplibreCamera ?? null }, [options?.maplibreCamera])
  useEffect(() => { mapOriginRef.current = options?.mapOrigin ?? null }, [options?.mapOrigin])

  // Bridge transform: convert MapLibre camera to Canvas camera
  const resolveCamera = useCallback((): CameraState => {
    if (externalCameraRef.current) return externalCameraRef.current
    const mlCam = maplibreCameraRef.current
    const origin = mapOriginRef.current
    if (mlCam && origin) {
      const latRad = (origin.lat * Math.PI) / 180
      const metersPerDegLat = 111_320
      const metersPerDegLng = metersPerDegLat * Math.cos(latRad)
      return createCamera({
        center: {
          x: (mlCam.center.lng - origin.lng) * metersPerDegLng,
          y: (mlCam.center.lat - origin.lat) * metersPerDegLat,
        },
        zoom: Math.pow(2, mlCam.zoom - 15),
        rotation: -mlCam.bearing,
      })
    }
    return cameraRef.current
  }, [])
  useEffect(() => { floorRef.current = options?.floor ?? null }, [options?.floor])
  useEffect(() => { styleRef.current = options?.style ?? DEFAULT_STYLE }, [options?.style])
  useEffect(() => { selectionRef.current = options?.selection ?? null }, [options?.selection])
  useEffect(() => { hoverRef.current = options?.hover ?? null }, [options?.hover])
  useEffect(() => { handleStateRef.current = options?.handleState ?? null }, [options?.handleState])
  useEffect(() => { handleVerticesRef.current = options?.handleVertices ?? [] }, [options?.handleVertices])

  // Expose viewport ref
  useEffect(() => {
    if (viewportRef) {
      viewportRef.current = {
        canvas: canvasRef.current,
        camera: cameraRef.current,
        setCamera: (cam: CameraState) => {
          setCameraState(cam)
          cameraRef.current = cam
        },
        canvasSize,
      }
    }
  }, [canvasRef.current, camera, canvasSize])

  // Resize observer
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const { width, height } = entry.contentRect
      setCanvasSize({ width: Math.floor(width), height: Math.floor(height) })
    })

    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  // Sync canvas size to canvas element
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = canvasSize.width
    canvas.height = canvasSize.height
  }, [canvasSize])

  // Render loop
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || canvasSize.width === 0) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let running = true

    const render = () => {
      if (!running) return

      ctx.clearRect(0, 0, canvas.width, canvas.height)

      const cam = resolveCamera()
      const floor = floorRef.current
      const style = styleRef.current
      const sel = selectionRef.current
      const hov = hoverRef.current
      const hs = handleStateRef.current
      const verts = handleVerticesRef.current

      if (floor) {
        ctx.save()
        applyCamera(ctx, cam, canvasSize)
        renderFloor(ctx, floor, style)

        // P4-T4: Render selection and hover overlays
        renderInteractionOverlays(ctx, sel, hov, floor)

        // P4-T2: Render editing handles (vertices + midpoints)
        if (hs && verts.length > 0) {
          renderEditingHandles(ctx, verts, hs)
        }

        ctx.restore()
      }

      rafRef.current = requestAnimationFrame(render)
    }

    rafRef.current = requestAnimationFrame(render)

    return () => {
      running = false
      cancelAnimationFrame(rafRef.current)
    }
  }, [canvasSize])

  // Stable setter that accepts partial overrides
  const setCamera = useCallback((camOrOverrides: CameraState | CameraOverrides) => {
    if ('center' in camOrOverrides && 'zoom' in camOrOverrides && 'rotation' in camOrOverrides) {
      // Full CameraState
      setCameraState(camOrOverrides as CameraState)
    } else {
      // Partial overrides
      setCameraState(prev => createCamera({
        center: (camOrOverrides as CameraOverrides).center ?? prev.center,
        zoom: (camOrOverrides as CameraOverrides).zoom ?? prev.zoom,
        rotation: (camOrOverrides as CameraOverrides).rotation ?? prev.rotation,
      }))
    }
  }, [])

  return {
    camera,
    setCamera,
    canvasSize,
    containerRef,
    canvasRef,
  }
}
