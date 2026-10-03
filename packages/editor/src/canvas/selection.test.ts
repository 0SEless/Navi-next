import { describe, it, expect } from 'vitest'
import { handleCanvasClick, type SelectionState } from './selection'
import type { FloorGeometryFloor } from '@navi/core'
import { createCamera, type CameraState, type CanvasSize } from './viewport'

// ── Test data ──

const roomPolygon = {
  points: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 8 },
    { x: 0, y: 8 },
  ],
}

const floor: FloorGeometryFloor = {
  level: 0,
  label: 'Ground Floor',
  elevation: 0,
  offset: { x: 0, y: 0 },
  rooms: [
    { id: 'r1', name: 'Room 101', number: '101', polygon: roomPolygon },
  ],
  hallways: [],
  staircases: [],
  elevators: [],
  doors: [],
  pois: [],
  qrCheckpoints: [],
}

const canvas: CanvasSize = { width: 800, height: 600 }
const camera = createCamera() // center (0,0), zoom 1

// ── Tests ──

describe('handleCanvasClick', () => {
  it('returns null when click misses all geometry', () => {
    // Click at screen center = world (0,0) = inside room r1
    // Click far from center = world (100,100) = outside
    const result = handleCanvasClick(
      { clientX: 700, clientY: 100 },
      camera,
      canvas,
      floor,
    )
    expect(result).toBeNull()
  })

  it('selects a room when click is inside its polygon', () => {
    // World (5, 4) is inside room r1 (0,0)-(10,8)
    // At zoom=1, center=(0,0): screen = (400 + 5, 300 - 4) = (405, 296)
    const result = handleCanvasClick(
      { clientX: 405, clientY: 296 },
      camera,
      canvas,
      floor,
    )
    expect(result).not.toBeNull()
    expect(result!.type).toBe('room')
    expect(result!.id).toBe('r1')
  })

  it('returns SelectionState with correct shape', () => {
    const result = handleCanvasClick(
      { clientX: 405, clientY: 296 },
      camera,
      canvas,
      floor,
    )
    expect(result).toEqual({
      type: 'room',
      id: 'r1',
      name: 'Room 101',
    })
  })

  it('handles zoom correctly', () => {
    const zoomedCamera = createCamera({ zoom: 2 })
    // World (5, 4) at zoom=2: screen = (400 + 5*2, 300 - 4*2) = (410, 292)
    const result = handleCanvasClick(
      { clientX: 410, clientY: 292 },
      zoomedCamera,
      canvas,
      floor,
    )
    expect(result).not.toBeNull()
    expect(result!.id).toBe('r1')
  })

  it('handles pan offset correctly', () => {
    const pannedCamera = createCamera({ center: { x: 5, y: 4 } })
    // Camera centered on (5,4), so world (5,4) = screen center (400, 300)
    const result = handleCanvasClick(
      { clientX: 400, clientY: 300 },
      pannedCamera,
      canvas,
      floor,
    )
    expect(result).not.toBeNull()
    expect(result!.id).toBe('r1')
  })
})
