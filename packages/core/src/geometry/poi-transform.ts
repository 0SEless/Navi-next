import type {
  LatLng,
  LocalCoord,
  PointOfInterestGeometry,
  WorldPOIGeometry,
} from '../types'

/**
 * Pure POI transform helpers for both coordinate scopes.
 *
 * World geometries are transformed in a local meter frame (equirectangular
 * approximation around the geometry) so move/resize/rotate math matches the
 * map's metric behavior; local geometries use meters directly. Every helper
 * returns a new geometry and never mutates its input.
 */

const METERS_PER_DEGREE_LAT = 111_320
const MIN_CIRCLE_RADIUS = 0.1
const MIN_RECTANGLE_SIDE = 0.2

function clonePoint(point: LocalCoord): LocalCoord {
  return { x: point.x, y: point.y }
}

function cloneLatLng(point: LatLng): LatLng {
  return { lat: point.lat, lng: point.lng }
}

export function clonePoiGeometryWorld(geometry: WorldPOIGeometry): WorldPOIGeometry {
  if (geometry.type === 'point') return { type: 'point', position: cloneLatLng(geometry.position) }
  if (geometry.type === 'circle') return { type: 'circle', center: cloneLatLng(geometry.center), radius: geometry.radius }
  return { type: geometry.type, points: geometry.points.map(cloneLatLng) }
}

export function clonePoiGeometryLocal(geometry: PointOfInterestGeometry): PointOfInterestGeometry {
  if (geometry.type === 'point') return { type: 'point', position: clonePoint(geometry.position) }
  if (geometry.type === 'circle') return { type: 'circle', center: clonePoint(geometry.center), radius: geometry.radius }
  if (geometry.type === 'rectangle') return { type: 'rectangle', min: clonePoint(geometry.min), max: clonePoint(geometry.max), ...(geometry.rotation !== undefined ? { rotation: geometry.rotation } : {}) }
  return { type: 'polygon', points: geometry.points.map(clonePoint) }
}

// ── World meter frame ──

interface WorldFrame {
  origin: LatLng
  metersLng: number
  toLocal: (point: LatLng) => LocalCoord
  toWorld: (local: LocalCoord) => LatLng
}

function worldFrame(origin: LatLng): WorldFrame {
  const metersLng = Math.max(Math.cos((origin.lat * Math.PI) / 180) * METERS_PER_DEGREE_LAT, 1)
  return {
    origin,
    metersLng,
    toLocal: (point) => ({
      x: (point.lng - origin.lng) * metersLng,
      y: (point.lat - origin.lat) * METERS_PER_DEGREE_LAT,
    }),
    toWorld: (local) => ({
      lat: origin.lat + local.y / METERS_PER_DEGREE_LAT,
      lng: origin.lng + local.x / metersLng,
    }),
  }
}

export function worldPoiGeometryCentroid(geometry: WorldPOIGeometry): LatLng {
  if (geometry.type === 'point') return cloneLatLng(geometry.position)
  if (geometry.type === 'circle') return cloneLatLng(geometry.center)
  let lat = 0
  let lng = 0
  for (const point of geometry.points) {
    lat += point.lat
    lng += point.lng
  }
  return { lat: lat / geometry.points.length, lng: lng / geometry.points.length }
}

export function localPoiGeometryCentroid(geometry: PointOfInterestGeometry): LocalCoord {
  if (geometry.type === 'point') return clonePoint(geometry.position)
  if (geometry.type === 'circle') return clonePoint(geometry.center)
  if (geometry.type === 'rectangle') {
    return { x: (geometry.min.x + geometry.max.x) / 2, y: (geometry.min.y + geometry.max.y) / 2 }
  }
  let x = 0
  let y = 0
  for (const point of geometry.points) {
    x += point.x
    y += point.y
  }
  return { x: x / geometry.points.length, y: y / geometry.points.length }
}

export function translateWorldPoiGeometry(geometry: WorldPOIGeometry, dLat: number, dLng: number): WorldPOIGeometry {
  const shift = (point: LatLng): LatLng => ({ lat: point.lat + dLat, lng: point.lng + dLng })
  if (geometry.type === 'point') return { type: 'point', position: shift(geometry.position) }
  if (geometry.type === 'circle') return { type: 'circle', center: shift(geometry.center), radius: geometry.radius }
  return { type: geometry.type, points: geometry.points.map(shift) }
}

