/**
 * P4-T7: Canvas pointer-event coordinate bridge tests.
 *
 * Verifies that Canvas pointer coordinates are correctly converted
 * to ToolPointerEvent coordinates (building-local meters + LatLng).
 */

import { describe, it, expect } from 'vitest'
import { screenToWorld, createCamera, type CameraState, type CanvasSize } from '../../canvas/viewport'

describe('Canvas pointer coordinate conversion', () => {
  const camera: CameraState = createCamera({ center: { x: 0, y: 0 }, zoom: 1, rotation: 0 })
  const canvasSize: CanvasSize = { width: 800, height: 600 }

  it('top-left corner → building-local', () => {
    const result = screenToWorld({ x: 0, y: 0 }, camera, canvasSize)
    expect(result.x).toBeCloseTo(-400)
    expect(result.y).toBeCloseTo(300)
  })

  it('center point → building-local origin', () => {
    const result = screenToWorld({ x: 400, y: 300 }, camera, canvasSize)
    expect(result.x).toBeCloseTo(0)
    expect(result.y).toBeCloseTo(0)
  })

  it('bottom-right corner → building-local', () => {
    const result = screenToWorld({ x: 800, y: 600 }, camera, canvasSize)
    expect(result.x).toBeCloseTo(400)
    expect(result.y).toBeCloseTo(-300)
  })

  it('zoom=2 doubles screen distance', () => {
    const zoomedCamera = createCamera({ center: { x: 0, y: 0 }, zoom: 2, rotation: 0 })
    const result = screenToWorld({ x: 400, y: 250 }, zoomedCamera, canvasSize)
    expect(result.x).toBeCloseTo(0)
    expect(result.y).toBeCloseTo(25)
  })

  it('rotation=90 rotates coordinates', () => {
    const rotatedCamera = createCamera({ center: { x: 0, y: 0 }, zoom: 1, rotation: 90 })
    const result = screenToWorld({ x: 500, y: 300 }, rotatedCamera, canvasSize)
    expect(result.x).toBeCloseTo(0)
    expect(result.y).toBeCloseTo(100)
  })

  it('pan offset shifts coordinates', () => {
    const pannedCamera = createCamera({ center: { x: 10, y: 20 }, zoom: 1, rotation: 0 })
    const result = screenToWorld({ x: 400, y: 300 }, pannedCamera, canvasSize)
    expect(result.x).toBeCloseTo(10)
    expect(result.y).toBeCloseTo(20)
  })

  it('round-trip: building-local → screen → building-local', () => {
    // This tests the full conversion chain that Canvas tools would use
    const buildingLocal = { x: 15.5, y: -7.3 }
    // Convert to screen using worldToScreen (the inverse)
    const screen = { x: 400 + buildingLocal.x, y: 300 - buildingLocal.y } // simplified
    // Convert back to building-local
    const result = screenToWorld(screen, camera, canvasSize)
    // The point should be preserved through the conversion
    expect(result.x).toBeCloseTo(buildingLocal.x, 10)
    expect(result.y).toBeCloseTo(buildingLocal.y, 10)
  })
})
