import type { LatLng, LocalCoord, PointOfInterest, PointOfInterestGeometry, WorldPOIGeometry } from '../types'

export type PointOfInterestGeometryValidation =
  | { valid: true }
  | { valid: false; error: string }

function isFiniteLocalCoord(value: unknown): value is LocalCoord {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return Number.isFinite(candidate.x) && Number.isFinite(candidate.y)
}

function isClosed(points: LocalCoord[]): boolean {
  const first = points[0]
  const last = points[points.length - 1]
  return first.x === last.x && first.y === last.y
}

function polygonArea(points: LocalCoord[]): number {
  let twiceArea = 0
  for (let index = 0; index < points.length; index++) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    twiceArea += current.x * next.y - next.x * current.y
  }
  return Math.abs(twiceArea) / 2
}

/** Validate the persisted local-only POI geometry discriminant. */
export function validatePointOfInterestGeometry(value: unknown): PointOfInterestGeometryValidation {
  if (typeof value !== 'object' || value === null) {
    return { valid: false, error: 'POI geometry must be an object' }
  }

  const geometry = value as Record<string, unknown>
  if (geometry.type === 'point') {
    return isFiniteLocalCoord(geometry.position)
      ? { valid: true }
      : { valid: false, error: 'Point geometry position must contain finite local x/y coordinates' }
  }

  if (geometry.type === 'circle') {
    if (!isFiniteLocalCoord(geometry.center)) {
      return { valid: false, error: 'Circle geometry center must contain finite local x/y coordinates' }
    }
    if (typeof geometry.radius !== 'number' || !Number.isFinite(geometry.radius) || geometry.radius <= 0) {
      return { valid: false, error: 'Circle geometry radius must be a finite number greater than zero' }
    }
    return { valid: true }
  }

  if (geometry.type === 'rectangle') {
    if (!isFiniteLocalCoord(geometry.min) || !isFiniteLocalCoord(geometry.max)) {
      return { valid: false, error: 'Rectangle geometry min/max must contain finite local x/y coordinates' }
    }
    const min = geometry.min as LocalCoord
    const max = geometry.max as LocalCoord
    if (min.x >= max.x || min.y >= max.y) {
      return { valid: false, error: 'Rectangle geometry requires normalized min/max with non-zero width and height' }
    }
    if (geometry.rotation !== undefined && (typeof geometry.rotation !== 'number' || !Number.isFinite(geometry.rotation))) {
      return { valid: false, error: 'Rectangle geometry rotation must be a finite number when provided' }
    }
    return { valid: true }
  }

  if (geometry.type === 'polygon') {
    if (!Array.isArray(geometry.points) || geometry.points.length < 3) {
      return { valid: false, error: 'Polygon geometry requires at least three ordered local points' }
    }
    const points = geometry.points
    if (!points.every(isFiniteLocalCoord)) {
      return { valid: false, error: 'Polygon geometry points must contain finite local x/y coordinates' }
    }
    if (isClosed(points)) {
      return { valid: false, error: 'Polygon geometry must be an open ring; closure is implicit' }
    }
    if (polygonArea(points) <= 0) {
      return { valid: false, error: 'Polygon geometry must have non-zero area' }
    }
    return { valid: true }
  }

  return { valid: false, error: 'POI geometry type must be point, circle, rectangle, or polygon' }
}

/** Resolve the compatibility position form to a point geometry without mutation. */
export function resolvePointOfInterestGeometry(poi: PointOfInterest): PointOfInterestGeometry | null {
  if ('geometry' in poi && poi.geometry !== undefined) {
    return structuredClone(poi.geometry)
  }
  if ('position' in poi && poi.position !== undefined) {
    return { type: 'point', position: { ...poi.position } }
  }
  return null
}

/** Return a point location for legacy/explicit points; shapes have no point fallback. */
export function getPointOfInterestPosition(poi: PointOfInterest): LocalCoord | null {
  const geometry = resolvePointOfInterestGeometry(poi)
  return geometry?.type === 'point' ? { ...geometry.position } : null
}

// ── World-space (outdoor/campus) geometry validation ──
// Same discriminant and rules as the indoor validator; the only difference is
// the coordinate space (world LatLng). Used by the scope-aware POI commands,
// the Studio outdoor authoring tools, and the compiler projection.

