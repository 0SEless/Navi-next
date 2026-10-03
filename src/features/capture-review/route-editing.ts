import type { Road } from '@navi/core'
import type { CandidateRoute, CaptureCoordinate, RawGpsSample } from '@/features/capture/types'

const EARTH_RADIUS_METERS = 6_371_008.8
const DEFAULT_ENDPOINT_SNAP_DISTANCE_METERS = 8
const DEFAULT_RAW_TRACE_REFERENCE_DISTANCE_METERS = 20

export const MIN_REVIEWED_ROUTE_POINTS = 2

export type CaptureRouteEndpoint = 'start' | 'end'

export interface EndpointSnapTarget {
  endpoint: CaptureRouteEndpoint
  roadId: string
  roadName: string
  segmentIndex: number
  coordinate: CaptureCoordinate
  distanceMeters: number
}

interface ProjectedCoordinate {
  x: number
  y: number
}

interface NearestRawTraceSample {
  sample: RawGpsSample
  sourceIndex: number
  distanceMeters: number
}

function isValidCoordinate(coordinate: CaptureCoordinate): boolean {
  return Number.isFinite(coordinate.latitude)
    && coordinate.latitude >= -90
    && coordinate.latitude <= 90
    && Number.isFinite(coordinate.longitude)
    && coordinate.longitude >= -180
    && coordinate.longitude <= 180
}

function cloneCoordinate(coordinate: CaptureCoordinate): CaptureCoordinate {
  return { latitude: coordinate.latitude, longitude: coordinate.longitude }
}

export function cloneCandidateRoute(candidate: CandidateRoute): CandidateRoute {
  return {
    ...candidate,
    points: candidate.points.map(cloneCoordinate),
    sourceSampleIndices: [...candidate.sourceSampleIndices],
  }
}

export function moveReviewedCandidatePoint(
  candidate: CandidateRoute,
  index: number,
  coordinate: CaptureCoordinate,
): CandidateRoute | null {
  if (!Number.isInteger(index) || index < 0 || index >= candidate.points.length || !isValidCoordinate(coordinate)) {
    return null
  }

  const reviewed = cloneCandidateRoute(candidate)
  reviewed.points[index] = cloneCoordinate(coordinate)
  return reviewed
}

function toCoordinate(sample: RawGpsSample): CaptureCoordinate {
  return { latitude: sample.latitude, longitude: sample.longitude }
}

function project(coordinate: CaptureCoordinate, origin: CaptureCoordinate): ProjectedCoordinate {
  const latitudeRadians = origin.latitude * Math.PI / 180
  const metersPerDegreeLatitude = Math.PI * EARTH_RADIUS_METERS / 180
  const metersPerDegreeLongitude = metersPerDegreeLatitude * Math.cos(latitudeRadians)
  return {
    x: (coordinate.longitude - origin.longitude) * metersPerDegreeLongitude,
    y: (coordinate.latitude - origin.latitude) * metersPerDegreeLatitude,
  }
}

function distance(a: ProjectedCoordinate, b: ProjectedCoordinate): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function findNearestRawTraceSample(
  samples: RawGpsSample[],
  target: CaptureCoordinate,
  maximumDistanceMeters = DEFAULT_RAW_TRACE_REFERENCE_DISTANCE_METERS,
): NearestRawTraceSample | null {
  if (!isValidCoordinate(target) || !Number.isFinite(maximumDistanceMeters) || maximumDistanceMeters < 0) return null

  let nearest: NearestRawTraceSample | null = null
  for (const [sourceIndex, sample] of samples.entries()) {
    if (!isValidCoordinate(sample)) continue
    const sampleDistance = distance(project(sample, target), { x: 0, y: 0 })
    if (sampleDistance > maximumDistanceMeters) continue
    if (!nearest || sampleDistance < nearest.distanceMeters) {
      nearest = { sample, sourceIndex, distanceMeters: sampleDistance }
    }
  }
  return nearest
}

export function addReviewedCandidatePoint(
  candidate: CandidateRoute,
  rawSamples: RawGpsSample[],
  requestedCoordinate: CaptureCoordinate,
): CandidateRoute | null {
  const nearest = findNearestRawTraceSample(rawSamples, requestedCoordinate)
  if (!nearest || candidate.points.length < MIN_REVIEWED_ROUTE_POINTS) return null
  if (candidate.sourceSampleIndices.includes(nearest.sourceIndex)) return null

  let insertIndex = candidate.sourceSampleIndices.findIndex((sourceIndex) => nearest.sourceIndex < sourceIndex)
  if (insertIndex === -1) insertIndex = candidate.points.length

  const previousSourceIndex = candidate.sourceSampleIndices[insertIndex - 1]
  const nextSourceIndex = candidate.sourceSampleIndices[insertIndex]
  if (previousSourceIndex !== undefined && nearest.sourceIndex <= previousSourceIndex) return null
  if (nextSourceIndex !== undefined && nearest.sourceIndex >= nextSourceIndex) return null

  const reviewed = cloneCandidateRoute(candidate)
  reviewed.points.splice(insertIndex, 0, toCoordinate(nearest.sample))
  reviewed.sourceSampleIndices.splice(insertIndex, 0, nearest.sourceIndex)
  reviewed.edgeCount = Math.max(0, reviewed.points.length - 1)
  return reviewed
}

