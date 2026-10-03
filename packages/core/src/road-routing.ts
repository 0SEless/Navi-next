import { polylineLengthHaversine } from './geometry/polyline'
import type { Road, RoadRouting } from './types/entities'
import type { RoadEdgeRouting } from './types/navigation-artifacts'
import type { RoadDirection, RoadRoutingFeature, RoadSlope } from './types/enums'

export interface EffectiveRoadRouting {
  feature: RoadRoutingFeature
  slope: RoadSlope
  direction: RoadDirection
  startElevationMeters?: number
  endElevationMeters?: number
  walkable: boolean
  /** Undefined deliberately represents unknown/legacy accessibility. */
  wheelchairAccessible?: boolean
}

function isRoadRoutingFeature(value: unknown): value is RoadRoutingFeature {
  return value === 'normal' || value === 'stairs' || value === 'ramp' || value === 'bridge'
}

function isRoadSlope(value: unknown): value is RoadSlope {
  return value === 'level' || value === 'gentle' || value === 'moderate' || value === 'steep'
}

function isRoadDirection(value: unknown): value is RoadDirection {
  return value === 'both' || value === 'forward' || value === 'reverse'
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * Preserve only explicitly authored, valid routing members. This is the shared
 * persistence/authoring boundary: it never materializes effective defaults.
 */
export function normalizeRoadRouting(routing: unknown): RoadRouting | undefined {
  if (!routing || typeof routing !== 'object' || Array.isArray(routing)) return undefined

  const source = routing as Record<string, unknown>
  const normalized: RoadRouting = {}

  if (isRoadRoutingFeature(source.feature)) normalized.feature = source.feature
  if (isRoadSlope(source.slope)) normalized.slope = source.slope
  if (isRoadDirection(source.direction)) normalized.direction = source.direction

  const startElevationMeters = finiteNumber(source.startElevationMeters)
  if (startElevationMeters !== undefined) normalized.startElevationMeters = startElevationMeters

  const endElevationMeters = finiteNumber(source.endElevationMeters)
  if (endElevationMeters !== undefined) normalized.endElevationMeters = endElevationMeters

  if (typeof source.walkable === 'boolean') normalized.walkable = source.walkable
  if (typeof source.wheelchairAccessible === 'boolean') {
    normalized.wheelchairAccessible = source.wheelchairAccessible
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined
}

const ROAD_ROUTING_KEYS = new Set([
  'feature',
  'slope',
  'direction',
  'startElevationMeters',
  'endElevationMeters',
  'walkable',
  'wheelchairAccessible',
])

/** True only when every present member is supported and already normalized. */
export function isValidRoadRouting(routing: unknown): routing is RoadRouting {
  if (!routing || typeof routing !== 'object' || Array.isArray(routing)) return false
  const source = routing as Record<string, unknown>
  const keys = Object.keys(source)
  if (keys.length === 0 || keys.some(key => !ROAD_ROUTING_KEYS.has(key))) return false

  const normalized = normalizeRoadRouting(source)
  if (!normalized || Object.keys(normalized).length !== keys.length) return false
  return keys.every(key => Object.is(source[key], normalized[key as keyof RoadRouting]))
}

/**
 * Safely normalize the additive graph-edge wrapper. Authored elevation values
 * remain Road-level metadata; this helper never derives segment elevations.
 */
export function normalizeRoadEdgeRouting(value: unknown): RoadEdgeRouting | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const source = value as Record<string, unknown>
  if (typeof source.sourceRoadId !== 'string' || source.sourceRoadId.trim().length === 0) return undefined
  if (source.authoredOrientation !== 'forward') return undefined

  const authored = normalizeRoadRouting(source.authored)
  if (!authored) return undefined
  return {
    sourceRoadId: source.sourceRoadId,
    authoredOrientation: 'forward',
    authored,
  }
}

/** Fail-closed canonical artifact check for the exact additive edge contract. */
export function isValidRoadEdgeRouting(value: unknown): value is RoadEdgeRouting {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const source = value as Record<string, unknown>
  if (
    Object.keys(source).length !== 3 ||
    !Object.prototype.hasOwnProperty.call(source, 'sourceRoadId') ||
    !Object.prototype.hasOwnProperty.call(source, 'authoredOrientation') ||
    !Object.prototype.hasOwnProperty.call(source, 'authored')
  ) return false

  return normalizeRoadEdgeRouting(source) !== undefined && isValidRoadRouting(source.authored)
}

/**
 * Read Road routing semantics without mutating or materializing defaults on the
 * authored Road. Runtime validation keeps malformed persisted values safe.
 */
export function getEffectiveRoadRouting(road: Pick<Road, 'routing'>): EffectiveRoadRouting {
  const routing = normalizeRoadRouting(road.routing)

  return {
    feature: routing?.feature ?? 'normal',
    slope: routing?.slope ?? 'level',
    direction: routing?.direction ?? 'both',
    startElevationMeters: routing?.startElevationMeters,
    endElevationMeters: routing?.endElevationMeters,
    walkable: typeof routing?.walkable === 'boolean' ? routing.walkable : true,
    wheelchairAccessible: routing?.wheelchairAccessible,
  }
}

/** Signed authored elevation change: end minus start, in meters. */
export function getRoadElevationDeltaMeters(
  road: Pick<Road, 'routing'>,
): number | undefined {
  const { startElevationMeters, endElevationMeters } = getEffectiveRoadRouting(road)
  if (startElevationMeters === undefined || endElevationMeters === undefined) return undefined

  const delta = endElevationMeters - startElevationMeters
  return Number.isFinite(delta) ? delta : undefined
}

function isValidGeographicPoint(point: unknown): point is { lat: number; lng: number } {
  if (!point || typeof point !== 'object') return false
  const { lat, lng } = point as { lat?: unknown; lng?: unknown }
  return (
    typeof lat === 'number' &&
    Number.isFinite(lat) &&
    lat >= -90 &&
    lat <= 90 &&
    typeof lng === 'number' &&
    Number.isFinite(lng) &&
    lng >= -180 &&
    lng <= 180
  )
}

/** Summed haversine length of every authored Road polyline segment, in meters. */
export function getRoadPolylineLengthMeters(
  road: Pick<Road, 'polyline'>,
): number | undefined {
  const points = road.polyline?.points
  if (!Array.isArray(points) || points.length < 2 || !points.every(isValidGeographicPoint)) {
    return undefined
  }

  const length = polylineLengthHaversine(road.polyline)
  return Number.isFinite(length) && length > 0 ? length : undefined
}

/** Signed grade percentage in authored forward direction. */
export function getRoadGradePercent(
  road: Pick<Road, 'routing' | 'polyline'>,
): number | undefined {
  const elevationDelta = getRoadElevationDeltaMeters(road)
  const length = getRoadPolylineLengthMeters(road)
  if (elevationDelta === undefined || length === undefined) return undefined

  const grade = (elevationDelta / length) * 100
  return Number.isFinite(grade) ? grade : undefined
}
