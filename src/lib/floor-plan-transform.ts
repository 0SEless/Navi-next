import type { LatLng, LocalCoord, PlanAlignment } from '@navi/core'

export interface ResolvedPlanAlignment {
  offset: LocalCoord
  scaleX: number
  scaleY: number
  rotation: number
  opacity: number
  locked: boolean
}

export interface FootprintFrameMeters {
  center: LatLng
  corners: [LocalCoord, LocalCoord, LocalCoord, LocalCoord]
  width: number
  height: number
}

const EARTH_RADIUS_METERS = 6371000
const DEG_TO_RAD = Math.PI / 180
const DEFAULT_OPACITY = 0.7

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function positiveOr(value: unknown, fallback: number): number {
  const number = finiteOr(value, fallback)
  return number > 0 ? number : fallback
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function normalizeDegrees(value: number): number {
  const normalized = ((value + 180) % 360 + 360) % 360 - 180
  return Object.is(normalized, -0) ? 0 : normalized
}

function uniqueFootprintPoints(footprint: readonly LatLng[]): LatLng[] {
  const points: LatLng[] = []
  const seen = new Set<string>()
  for (const point of footprint) {
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) continue
    const key = `${point.lat}:${point.lng}`
    if (seen.has(key)) continue
    seen.add(key)
    points.push({ lat: point.lat, lng: point.lng })
  }
  return points
}

/**
 * Resolve every optional alignment field once. Explicit axis scales win over
 * legacy scale; malformed values fall back to the established defaults.
 */
export function resolvePlanAlignment(alignment?: PlanAlignment | null): ResolvedPlanAlignment {
  const legacyScale = positiveOr(alignment?.scale, 1)
  return {
    offset: {
      x: finiteOr(alignment?.offset?.x, 0),
      y: finiteOr(alignment?.offset?.y, 0),
    },
    scaleX: positiveOr(alignment?.scaleX, legacyScale),
    scaleY: positiveOr(alignment?.scaleY, legacyScale),
    rotation: normalizeDegrees(finiteOr(alignment?.rotation, 0)),
    opacity: clamp(finiteOr(alignment?.opacity, DEFAULT_OPACITY), 0, 1),
    locked: alignment?.locked === true,
  }
}

export function latLngToLocalMeters(point: LatLng, center: LatLng): LocalCoord {
  const cosLat = Math.cos(center.lat * DEG_TO_RAD)
  return {
    x: (point.lng - center.lng) * DEG_TO_RAD * EARTH_RADIUS_METERS * cosLat,
    y: (point.lat - center.lat) * DEG_TO_RAD * EARTH_RADIUS_METERS,
  }
}

/**
 * Return a footprint's de-duplicated center and bbox in true local meters.
 * Repeated closing vertices are ignored so open and closed rings share a
 * transform frame.
 */
export function getFootprintFrameMeters(footprint: readonly LatLng[]): FootprintFrameMeters {
  const points = uniqueFootprintPoints(footprint)
  if (points.length === 0) {
    const empty: LocalCoord = { x: 0, y: 0 }
    return { center: { lat: 0, lng: 0 }, corners: [empty, empty, empty, empty], width: 0, height: 0 }
  }

  const center = points.reduce(
    (sum, point) => ({ lat: sum.lat + point.lat, lng: sum.lng + point.lng }),
    { lat: 0, lng: 0 },
  )
  center.lat /= points.length
  center.lng /= points.length

  const localPoints = points.map(point => latLngToLocalMeters(point, center))
  const minX = Math.min(...localPoints.map(point => point.x))
  const maxX = Math.max(...localPoints.map(point => point.x))
  const minY = Math.min(...localPoints.map(point => point.y))
  const maxY = Math.max(...localPoints.map(point => point.y))
  const corners: [LocalCoord, LocalCoord, LocalCoord, LocalCoord] = [
    { x: minX, y: maxY },
    { x: maxX, y: maxY },
    { x: maxX, y: minY },
    { x: minX, y: minY },
  ]

  return { center, corners, width: maxX - minX, height: maxY - minY }
}

function rotateClockwise(point: LocalCoord, degrees: number): LocalCoord {
  const radians = degrees * DEG_TO_RAD
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return {
    x: point.x * cos + point.y * sin,
    y: -point.x * sin + point.y * cos,
  }
}

function rotateCounterClockwise(point: LocalCoord, degrees: number): LocalCoord {
  return rotateClockwise(point, -degrees)
}

/** Apply local-axis scale, clockwise rotation, and true-meter translation. */
export function transformLocalPoint(point: LocalCoord, alignment?: PlanAlignment | null): LocalCoord {
  const resolved = resolvePlanAlignment(alignment)
  const scaled = { x: point.x * resolved.scaleX, y: point.y * resolved.scaleY }
  const rotated = rotateClockwise(scaled, resolved.rotation)
  return {
    x: rotated.x + resolved.offset.x,
    y: rotated.y + resolved.offset.y,
  }
}

/** Invert the canonical local transform for calibration and hit testing. */
export function inverseTransformLocalPoint(point: LocalCoord, alignment?: PlanAlignment | null): LocalCoord {
  const resolved = resolvePlanAlignment(alignment)
  const untransformed = rotateCounterClockwise({
    x: point.x - resolved.offset.x,
    y: point.y - resolved.offset.y,
  }, resolved.rotation)
  return {
    x: untransformed.x / resolved.scaleX,
    y: untransformed.y / resolved.scaleY,
  }
}

export function getPlanDimensionsMeters(
  frame: Pick<FootprintFrameMeters, 'width' | 'height'>,
  alignment?: PlanAlignment | null,
): { width: number; height: number } {
  const resolved = resolvePlanAlignment(alignment)
  return { width: frame.width * resolved.scaleX, height: frame.height * resolved.scaleY }
}

export const floorPlanTransformConstants = {
  earthRadiusMeters: EARTH_RADIUS_METERS,
  degreesToRadians: DEG_TO_RAD,
  defaultOpacity: DEFAULT_OPACITY,
} as const
