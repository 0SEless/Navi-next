import type { Point2D } from '../canvas/viewport'
import type { WallSegment } from './wall-topology'

const EPSILON = 1e-10

function sub(a: Point2D, b: Point2D): Point2D {
  return { x: a.x - b.x, y: a.y - b.y }
}

function add(a: Point2D, b: Point2D): Point2D {
  return { x: a.x + b.x, y: a.y + b.y }
}

function scale(a: Point2D, s: number): Point2D {
  return { x: a.x * s, y: a.y * s }
}

function dot(a: Point2D, b: Point2D): number {
  return a.x * b.x + a.y * b.y
}

function length(a: Point2D, b: Point2D): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  return Math.sqrt(dx * dx + dy * dy)
}

function wallLength(wall: WallSegment): number {
  return length(wall.start, wall.end)
}

/**
 * Project a point onto the infinite line defined by a wall segment.
 * Returns the parameter t (0 = start, 1 = end).
 * t < 0 or t > 1 means the projection falls outside the segment.
 */
function projectOntoWall(wall: WallSegment, point: Point2D): number {
  const d = sub(wall.end, wall.start)
  const lenSq = dot(d, d)
  if (lenSq < EPSILON * EPSILON) return 0
  return dot(sub(point, wall.start), d) / lenSq
}

/**
 * Compute the perpendicular distance from a point to the infinite line
 * defined by a wall segment.
 */
function distanceToLine(wall: WallSegment, point: Point2D): number {
  const d = sub(wall.end, wall.start)
  const lenSq = dot(d, d)
  if (lenSq < EPSILON * EPSILON) return length(point, wall.start)

  const t = Math.max(0, Math.min(1, projectOntoWall(wall, point)))
  const proj = add(wall.start, scale(d, t))
  return length(point, proj)
}

// ── Public API ──

/**
 * Find the nearest wall to a point within the given threshold distance.
 * Returns the wall and the projection parameter, or null if no wall is close enough.
 */
export function findWallAtPoint(
  point: Point2D,
  walls: WallSegment[],
  threshold: number,
): { wall: WallSegment; t: number } | null {
  let best: { wall: WallSegment; t: number; dist: number } | null = null

  for (const wall of walls) {
    const len = wallLength(wall)
    if (len < EPSILON) continue

    const t = projectOntoWall(wall, point)
    const clampedT = Math.max(0, Math.min(1, t))
    const proj = add(wall.start, scale(sub(wall.end, wall.start), clampedT))
    const dist = length(point, proj)

    if (dist <= threshold) {
      if (!best || dist < best.dist) {
        best = { wall, t: clampedT, dist }
      }
    }
  }

  if (!best) return null
  return { wall: best.wall, t: best.t }
}

/**
 * Compute the offset along a wall from its start to the closest point on the wall
 * to the given point. The offset is in the same units as the wall coordinates.
 *
 * The point is projected onto the wall segment; the offset is clamped to
 * [0, wallLength] if the projection falls outside the segment.
 */
export function getWallOffset(wall: WallSegment, point: Point2D): number {
  const len = wallLength(wall)
  if (len < EPSILON) return 0

  const t = projectOntoWall(wall, point)
  const clampedT = Math.max(0, Math.min(1, t))
  return clampedT * len
}

/**
 * Compute the point at a given offset along a wall from its start.
 * The offset is clamped to [0, wallLength].
 */
export function getPointOnWall(wall: WallSegment, offset: number): Point2D {
  const len = wallLength(wall)
  if (len < EPSILON) return { ...wall.start }

  const t = Math.max(0, Math.min(1, offset / len))
  return add(wall.start, scale(sub(wall.end, wall.start), t))
}

/**
 * Check if a point is near a wall segment within the given threshold distance.
 */
export function isPointOnWall(
  point: Point2D,
  wall: WallSegment,
  threshold: number,
): boolean {
  return distanceToLine(wall, point) <= threshold
}