export function translateLocalPoiGeometry(geometry: PointOfInterestGeometry, dx: number, dy: number): PointOfInterestGeometry {
  const shift = (point: LocalCoord): LocalCoord => ({ x: point.x + dx, y: point.y + dy })
  if (geometry.type === 'point') return { type: 'point', position: shift(geometry.position) }
  if (geometry.type === 'circle') return { type: 'circle', center: shift(geometry.center), radius: geometry.radius }
  if (geometry.type === 'rectangle') return { type: 'rectangle', min: shift(geometry.min), max: shift(geometry.max), ...(geometry.rotation !== undefined ? { rotation: geometry.rotation } : {}) }
  return { type: 'polygon', points: geometry.points.map(shift) }
}

export function moveWorldPoiPoint(geometry: WorldPOIGeometry, position: LatLng): WorldPOIGeometry {
  if (geometry.type !== 'point') return clonePoiGeometryWorld(geometry)
  return { type: 'point', position: cloneLatLng(position) }
}

export function moveLocalPoiPoint(geometry: PointOfInterestGeometry, position: LocalCoord): PointOfInterestGeometry {
  if (geometry.type !== 'point') return clonePoiGeometryLocal(geometry)
  return { type: 'point', position: clonePoint(position) }
}

export function setWorldCircleRadius(geometry: WorldPOIGeometry, radius: number): WorldPOIGeometry {
  if (geometry.type !== 'circle') return clonePoiGeometryWorld(geometry)
  return { type: 'circle', center: cloneLatLng(geometry.center), radius: Math.max(MIN_CIRCLE_RADIUS, radius) }
}

export function setLocalCircleRadius(geometry: PointOfInterestGeometry, radius: number): PointOfInterestGeometry {
  if (geometry.type !== 'circle') return clonePoiGeometryLocal(geometry)
  return { type: 'circle', center: clonePoint(geometry.center), radius: Math.max(MIN_CIRCLE_RADIUS, radius) }
}

export function moveWorldPolygonVertex(geometry: WorldPOIGeometry, index: number, position: LatLng): WorldPOIGeometry {
  if (geometry.type !== 'polygon' || index < 0 || index >= geometry.points.length) return clonePoiGeometryWorld(geometry)
  const points = geometry.points.map(cloneLatLng)
  points[index] = cloneLatLng(position)
  return { type: 'polygon', points }
}

export function moveLocalPolygonVertex(geometry: PointOfInterestGeometry, index: number, position: LocalCoord): PointOfInterestGeometry {
  if (geometry.type !== 'polygon' || index < 0 || index >= geometry.points.length) return clonePoiGeometryLocal(geometry)
  const points = geometry.points.map(clonePoint)
  points[index] = clonePoint(position)
  return { type: 'polygon', points }
}

export function rotateWorldPoiGeometry(geometry: WorldPOIGeometry, deltaRad: number): WorldPOIGeometry {
  if (geometry.type === 'point' || geometry.type === 'circle') return clonePoiGeometryWorld(geometry)
  const centroid = worldPoiGeometryCentroid(geometry)
  const frame = worldFrame(centroid)
  const cos = Math.cos(deltaRad)
  const sin = Math.sin(deltaRad)
  const rotate = (point: LatLng): LatLng => {
    const local = frame.toLocal(point)
    return frame.toWorld({ x: local.x * cos - local.y * sin, y: local.x * sin + local.y * cos })
  }
  return { type: geometry.type, points: geometry.points.map(rotate) }
}

export function rotateLocalPoiGeometry(geometry: PointOfInterestGeometry, deltaRad: number): PointOfInterestGeometry {
  if (geometry.type === 'point' || geometry.type === 'circle') return clonePoiGeometryLocal(geometry)
  if (geometry.type === 'rectangle') {
    return {
      type: 'rectangle',
      min: clonePoint(geometry.min),
      max: clonePoint(geometry.max),
      rotation: (geometry.rotation ?? 0) + deltaRad,
    }
  }
  const centroid = localPoiGeometryCentroid(geometry)
  const cos = Math.cos(deltaRad)
  const sin = Math.sin(deltaRad)
  const rotate = (point: LocalCoord): LocalCoord => {
    const dx = point.x - centroid.x
    const dy = point.y - centroid.y
    return { x: centroid.x + dx * cos - dy * sin, y: centroid.y + dx * sin + dy * cos }
  }
  return { type: 'polygon', points: geometry.points.map(rotate) }
}

function localRectangleCorners(geometry: Extract<PointOfInterestGeometry, { type: 'rectangle' }>): LocalCoord[] {
  const corners = [
    { x: geometry.min.x, y: geometry.min.y },
    { x: geometry.max.x, y: geometry.min.y },
    { x: geometry.max.x, y: geometry.max.y },
    { x: geometry.min.x, y: geometry.max.y },
  ]
  const rotation = geometry.rotation ?? 0
  if (rotation === 0) return corners
  const center = localPoiGeometryCentroid(geometry)
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  return corners.map((point) => {
    const dx = point.x - center.x
    const dy = point.y - center.y
    return {
      x: center.x + dx * cos - dy * sin,
      y: center.y + dx * sin + dy * cos,
    }
  })
}

