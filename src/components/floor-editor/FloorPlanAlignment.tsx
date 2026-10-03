'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import { computeFloorPlanCoords } from '@/lib/floor-plan-coords'
import {
  lngLatToLocalMeters,
  MAX_PLAN_SCALE,
  MIN_PLAN_SCALE,
  resizePlanFromHandle,
  type FloorPlanResizeAlignment,
  type LocalMeters,
  type PlanResizeHandle,
} from '@/lib/floor-plan-resize'
import { resolvePlanAlignment } from '@/lib/floor-plan-transform'

type FloorPlanCoords = [[number, number], [number, number], [number, number], [number, number]]
type PixelPoint = [number, number]

interface FloorPlanAlignmentProps {
  map: maplibregl.Map
  floorPlanCoords: FloorPlanCoords | null
  buildingFp: { lat: number; lng: number }[]
  alignment: FloorPlanResizeAlignment
  floorPlanUrl?: string
  locked?: boolean
  aspectRatioLocked?: boolean
  onAspectRatioLockedChange?: (locked: boolean) => void
  onChange: (align: FloorPlanResizeAlignment) => void
}

type GestureKind = 'move' | 'resize' | 'rotate'

interface Gesture {
  pointerId: number
  kind: GestureKind
  handle?: PlanResizeHandle
  startAlignment: FloorPlanResizeAlignment
  startCoords: FloorPlanCoords
  startPointerLocal?: LocalMeters
  centerPx?: { x: number; y: number }
  startAngle?: number
  latest?: { clientX: number; clientY: number; shiftKey: boolean }
  preview?: FloorPlanResizeAlignment
  rafId: number | null
  target: HTMLElement
  dragPanWasEnabled: boolean
}

const HANDLE_SIZE = 14
const ROTATION_STALK_LENGTH = 30
const HANDLE_ORDER: PlanResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

const HANDLE_LABELS: Record<PlanResizeHandle, string> = {
  nw: 'Resize floor plan top-left corner',
  n: 'Resize floor plan top edge',
  ne: 'Resize floor plan top-right corner',
  e: 'Resize floor plan right edge',
  se: 'Resize floor plan bottom-right corner',
  s: 'Resize floor plan bottom edge',
  sw: 'Resize floor plan bottom-left corner',
  w: 'Resize floor plan left edge',
}

function cloneAlignment(alignment: FloorPlanResizeAlignment): FloorPlanResizeAlignment {
  return {
    ...alignment,
    ...(alignment.offset ? { offset: { x: alignment.offset.x, y: alignment.offset.y } } : {}),
  }
}

function finiteCoordinatePair(pair: readonly [number, number]): boolean {
  return Number.isFinite(pair[0]) && Number.isFinite(pair[1])
}

function validCoords(coords: FloorPlanCoords | null): coords is FloorPlanCoords {
  return Boolean(coords && coords.length === 4 && coords.every(finiteCoordinatePair))
}

function getRaf(callback: FrameRequestCallback): number {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(callback)
  return window.setTimeout(() => callback(performance.now()), 0)
}

function cancelRaf(id: number): void {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id)
  else window.clearTimeout(id)
}

