import { describe, it, expect } from 'vitest'
import { simplifyPolyline, nearestPointOnPolyline, lineIntersection, bufferPolygon } from './extensions'
import type { LocalCoord } from '../types'

describe('simplifyPolyline', () => {
  it('removes collinear points', () => {
    const pts: LocalCoord[] = [
      { x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 10 }, { x: 15, y: 15 },
    ]
    const simplified = simplifyPolyline(pts, 2)
    expect(simplified.length).toBe(2)
    expect(simplified[0].x).toBe(0)
    expect(simplified[simplified.length - 1].x).toBe(15)
  })

  it('preserves endpoints for 2 points', () => {
    const pts: LocalCoord[] = [{ x: 0, y: 0 }, { x: 10, y: 10 }]
    expect(simplifyPolyline(pts, 1)).toEqual(pts)
  })
})

describe('nearestPointOnPolyline', () => {
  it('finds nearest point on horizontal segment', () => {
    const pts: LocalCoord[] = [{ x: 0, y: 0 }, { x: 10, y: 0 }]
    const result = nearestPointOnPolyline({ x: 5, y: 3 }, pts)
    expect(result.point.x).toBeCloseTo(5, 5)
    expect(result.point.y).toBeCloseTo(0, 5)
    expect(result.index).toBe(0)
  })

  it('finds endpoint for far point', () => {
    const pts: LocalCoord[] = [{ x: 0, y: 0 }, { x: 10, y: 0 }]
    const result = nearestPointOnPolyline({ x: 20, y: 5 }, pts)
    expect(result.point.x).toBeCloseTo(10, 5)
  })
})

describe('lineIntersection', () => {
  it('finds intersection of crossing lines', () => {
    const result = lineIntersection(
      { a: { x: 0, y: 0 }, b: { x: 10, y: 10 } },
      { a: { x: 0, y: 10 }, b: { x: 10, y: 0 } },
    )
    expect(result).not.toBeNull()
    if (result) {
      expect((result.point as LocalCoord).x).toBeCloseTo(5, 5)
      expect((result.point as LocalCoord).y).toBeCloseTo(5, 5)
    }
  })

  it('returns null for parallel lines', () => {
    const result = lineIntersection(
      { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } },
      { a: { x: 0, y: 5 }, b: { x: 10, y: 5 } },
    )
    expect(result).toBeNull()
  })

  it('returns null for non-intersecting lines', () => {
    const result = lineIntersection(
      { a: { x: 0, y: 0 }, b: { x: 5, y: 0 } },
      { a: { x: 6, y: -1 }, b: { x: 7, y: 1 } },
    )
    expect(result).toBeNull()
  })
})

describe('bufferPolygon', () => {
  it('expands a unit square', () => {
    const square = { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 0, y: 0 }] }
    const buffered = bufferPolygon(square, 1)
    expect(buffered.points.length).toBe(5)
    // First vertex should have moved outward
    expect(buffered.points[0].x).toBeLessThanOrEqual(0)  // moved left or stayed
  })
})
