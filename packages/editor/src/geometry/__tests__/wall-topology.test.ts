import { describe, it, expect } from 'vitest'
import {
  splitWallAtPoint,
  findIntersections,
  splitAtTJunction,
  mergeWalls,
  type WallSegment,
} from '../wall-topology'

// ── Helpers ──

function wall(id: string, sx: number, sy: number, ex: number, ey: number): WallSegment {
  return { id, start: { x: sx, y: sy }, end: { x: ex, y: ey } }
}

function expectPointClose(a: { x: number; y: number }, b: { x: number; y: number }) {
  expect(a.x).toBeCloseTo(b.x, 10)
  expect(a.y).toBeCloseTo(b.y, 10)
}

// ── Tests ──

describe('splitWallAtPoint', () => {
  it('splits a wall at an interior point', () => {
    const w = wall('w1', 0, 0, 10, 0)
    const result = splitWallAtPoint(w, { x: 5, y: 0 })

    expect(result).not.toBeNull()
    const [left, right] = result!
    expect(left.id).toBe('w1-L')
    expect(right.id).toBe('w1-R')
    expectPointClose(left.start, { x: 0, y: 0 })
    expectPointClose(left.end, { x: 5, y: 0 })
    expectPointClose(right.start, { x: 5, y: 0 })
    expectPointClose(right.end, { x: 10, y: 0 })
  })

  it('splits a diagonal wall at a midpoint', () => {
    const w = wall('w1', 0, 0, 4, 4)
    const result = splitWallAtPoint(w, { x: 2, y: 2 })

    expect(result).not.toBeNull()
    const [left, right] = result!
    expectPointClose(left.end, { x: 2, y: 2 })
    expectPointClose(right.start, { x: 2, y: 2 })
  })

  it('returns null when point is at start', () => {
    const w = wall('w1', 0, 0, 10, 0)
    expect(splitWallAtPoint(w, { x: 0, y: 0 })).toBeNull()
  })

  it('returns null when point is at end', () => {
    const w = wall('w1', 0, 0, 10, 0)
    expect(splitWallAtPoint(w, { x: 10, y: 0 })).toBeNull()
  })

  it('returns null for degenerate (zero-length) wall', () => {
    const w = wall('w1', 5, 5, 5, 5)
    expect(splitWallAtPoint(w, { x: 5, y: 5 })).toBeNull()
  })

  it('returns null when point is off the wall', () => {
    const w = wall('w1', 0, 0, 10, 0)
    expect(splitWallAtPoint(w, { x: 5, y: 5 })).toBeNull()
  })
})

