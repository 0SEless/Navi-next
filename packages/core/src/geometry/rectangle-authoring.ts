import type { LocalCoord } from '../types/coordinates'

/** Shared axis-aligned rectangle helpers for authored indoor gestures. */
export function normalizeLocalRectangle(a: LocalCoord, b: LocalCoord): { min: LocalCoord; max: LocalCoord } {
  return { min: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) }, max: { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) } }
}

/** Return an open ring; GeoJSON callers close it at the boundary. */
export function localRectangleCorners(min: LocalCoord, max: LocalCoord): LocalCoord[] {
  return [{ x: min.x, y: min.y }, { x: max.x, y: min.y }, { x: max.x, y: max.y }, { x: min.x, y: max.y }]
}

export function localRectangleFromDrag(a: LocalCoord, b: LocalCoord): LocalCoord[] {
  const bounds = normalizeLocalRectangle(a, b)
  return localRectangleCorners(bounds.min, bounds.max)
}

export function rectangleCenter(points: LocalCoord[]): LocalCoord {
  if (points.length === 0) return { x: 0, y: 0 }
  return points.reduce((sum, point) => ({ x: sum.x + point.x / points.length, y: sum.y + point.y / points.length }), { x: 0, y: 0 })
}

export function rotateRectangleFootprint(points: LocalCoord[], deltaRadians: number): LocalCoord[] {
  if (points.length !== 4) return points.map(point => ({ ...point }))
  const center = rectangleCenter(points)
  const cos = Math.cos(deltaRadians)
  const sin = Math.sin(deltaRadians)
  return points.map(point => {
    const dx = point.x - center.x
    const dy = point.y - center.y
    return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos }
  })
}

/** Anchored corner resize in the rectangle's current axes. */
export function resizeRectangleFootprint(points: LocalCoord[], cornerIndex: number, dragged: LocalCoord): LocalCoord[] | null {
  if (points.length !== 4 || cornerIndex < 0 || cornerIndex > 3) return null
  const origin = points[0]
  const edgeU = { x: points[1].x - origin.x, y: points[1].y - origin.y }
  const edgeV = { x: points[3].x - origin.x, y: points[3].y - origin.y }
  const lengthU = Math.hypot(edgeU.x, edgeU.y)
  const lengthV = Math.hypot(edgeV.x, edgeV.y)
  if (lengthU < 0.2 || lengthV < 0.2) return null
  const u = { x: edgeU.x / lengthU, y: edgeU.y / lengthU }
  const v = { x: edgeV.x / lengthV, y: edgeV.y / lengthV }
  const project = (point: LocalCoord) => {
    const relative = { x: point.x - origin.x, y: point.y - origin.y }
    return { x: relative.x * u.x + relative.y * u.y, y: relative.x * v.x + relative.y * v.y }
  }
  const anchor = project(points[(cornerIndex + 2) % 4])
  const target = project(dragged)
  const minX = Math.min(anchor.x, target.x)
  const maxX = Math.max(anchor.x, target.x)
  const minY = Math.min(anchor.y, target.y)
  const maxY = Math.max(anchor.y, target.y)
  if (maxX - minX < 0.2 || maxY - minY < 0.2) return null
  const unproject = (x: number, y: number): LocalCoord => ({ x: origin.x + u.x * x + v.x * y, y: origin.y + u.y * x + v.y * y })
  return [unproject(minX, minY), unproject(maxX, minY), unproject(maxX, maxY), unproject(minX, maxY)]
}
