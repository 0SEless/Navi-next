import { describe, it, expect } from 'vitest'
import { wallToPolygon, wallToExtrusionFeature, wallsToExtrusionCollection } from '../wall-to-polygon'
import type { Wall } from '@navi/core'

// ── Helpers ──

function wall(id: string, sx: number, sy: number, ex: number, ey: number, thickness = 0.2, height = 3.5): Wall {
  return { id, start: { x: sx, y: sy }, end: { x: ex, y: ey }, thickness, height }
}

// ── Case 1: Horizontal wall → correct polygon ──

describe('W13A Case 1: Horizontal wall produces correct polygon', () => {
  it('offsets perpendicular to horizontal wall by thickness/2', () => {
    const w = wall('w1', 0, 0, 10, 0, 0.2, 3.5)
    const poly = wallToPolygon(w)

    expect(poly.type).toBe('Polygon')
    expect(poly.coordinates).toHaveLength(1) // one ring

    const ring = poly.coordinates[0]
    // 5 points: 4 corners + closure
    expect(ring).toHaveLength(5)

    // Ring must be closed
    const first = ring[0]
    const last = ring[ring.length - 1]
    expect(first[0]).toBeCloseTo(last[0], 10)
    expect(first[1]).toBeCloseTo(last[1], 10)

    // For horizontal wall (0,0)→(10,0): perpendicular is +y direction
    // Expected corners: (0, 0.1), (10, 0.1), (10, -0.1), (0, -0.1), (0, 0.1)
    expect(ring[0][0]).toBeCloseTo(0, 10)   // start x
    expect(ring[0][1]).toBeCloseTo(0.1, 10)  // start y + half thickness (right normal)
    expect(ring[1][0]).toBeCloseTo(10, 10)  // end x
    expect(ring[1][1]).toBeCloseTo(0.1, 10)  // end y + half thickness
    expect(ring[2][0]).toBeCloseTo(10, 10)
    expect(ring[2][1]).toBeCloseTo(-0.1, 10) // end y - half thickness
    expect(ring[3][0]).toBeCloseTo(0, 10)
    expect(ring[3][1]).toBeCloseTo(-0.1, 10) // start y - half thickness
  })
})

// ── Case 2: Vertical wall → correct polygon ──

describe('W13A Case 2: Vertical wall produces correct polygon', () => {
  it('offsets perpendicular to vertical wall by thickness/2', () => {
    const w = wall('w2', 0, 0, 0, 10, 0.2, 3.5)
    const poly = wallToPolygon(w)

    const ring = poly.coordinates[0]
    expect(ring).toHaveLength(5)

    // For vertical wall (0,0)→(0,10): perpendicular is horizontal (±0.1 in x)
    // Expected: (-0.1, 0), (-0.1, 10), (0.1, 10), (0.1, 0), (-0.1, 0)
    expect(ring[0][0]).toBeCloseTo(-0.1, 10)
    expect(ring[0][1]).toBeCloseTo(0, 10)
    expect(ring[1][0]).toBeCloseTo(-0.1, 10)
    expect(ring[1][1]).toBeCloseTo(10, 10)
    expect(ring[2][0]).toBeCloseTo(0.1, 10)
    expect(ring[2][1]).toBeCloseTo(10, 10)
    expect(ring[3][0]).toBeCloseTo(0.1, 10)
    expect(ring[3][1]).toBeCloseTo(0, 10)
  })
})

// ── Case 3: Diagonal wall → correct polygon ──

describe('W13A Case 3: Diagonal wall produces correct polygon', () => {
  it('offsets perpendicular to diagonal wall', () => {
    const w = wall('w3', 0, 0, 5, 5, 0.2, 3.5)
    const poly = wallToPolygon(w)

    const ring = poly.coordinates[0]
    expect(ring).toHaveLength(5)

    // For diagonal (0,0)→(5,5): direction = (5,5), length = 5√2
    // Perpendicular normal = (-5,5) / (5√2) = (-1/√2, 1/√2)
    // Half thickness = 0.1
    // Expected offset: ±0.1 × (-1/√2, 1/√2) ≈ ±(-0.0707, 0.0707)

    const halfThick = 0.1
    const sqrt2 = Math.SQRT2
    const nx = -1 / sqrt2
    const ny = 1 / sqrt2

    // Corner 0: start + nx * half
    expect(ring[0][0]).toBeCloseTo(0 + nx * halfThick, 6)
    expect(ring[0][1]).toBeCloseTo(0 + ny * halfThick, 6)

    // Corner 1: end + nx * half
    expect(ring[1][0]).toBeCloseTo(5 + nx * halfThick, 6)
    expect(ring[1][1]).toBeCloseTo(5 + ny * halfThick, 6)

    // Corner 2: end - nx * half
    expect(ring[2][0]).toBeCloseTo(5 - nx * halfThick, 6)
    expect(ring[2][1]).toBeCloseTo(5 - ny * halfThick, 6)

    // Corner 3: start - nx * half
    expect(ring[3][0]).toBeCloseTo(0 - nx * halfThick, 6)
    expect(ring[3][1]).toBeCloseTo(0 - ny * halfThick, 6)
  })
})

