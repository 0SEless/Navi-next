/**
 * P3-T4: Selection hook for the Canvas editor.
 *
 * Wires Canvas click → hit-test → selection store → Inspector.
 * Uses the same entity IDs as the existing editor selection system.
 */

import { useState, useCallback } from 'react'
import { hitTestFloor, type HitResult } from './hit-test'
import { screenToWorld, type CameraState, type CanvasSize } from './viewport'
import type { FloorGeometryFloor } from '@navi/core'

// ── Types ──

export interface UseCanvasSelectionOptions {
  camera: CameraState
  canvasSize: CanvasSize
  floor: FloorGeometryFloor
  onSelect: (id: string | null) => void
}

export interface UseCanvasSelectionResult {
  selection: HitResult | null
  handleClick: (screenPoint: { x: number; y: number }) => void
}

// ── Hook ──

export function useCanvasSelection({
  camera,
  canvasSize,
  floor,
  onSelect,
}: UseCanvasSelectionOptions): UseCanvasSelectionResult {
  const [selection, setSelection] = useState<HitResult | null>(null)

  const handleClick = useCallback((screenPoint: { x: number; y: number }) => {
    if (canvasSize.width === 0) return

    const world = screenToWorld(screenPoint, camera, canvasSize)
    const hit = hitTestFloor(world, floor)

    setSelection(hit)
    onSelect(hit?.id ?? null)
  }, [camera, canvasSize, floor, onSelect])

  return { selection, handleClick }
}
