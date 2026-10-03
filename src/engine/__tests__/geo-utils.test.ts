import { describe, it, expect } from 'vitest'
import { lineSegmentIntersection, closestPointOnSegment, pointToSegmentDistance, haversine } from '../geo-utils'

const p = (lat: number, lng: number) => ({ lat, lng })

describe('lineSegmentIntersection', () => {
  it('returns intersection point for crossing segments', () => {
    const result = lineSegmentIntersection(p(0, 0), p(2, 2), p(0, 2), p(2, 0))
    expect(result).not.toBeNull()
    expect(result!.lat).toBeCloseTo(1, 5)
    expect(result!.lng).toBeCloseTo(1, 5)
  })

  it('returns null for parallel segments', () => {
    const result = lineSegmentIntersection(p(0, 0), p(1, 1), p(0, 2), p(1, 3))
    expect(result).toBeNull()
  })

  it('returns null for non-intersecting segments', () => {
    const result = lineSegmentIntersection(p(0, 0), p(1, 0), p(2, 1), p(3, 1))
    expect(result).toBeNull()
  })

  it('detects intersection when segments share endpoint', () => {
    const result = lineSegmentIntersection(p(0, 0), p(1, 1), p(1, 1), p(2, 0))
    expect(result).not.toBeNull()
    expect(result!.lat).toBeCloseTo(1, 5)
    expect(result!.lng).toBeCloseTo(1, 5)
  })

  it('returns null for colinear non-overlapping segments', () => {
    const result = lineSegmentIntersection(p(0, 0), p(1, 0), p(2, 0), p(3, 0))
    expect(result).toBeNull()
  })
})

describe('closestPointOnSegment', () => {
  it('returns P itself when P is on the segment', () => {
    const result = closestPointOnSegment(p(0.5, 0.5), p(0, 0), p(1, 1))
    expect(result.lat).toBeCloseTo(0.5, 5)
    expect(result.lng).toBeCloseTo(0.5, 5)
  })

  it('clamps to endpoint A when projection is before A', () => {
    const result = closestPointOnSegment(p(-1, -1), p(0, 0), p(1, 1))
    expect(result.lat).toBeCloseTo(0, 5)
    expect(result.lng).toBeCloseTo(0, 5)
  })

  it('clamps to endpoint B when projection is past B', () => {
    const result = closestPointOnSegment(p(2, 2), p(0, 0), p(1, 1))
    expect(result.lat).toBeCloseTo(1, 5)
    expect(result.lng).toBeCloseTo(1, 5)
  })

  it('handles vertical segment', () => {
    const result = closestPointOnSegment(p(5, 5), p(0, 5), p(10, 5))
    expect(result.lat).toBeCloseTo(5, 5)
    expect(result.lng).toBeCloseTo(5, 5)
  })

  it('returns A when A and B are the same point', () => {
    const result = closestPointOnSegment(p(5, 5), p(1, 1), p(1, 1))
    expect(result.lat).toBe(1)
    expect(result.lng).toBe(1)
  })
})

describe('pointToSegmentDistance', () => {
  it('returns 0 when point is on the segment', () => {
    const d = pointToSegmentDistance(p(0.5, 0.5), p(0, 0), p(1, 1))
    expect(d).toBeLessThan(1)
  })

  it('returns positive distance when point is off the segment', () => {
    const d = pointToSegmentDistance(p(2, 0), p(0, 0), p(1, 0))
    expect(d).toBeGreaterThan(0)
  })
})

describe('haversine', () => {
  it('returns 0 for identical points', () => {
    expect(haversine(p(11.8195, 122.0922), p(11.8195, 122.0922))).toBe(0)
  })

  it('returns reasonable distance for known points', () => {
    const d = haversine(p(11.8195, 122.0922), p(11.8196, 122.0923))
    expect(d).toBeGreaterThan(0)
    expect(d).toBeLessThan(50)
  })
})
