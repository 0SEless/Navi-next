import { describe, it, expect } from 'vitest'
import { polygonArea, polygonCentroid, pointInPolygon, isClosedPolygon, polygonBBox } from './polygon'
import type { LocalPolygon, WorldPolygon } from '../types'

describe('polygonArea (Shoelace)', () => {
  it('computes area of a 2x2 square', () => {
    const square: LocalPolygon = {
      points: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }, { x: 0, y: 0 }],
    }
    expect(polygonArea(square)).toBe(4)
  })

  it('returns 0 for degenerate polygon', () => {
    const line: LocalPolygon = { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }
    expect(polygonArea(line)).toBe(0)
  })
})

describe('polygonCentroid', () => {
  it('finds centroid of a unit square', () => {
    const square: LocalPolygon = {
      points: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }, { x: 0, y: 0 }],
    }
    const c = polygonCentroid(square) as { x: number; y: number }
    expect(c.x).toBeCloseTo(1, 5)
    expect(c.y).toBeCloseTo(1, 5)
  })
})

describe('pointInPolygon', () => {
  it('detects point inside square', () => {
    const square: LocalPolygon = {
      points: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }, { x: 0, y: 0 }],
    }
    expect(pointInPolygon({ x: 1, y: 1 }, square)).toBe(true)
    expect(pointInPolygon({ x: 3, y: 1 }, square)).toBe(false)
  })
})

describe('isClosedPolygon', () => {
  it('detects closed polygon', () => {
    const closed: LocalPolygon = {
      points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 0, y: 0 }],
    }
    expect(isClosedPolygon(closed)).toBe(true)
  })

  it('detects open polygon', () => {
    const open: LocalPolygon = {
      points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }],
    }
    expect(isClosedPolygon(open)).toBe(false)
  })
})

describe('polygonBBox', () => {
  it('computes bounding box', () => {
    const poly: WorldPolygon = {
      points: [
        { lat: 33.4, lng: -111.93 },
        { lat: 33.43, lng: -111.93 },
        { lat: 33.43, lng: -111.92 },
        { lat: 33.4, lng: -111.92 },
        { lat: 33.4, lng: -111.93 },
      ],
    }
    const bbox = polygonBBox(poly)
    expect(bbox.minX).toBeCloseTo(-111.93, 5)
    expect(bbox.maxX).toBeCloseTo(-111.92, 5)
    expect(bbox.minY).toBeCloseTo(33.4, 5)
    expect(bbox.maxY).toBeCloseTo(33.43, 5)
  })
})
