import {
  closestPointOnSegment,
  haversine,
  pointInPolygon,
} from '@navi/core'
import type { LatLng, POI, RuntimePOIGeometry } from '@navi/core'

/** Bounded GPS-scale tolerance used for all POI geometry arrival checks. */
export const POI_ARRIVAL_TOLERANCE_METERS = 15

export interface PoiArrivalContext {
  buildingId?: string
  floor?: number
}

function isFinitePosition(value: unknown): value is LatLng {
  if (!value || typeof value !== 'object') return false
  const position = value as { lat?: unknown; lng?: unknown }
  return typeof position.lat === 'number'
    && Number.isFinite(position.lat)
    && typeof position.lng === 'number'
    && Number.isFinite(position.lng)
    && position.lat >= -90
    && position.lat <= 90
    && position.lng >= -180
    && position.lng <= 180
}

function samePosition(left: LatLng, right: LatLng): boolean {
  return left.lat === right.lat && left.lng === right.lng
}

function openRing(points: unknown, minimumPoints: number): LatLng[] | null {
  if (!Array.isArray(points)) return null
  const normalized = points.filter(isFinitePosition)
  if (normalized.length !== points.length) return null
  if (normalized.length > 1 && samePosition(normalized[0], normalized[normalized.length - 1])) {
    normalized.pop()
  }
  return normalized.length >= minimumPoints ? normalized : null
}

function resolveGeometry(poi: POI): RuntimePOIGeometry | null {
  if (!isFinitePosition(poi.position)) return null
  const geometry = poi.geometry
  if (!geometry) return { type: 'point', position: poi.position }

  if (geometry.type === 'point') {
    return isFinitePosition(geometry.position)
      ? { type: 'point', position: geometry.position }
      : null
  }

  if (geometry.type === 'circle') {
    return isFinitePosition(geometry.center)
      && typeof geometry.radius === 'number'
      && Number.isFinite(geometry.radius)
      && geometry.radius >= 0
      ? { type: 'circle', center: geometry.center, radius: geometry.radius }
      : null
  }

  const points = openRing(geometry.points, geometry.type === 'rectangle' ? 4 : 3)
  if (!points) return null
  return { type: geometry.type, points }
}

function distanceToBoundary(position: LatLng, points: LatLng[]): number {
  let nearest = Infinity
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length]
    const projected = closestPointOnSegment(position, points[index], next)
    nearest = Math.min(nearest, haversine(position, projected))
  }
  return nearest
}

/**
 * Return the horizontal distance from a world position to a POI's geometry.
 * A point inside a shaped POI has distance zero. Invalid input returns null.
 */
export function distanceToPoiGeometry(position: LatLng, poi: POI): number | null {
  if (!isFinitePosition(position)) return null
  const geometry = resolveGeometry(poi)
  if (!geometry) return null

  if (geometry.type === 'point') return haversine(position, geometry.position)
  if (geometry.type === 'circle') {
    return Math.max(0, haversine(position, geometry.center) - geometry.radius)
  }

  if (pointInPolygon(position, { points: geometry.points })) return 0
  return distanceToBoundary(position, geometry.points)
}

function hasRequiredContext(poi: POI, context: PoiArrivalContext): boolean {
  if (poi.buildingId && context.buildingId !== poi.buildingId) return false
  if (poi.floor !== undefined && context.floor !== poi.floor) return false
  return true
}

/** Return whether a position satisfies POI geometry and required context. */
export function isPoiArrival(
  position: LatLng,
  poi: POI,
  context: PoiArrivalContext = {},
  toleranceMeters = POI_ARRIVAL_TOLERANCE_METERS,
): boolean {
  if (!Number.isFinite(toleranceMeters) || toleranceMeters < 0) return false
  if (!hasRequiredContext(poi, context)) return false
  const distance = distanceToPoiGeometry(position, poi)
  return distance !== null && distance <= toleranceMeters
}
