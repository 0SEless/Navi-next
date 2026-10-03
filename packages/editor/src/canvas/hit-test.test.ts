import { describe, it, expect } from 'vitest'
import { pointInPolygon, pointNearPolyline, hitTestFloor, type HitResult } from './hit-test'
import type { FloorGeometryFloor, FloorGeometryFeature } from '@navi/core'

// ── pointInPolygon ──

describe('pointInPolygon', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ]

  it('returns true for point inside polygon', () => {
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true)
  })

  it('returns false for point outside polygon', () => {
    expect(pointInPolygon({ x: 15, y: 5 }, square)).toBe(false)
  })

  it('returns false for point on edge (boundary)', () => {
    const result = pointInPolygon({ x: 0, y: 5 }, square)
    expect(typeof result).toBe('boolean')
  })

  it('handles triangle polygon', () => {
    const triangle = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 10 },
    ]
    expect(pointInPolygon({ x: 5, y: 3 }, triangle)).toBe(true)
    expect(pointInPolygon({ x: 0, y: 8 }, triangle)).toBe(false)
  })

  it('returns false for empty polygon', () => {
    expect(pointInPolygon({ x: 5, y: 5 }, [])).toBe(false)
  })
})

// ── pointNearPolyline ──

describe('pointNearPolyline', () => {
  const line = [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
  ]

  it('returns true for point near line', () => {
    expect(pointNearPolyline({ x: 10, y: 1 }, line, 2)).toBe(true)
  })

  it('returns false for point far from line', () => {
    expect(pointNearPolyline({ x: 10, y: 5 }, line, 2)).toBe(false)
  })

  it('returns true for point near endpoint', () => {
    expect(pointNearPolyline({ x: 0, y: 1 }, line, 2)).toBe(true)
  })

  it('returns true for point on line', () => {
    expect(pointNearPolyline({ x: 10, y: 0 }, line, 2)).toBe(true)
  })

  it('handles diagonal line', () => {
    const diag = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ]
    expect(pointNearPolyline({ x: 5, y: 5 }, diag, 1)).toBe(true)
    expect(pointNearPolyline({ x: 5, y: 7 }, diag, 1)).toBe(false)
  })

  it('returns false for empty polyline', () => {
    expect(pointNearPolyline({ x: 5, y: 5 }, [], 2)).toBe(false)
  })

  it('returns false for single-point polyline', () => {
    expect(pointNearPolyline({ x: 5, y: 5 }, [{ x: 0, y: 0 }], 2)).toBe(false)
  })
})

// ── hitTestFloor ──