interface AxisFrame {
  origin: LocalCoord
  u: LocalCoord
  v: LocalCoord
}

function axisFrameFromCorners(corners: LocalCoord[]): AxisFrame {
  const origin = corners[0]
  const edgeU = { x: corners[1].x - origin.x, y: corners[1].y - origin.y }
  const edgeV = { x: corners[3].x - origin.x, y: corners[3].y - origin.y }
  const lengthU = Math.hypot(edgeU.x, edgeU.y) || 1
  const lengthV = Math.hypot(edgeV.x, edgeV.y) || 1
  return { origin, u: { x: edgeU.x / lengthU, y: edgeU.y / lengthU }, v: { x: edgeV.x / lengthV, y: edgeV.y / lengthV } }
}

function dot(a: LocalCoord, b: LocalCoord): number {
  return a.x * b.x + a.y * b.y
}

/**
 * Anchored corner resize that preserves the opposite corner and the original
 * edge orientation (u/v axes). Works in a metric frame, so it is shared by
 * both scopes.
 */
function resizeCorners(corners: LocalCoord[], cornerIndex: number, dragged: LocalCoord): LocalCoord[] | null {
  if (corners.length !== 4 || cornerIndex < 0 || cornerIndex > 3) return null
  const frame = axisFrameFromCorners(corners)
  const canonical = (point: LocalCoord): LocalCoord => ({
    x: dot({ x: point.x - frame.origin.x, y: point.y - frame.origin.y }, frame.u),
    y: dot({ x: point.x - frame.origin.x, y: point.y - frame.origin.y }, frame.v),
  })
  const anchorIndex = (cornerIndex + 2) % 4
  const anchor = canonical(corners[anchorIndex])
  const target = canonical(dragged)

  const minU = Math.min(anchor.x, target.x)
  const maxU = Math.max(anchor.x, target.x)
  const minV = Math.min(anchor.y, target.y)
  const maxV = Math.max(anchor.y, target.y)
  if (maxU - minU < MIN_RECTANGLE_SIDE || maxV - minV < MIN_RECTANGLE_SIDE) return null

  const fromCanonical = (point: LocalCoord): LocalCoord => ({
    x: frame.origin.x + frame.u.x * point.x + frame.v.x * point.y,
    y: frame.origin.y + frame.u.y * point.x + frame.v.y * point.y,
  })
  return [
    fromCanonical({ x: minU, y: minV }),
    fromCanonical({ x: maxU, y: minV }),
    fromCanonical({ x: maxU, y: maxV }),
    fromCanonical({ x: minU, y: maxV }),
  ]
}

/** Resize a world rectangle by dragging one corner; preserves orientation. */
export function resizeWorldRectangle(geometry: WorldPOIGeometry, cornerIndex: number, dragged: LatLng): WorldPOIGeometry | null {
  if (geometry.type !== 'rectangle') return null
  const frame = worldFrame(geometry.points[0])
  const localCorners = geometry.points.map(frame.toLocal)
  const resized = resizeCorners(localCorners, cornerIndex, frame.toLocal(dragged))
  if (!resized) return null
  return { type: 'rectangle', points: resized.map(frame.toWorld) }
}

/** Resize a local rectangle by dragging one corner; preserves orientation. */
export function resizeLocalRectangle(geometry: PointOfInterestGeometry, cornerIndex: number, dragged: LocalCoord): PointOfInterestGeometry | null {
  if (geometry.type !== 'rectangle') return null
  const resized = resizeCorners(localRectangleCorners(geometry), cornerIndex, dragged)
  if (!resized) return null
  const rotation = geometry.rotation ?? 0
  const center = resized.reduce((sum, point) => ({ x: sum.x + point.x / 4, y: sum.y + point.y / 4 }), { x: 0, y: 0 })
  const cos = Math.cos(-rotation)
  const sin = Math.sin(-rotation)
  const unrotated = resized.map((point) => {
    const dx = point.x - center.x
    const dy = point.y - center.y
    return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos }
  })
  const xs = unrotated.map((c) => c.x)
  const ys = unrotated.map((c) => c.y)
  return {
    type: 'rectangle',
    min: { x: Math.min(...xs), y: Math.min(...ys) },
    max: { x: Math.max(...xs), y: Math.max(...ys) },
    ...(geometry.rotation !== undefined || rotation !== 0 ? { rotation } : {}),
  }
}

export function localRectangleCornersOf(geometry: PointOfInterestGeometry): LocalCoord[] {
  return geometry.type === 'rectangle' ? localRectangleCorners(geometry) : []
}
