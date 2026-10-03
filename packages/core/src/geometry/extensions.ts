import type { LatLng, LocalCoord, WorldPolygon, LocalPolygon, WorldPolyline, LocalPolyline } from '../types'
import { polygonBBox, type BBox } from './polygon'
import { pointDistance } from './polyline'

// ── Douglas-Peucker polyline simplification ──

export function simplifyPolyline<T extends LatLng | LocalCoord>(
  points: T[],
  tolerance: number,
): T[] {
  if (points.length <= 2) return points

  let maxDist = 0
  let maxIdx = 0
  const first = points[0]
  const last = points[points.length - 1]

  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i], first, last)
    if (d > maxDist) {
      maxDist = d
      maxIdx = i
    }
  }

  if (maxDist > tolerance) {
    const left = simplifyPolyline(points.slice(0, maxIdx + 1), tolerance)
    const right = simplifyPolyline(points.slice(maxIdx), tolerance)
    return [...left.slice(0, -1), ...right]
  }

  return [first, last]
}

export function simplifyPolygon<T extends LatLng | LocalCoord>(
  polygon: { points: T[] },
  tolerance: number,
): { points: T[] } {
  // Remove closing point, simplify, re-add
  const pts = polygon.points.slice(0, -1)
  const simplified = simplifyPolyline(pts, tolerance)
  simplified.push(simplified[0])
  return { points: simplified }
}

function perpendicularDistance<T extends LatLng | LocalCoord>(
  p: T,
  a: T,
  b: T,
): number {
  const dx = coordVal(b, 'x') - coordVal(a, 'x')
  const dy = coordVal(b, 'y') - coordVal(a, 'y')
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len === 0) return pointDistance(p, a)
  const px = coordVal(p, 'x')
  const py = coordVal(p, 'y')
  const ax = coordVal(a, 'x')
  const ay = coordVal(a, 'y')
  return Math.abs(dy * px - dx * py - dy * ax + dx * ay) / len
}

function coordVal(p: LatLng | LocalCoord, axis: 'x' | 'y'): number {
  if ('lat' in p && 'lng' in p) {
    return axis === 'x' ? p.lng : p.lat
  }
  return axis === 'x' ? (p as LocalCoord).x : (p as LocalCoord).y
}

// ── Nearest point on polyline ──

export function nearestPointOnPolyline<T extends LatLng | LocalCoord>(
  point: T,
  polyline: T[],
): { point: T; index: number; distance: number } {
  let best: { point: T; distance: number; index: number } | null = null

  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i]
    const b = polyline[i + 1]
    const nearest = nearestPointOnSegment(point, a, b)
    const d = pointDistance(point, nearest)
    if (!best || d < best.distance) {
      best = { point: nearest as T, distance: d, index: i }
    }
  }

  return best!
}

function nearestPointOnSegment<T extends LatLng | LocalCoord>(
  p: T,
  a: T,
  b: T,
): LatLng | LocalCoord {
  const ax = coordVal(a, 'x')
  const ay = coordVal(a, 'y')
  const bx = coordVal(b, 'x')
  const by = coordVal(b, 'y')
  const px = coordVal(p, 'x')
  const py = coordVal(p, 'y')
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return a
  let t = ((px - ax) * dx + (py - ay) * dy) / len2
  t = Math.max(0, Math.min(1, t))

  if ('lat' in a && 'lng' in a) {
    return { lat: ay + t * dy, lng: ax + t * dx } as T
  }
  return { x: ax + t * dx, y: ay + t * dy } as T
}

// ── Line intersection (2D) ──

export interface Line {
  a: LatLng | LocalCoord
  b: LatLng | LocalCoord
}

export function lineIntersection(
  l1: Line,
  l2: Line,
): { point: LatLng | LocalCoord; t: number; u: number } | null {
  const x1 = coordVal(l1.a, 'x')
  const y1 = coordVal(l1.a, 'y')
  const x2 = coordVal(l1.b, 'x')
  const y2 = coordVal(l1.b, 'y')
  const x3 = coordVal(l2.a, 'x')
  const y3 = coordVal(l2.a, 'y')
  const x4 = coordVal(l2.b, 'x')
  const y4 = coordVal(l2.b, 'y')

  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
  if (Math.abs(denom) < 1e-12) return null

  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom

  if (t < 0 || t > 1 || u < 0 || u > 1) return null

  const x = x1 + t * (x2 - x1)
  const y = y1 + t * (y2 - y1)

  if ('lat' in l1.a && 'lng' in l1.a) {
    return { point: { lat: y, lng: x } as LatLng, t, u }
  }
  return { point: { x, y } as LocalCoord, t, u }
}

// ── Simple polygon buffer (outset by distance) ──
// For V1: basic uniform offset. Complex Minkowski sum deferred.

export function bufferPolygon<T extends LatLng | LocalCoord>(
  polygon: { points: T[] },
  distance: number,
): { points: T[] } {
  const pts = polygon.points
  if (pts.length < 3) return { points: [...pts] }

  const isLocal = !('lat' in pts[0] && 'lng' in pts[0])
  const result: T[] = []

  for (let i = 0; i < pts.length - 1; i++) {
    const prev = pts[i === 0 ? pts.length - 2 : i - 1]
    const curr = pts[i]
    const next = pts[i + 1]

    const ax = coordVal(curr, 'x') - coordVal(prev, 'x')
    const ay = coordVal(curr, 'y') - coordVal(prev, 'y')
    const bx = coordVal(next, 'x') - coordVal(curr, 'x')
    const by = coordVal(next, 'y') - coordVal(curr, 'y')

    const lenA = Math.sqrt(ax * ax + ay * ay)
    const lenB = Math.sqrt(bx * bx + by * by)
    if (lenA === 0 || lenB === 0) {
      result.push(curr)
      continue
    }

    const nx = (ay / lenA + by / lenB) * distance
    const ny = (-ax / lenA - by / lenB) * distance

    if (isLocal) {
      result.push({ x: (curr as LocalCoord).x + nx, y: (curr as LocalCoord).y + ny } as T)
    } else {
      const c = curr as LatLng
      result.push({ lat: c.lat + ny, lng: c.lng + nx } as T)
    }
  }

  // Close polygon
  result.push(result[0])
  return { points: result }
}