export function removeReviewedCandidatePoint(candidate: CandidateRoute, index: number): CandidateRoute | null {
  if (
    !Number.isInteger(index)
    || index < 0
    || index >= candidate.points.length
    || candidate.points.length <= MIN_REVIEWED_ROUTE_POINTS
  ) {
    return null
  }

  const reviewed = cloneCandidateRoute(candidate)
  reviewed.points.splice(index, 1)
  reviewed.sourceSampleIndices.splice(index, 1)
  reviewed.edgeCount = Math.max(0, reviewed.points.length - 1)
  return reviewed
}

export function resetReviewedCandidateRoute(candidate: CandidateRoute | null | undefined): CandidateRoute | null {
  return candidate ? cloneCandidateRoute(candidate) : null
}

function nearestPointOnSegment(
  target: CaptureCoordinate,
  start: CaptureCoordinate,
  end: CaptureCoordinate,
): { coordinate: CaptureCoordinate; distanceMeters: number } | null {
  if (!isValidCoordinate(target) || !isValidCoordinate(start) || !isValidCoordinate(end)) return null
  const projectedStart = project(start, target)
  const projectedEnd = project(end, target)
  const segmentX = projectedEnd.x - projectedStart.x
  const segmentY = projectedEnd.y - projectedStart.y
  const segmentLengthSquared = segmentX ** 2 + segmentY ** 2
  const projection = segmentLengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, (-(projectedStart.x * segmentX + projectedStart.y * segmentY)) / segmentLengthSquared))
  const projectedPoint = {
    x: projectedStart.x + projection * segmentX,
    y: projectedStart.y + projection * segmentY,
  }
  return {
    coordinate: {
      latitude: start.latitude + projection * (end.latitude - start.latitude),
      longitude: start.longitude + projection * (end.longitude - start.longitude),
    },
    distanceMeters: distance(projectedPoint, { x: 0, y: 0 }),
  }
}

function closestEndpointTarget(
  endpoint: CaptureRouteEndpoint,
  coordinate: CaptureCoordinate,
  roads: Road[],
  maximumDistanceMeters: number,
): EndpointSnapTarget | null {
  let closest: EndpointSnapTarget | null = null
  for (const road of roads) {
    const points = road.polyline.points
    for (let segmentIndex = 0; segmentIndex < points.length - 1; segmentIndex += 1) {
      const nearest = nearestPointOnSegment(
        coordinate,
        { latitude: points[segmentIndex].lat, longitude: points[segmentIndex].lng },
        { latitude: points[segmentIndex + 1].lat, longitude: points[segmentIndex + 1].lng },
      )
      if (!nearest || nearest.distanceMeters > maximumDistanceMeters) continue
      if (!closest || nearest.distanceMeters < closest.distanceMeters) {
        closest = {
          endpoint,
          roadId: road.id,
          roadName: road.name,
          segmentIndex,
          coordinate: nearest.coordinate,
          distanceMeters: nearest.distanceMeters,
        }
      }
    }
  }
  return closest
}

export function findEndpointSnapTargets(
  candidate: CandidateRoute | null | undefined,
  roads: Road[],
  maximumDistanceMeters = DEFAULT_ENDPOINT_SNAP_DISTANCE_METERS,
): EndpointSnapTarget[] {
  if (!candidate || candidate.points.length < MIN_REVIEWED_ROUTE_POINTS) return []
  if (!Number.isFinite(maximumDistanceMeters) || maximumDistanceMeters < 0) return []

  const endpoints: Array<[CaptureRouteEndpoint, CaptureCoordinate | undefined]> = [
    ['start', candidate.points[0]],
    ['end', candidate.points.at(-1)],
  ]
  return endpoints.flatMap(([endpoint, coordinate]) => {
    if (!coordinate) return []
    const target = closestEndpointTarget(endpoint, coordinate, roads, maximumDistanceMeters)
    return target ? [target] : []
  })
}

export function applyEndpointSnap(candidate: CandidateRoute, target: EndpointSnapTarget | null | undefined): CandidateRoute | null {
  if (!target || !isValidCoordinate(target.coordinate) || candidate.points.length < MIN_REVIEWED_ROUTE_POINTS) return null
  const index = target.endpoint === 'start' ? 0 : candidate.points.length - 1
  const reviewed = cloneCandidateRoute(candidate)
  reviewed.points[index] = cloneCoordinate(target.coordinate)
  return reviewed
}