function isFiniteLatLng(value: unknown): value is LatLng {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.lat === 'number' && Number.isFinite(candidate.lat)
    && typeof candidate.lng === 'number' && Number.isFinite(candidate.lng)
    && candidate.lat >= -90 && candidate.lat <= 90
    && candidate.lng >= -180 && candidate.lng <= 180
  )
}

function worldRingArea(points: LatLng[]): number {
  let twiceArea = 0
  for (let index = 0; index < points.length; index++) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    twiceArea += current.lat * next.lng - next.lat * current.lng
  }
  return Math.abs(twiceArea) / 2
}

export function validateWorldPointOfInterestGeometry(value: unknown): PointOfInterestGeometryValidation {
  if (typeof value !== 'object' || value === null) {
    return { valid: false, error: 'POI geometry must be an object' }
  }

  const geometry = value as Record<string, unknown>
  if (geometry.type === 'point') {
    return isFiniteLatLng(geometry.position)
      ? { valid: true }
      : { valid: false, error: 'Point geometry position must contain finite world lat/lng' }
  }

  if (geometry.type === 'circle') {
    if (!isFiniteLatLng(geometry.center)) {
      return { valid: false, error: 'Circle geometry center must contain finite world lat/lng' }
    }
    if (typeof geometry.radius !== 'number' || !Number.isFinite(geometry.radius) || geometry.radius <= 0) {
      return { valid: false, error: 'Circle geometry radius must be a finite number greater than zero' }
    }
    return { valid: true }
  }

  const rawPoints = geometry.points
  if (!Array.isArray(rawPoints) || !rawPoints.every(isFiniteLatLng)) {
    return { valid: false, error: 'POI shape points must contain finite world lat/lng' }
  }
  const points = rawPoints as LatLng[]

  if (geometry.type === 'rectangle') {
    if (points.length !== 4) {
      return { valid: false, error: 'Rectangle geometry requires exactly four world corners' }
    }
    if (worldRingArea(points) <= 0) {
      return { valid: false, error: 'Rectangle geometry requires non-zero area' }
    }
    return { valid: true }
  }

  if (geometry.type === 'polygon') {
    if (points.length < 3) {
      return { valid: false, error: 'Polygon geometry requires at least three ordered world points' }
    }
    if (isClosedLatLng(points)) {
      return { valid: false, error: 'Polygon geometry must be an open ring; closure is implicit' }
    }
    if (worldRingArea(points) <= 0) {
      return { valid: false, error: 'Polygon geometry must have non-zero area' }
    }
    return { valid: true }
  }

  return { valid: false, error: 'POI geometry type must be point, circle, rectangle, or polygon' }
}

function isClosedLatLng(points: LatLng[]): boolean {
  const first = points[0]
  const last = points[points.length - 1]
  return first.lat === last.lat && first.lng === last.lng
}

/** Representative anchor for a world geometry record. */
export function getWorldPointOfInterestRepresentative(geometry: WorldPOIGeometry): LatLng {
  switch (geometry.type) {
    case 'point':
      return { ...geometry.position }
    case 'circle':
      return { ...geometry.center }
    case 'rectangle': {
      const lat = geometry.points.reduce((sum, point) => sum + point.lat, 0) / geometry.points.length
      const lng = geometry.points.reduce((sum, point) => sum + point.lng, 0) / geometry.points.length
      return { lat, lng }
    }
    case 'polygon': {
      let twiceArea = 0
      let centroidLat = 0
      let centroidLng = 0
      const points = geometry.points
      for (let index = 0; index < points.length; index++) {
        const current = points[index]
        const next = points[(index + 1) % points.length]
        const cross = current.lat * next.lng - next.lat * current.lng
        twiceArea += cross
        centroidLat += (current.lat + next.lat) * cross
        centroidLng += (current.lng + next.lng) * cross
      }
      if (twiceArea === 0) {
        const lat = points.reduce((sum, point) => sum + point.lat, 0) / points.length
        const lng = points.reduce((sum, point) => sum + point.lng, 0) / points.length
        return { lat, lng }
      }
      return { lat: centroidLat / (3 * twiceArea), lng: centroidLng / (3 * twiceArea) }
    }
  }
}
