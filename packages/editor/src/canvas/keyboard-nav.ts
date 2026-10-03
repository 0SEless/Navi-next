/**
 * P2-T6: Keyboard navigation for the Canvas editor.
 *
 * Converts keyboard events → camera state updates (pan, zoom).
 * Pure state transitions; no DOM manipulation.
 */

import { createCamera, type CameraState, type CameraOverrides } from './viewport'

// ── Types ──

export type KeyboardResult = CameraOverrides | null

interface Modifiers {
  shift?: boolean
}

const PAN_STEP = 1 // meters per arrow key press
const PAN_SHIFT_MULTIPLIER = 5
const ZOOM_FACTOR = 1.2

// ── Handler ──

/**
 * Handle a keyboard event and return new camera state overrides.
 * Returns null for unhandled keys.
 */
export function handleKeyboard(
  key: string,
  camera: CameraState,
  modifiers?: Modifiers,
): KeyboardResult {
  const step = (modifiers?.shift ? PAN_STEP * PAN_SHIFT_MULTIPLIER : PAN_STEP)

  switch (key) {
    case 'ArrowLeft':
      return { center: { x: camera.center.x - step, y: camera.center.y } }
    case 'ArrowRight':
      return { center: { x: camera.center.x + step, y: camera.center.y } }
    case 'ArrowUp':
      return { center: { x: camera.center.x, y: camera.center.y + step } }
    case 'ArrowDown':
      return { center: { x: camera.center.x, y: camera.center.y - step } }
    case '+':
    case '=':
      return createCamera({ center: camera.center, zoom: camera.zoom * ZOOM_FACTOR, rotation: camera.rotation })
    case '-':
      return createCamera({ center: camera.center, zoom: camera.zoom / ZOOM_FACTOR, rotation: camera.rotation })
    default:
      return null
  }
}
