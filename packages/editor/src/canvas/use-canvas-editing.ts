/**
 * P3-T5: Canvas adapter for vertex/midpoint editing.
 *
 * Wires Canvas pointer events → useEditablePathEditor callbacks.
 * Handles vertex hit-testing, drag detection, and pointer capture.
 */

import { useCallback, useRef } from 'react'
import { screenToWorld, type CameraState, type CanvasSize } from './viewport'
import type { EditablePath } from '@/types/path-types'
import type { EditablePathEditorState } from '@/components/floor-editor/useEditablePathEditor'

// ── Types ──

export interface CanvasEditingAdapterOptions {
  camera: CameraState
  canvasSize: CanvasSize
  path: EditablePath
  editor: EditablePathEditorState
  readOnly: boolean
}

export interface CanvasEditingResult {
  onPointerDown: (e: PointerEvent, canvas: HTMLCanvasElement) => void
  onPointerMove: (e: PointerEvent) => void
  onPointerUp: (e: PointerEvent) => void
}

const VERTEX_HIT_RADIUS = 8 // pixels
const SEGMENT_HIT_RADIUS = 6 // pixels

// ── Hit testing ──

function findNearestVertex(
  screenPoint: { x: number; y: number },
  path: EditablePath,
  camera: CameraState,
  canvasSize: CanvasSize,
): { vertexId: string; distance: number } | null {
  let best: { vertexId: string; distance: number } | null = null

  for (const vertex of path.vertices) {
    const screen = screenToWorld(
      { x: screenPoint.x, y: screenPoint.y },
      camera,
      canvasSize,
    )
    const dx = screen.x - vertex.x
    const dy = screen.y - vertex.y
    const dist = Math.sqrt(dx * dx + dy * dy)

    // Convert hit radius from pixels to world units
    const worldHitRadius = VERTEX_HIT_RADIUS / camera.zoom

    if (dist <= worldHitRadius && (!best || dist < best.distance)) {
      best = { vertexId: vertex.id, distance: dist }
    }
  }

  return best
}

function findNearestSegment(
  screenPoint: { x: number; y: number },
  path: EditablePath,
  camera: CameraState,
  canvasSize: CanvasSize,
): { segmentId: string; distance: number } | null {
  const world = screenToWorld(screenPoint, camera, canvasSize)
  let best: { segmentId: string; distance: number } | null = null

  for (const segment of path.segments) {
    const from = path.vertices.find(v => v.id === segment.startVertexId)
    const to = path.vertices.find(v => v.id === segment.endVertexId)
    if (!from || !to) continue

    // Distance from point to line segment
    const dx = to.x - from.x
    const dy = to.y - from.y
    const lenSq = dx * dx + dy * dy
    if (lenSq === 0) continue

    let t = ((world.x - from.x) * dx + (world.y - from.y) * dy) / lenSq
    t = Math.max(0, Math.min(1, t))

    const projX = from.x + t * dx
    const projY = from.y + t * dy
    const ex = world.x - projX
    const ey = world.y - projY
    const dist = Math.sqrt(ex * ex + ey * ey)

    const worldHitRadius = SEGMENT_HIT_RADIUS / camera.zoom

    if (dist <= worldHitRadius && (!best || dist < best.distance)) {
      best = { segmentId: segment.id, distance: dist }
    }
  }

  return best
}

// ── Adapter ──

export function useCanvasEditingAdapter({
  camera,
  canvasSize,
  path,
  editor,
  readOnly,
}: CanvasEditingAdapterOptions): CanvasEditingResult {
  const pointerRef = useRef<{ x: number; y: number } | null>(null)

  const onPointerDown = useCallback((e: PointerEvent, canvas: HTMLCanvasElement) => {
    if (readOnly) return

    const screenPoint = { x: e.clientX, y: e.clientY }
    pointerRef.current = screenPoint

    // Check vertex first (higher priority)
    const vertexHit = findNearestVertex(screenPoint, path, camera, canvasSize)
    if (vertexHit) {
      editor.onVertexPointerDown(vertexHit.vertexId)
      canvas.setPointerCapture(e.pointerId)
      return
    }

    // Check segment (midpoint insertion)
    const segmentHit = findNearestSegment(screenPoint, path, camera, canvasSize)
    if (segmentHit) {
      editor.onSegmentPointerDown(segmentHit.segmentId)
      canvas.setPointerCapture(e.pointerId)
      return
    }

    // Canvas click (deselect)
    const world = screenToWorld(screenPoint, camera, canvasSize)
    editor.onCanvasClick(world)
  }, [camera, canvasSize, path, editor, readOnly])

  const onPointerMove = useCallback((e: PointerEvent) => {
    if (readOnly) return

    const screenPoint = { x: e.clientX, y: e.clientY }
    const world = screenToWorld(screenPoint, camera, canvasSize)

    // Update hover state
    const vertexHit = findNearestVertex(screenPoint, path, camera, canvasSize)
    editor.setHoveredVertex(vertexHit?.vertexId ?? null)

    if (!vertexHit) {
      const segmentHit = findNearestSegment(screenPoint, path, camera, canvasSize)
      editor.setHoveredSegment(segmentHit?.segmentId ?? null)
    } else {
      editor.setHoveredSegment(null)
    }

    // Forward to editing hook (handles drag)
    editor.onPointerMove(world)
  }, [camera, canvasSize, path, editor, readOnly])

  const onPointerUp = useCallback((e: PointerEvent) => {
    if (readOnly) return
    editor.onPointerUp()
    pointerRef.current = null
  }, [editor, readOnly])

  return { onPointerDown, onPointerMove, onPointerUp }
}
