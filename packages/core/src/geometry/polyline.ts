import type { LatLng, LocalCoord, WorldPolyline, LocalPolyline } from '../types'

// ── Polyline length ──

export function polylineLength(polyline: WorldPolyline | LocalPolyline): number {
  const pts = polyline.points
  let total = 0
  for (let i = 0; i < pts.length - 1; i++) {
    total += pointDistance(pts[i], pts[i + 1])
  }
  return total
}

// ── Euclidean distance between two points ──

export function pointDistance(a: LatLng | LocalCoord, b: LatLng | LocalCoord): number {
  const dx = coordVal(b, 'x') - coordVal(a, 'x')
  const dy = coordVal(b, 'y') - coordVal(a, 'y')
  return Math.sqrt(dx * dx + dy * dy)
}

function coordVal(p: LatLng | LocalCoord, axis: 'x' | 'y'): number {
  if ('lat' in p && 'lng' in p) {
    return axis === 'x' ? p.lng : p.lat
  }
  const c = p as LocalCoord
  return axis === 'x' ? c.x : c.y
}

// ── Closest point on segment ──

export function closestPointOnSegment(p: LatLng, a: LatLng, b: LatLng): LatLng {
  const abx = b.lng - a.lng
  const aby = b.lat - a.lat
  const apx = p.lng - a.lng
  const apy = p.lat - a.lat
  const dot = apx * abx + apy * aby
  const len2 = abx * abx + aby * aby

  if (len2 === 0) return a

  const t = Math.max(0, Math.min(1, dot / len2))

  return {
    lat: a.lat + t * aby,
    lng: a.lng + t * abx,
  }
}

// ── Haversine distance (world coordinates) ──

export function haversineDistance(a: LatLng, b: LatLng): number {
  const R = 6371000  // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const sinDLat = Math.sin(dLat / 2)
  const sinDLng = Math.sin(dLng / 2)
  const h =
    sinDLat * sinDLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinDLng * sinDLng
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

export function polylineLengthHaversine(polyline: WorldPolyline): number {
  const pts = polyline.points
  let total = 0
  for (let i = 0; i < pts.length - 1; i++) {
    total += haversineDistance(pts[i], pts[i + 1])
  }
  return total
}
