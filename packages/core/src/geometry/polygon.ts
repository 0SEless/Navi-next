import type { LatLng, LocalCoord, WorldPolygon, LocalPolygon } from '../types'

// ── Polygon area using the Shoelace formula ──

export function polygonArea(polygon: WorldPolygon | LocalPolygon): number {
  const pts = polygon.points
  const n = pts.length
  if (n < 3) return 0

  let area = 0
  for (let i = 0; i < n - 1; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    area += coordVal(a, 'x') * coordVal(b, 'y')
    area -= coordVal(b, 'x') * coordVal(a, 'y')
  }
  return Math.abs(area) / 2
}

function coordVal(p: LatLng | LocalCoord, axis: 'x' | 'y'): number {
  if ('lat' in p && 'lng' in p) {
    return axis === 'x' ? p.lng : p.lat
  }
  const c = p as LocalCoord
  return axis === 'x' ? c.x : c.y
}

// ── Polygon centroid (area-weighted) ──
// Note: level-geometry.ts exports `vertexCentroid` (mean-of-vertices) — see
// its JSDoc for when to use which.

export function polygonCentroid(polygon: WorldPolygon | LocalPolygon): LatLng | LocalCoord {
  const pts = polygon.points
  const n = pts.length - 1  // exclude closing point
  if (n < 3) return pts[0]

  let cx = 0
  let cy = 0
  let area = 0

  for (let i = 0; i < n; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % n]
    const ax = coordVal(a, 'x')
    const ay = coordVal(a, 'y')
    const bx = coordVal(b, 'x')
    const by = coordVal(b, 'y')
    const cross = ax * by - bx * ay
    cx += (ax + bx) * cross
    cy += (ay + by) * cross
    area += cross
  }

  area /= 2
  const f = 1 / (6 * area)

  if ('lat' in pts[0] && 'lng' in pts[0]) {
    return { lng: cx * f, lat: cy * f } as LatLng
  }
  return { x: cx * f, y: cy * f } as LocalCoord
}

// ── Point-in-polygon test (ray casting) ──

export function pointInPolygon(
  point: LatLng | LocalCoord,
  polygon: WorldPolygon | LocalPolygon,
): boolean {
  const pts = polygon.points
  const n = pts.length
  let inside = false
  const px = coordVal(point, 'x')
  const py = coordVal(point, 'y')

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = coordVal(pts[i], 'x')
    const yi = coordVal(pts[i], 'y')
    const xj = coordVal(pts[j], 'x')
    const yj = coordVal(pts[j], 'y')

    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

// ── Bounding box ──

export interface BBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export function polygonBBox(polygon: WorldPolygon | LocalPolygon): BBox {
  const pts = polygon.points
  let minX = Infinity, minY = Infinity
  let maxX = -Infinity, maxY = -Infinity

  for (const p of pts) {
    const x = coordVal(p, 'x')
    const y = coordVal(p, 'y')
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  return { minX, minY, maxX, maxY }
}

// ── Polygon closure check ──

export function isClosedPolygon(polygon: WorldPolygon | LocalPolygon): boolean {
  const pts = polygon.points
  if (pts.length < 4) return false
  const first = pts[0]
  const last = pts[pts.length - 1]
  if ('lat' in first && 'lat' in last) {
    return (first as LatLng).lat === (last as LatLng).lat &&
           (first as LatLng).lng === (last as LatLng).lng
  }
  const f = first as LocalCoord
  const l = last as LocalCoord
  return f.x === l.x && f.y === l.y
}