// ── Case 4: Wall height preserved in extrusion feature ──

describe('W13A Case 4: Wall height preserved in extrusion feature', () => {
  it('sets base = floorElevation and height = floorElevation + wall.height', () => {
    const w = wall('w4', 0, 0, 10, 0, 0.2, 3.5)
    const feature = wallToExtrusionFeature(w, 100)

    expect(feature.type).toBe('Feature')
    expect(feature.properties).toBeDefined()
    expect(feature.properties!.id).toBe('w4')
    expect(feature.properties!.base).toBe(100)
    expect(feature.properties!.height).toBe(103.5) // 100 + 3.5
  })

  it('preserves wall.height with different floor elevation', () => {
    const w = wall('w5', 0, 0, 10, 0, 0.15, 4.2)
    const feature = wallToExtrusionFeature(w, 50)

    expect(feature.properties!.base).toBe(50)
    expect(feature.properties!.height).toBeCloseTo(54.2, 10)
  })
})

// ── Case 5: Multiple walls → correct polygons ──

describe('W13A Case 5: Multiple walls produce correct extrusion collection', () => {
  it('produces one feature per wall in the collection', () => {
    const walls = [
      wall('w1', 0, 0, 10, 0),
      wall('w2', 10, 0, 10, 8),
      wall('w3', 10, 8, 0, 8),
      wall('w4', 0, 8, 0, 0),
    ]
    const collection = wallsToExtrusionCollection(walls, 0)

    expect(collection.type).toBe('FeatureCollection')
    expect(collection.features).toHaveLength(4)

    for (const f of collection.features) {
      expect(f.type).toBe('Feature')
      const geom = f.geometry as GeoJSON.Polygon
      expect(geom.type).toBe('Polygon')
      expect(geom.coordinates[0]).toHaveLength(5) // closed 4-corner ring
      // Ring must be closed
      const ring = geom.coordinates[0]
      const first = ring[0]
      const last = ring[ring.length - 1]
      expect(first[0]).toBe(last[0])
      expect(first[1]).toBe(last[1])
    }
  })

  it('each wall gets unique id in feature properties', () => {
    const walls = [
      wall('wall-a', 0, 0, 5, 0),
      wall('wall-b', 5, 0, 5, 5),
    ]
    const collection = wallsToExtrusionCollection(walls, 0)

    const ids = collection.features.map((f) => f.properties!.id)
    expect(ids).toContain('wall-a')
    expect(ids).toContain('wall-b')
  })
})

// ── Degenerate wall handling ──

describe('W13A: Degenerate wall handling', () => {
  it('returns a point-sized polygon for zero-length wall', () => {
    const w = wall('w-degen', 5, 5, 5, 5, 0.2, 3.5)
    const poly = wallToPolygon(w)

    const ring = poly.coordinates[0]
    expect(ring).toHaveLength(5)
    // All corners should be within half-thickness of (5,5)
    for (let i = 0; i < 4; i++) {
      expect(ring[i][0]).toBeGreaterThanOrEqual(5 - 0.1 - 1e-6)
      expect(ring[i][0]).toBeLessThanOrEqual(5 + 0.1 + 1e-6)
      expect(ring[i][1]).toBeGreaterThanOrEqual(5 - 0.1 - 1e-6)
      expect(ring[i][1]).toBeLessThanOrEqual(5 + 0.1 + 1e-6)
    }
  })
})

// ── Polygon does not mutate input ──

describe('W13A: Input immutability', () => {
  it('wallToPolygon does not mutate the input wall', () => {
    const w = wall('w-imm', 0, 0, 10, 0, 0.2, 3.5)
    const origStart = { ...w.start }
    const origEnd = { ...w.end }

    wallToPolygon(w)

    expect(w.start.x).toBe(origStart.x)
    expect(w.start.y).toBe(origStart.y)
    expect(w.end.x).toBe(origEnd.x)
    expect(w.end.y).toBe(origEnd.y)
  })
})
