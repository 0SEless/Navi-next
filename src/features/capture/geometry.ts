import type { CandidateRoute, CaptureCoordinate, RawGpsSample } from './types'

const EARTH_RADIUS_METERS = 6_371_008.8
const GPS_QUALITY_ACCURACY_THRESHOLD_METERS = 25
const STATIONARY_CLUSTER_RADIUS_METERS = 2
const STATIONARY_CLUSTER_MIN_POINTS = 3
const STATIONARY_SPEED_THRESHOLD_METERS_PER_SECOND = 0.35
const ISOLATED_SPIKE_DETOUR_METERS = 20
const ISOLATED_SPIKE_RETURN_RATIO = 0.75
const CANDIDATE_ALGORITHM_VERSION = 'capture-quality-dp-v2'

export type CaptureRouteDetail = 'simpler' | 'balanced' | 'detailed'

export interface CaptureRouteDetailProfile {
  toleranceMeters: number
  maxSegmentLengthMeters: number
}

export const CAPTURE_ROUTE_DETAIL_PROFILES: Record<CaptureRouteDetail, CaptureRouteDetailProfile> = {
  simpler: { toleranceMeters: 5.5, maxSegmentLengthMeters: 20 },
  balanced: { toleranceMeters: 3, maxSegmentLengthMeters: 12 },
  detailed: { toleranceMeters: 1.5, maxSegmentLengthMeters: 8 },
}

export const DEFAULT_CAPTURE_ROUTE_DETAIL: CaptureRouteDetail = 'balanced'

interface ProjectedPoint {
  x: number
  y: number
  sourceIndex: number
  coordinate: CaptureCoordinate
  accuracy: number | null
  speed: number | null
}

function isFiniteCoordinate(value: CaptureCoordinate): boolean {
  return Number.isFinite(value.latitude) && Number.isFinite(value.longitude)
}

function project(sample: RawGpsSample, origin: CaptureCoordinate, sourceIndex: number): ProjectedPoint {
  const latitudeRadians = origin.latitude * Math.PI / 180
  const metersPerDegreeLatitude = Math.PI * EARTH_RADIUS_METERS / 180
  const metersPerDegreeLongitude = metersPerDegreeLatitude * Math.cos(latitudeRadians)

  return {
    x: (sample.longitude - origin.longitude) * metersPerDegreeLongitude,
    y: (sample.latitude - origin.latitude) * metersPerDegreeLatitude,
    sourceIndex,
    coordinate: {
      latitude: sample.latitude,
      longitude: sample.longitude,
    },
    accuracy: sample.accuracy,
    speed: sample.speed,
  }
}

function distanceBetweenProjectedPoints(a: ProjectedPoint, b: ProjectedPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function isStationaryQualityPoint(point: ProjectedPoint): boolean {
  return point.speed == null || point.speed <= STATIONARY_SPEED_THRESHOLD_METERS_PER_SECOND
}

/**
 * Keep one representative for a compact stationary cluster. The original
 * samples remain in RawGpsSample[]; this only controls candidate derivation.
 */
function collapseStationaryJitter(points: ProjectedPoint[]): ProjectedPoint[] {
  if (points.length <= 2) return points.slice()

  const retained: ProjectedPoint[] = []
  let cluster: ProjectedPoint[] = []

  const flushCluster = () => {
    if (cluster.length >= STATIONARY_CLUSTER_MIN_POINTS) {
      retained.push(cluster[0])
    } else {
      retained.push(...cluster)
    }
    cluster = []
  }

  for (const point of points) {
    const anchor = cluster[0]
    if (
      anchor
      && isStationaryQualityPoint(point)
      && cluster.every(isStationaryQualityPoint)
      && distanceBetweenProjectedPoints(point, anchor) <= STATIONARY_CLUSTER_RADIUS_METERS
    ) {
      cluster.push(point)
      continue
    }

    if (cluster.length > 0) flushCluster()
    cluster = [point]
  }

  if (cluster.length > 0) flushCluster()
  return retained
}

/**
 * Remove only an isolated, low-confidence detour that returns to the trace.
 * A genuine corner has a meaningful bridge distance and is retained.
 */
function removeIsolatedSpikes(points: ProjectedPoint[]): ProjectedPoint[] {
  if (points.length <= 2) return points.slice()

  return points.filter((point, index) => {
    if (index === 0 || index === points.length - 1) return true

    const previous = points[index - 1]
    const next = points[index + 1]
    const distanceToPrevious = distanceBetweenProjectedPoints(previous, point)
    const distanceToNext = distanceBetweenProjectedPoints(point, next)
    const bridgeDistance = distanceBetweenProjectedPoints(previous, next)
    const detourDistance = distanceToPrevious + distanceToNext - bridgeDistance
    const poorFix = point.accuracy == null || point.accuracy > GPS_QUALITY_ACCURACY_THRESHOLD_METERS
    const returnsToTrace = bridgeDistance <= Math.min(distanceToPrevious, distanceToNext) * ISOLATED_SPIKE_RETURN_RATIO
    const implausibleSpeed = point.speed != null && point.speed > 10

    return !(detourDistance >= ISOLATED_SPIKE_DETOUR_METERS && returnsToTrace && (poorFix || implausibleSpeed))
  })
}

function qualityFilter(points: ProjectedPoint[]): ProjectedPoint[] {
  return removeIsolatedSpikes(collapseStationaryJitter(points))
}

function perpendicularDistance(point: ProjectedPoint, start: ProjectedPoint, end: ProjectedPoint): number {
  const dx = end.x - start.x
  const dy = end.y - start.y

  if (dx === 0 && dy === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y)
  }

  return Math.abs(dy * point.x - dx * point.y + end.x * start.y - end.y * start.x) / Math.hypot(dx, dy)
}