export function FloorPlanAlignment({ map, floorPlanCoords, buildingFp, alignment, floorPlanUrl, locked, aspectRatioLocked: controlledAspectRatioLocked, onAspectRatioLockedChange, onChange }: FloorPlanAlignmentProps) {
  // The URL is intentionally not touched during a gesture. MapLibre receives
  // setCoordinates-only visual previews; image reload/persistence stays outside
  // this interaction component.
  void floorPlanUrl

  const overlayRef = useRef<HTMLDivElement>(null)
  const [cornerPixels, setCornerPixels] = useState<PixelPoint[]>([])
  const [rotationPixels, setRotationPixels] = useState<PixelPoint>([0, 0])
  const [rotationTooltip, setRotationTooltip] = useState<number | null>(null)
  const [scaleTooltip, setScaleTooltip] = useState<number | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [localAspectRatioLocked, setLocalAspectRatioLocked] = useState(true)
  const aspectRatioLocked = controlledAspectRatioLocked ?? localAspectRatioLocked

  const activeAlignRef = useRef(cloneAlignment(alignment))
  const fpcRef = useRef<FloorPlanCoords | null>(floorPlanCoords)
  const bfpRef = useRef(buildingFp)
  const aspectRatioLockedRef = useRef(aspectRatioLocked)
  const gestureRef = useRef<Gesture | null>(null)
  const finishGestureRef = useRef<(mode: 'commit' | 'cancel') => void>(() => undefined)
  const processFrameRef = useRef<() => void>(() => undefined)

  useEffect(() => {
    if (!gestureRef.current) activeAlignRef.current = cloneAlignment(alignment)
  }, [alignment])

  useEffect(() => {
    fpcRef.current = floorPlanCoords
  }, [floorPlanCoords])

  useEffect(() => {
    bfpRef.current = buildingFp
  }, [buildingFp])

  useEffect(() => {
    aspectRatioLockedRef.current = aspectRatioLocked
  }, [aspectRatioLocked])

  const getMapPoint = useCallback((clientX: number, clientY: number) => {
    const rect = map.getContainer().getBoundingClientRect()
    return map.unproject([clientX - rect.left, clientY - rect.top])
  }, [map])

  const projectToOverlay = useCallback((coordinate: [number, number]): PixelPoint => {
    const projected = map.project(coordinate)
    const mapRect = map.getContainer().getBoundingClientRect()
    const overlayRect = overlayRef.current?.getBoundingClientRect()
    return [
      projected.x + mapRect.left - (overlayRect?.left ?? mapRect.left),
      projected.y + mapRect.top - (overlayRect?.top ?? mapRect.top),
    ]
  }, [map])

  const updatePixelPositions = useCallback((coords: FloorPlanCoords | null) => {
    if (!validCoords(coords)) return
    const corners = coords.map(projectToOverlay) as PixelPoint[]
    setCornerPixels(corners)
    const topCenter: PixelPoint = [
      (corners[0][0] + corners[1][0]) / 2,
      (corners[0][1] + corners[1][1]) / 2,
    ]
    const dx = corners[1][0] - corners[0][0]
    const dy = corners[1][1] - corners[0][1]
    const length = Math.hypot(dx, dy) || 1
    setRotationPixels([
      topCenter[0] + (dy / length) * ROTATION_STALK_LENGTH,
      topCenter[1] - (dx / length) * ROTATION_STALK_LENGTH,
    ])
  }, [projectToOverlay])

  useEffect(() => {
    if (!floorPlanCoords) return
    const update = () => updatePixelPositions(fpcRef.current)

    update()
    const t1 = setTimeout(update, 50)
    const t2 = setTimeout(update, 200)
    const t3 = setTimeout(update, 600)
    map.on('move', update)
    map.on('zoom', update)
    map.on('resize', update)
    map.on('render', update)
    map.on('idle', update)

    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
      clearTimeout(t3)
      try {
        map.off('move', update)
        map.off('zoom', update)
        map.off('resize', update)
        map.off('render', update)
        map.off('idle', update)
      } catch {
        // MapLibre may already be disposing its event registry.
      }
    }
  }, [map, floorPlanCoords, updatePixelPositions])

  const applyVisualCoords = useCallback((coords: FloorPlanCoords): boolean => {
    if (!validCoords(coords)) return false
    fpcRef.current = coords
    const source = map.getSource('floor-floorplan') as (maplibregl.ImageSource & {
      setCoordinates?: (coordinates: FloorPlanCoords) => void
    }) | undefined
    if (source && typeof source.setCoordinates === 'function') source.setCoordinates(coords)
    updatePixelPositions(coords)
    return true
  }, [map, updatePixelPositions])

  const applyVisualAlignment = useCallback((nextAlignment: FloorPlanResizeAlignment): boolean => {
    if (bfpRef.current.length < 3) return false
    const coords = computeFloorPlanCoords(bfpRef.current, nextAlignment)
    return applyVisualCoords(coords)
  }, [applyVisualCoords])

  const restoreMapDrag = useCallback((wasEnabled: boolean) => {
    const dragPan = map.dragPan
    if (!dragPan) return
    try {
      if (wasEnabled) dragPan.enable()
      else if (typeof dragPan.isEnabled === 'function' && dragPan.isEnabled()) dragPan.disable()
    } catch {
      // MapLibre may be disposed while a pointer-capture cleanup is running.
    }
  }, [map])

  const applyGestureFrame = useCallback((gesture: Gesture): boolean => {
    const latest = gesture.latest
    if (!latest || bfpRef.current.length < 3) return false

    const current = getMapPoint(latest.clientX, latest.clientY)
    const pointerLocal = lngLatToLocalMeters({ lat: current.lat, lng: current.lng }, bfpRef.current)
    if (!Number.isFinite(pointerLocal.x) || !Number.isFinite(pointerLocal.y)) return false

    let nextAlignment: FloorPlanResizeAlignment
    if (gesture.kind === 'move') {
      const start = gesture.startPointerLocal
      if (!start) return false
      nextAlignment = {
        ...gesture.startAlignment,
        offset: {
          x: (gesture.startAlignment.offset?.x ?? 0) + pointerLocal.x - start.x,
          y: (gesture.startAlignment.offset?.y ?? 0) + pointerLocal.y - start.y,
        },
      }
    } else if (gesture.kind === 'resize' && gesture.handle) {
      nextAlignment = resizePlanFromHandle(
        bfpRef.current,
        gesture.startAlignment,
        gesture.handle,
        pointerLocal,
        { aspectRatioLocked: aspectRatioLockedRef.current },
      )
      if (typeof nextAlignment.scaleX === 'number') setScaleTooltip(nextAlignment.scaleX)
    } else {
      if (!gesture.centerPx || gesture.startAngle == null) return false
      const currentAngle = Math.atan2(gesture.centerPx.y - latest.clientY, latest.clientX - gesture.centerPx.x)
      const deltaDegrees = ((gesture.startAngle - currentAngle) * 180) / Math.PI
      let rotation = (gesture.startAlignment.rotation ?? 0) + deltaDegrees
      rotation = latest.shiftKey ? Math.round(rotation / 15) * 15 : Math.round(rotation * 10) / 10
      setRotationTooltip(rotation)
      nextAlignment = { ...gesture.startAlignment, rotation }
    }

    const coords = computeFloorPlanCoords(bfpRef.current, nextAlignment)
    if (!applyVisualCoords(coords)) return false
    gesture.preview = cloneAlignment(nextAlignment)
    return true
  }, [applyVisualCoords, getMapPoint])

  const processGestureFrame = useCallback(() => {
    const gesture = gestureRef.current
    if (!gesture) return
    gesture.rafId = null
    if (!applyGestureFrame(gesture)) finishGestureRef.current('cancel')
  }, [applyGestureFrame])

  useEffect(() => {
    processFrameRef.current = processGestureFrame
  }, [processGestureFrame])

  const finishGesture = useCallback((mode: 'commit' | 'cancel') => {
    const gesture = gestureRef.current
    if (!gesture) return

    if (gesture.rafId != null) {
      cancelRaf(gesture.rafId)
      gesture.rafId = null
    }
    if (mode === 'commit' && gesture.latest && !applyGestureFrame(gesture)) mode = 'cancel'

    gestureRef.current = null
    setIsDragging(false)
    setRotationTooltip(null)
    setScaleTooltip(null)

    try {
      if (mode === 'commit' && gesture.preview) {
        const committed = cloneAlignment(gesture.preview)
        activeAlignRef.current = committed
        onChange(committed)
      } else {
        fpcRef.current = gesture.startCoords
        applyVisualCoords(gesture.startCoords)
      }
    } finally {
      try {
        gesture.target.releasePointerCapture?.(gesture.pointerId)
      } catch {
        // Pointer capture may already have been released by the browser.
      }
      restoreMapDrag(gesture.dragPanWasEnabled)
    }
  }, [applyGestureFrame, applyVisualCoords, onChange, restoreMapDrag])

  useEffect(() => {
    finishGestureRef.current = finishGesture
  }, [finishGesture])

  useEffect(() => {
    return () => finishGestureRef.current('cancel')
  }, [])

  useEffect(() => {
    if (locked) finishGestureRef.current('cancel')
  }, [locked])

  const beginGesture = useCallback((kind: GestureKind, event: React.PointerEvent<HTMLElement>, handle?: PlanResizeHandle) => {
    if (locked || gestureRef.current || !validCoords(fpcRef.current) || bfpRef.current.length < 3) return
    event.preventDefault()
    event.stopPropagation()

    const target = event.currentTarget
    const startAlignment = cloneAlignment(activeAlignRef.current)
    const startCoords = fpcRef.current
    const dragPan = map.dragPan
    let dragPanWasEnabled = false
    try {
      dragPanWasEnabled = typeof dragPan?.isEnabled === 'function' ? dragPan.isEnabled() : false
      if (dragPanWasEnabled) dragPan.disable()
    } catch {
      dragPanWasEnabled = false
    }

    const gesture: Gesture = {
      pointerId: event.pointerId,
      kind,
      handle,
      startAlignment,
      startCoords: [
        [...startCoords[0]],
        [...startCoords[1]],
        [...startCoords[2]],
        [...startCoords[3]],
      ] as FloorPlanCoords,
      rafId: null,
      target,
      dragPanWasEnabled,
    }

    // Register the transaction before any further validation so every failure
    // (including a non-finite map point) takes the same idempotent cleanup path.
    gestureRef.current = gesture

    const point = getMapPoint(event.clientX, event.clientY)
    const pointerLocal = lngLatToLocalMeters({ lat: point.lat, lng: point.lng }, bfpRef.current)
    if (!Number.isFinite(pointerLocal.x) || !Number.isFinite(pointerLocal.y)) {
      finishGestureRef.current('cancel')
      return
    }
    if (kind === 'move') gesture.startPointerLocal = pointerLocal
    if (kind === 'rotate') {
      // Average projected corners so rotation is centered in the rendered
      // MapLibre frame, even when the geographic projection is non-linear.
      const projectedCorners = startCoords.map((coordinate) => map.project(coordinate))
      const center = projectedCorners.reduce(
        (sum, point) => ({ x: sum.x + point.x / projectedCorners.length, y: sum.y + point.y / projectedCorners.length }),
        { x: 0, y: 0 },
      )
      const mapRect = map.getContainer().getBoundingClientRect()
      gesture.centerPx = { x: center.x + mapRect.left, y: center.y + mapRect.top }
      gesture.startAngle = Math.atan2(gesture.centerPx.y - event.clientY, event.clientX - gesture.centerPx.x)
    }

    setIsDragging(true)
    try {
      target.setPointerCapture?.(event.pointerId)
    } catch {
      finishGestureRef.current('cancel')
    }
  }, [getMapPoint, locked, map])

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const gesture = gestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    event.preventDefault()
    gesture.latest = { clientX: event.clientX, clientY: event.clientY, shiftKey: event.shiftKey }
    if (gesture.rafId == null) {
      // Mark the frame pending before invoking the scheduler. This also keeps
      // synchronous test shims from leaving a stale id after the callback.
      gesture.rafId = -1
      const rafId = getRaf(() => processFrameRef.current())
      if (gestureRef.current === gesture && gesture.rafId === -1) gesture.rafId = rafId
    }
  }, [])

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const gesture = gestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    event.preventDefault()
    gesture.latest = { clientX: event.clientX, clientY: event.clientY, shiftKey: event.shiftKey }
    finishGestureRef.current('commit')
  }, [])

  const handlePointerCancel = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const gesture = gestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    event.preventDefault()
    finishGestureRef.current('cancel')
  }, [])

  const handleLostPointerCapture = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const gesture = gestureRef.current
    if (!gesture || (event.pointerId !== 0 && gesture.pointerId !== event.pointerId)) return
    finishGestureRef.current('cancel')
  }, [])

  useEffect(() => {
    if (locked) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (gestureRef.current) {
          event.preventDefault()
          finishGestureRef.current('cancel')
        }
        return
      }
      if (gestureRef.current || (event.target as HTMLElement)?.tagName === 'INPUT') return
      const step = event.shiftKey ? 2 : 0.5
      let dx = 0
      let dy = 0
      if (event.key === 'ArrowLeft') dx = -step
      else if (event.key === 'ArrowRight') dx = step
      else if (event.key === 'ArrowUp') dy = step
      else if (event.key === 'ArrowDown') dy = -step
      else if (event.key === '=' || event.key === '+') {
        event.preventDefault()
        const resolved = resolvePlanAlignment(activeAlignRef.current)
        const factor = event.shiftKey ? 1.2 : 1.1
        const next = {
          ...activeAlignRef.current,
          scaleX: Math.min(MAX_PLAN_SCALE, resolved.scaleX * factor),
          scaleY: Math.min(MAX_PLAN_SCALE, resolved.scaleY * factor),
        }
        activeAlignRef.current = next
        applyVisualAlignment(next)
        onChange(next)
        return
      } else if (event.key === '-' || event.key === '_') {
        event.preventDefault()
        const resolved = resolvePlanAlignment(activeAlignRef.current)
        const factor = event.shiftKey ? 1 / 1.2 : 1 / 1.1
        const next = {
          ...activeAlignRef.current,
          scaleX: Math.max(MIN_PLAN_SCALE, resolved.scaleX * factor),
          scaleY: Math.max(MIN_PLAN_SCALE, resolved.scaleY * factor),
        }
        activeAlignRef.current = next
        applyVisualAlignment(next)
        onChange(next)
        return
      } else return

      event.preventDefault()
      const next = {
        ...activeAlignRef.current,
        offset: {
          x: (activeAlignRef.current.offset?.x ?? 0) + dx,
          y: (activeAlignRef.current.offset?.y ?? 0) + dy,
        },
      }
      activeAlignRef.current = next
      applyVisualAlignment(next)
      onChange(next)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [applyVisualAlignment, locked, onChange])

  if (locked || !floorPlanCoords || cornerPixels.length < 4) return null

  const [topLeft, topRight, bottomRight, bottomLeft] = cornerPixels
  const handlePixels: Record<PlanResizeHandle, PixelPoint> = {
    nw: topLeft,
    n: [(topLeft[0] + topRight[0]) / 2, (topLeft[1] + topRight[1]) / 2],
    ne: topRight,
    e: [(topRight[0] + bottomRight[0]) / 2, (topRight[1] + bottomRight[1]) / 2],
    se: bottomRight,
    s: [(bottomRight[0] + bottomLeft[0]) / 2, (bottomRight[1] + bottomLeft[1]) / 2],
    sw: bottomLeft,
    w: [(bottomLeft[0] + topLeft[0]) / 2, (bottomLeft[1] + topLeft[1]) / 2],
  }
  const polygonPath = cornerPixels.map(([x, y]) => `${x},${y}`).join(' L ')
  const planClipPath = `polygon(${cornerPixels.map(([x, y]) => `${x}px ${y}px`).join(', ')})`
  const topCenter: PixelPoint = handlePixels.n

  return (
    <div ref={overlayRef} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 5, pointerEvents: 'none' }}>
      <div
        data-testid="floor-plan-body"
        data-plan-drag-surface
        onPointerDown={(event) => beginGesture('move', event)}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onLostPointerCapture={handleLostPointerCapture}
        onWheel={(event) => {
          event.stopPropagation()
          const mapEl = map.getContainer()
          mapEl.dispatchEvent(new WheelEvent('wheel', { deltaX: event.deltaX, deltaY: event.deltaY, deltaMode: event.deltaMode, clientX: event.clientX, clientY: event.clientY, bubbles: true, cancelable: true }))
        }}
        style={{ position: 'absolute', inset: 0, clipPath: planClipPath, WebkitClipPath: planClipPath, cursor: isDragging ? 'grabbing' : 'grab', touchAction: 'none', pointerEvents: 'auto', zIndex: 5 }}
      />

      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 6 }}>
        <path d={`M ${polygonPath} Z`} fill="rgba(59, 130, 246, 0.06)" stroke="#3B82F6" strokeWidth="2.5" strokeDasharray={isDragging ? 'none' : '6,4'} />
        <line x1={topCenter[0]} y1={topCenter[1]} x2={rotationPixels[0]} y2={rotationPixels[1]} stroke="#3B82F6" strokeWidth="2.5" />
      </svg>

      {rotationTooltip != null && <div style={{ position: 'absolute', left: rotationPixels[0], top: rotationPixels[1] - 24, transform: 'translateX(-50%)', background: '#0F172A', color: '#38BDF8', border: '1px solid #38BDF8', borderRadius: 4, padding: '3px 8px', fontSize: 11, fontWeight: 600, pointerEvents: 'none', zIndex: 30 }}>{rotationTooltip}°</div>}
      {scaleTooltip != null && <div style={{ position: 'absolute', left: topCenter[0], top: topCenter[1] + 20, transform: 'translateX(-50%)', background: '#0F172A', color: '#10B981', border: '1px solid #10B981', borderRadius: 4, padding: '3px 8px', fontSize: 11, fontWeight: 600, pointerEvents: 'none', zIndex: 30 }}>Scale: {scaleTooltip}x</div>}

      {HANDLE_ORDER.map((handle) => {
        const [x, y] = handlePixels[handle]
        return (
          <div
            key={handle}
            data-testid={`floor-plan-handle-${handle}`}
            data-handle={handle}
            aria-label={HANDLE_LABELS[handle]}
            onPointerDown={(event) => beginGesture('resize', event, handle)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onLostPointerCapture={handleLostPointerCapture}
            style={{ position: 'absolute', width: HANDLE_SIZE, height: HANDLE_SIZE, borderRadius: 3, background: '#FFFFFF', border: '2.5px solid #3B82F6', boxShadow: '0 2px 8px rgba(0,0,0,0.5)', cursor: `${handle.includes('n') || handle.includes('s') ? (handle.includes('e') || handle.includes('w') ? 'nwse-resize' : 'ns-resize') : 'ew-resize'}`, transform: 'translate(-50%, -50%)', left: x, top: y, pointerEvents: 'auto', zIndex: 10 }}
          />
        )
      })}

      <div
        data-testid="floor-plan-rotation-handle"
        data-handle="rotation"
        aria-label="Rotate floor plan"
        onPointerDown={(event) => beginGesture('rotate', event)}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onLostPointerCapture={handleLostPointerCapture}
        style={{ position: 'absolute', width: 16, height: 16, borderRadius: '50%', background: '#3B82F6', border: '2.5px solid #FFFFFF', boxShadow: '0 2px 8px rgba(0,0,0,0.5)', cursor: 'grab', transform: 'translate(-50%, -50%)', left: rotationPixels[0], top: rotationPixels[1], pointerEvents: 'auto', zIndex: 10 }}
      />

      <button
        type="button"
        data-testid="floor-plan-aspect-lock"
        aria-pressed={aspectRatioLocked}
        aria-label="Lock floor plan aspect ratio"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => {
          const next = !aspectRatioLocked
          if (onAspectRatioLockedChange) onAspectRatioLockedChange(next)
          else setLocalAspectRatioLocked(next)
        }}
        style={{ position: 'absolute', left: topCenter[0], top: topCenter[1] + 28, transform: 'translate(-50%, -50%)', pointerEvents: 'auto', zIndex: 11, fontSize: 11, padding: '2px 6px', borderRadius: 4, border: '1px solid #3B82F6', background: aspectRatioLocked ? '#DBEAFE' : '#FFFFFF', color: '#1D4ED8' }}
      >
        {aspectRatioLocked ? 'Ratio locked' : 'Free ratio'}
      </button>
    </div>
  )
}
