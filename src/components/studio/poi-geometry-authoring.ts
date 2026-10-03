import {
  validatePointOfInterestGeometry,
  validateWorldPointOfInterestGeometry,
  worldCirclePoints,
  worldDistanceMeters,
  worldRectangleCorners,
  normalizeLocalRectangle,
  localRectangleCorners,
  type LatLng,
  type LocalCoord,
  type PointOfInterestGeometry,
  type WorldPOIGeometry,
} from '@navi/core'

export type POIGeometryTool = 'poi-circle' | 'poi-rectangle' | 'poi-polygon'

export function isPOIGeometryTool(value: string | null): value is POIGeometryTool {
  return value === 'poi-circle' || value === 'poi-rectangle' || value === 'poi-polygon'
}

export interface POIPreviewState {
  center?: LocalCoord
  first?: LocalCoord
  current?: LocalCoord
  points?: LocalCoord[]
}

function copyPoint(point: LocalCoord): LocalCoord {
  return { x: point.x, y: point.y }
}

function finitePoint(point: LocalCoord | undefined): point is LocalCoord {
  return Boolean(
    point
    && Number.isFinite(point.x)
    && Number.isFinite(point.y),
  )
}

export function localDistance(a: LocalCoord, b: LocalCoord): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export const normalizeRectangle = normalizeLocalRectangle

/** Return an open local ring for display; callers close it only in GeoJSON. */
export function buildCircleLocalPoints(center: LocalCoord, radius: number, segments = 32): LocalCoord[] {
  const count = Math.max(3, Math.floor(segments))
  return Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 2
    return {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    }
  })
}

/** Return the four open local corners for display. */
export const buildRectangleLocalPoints = localRectangleCorners

function validated(geometry: PointOfInterestGeometry): PointOfInterestGeometry | null {
  return validatePointOfInterestGeometry(geometry).valid ? geometry : null
}

export function buildPOIGeometry(
  tool: POIGeometryTool,
  state: POIPreviewState,
): PointOfInterestGeometry | null {
  if (tool === 'poi-circle') {
    if (!finitePoint(state.center) || !finitePoint(state.current)) return null
    const geometry: PointOfInterestGeometry = {
      type: 'circle',
      center: copyPoint(state.center),
      radius: localDistance(state.center, state.current),
    }
    return validated(geometry)
  }

  if (tool === 'poi-rectangle') {
    if (!finitePoint(state.first) || !finitePoint(state.current)) return null
    const bounds = normalizeRectangle(state.first, state.current)
    return validated({
      type: 'rectangle',
      min: bounds.min,
      max: bounds.max,
    })
  }

  if (tool === 'poi-polygon') {
    if (!state.points || state.points.length < 3 || state.points.some(point => !finitePoint(point))) return null
    const geometry: PointOfInterestGeometry = {
      type: 'polygon',
      points: state.points.map(copyPoint),
    }
    return validated(geometry)
  }

  return null
}

// ── Outdoor/campus (world) geometry builders ──
// Same gesture vocabulary as the indoor builders; coordinates are world LatLng
// and the result is the shared runtime geometry contract.

export interface WorldPOIPreviewState {
  center?: LatLng
  first?: LatLng
  current?: LatLng
  points?: LatLng[]
}

function copyLatLng(point: LatLng): LatLng {
  return { lat: point.lat, lng: point.lng }
}

function isFiniteLatLng(point: LatLng | undefined): point is LatLng {
  return Boolean(
    point
    && Number.isFinite(point.lat)
    && Number.isFinite(point.lng)
    && point.lat >= -90 && point.lat <= 90
    && point.lng >= -180 && point.lng <= 180,
  )
}

function validatedWorld(geometry: WorldPOIGeometry): WorldPOIGeometry | null {
  return validateWorldPointOfInterestGeometry(geometry).valid ? geometry : null
}

/** World-space circle ring for the transient preview (open ring). */
export function buildWorldCirclePreview(center: LatLng, radiusMeters: number): LatLng[] {
  return worldCirclePoints(center, radiusMeters)
}

/** World-space rectangle corners for the transient preview. */
export function buildWorldRectanglePreview(first: LatLng, current: LatLng): LatLng[] {
  return worldRectangleCorners(first, current)
}

export function buildWorldPOIGeometry(
  tool: POIGeometryTool,
  state: WorldPOIPreviewState,
): WorldPOIGeometry | null {
  if (tool === 'poi-circle') {
    if (!isFiniteLatLng(state.center) || !isFiniteLatLng(state.current)) return null
    return validatedWorld({
      type: 'circle',
      center: copyLatLng(state.center),
      radius: worldDistanceMeters(state.center, state.current),
    })
  }

  if (tool === 'poi-rectangle') {
    if (!isFiniteLatLng(state.first) || !isFiniteLatLng(state.current)) return null
    return validatedWorld({
      type: 'rectangle',
      points: worldRectangleCorners(state.first, state.current),
    })
  }

  if (tool === 'poi-polygon') {
    if (!state.points || state.points.length < 3 || state.points.some(point => !isFiniteLatLng(point))) return null
    return validatedWorld({
      type: 'polygon',
      points: state.points.map(copyLatLng),
    })
  }

  return null
}

/** One-click outdoor point geometry (marker scope). */
export function buildWorldPointGeometry(position: LatLng): WorldPOIGeometry {
  return { type: 'point', position: copyLatLng(position) }
}