function douglasPeucker(points: ProjectedPoint[], toleranceMeters: number): ProjectedPoint[] {
  if (points.length <= 2) return points.slice()

  let maxDistance = toleranceMeters
  let splitIndex = -1
  const start = points[0]
  const end = points[points.length - 1]

  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = perpendicularDistance(points[index], start, end)
    if (distance > maxDistance) {
      maxDistance = distance
      splitIndex = index
    }
  }

  if (splitIndex === -1) {
    return [start, end]
  }

  const left = douglasPeucker(points.slice(0, splitIndex + 1), toleranceMeters)
  const right = douglasPeucker(points.slice(splitIndex), toleranceMeters)
  return left.slice(0, -1).concat(right)
}

/**
 * Retain existing trace points when simplification leaves an overlong edge.
 * This deliberately never interpolates a new coordinate.
 */
function retainMaximumSegmentLength(
  sourcePoints: ProjectedPoint[],
  simplifiedPoints: ProjectedPoint[],
  maximumSegmentLengthMeters: number,
): ProjectedPoint[] {
  if (simplifiedPoints.length <= 1 || maximumSegmentLengthMeters <= 0) return simplifiedPoints.slice()

  const retained: ProjectedPoint[] = [simplifiedPoints[0]]
  let current = simplifiedPoints[0]

  for (const target of simplifiedPoints.slice(1)) {
    let candidates = sourcePoints.filter((point) => point.sourceIndex > current.sourceIndex && point.sourceIndex <= target.sourceIndex)

    while (candidates.length > 0) {
      const targetIsReachable = distanceBetweenProjectedPoints(current, target) <= maximumSegmentLengthMeters
      if (targetIsReachable) {
        if (retained.at(-1)?.sourceIndex !== target.sourceIndex) retained.push(target)
        current = target
        break
      }

      const reachable = candidates.filter((point) => distanceBetweenProjectedPoints(current, point) <= maximumSegmentLengthMeters)
      const next = reachable.at(-1) ?? candidates[0]
      if (next.sourceIndex === current.sourceIndex) break
      if (retained.at(-1)?.sourceIndex !== next.sourceIndex) retained.push(next)
      current = next
      candidates = candidates.filter((point) => point.sourceIndex > current.sourceIndex)
    }

    if (current.sourceIndex !== target.sourceIndex && retained.at(-1)?.sourceIndex !== target.sourceIndex) {
      // The source trace itself has a gap larger than the configured bound.
      // Preserve the authoritative endpoint rather than inventing a point.
      retained.push(target)
      current = target
    }
  }

  return retained
}

export function deriveCandidateRoute(
  samples: RawGpsSample[],
  options: {
    detail?: CaptureRouteDetail
    toleranceMeters?: number
    maxSegmentLengthMeters?: number
    derivedAt?: string
  } = {},
): CandidateRoute | null {
  const validSamples = samples
    .map((sample, sourceIndex) => ({ sample, sourceIndex }))
    .filter(({ sample }) => isFiniteCoordinate(sample))

  if (validSamples.length === 0) return null

  const origin = validSamples[0].sample
  const projected = validSamples.map(({ sample, sourceIndex }) => project(sample, origin, sourceIndex))
  const qualityFiltered = qualityFilter(projected)
  const profile = CAPTURE_ROUTE_DETAIL_PROFILES[options.detail ?? DEFAULT_CAPTURE_ROUTE_DETAIL]
  const toleranceMeters = Math.max(0, options.toleranceMeters ?? profile.toleranceMeters)
  const maxSegmentLengthMeters = options.maxSegmentLengthMeters ?? profile.maxSegmentLengthMeters
  const simplified = douglasPeucker(
    qualityFiltered,
    toleranceMeters,
  )
  const retained = retainMaximumSegmentLength(qualityFiltered, simplified, maxSegmentLengthMeters)

  return {
    points: retained.map((point) => ({ ...point.coordinate })),
    sourceSampleIndices: retained.map((point) => point.sourceIndex),
    edgeCount: Math.max(0, retained.length - 1),
    derivedFromSampleCount: samples.length,
    derivedAt: options.derivedAt ?? new Date().toISOString(),
    algorithmVersion: CANDIDATE_ALGORITHM_VERSION,
  }
}

export function captureCoordinatesToGeoJsonLine(points: CaptureCoordinate[]): [number, number][] {
  return points.map((point) => [point.longitude, point.latitude])
}

export function getCaptureBounds(session: { rawSamples: RawGpsSample[]; markers: { position: CaptureCoordinate }[] }) {
  const coordinates = [
    ...session.rawSamples.map((sample) => ({ latitude: sample.latitude, longitude: sample.longitude })),
    ...session.markers.map((marker) => marker.position),
  ].filter(isFiniteCoordinate)

  if (coordinates.length === 0) return null

  return coordinates.reduce(
    (bounds, coordinate) => ({
      minLat: Math.min(bounds.minLat, coordinate.latitude),
      maxLat: Math.max(bounds.maxLat, coordinate.latitude),
      minLng: Math.min(bounds.minLng, coordinate.longitude),
      maxLng: Math.max(bounds.maxLng, coordinate.longitude),
    }),
    {
      minLat: coordinates[0].latitude,
      maxLat: coordinates[0].latitude,
      minLng: coordinates[0].longitude,
      maxLng: coordinates[0].longitude,
    },
  )
}