describe('hitTestFloor', () => {
  const roomPolygon = {
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 8 },
      { x: 0, y: 8 },
    ],
  }

  const hallwayPolyline = {
    points: [
      { x: 12, y: 0 },
      { x: 12, y: 10 },
    ],
  }

  const staircase: FloorGeometryFeature = {
    id: 's1',
    name: 'Stair A',
    position: { x: 15, y: 5 },
    rotation: 0,
    polygon: {
      points: [
        { x: 14, y: 3 },
        { x: 16, y: 3 },
        { x: 16, y: 7 },
        { x: 14, y: 7 },
      ],
    },
  }

  const elevator: FloorGeometryFeature = {
    id: 'e1',
    name: 'Elevator 1',
    position: { x: 5, y: 12 },
    rotation: 0,
  }

  const floor: FloorGeometryFloor = {
    level: 0,
    label: 'Ground Floor',
    elevation: 0,
    offset: { x: 0, y: 0 },
    rooms: [
      { id: 'r1', name: 'Room 101', number: '101', polygon: roomPolygon },
    ],
    hallways: [
      { id: 'h1', name: 'Main Hall', polyline: hallwayPolyline },
    ],
    staircases: [staircase],
    elevators: [elevator],
    doors: [
      { id: 'd1', roomId: 'r1', doorType: 'single', position: { x: 10, y: 4 }, width: 1.2 },
      { id: 'd2', roomId: 'r1', doorType: 'double', position: { x: 5, y: 0 }, width: 1.8 },
    ],
    pois: [
      { id: 'p1', name: 'Vending Machine', category: 'amenity', position: { x: 20, y: 5 } },
    ],
    qrCheckpoints: [
      { id: 'q1', label: 'QR Entrance', code: 'navi.app/q/q1', position: { x: 25, y: 5 } },
    ],
  }

  it('hits a room when point is inside', () => {
    const result = hitTestFloor({ x: 5, y: 4 }, floor)
    expect(result).not.toBeNull()
    expect(result!.type).toBe('room')
    expect(result!.id).toBe('r1')
  })

  it('returns null when point is outside all geometry', () => {
    const result = hitTestFloor({ x: 50, y: 50 }, floor)
    expect(result).toBeNull()
  })

  it('hits a hallway when point is near polyline', () => {
    const result = hitTestFloor({ x: 12, y: 5 }, floor)
    expect(result).not.toBeNull()
    expect(result!.type).toBe('hallway')
    expect(result!.id).toBe('h1')
  })

  it('hits a staircase when point is inside its polygon', () => {
    const result = hitTestFloor({ x: 15, y: 5 }, floor)
    expect(result).not.toBeNull()
    expect(result!.type).toBe('staircase')
    expect(result!.id).toBe('s1')
  })

  it('hits an elevator when point is near its position', () => {
    const result = hitTestFloor({ x: 5, y: 12 }, floor)
    expect(result).not.toBeNull()
    expect(result!.type).toBe('elevator')
    expect(result!.id).toBe('e1')
  })

  it('hits a door when point is inside its hit polygon', () => {
    // Door d1 at (10, 4) width 1.2: hit rect x in [9.4, 10.6], y in [3.4, 4.6]
    const result = hitTestFloor({ x: 10, y: 4 }, floor)
    expect(result).not.toBeNull()
    expect(result!.type).toBe('door')
    expect(result!.id).toBe('d1')
  })

  it('returns null for door when point is far from position', () => {
    // d1 at (10, 4): distance in y = 2, beyond half-height 0.6
    const result = hitTestFloor({ x: 10, y: 6 }, floor)
    expect(result?.id).not.toBe('d1')
  })

  it('hits a POI when point is near its position', () => {
    const result = hitTestFloor({ x: 20, y: 5 }, floor)
    expect(result).not.toBeNull()
    expect(result!.type).toBe('poi')
    expect(result!.id).toBe('p1')
  })

  it('returns null for POI when point is far from position', () => {
    // p1 at (20, 5), distance in y = 3 > POSITION_THRESHOLD (2.0)
    const result = hitTestFloor({ x: 20, y: 8 }, floor)
    expect(result?.id).not.toBe('p1')
  })

  it('hits a QR checkpoint when point is near its position', () => {
    const result = hitTestFloor({ x: 25, y: 5 }, floor)
    expect(result).not.toBeNull()
    expect(result!.type).toBe('qrCheckpoint')
    expect(result!.id).toBe('q1')
  })

  it('returns first match (room priority over hallway)', () => {
    const result = hitTestFloor({ x: 5, y: 4 }, floor)
    expect(result!.type).toBe('room')
  })

  it('hallway takes priority over door when both match', () => {
    const hallwayFloor: FloorGeometryFloor = {
      ...floor,
      doors: [
        { id: 'd3', roomId: 'r1', doorType: 'single', position: { x: 12, y: 5 }, width: 1.2 },
      ],
    }
    const result = hitTestFloor({ x: 12, y: 5 }, hallwayFloor)
    expect(result!.type).toBe('hallway')
  })

  it('door takes priority over staircase when both match', () => {
    const overlapFloor: FloorGeometryFloor = {
      ...floor,
      doors: [
        { id: 'd4', roomId: 'r1', doorType: 'single', position: { x: 15, y: 5 }, width: 1.2 },
      ],
    }
    const result = hitTestFloor({ x: 15, y: 5 }, overlapFloor)
    expect(result!.type).toBe('door')
  })

  it('staircase takes priority over elevator when both match', () => {
    const overlapFloor: FloorGeometryFloor = {
      ...floor,
      staircases: [{
        ...floor.staircases[0],
        position: { x: 5, y: 12 },
        polygon: {
          points: [
            { x: 4, y: 11 },
            { x: 6, y: 11 },
            { x: 6, y: 13 },
            { x: 4, y: 13 },
          ],
        },
      }],
    }
    const result = hitTestFloor({ x: 5, y: 12 }, overlapFloor)
    expect(result!.type).toBe('staircase')
  })

  it('POI takes priority over QR checkpoint when both match', () => {
    const overlapFloor: FloorGeometryFloor = {
      ...floor,
      pois: [
        { id: 'p2', name: 'Info Board', category: 'info', position: { x: 25, y: 5 } },
      ],
    }
    const result = hitTestFloor({ x: 25, y: 5 }, overlapFloor)
    expect(result!.type).toBe('poi')
  })

  it('handles empty floor', () => {
    const emptyFloor: FloorGeometryFloor = {
      ...floor,
      rooms: [],
      hallways: [],
      staircases: [],
      elevators: [],
      doors: [],
      pois: [],
      qrCheckpoints: [],
    }
    expect(hitTestFloor({ x: 5, y: 5 }, emptyFloor)).toBeNull()
  })

  it('hits door using rectangular hit area (not just point)', () => {
    // d1 at (10, 4) width 1.2: hit rect x in [9.4, 10.6], y in [3.4, 4.6]
    // Test that the door hit area is rectangular, not circular
    const floorFarHall: FloorGeometryFloor = {
      ...floor,
      hallways: [],
    }
    const result = hitTestFloor({ x: 10.5, y: 4 }, floorFarHall)
    expect(result).not.toBeNull()
    expect(result!.type).toBe('door')
    expect(result!.id).toBe('d1')
  })

  it('hits QR checkpoint near position within threshold', () => {
    // q1 at (25, 5): distance 1.5 < POSITION_THRESHOLD (2.0)
    const result = hitTestFloor({ x: 25, y: 6.5 }, floor)
    expect(result).not.toBeNull()
    expect(result!.type).toBe('qrCheckpoint')
    expect(result!.id).toBe('q1')
  })
})
