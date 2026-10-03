import { describe, it, expect } from 'vitest'
import {
  findWallAtPoint,
  getWallOffset,
  getPointOnWall,
  isPointOnWall,
} from '../wall-attachments'
import type { WallSegment } from '../wall-topology'

// ── Helpers ──

function wall(id: string, sx: number, sy: number, ex: number, ey: number): WallSegment {
  return { id, start: { x: sx, y: sy }, end: { x: ex, y: ey } }
}

function expectPointClose(a: { x: number; y: number }, b: { x: number; y: number }) {
  expect(a.x).toBeCloseTo(b.x, 10)
  expect(a.y).toBeCloseTo(b.y, 10)
}

// ── Tests ──

describe('findWallAtPoint', () => {
  const walls = [
    wall('w1', 0, 0, 10, 0),
    wall('w2', 0, 5, 10, 5),
  ]

  it('finds the nearest wall to a point near its midpoint', () => {
    const result = findWallAtPoint({ x: 5, y: 1 }, walls, 2)
    expect(result).not.toBeNull()
    expect(result!.wall.id).toBe('w1')
    expect(result!.t).toBeCloseTo(0.5, 10)
  })

  it('finds the wall closest when multiple are within threshold', () => {
    const result = findWallAtPoint({ x: 5, y: 2.5 }, walls, 5)
    expect(result).not.toBeNull()
    expect(result!.wall.id).toBe('w1')
  })

  it('returns null when point is far from all walls', () => {
    const result = findWallAtPoint({ x: 5, y: 100 }, walls, 5)
    expect(result).toBeNull()
  })

  it('finds wall near its start endpoint', () => {
    const result = findWallAtPoint({ x: 0.5, y: 0.5 }, walls, 1)
    expect(result).not.toBeNull()
    expect(result!.wall.id).toBe('w1')
  })

  it('finds wall near its end endpoint', () => {
    const result = findWallAtPoint({ x: 9.5, y: 0.5 }, walls, 1)
    expect(result).not.toBeNull()
    expect(result!.wall.id).toBe('w1')
  })

  it('returns null for empty wall list', () => {
    expect(findWallAtPoint({ x: 0, y: 0 }, [], 1)).toBeNull()
  })

  it('skips zero-length walls', () => {
    const degenerate = [wall('w0', 5, 5, 5, 5)]
    expect(findWallAtPoint({ x: 5, y: 5 }, degenerate, 1)).toBeNull()
  })

  it('handles point exactly on wall', () => {
    const result = findWallAtPoint({ x: 5, y: 0 }, walls, 0.01)
    expect(result).not.toBeNull()
    expect(result!.wall.id).toBe('w1')
    expect(result!.t).toBeCloseTo(0.5, 10)
  })
})

describe('getWallOffset', () => {
  it('returns 0 for point at wall start', () => {
    const w = wall('w1', 0, 0, 10, 0)
    expect(getWallOffset(w, { x: 0, y: 0 })).toBeCloseTo(0, 10)
  })

  it('returns full length for point at wall end', () => {
    const w = wall('w1', 0, 0, 10, 0)
    expect(getWallOffset(w, { x: 10, y: 0 })).toBeCloseTo(10, 10)
  })

  it('returns half length for midpoint', () => {
    const w = wall('w1', 0, 0, 10, 0)
    expect(getWallOffset(w, { x: 5, y: 0 })).toBeCloseTo(5, 10)
  })

  it('works for diagonal walls', () => {
    const w = wall('w1', 0, 0, 3, 4)
    // Length = 5, midpoint offset = 2.5
    expect(getWallOffset(w, { x: 1.5, y: 2 })).toBeCloseTo(2.5, 10)
  })

  it('projects perpendicular point onto wall', () => {
    const w = wall('w1', 0, 0, 10, 0)
    // Point is above the wall at x=3 — should project to offset 3
    expect(getWallOffset(w, { x: 3, y: 5 })).toBeCloseTo(3, 10)
  })

  it('clamps when point is before wall start', () => {
    const w = wall('w1', 5, 0, 10, 0)
    expect(getWallOffset(w, { x: 0, y: 0 })).toBeCloseTo(0, 10)
  })

  it('clamps when point is past wall end', () => {
    const w = wall('w1', 0, 0, 5, 0)
    expect(getWallOffset(w, { x: 10, y: 0 })).toBeCloseTo(5, 10)
  })

  it('returns 0 for zero-length wall', () => {
    const w = wall('w1', 5, 5, 5, 5)
    expect(getWallOffset(w, { x: 5, y: 5 })).toBe(0)
  })
})

describe('getPointOnWall', () => {
  it('returns start point at offset 0', () => {
    const w = wall('w1', 0, 0, 10, 0)
    expectPointClose(getPointOnWall(w, 0), { x: 0, y: 0 })
  })

  it('returns end point at full offset', () => {
    const w = wall('w1', 0, 0, 10, 0)
    expectPointClose(getPointOnWall(w, 10), { x: 10, y: 0 })
  })

  it('returns midpoint at half offset', () => {
    const w = wall('w1', 0, 0, 10, 0)
    expectPointClose(getPointOnWall(w, 5), { x: 5, y: 0 })
  })

  it('works for diagonal walls', () => {
    const w = wall('w1', 0, 0, 3, 4)
    expectPointClose(getPointOnWall(w, 2.5), { x: 1.5, y: 2 })
  })

  it('clamps negative offset to start', () => {
    const w = wall('w1', 0, 0, 10, 0)
    expectPointClose(getPointOnWall(w, -5), { x: 0, y: 0 })
  })

  it('clamps offset beyond wall length to end', () => {
    const w = wall('w1', 0, 0, 10, 0)
    expectPointClose(getPointOnWall(w, 20), { x: 10, y: 0 })
  })

  it('returns start for zero-length wall', () => {
    const w = wall('w1', 5, 5, 5, 5)
    expectPointClose(getPointOnWall(w, 0), { x: 5, y: 5 })
  })
})

describe('isPointOnWall', () => {
  it('returns true for point on wall', () => {
    const w = wall('w1', 0, 0, 10, 0)
    expect(isPointOnWall({ x: 5, y: 0 }, w, 0.01)).toBe(true)
  })

  it('returns true for point near wall within threshold', () => {
    const w = wall('w1', 0, 0, 10, 0)
    expect(isPointOnWall({ x: 5, y: 0.5 }, w, 1)).toBe(true)
  })

  it('returns false for point far from wall', () => {
    const w = wall('w1', 0, 0, 10, 0)
    expect(isPointOnWall({ x: 5, y: 10 }, w, 1)).toBe(false)
  })

  it('returns true for point near wall start', () => {
    const w = wall('w1', 0, 0, 10, 0)
    expect(isPointOnWall({ x: 0.5, y: 0.5 }, w, 1)).toBe(true)
  })

  it('returns true for point near wall end', () => {
    const w = wall('w1', 0, 0, 10, 0)
    expect(isPointOnWall({ x: 9.5, y: 0.5 }, w, 1)).toBe(true)
  })

  it('returns false for point beyond wall end but far away', () => {
    const w = wall('w1', 0, 0, 5, 0)
    expect(isPointOnWall({ x: 10, y: 5 }, w, 1)).toBe(false)
  })

  it('handles zero-length wall', () => {
    const w = wall('w1', 5, 5, 5, 5)
    expect(isPointOnWall({ x: 5, y: 5 }, w, 0.01)).toBe(true)
    expect(isPointOnWall({ x: 6, y: 5 }, w, 0.5)).toBe(false)
  })
})
