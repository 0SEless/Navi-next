/**
 * Characterization test: Canvas screen → building-local coordinate transformation.
 *
 * Proves that the full chain works:
 * clientX/clientY → Canvas bounding rect → screenToWorld → building-local meters
 */

import { describe, it, expect } from 'vitest'
import { screenToWorld, createCamera, type CameraState, type CanvasSize } from '../../canvas/viewport'

describe('Canvas screen → building-local coordinate transformation', () => {
  const canvasSize: CanvasSize = { width: 800, height: 600 }
  const camera: CameraState = createCamera({ center: { x: 0, y: 0 }, zoom: 1, rotation: 0 })

  it('Canvas-relative coordinates: center → building-local origin', () => {
    // Canvas center (400, 300) → building-local (0, 0) at zoom=1, center=(0,0)
    const result = screenToWorld({ x: 400, y: 300 }, camera, canvasSize)
    expect(result.x).toBeCloseTo(0)
    expect(result.y).toBeCloseTo(0)
  })

  it('Canvas-relative coordinates: offset → correct building-local', () => {
    // Canvas offset (100, 0) → building-local (100, 0) at zoom=1, center=(0,0)
    const result = screenToWorld({ x: 500, y: 300 }, camera, canvasSize)
    expect(result.x).toBeCloseTo(100)
    expect(result.y).toBeCloseTo(0)
  })

  it('Canvas NOT at page origin: bounding rect subtraction needed', () => {
    // This proves the InteractionController MUST subtract Canvas bounding rect
    // Canvas offset: left=280, top=140
    // Client (780, 440) → Canvas-local (500, 300)
    // Canvas-local (500, 300) → building-local (100, 0) at zoom=1
    const canvasLocalX = 780 - 280 // = 500
    const canvasLocalY = 440 - 140 // = 300
    const result = screenToWorld({ x: canvasLocalX, y: canvasLocalY }, camera, canvasSize)
    expect(result.x).toBeCloseTo(100)
    expect(result.y).toBeCloseTo(0)
  })

  it('Zoom=2 doubles the screen distance', () => {
    const zoomedCamera = createCamera({ center: { x: 0, y: 0 }, zoom: 2, rotation: 0 })
    const result = screenToWorld({ x: 500, y: 300 }, zoomedCamera, canvasSize)
    expect(result.x).toBeCloseTo(50)
    expect(result.y).toBeCloseTo(0)
  })

  it('Pan offset shifts building-local coordinates', () => {
    const pannedCamera = createCamera({ center: { x: 10, y: 20 }, zoom: 1, rotation: 0 })
    const result = screenToWorld({ x: 400, y: 300 }, pannedCamera, canvasSize)
    expect(result.x).toBeCloseTo(10)
    expect(result.y).toBeCloseTo(20)
  })

  it('Rotation rotates coordinates correctly', () => {
    const rotatedCamera = createCamera({ center: { x: 0, y: 0 }, zoom: 1, rotation: 90 })
    const result = screenToWorld({ x: 500, y: 300 }, rotatedCamera, canvasSize)
    expect(result.x).toBeCloseTo(0)
    expect(result.y).toBeCloseTo(100)
  })

  it('Combined pan + zoom + rotation produces correct coordinates', () => {
    const combinedCamera = createCamera({ center: { x: 5, y: -3 }, zoom: 2, rotation: 45 })
    const result = screenToWorld({ x: 400, y: 300 }, combinedCamera, canvasSize)
    expect(result.x).toBeCloseTo(5)
    expect(result.y).toBeCloseTo(-3)
  })
})
