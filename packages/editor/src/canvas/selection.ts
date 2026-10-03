/**
 * P2-T4: Selection wiring for the Canvas editor.
 *
 * Connects screen clicks → coordinate conversion → hit-testing → selection state.
 * Pure state logic; no React, no DOM manipulation.
 */

import type { FloorGeometryFloor } from '@navi/core'
import { screenToWorld, type CameraState, type CanvasSize } from './viewport'
import { hitTestFloor, type HitResult } from './hit-test'

// ── Types ──

export type SelectionState = HitResult | null

// ── Click handler ──

/**
 * Handle a canvas click event: convert screen coordinates to building-local,
 * hit-test against floor geometry, and return the selection state.
 *
 * Returns the hit result (entity to select) or null (clear selection).
 */
export function handleCanvasClick(
  event: { clientX: number; clientY: number },
  camera: CameraState,
  canvas: CanvasSize,
  floor: FloorGeometryFloor,
): SelectionState {
  const world = screenToWorld(
    { x: event.clientX, y: event.clientY },
    camera,
    canvas,
  )
  return hitTestFloor(world, floor)
}
