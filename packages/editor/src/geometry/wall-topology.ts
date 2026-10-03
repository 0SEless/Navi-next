import type { Point2D } from '../canvas/viewport'

// ── Types ──

export interface WallSegment {
  readonly id: string
  readonly start: Point2D
  readonly end: Point2D
  /** Original authored wall ID, retained when this segment is split. */
  readonly sourceWallId?: string
}

export interface Intersection {
  point: Point2D
  wallA: WallSegment
  wallB: WallSegment
  tA: number // parameter on wallA (0–1)
  tB: number // parameter on wallB (0–1)
}

// ── Geometry helpers ──

const EPSILON = 1e-10

function cross2d(a: Point2D, b: Point2D): number {
  return a.x * b.y - a.y * b.x
}

function sub(a: Point2D, b: Point2D): Point2D {
  return { x: a.x - b.x, y: a.y - b.y }
}

function add(a: Point2D, b: Point2D): Point2D {
  return { x: a.x + b.x, y: a.y + b.y }
}

function scale(a: Point2D, s: number): Point2D {
  return { x: a.x * s, y: a.y * s }
}

function length(a: Point2D, b: Point2D): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  return Math.sqrt(dx * dx + dy * dy)
}

function pointsEqual(a: Point2D, b: Point2D): boolean {
  return Math.abs(a.x - b.x) < EPSILON && Math.abs(a.y - b.y) < EPSILON
}

function distanceToSegment(p: Point2D, seg: WallSegment): number {
  const dx = seg.end.x - seg.start.x
  const dy = seg.end.y - seg.start.y
  const lenSq = dx * dx + dy * dy
  if (lenSq < EPSILON * EPSILON) return length(p, seg.start)

  let t = ((p.x - seg.start.x) * dx + (p.y - seg.start.y) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))

  const proj = { x: seg.start.x + t * dx, y: seg.start.y + t * dy }
  return length(p, proj)
}

// ── Segment intersection ──

function segmentIntersection(
  a: WallSegment,
  b: WallSegment,
): { point: Point2D; tA: number; tB: number } | null {
  const r = sub(a.end, a.start)
  const s = sub(b.end, b.start)
  const d = sub(b.start, a.start)

  const rxs = cross2d(r, s)
  const dxr = cross2d(d, r)
  const dxs = cross2d(d, s)

  if (Math.abs(rxs) < EPSILON) {
    // Parallel or collinear
    if (Math.abs(dxr) < EPSILON && Math.abs(dxs) < EPSILON) {
      // Collinear — check overlap
      const t0 = dot(d, r) / dot(r, r)
      const t1 = t0 + dot(s, r) / dot(r, r)

      if (t0 > t1) {
        // Check reverse: s projected onto -r
        const negR = { x: -r.x, y: -r.y }
        const dt0 = dot(d, negR) / dot(negR, negR)
        const dt1 = dt0 + dot(s, negR) / dot(negR, negR)

        const lo = Math.max(0, Math.min(dt0, dt1))
        const hi = Math.min(1, Math.max(dt0, dt1))

        if (lo <= hi) {
          const tMid = (lo + hi) / 2
          return {
            point: add(a.start, scale(r, tMid)),
            tA: tMid,
            tB: (lo + hi) / 2, // simplified
          }
        }
      } else {
        const lo = Math.max(0, Math.min(t0, t1))
        const hi = Math.min(1, Math.max(t0, t1))

        if (lo <= hi) {
          const tMid = (lo + hi) / 2
          return {
            point: add(a.start, scale(r, tMid)),
            tA: tMid,
            tB: tMid,
          }
        }
      }
      return null
    }
    return null
  }

  const t = cross2d(d, s) / rxs
  const u = cross2d(d, r) / rxs

  if (t >= -EPSILON && t <= 1 + EPSILON && u >= -EPSILON && u <= 1 + EPSILON) {
    return {
      point: add(a.start, scale(r, t)),
      tA: t,
      tB: u,
    }
  }

  return null
}

function dot(a: Point2D, b: Point2D): number {
  return a.x * b.x + a.y * b.y
}

// ── Collinearity check ──

function areCollinear(a: WallSegment, b: WallSegment): boolean {
  const r = sub(a.end, a.start)
  const s = sub(b.end, b.start)
  const rxs = cross2d(r, s)
  return Math.abs(rxs) < EPSILON
}

function areOnSameLine(a: WallSegment, b: WallSegment): boolean {
  if (!areCollinear(a, b)) return false
  // Check if they share any point on the line
  const d = sub(b.start, a.start)
  const r = sub(a.end, a.start)
  const dxr = cross2d(d, r)
  return Math.abs(dxr) < EPSILON
}

// ── Public API ──

/**
 * Split a wall segment at an arbitrary point.
 * Returns two new wall segments if the point is interior, or the original if degenerate.
 */