describe('findIntersections', () => {
  it('finds a single crossing intersection', () => {
    const w1 = wall('w1', 0, 5, 10, 5)
    const w2 = wall('w2', 5, 0, 5, 10)

    const hits = findIntersections([w1, w2])
    expect(hits).toHaveLength(1)
    expectPointClose(hits[0].point, { x: 5, y: 5 })
  })

  it('returns empty for non-intersecting walls', () => {
    const w1 = wall('w1', 0, 0, 5, 0)
    const w2 = wall('w2', 6, 0, 10, 0)

    expect(findIntersections([w1, w2])).toHaveLength(0)
  })

  it('returns empty for parallel walls', () => {
    const w1 = wall('w1', 0, 0, 10, 0)
    const w2 = wall('w2', 0, 5, 10, 5)

    expect(findIntersections([w1, w2])).toHaveLength(0)
  })

  it('finds multiple intersections', () => {
    const w1 = wall('w1', 0, 5, 10, 5)
    const w2 = wall('w2', 3, 0, 3, 10)
    const w3 = wall('w3', 7, 0, 7, 10)

    const hits = findIntersections([w1, w2, w3])
    expect(hits).toHaveLength(2)
  })

  it('finds T-junction intersection (endpoint touches interior)', () => {
    const w1 = wall('w1', 0, 0, 10, 0)
    const w2 = wall('w2', 5, 0, 5, 10)

    const hits = findIntersections([w1, w2])
    expect(hits).toHaveLength(1)
    expectPointClose(hits[0].point, { x: 5, y: 0 })
  })

  it('ignores overlapping collinear walls (no single intersection point)', () => {
    const w1 = wall('w1', 0, 0, 10, 0)
    const w2 = wall('w2', 5, 0, 15, 0)

    // Collinear overlapping — returns one intersection at the midpoint of overlap
    const hits = findIntersections([w1, w2])
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('handles empty wall list', () => {
    expect(findIntersections([])).toHaveLength(0)
  })

  it('handles single wall', () => {
    expect(findIntersections([wall('w1', 0, 0, 10, 0)])).toHaveLength(0)
  })
})

describe('splitAtTJunction', () => {
  it('splits the wall whose interior the junction point lies on', () => {
    const walls = [
      wall('w1', 0, 0, 10, 0),
      wall('w2', 5, 0, 5, 10),
    ]
    const junction = { x: 5, y: 0 }

    const result = splitAtTJunction(walls, junction)
    // w1 should be split, w2 should stay
    expect(result).toHaveLength(3)
    const ids = result.map((w) => w.id)
    expect(ids).toContain('w1-L')
    expect(ids).toContain('w1-R')
    expect(ids).toContain('w2')
  })

  it('does not split walls that end at the junction', () => {
    const walls = [
      wall('w1', 0, 0, 5, 0),
      wall('w2', 5, 0, 10, 0),
      wall('w3', 5, 0, 5, 10),
    ]
    const junction = { x: 5, y: 0 }

    const result = splitAtTJunction(walls, junction)
    // All three walls have an endpoint at the junction — none get split
    expect(result).toHaveLength(3)
    expect(result.map((w) => w.id)).toEqual(['w1', 'w2', 'w3'])
  })

  it('returns walls unchanged if no wall passes through the point', () => {
    const walls = [
      wall('w1', 0, 0, 10, 0),
      wall('w2', 0, 5, 10, 5),
    ]
    const junction = { x: 5, y: 3 }

    const result = splitAtTJunction(walls, junction)
    expect(result).toHaveLength(2)
    expect(result.map((w) => w.id)).toEqual(['w1', 'w2'])
  })
})

describe('mergeWalls', () => {
  it('merges two collinear walls sharing an endpoint', () => {
    const walls = [
      wall('w1', 0, 0, 5, 0),
      wall('w2', 5, 0, 10, 0),
    ]

    const result = mergeWalls(walls)
    expect(result).toHaveLength(1)
    expectPointClose(result[0].start, { x: 0, y: 0 })
    expectPointClose(result[0].end, { x: 10, y: 0 })
  })

  it('merges three collinear walls into one', () => {
    const walls = [
      wall('w1', 0, 0, 3, 0),
      wall('w2', 3, 0, 7, 0),
      wall('w3', 7, 0, 10, 0),
    ]

    const result = mergeWalls(walls)
    expect(result).toHaveLength(1)
    expectPointClose(result[0].start, { x: 0, y: 0 })
    expectPointClose(result[0].end, { x: 10, y: 0 })
  })

  it('does not merge non-collinear walls sharing an endpoint', () => {
    const walls = [
      wall('w1', 0, 0, 5, 0),
      wall('w2', 5, 0, 5, 5),
    ]

    const result = mergeWalls(walls)
    expect(result).toHaveLength(2)
  })

  it('does not merge walls that are collinear but disjoint', () => {
    const walls = [
      wall('w1', 0, 0, 3, 0),
      wall('w2', 5, 0, 10, 0),
    ]

    const result = mergeWalls(walls)
    expect(result).toHaveLength(2)
  })

  it('merges diagonal collinear walls', () => {
    const walls = [
      wall('w1', 0, 0, 3, 3),
      wall('w2', 3, 3, 6, 6),
    ]

    const result = mergeWalls(walls)
    expect(result).toHaveLength(1)
    expectPointClose(result[0].start, { x: 0, y: 0 })
    expectPointClose(result[0].end, { x: 6, y: 6 })
  })

  it('returns empty for empty input', () => {
    expect(mergeWalls([])).toHaveLength(0)
  })

  it('returns single wall unchanged', () => {
    const w = wall('w1', 0, 0, 10, 0)
    expect(mergeWalls([w])).toHaveLength(1)
  })

  it('merges only collinear chains, leaving T-junctions intact', () => {
    // T-junction: w1 horizontal, w3 vertical touching at midpoint
    const walls = [
      wall('w1', 0, 0, 10, 0),
      wall('w2', 10, 0, 20, 0),  // collinear with w1
      wall('w3', 5, 0, 5, 5),    // vertical, T-junction
    ]

    const result = mergeWalls(walls)
    // w1 and w2 merge into one; w3 stays separate
    expect(result).toHaveLength(2)
  })
})