export function splitWallAtPoint(
  wall: WallSegment,
  point: Point2D,
): [WallSegment, WallSegment] | null {
  if (pointsEqual(point, wall.start) || pointsEqual(point, wall.end)) {
    return null
  }

  const dx = wall.end.x - wall.start.x
  const dy = wall.end.y - wall.start.y
  const lenSq = dx * dx + dy * dy
  if (lenSq < EPSILON * EPSILON) return null

  const t = ((point.x - wall.start.x) * dx + (point.y - wall.start.y) * dy) / lenSq
  if (t < EPSILON || t > 1 - EPSILON) return null

  // Verify the point is actually on the segment (not just on the infinite line)
  const dist = distanceToSegment(point, wall)
  if (dist > EPSILON) return null

  const left: WallSegment = {
    id: `${wall.id}-L`,
    start: wall.start,
    end: point,
  }
  const right: WallSegment = {
    id: `${wall.id}-R`,
    start: point,
    end: wall.end,
  }
  return [left, right]
}

/**
 * Find all intersection points between wall segments.
 */
export function findIntersections(walls: WallSegment[]): Intersection[] {
  const results: Intersection[] = []

  for (let i = 0; i < walls.length; i++) {
    for (let j = i + 1; j < walls.length; j++) {
      const hit = segmentIntersection(walls[i], walls[j])
      if (hit) {
        results.push({
          point: hit.point,
          wallA: walls[i],
          wallB: walls[j],
          tA: hit.tA,
          tB: hit.tB,
        })
      }
    }
  }

  return results
}

/**
 * Split all walls at a T-junction point.
 * A T-junction is where one wall's endpoint touches another wall's interior.
 * Returns the full set of wall segments after splitting.
 */
export function splitAtTJunction(
  walls: WallSegment[],
  junctionPoint: Point2D,
): WallSegment[] {
  const result: WallSegment[] = []

  for (const wall of walls) {
    const isStartJunction = pointsEqual(wall.start, junctionPoint)
    const isEndJunction = pointsEqual(wall.end, junctionPoint)

    if (isStartJunction || isEndJunction) {
      // This wall ends at the junction — keep it as-is
      result.push(wall)
      continue
    }

    const split = splitWallAtPoint(wall, junctionPoint)
    if (split) {
      result.push(split[0], split[1])
    } else {
      result.push(wall)
    }
  }

  return result
}

/**
 * Merge collinear adjacent wall segments into longer walls.
 * Walls are merged if they share an endpoint and are collinear.
 */
export function mergeWalls(walls: WallSegment[]): WallSegment[] {
  if (walls.length === 0) return []

  // Build adjacency: find walls that share endpoints and are collinear
  const merged = new Set<string>() // ids of walls already merged
  const result: WallSegment[] = []

  // Build endpoint index: point → wall ids
  const endpointIndex = new Map<string, string[]>()
  const wallMap = new Map<string, WallSegment>()

  for (const wall of walls) {
    wallMap.set(wall.id, wall)
    const startKey = `${wall.start.x.toFixed(10)},${wall.start.y.toFixed(10)}`
    const endKey = `${wall.end.x.toFixed(10)},${wall.end.y.toFixed(10)}`

    if (!endpointIndex.has(startKey)) endpointIndex.set(startKey, [])
    endpointIndex.get(startKey)!.push(wall.id)

    if (!endpointIndex.has(endKey)) endpointIndex.set(endKey, [])
    endpointIndex.get(endKey)!.push(wall.id)
  }

  // Find merge candidates
  for (const wall of walls) {
    if (merged.has(wall.id)) continue

    // Try to extend this wall in both directions
    let currentStart = wall.start
    let currentEnd = wall.end
    const visited = new Set<string>([wall.id])

    // Extend from end
    let extended = true
    while (extended) {
      extended = false
      const endKey = `${currentEnd.x.toFixed(10)},${currentEnd.y.toFixed(10)}`
      const candidates = endpointIndex.get(endKey) || []

      for (const candId of candidates) {
        if (visited.has(candId)) continue
        const cand = wallMap.get(candId)!
        if (!areOnSameLine(wall, cand)) continue

        // Merge: extend currentEnd to the other end of cand
        visited.add(candId)
        merged.add(candId)

        if (pointsEqual(cand.start, currentEnd)) {
          currentEnd = cand.end
        } else {
          currentEnd = cand.start
        }
        extended = true
        break
      }
    }

    // Extend from start
    extended = true
    while (extended) {
      extended = false
      const startKey = `${currentStart.x.toFixed(10)},${currentStart.y.toFixed(10)}`
      const candidates = endpointIndex.get(startKey) || []

      for (const candId of candidates) {
        if (visited.has(candId)) continue
        const cand = wallMap.get(candId)!
        if (!areOnSameLine(wall, cand)) continue

        visited.add(candId)
        merged.add(candId)

        if (pointsEqual(cand.end, currentStart)) {
          currentStart = cand.start
        } else {
          currentStart = cand.end
        }
        extended = true
        break
      }
    }

    result.push({
      id: wall.id,
      start: currentStart,
      end: currentEnd,
    })
  }

  return result
}
