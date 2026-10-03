import type { CaptureCoordinate, CaptureSession, RawGpsSample } from '@/features/capture/types'
import type { CaptureReviewGeoJson, CaptureReviewSelection, AccuracyWarningSegment, CaptureReviewMetrics } from './types'

export const DEFAULT_GPS_WARNING_ACCURACY_METERS = 20

function toRadians(value: number) {
  return value * Math.PI / 180
}

export function haversineMeters(a: CaptureCoordinate, b: CaptureCoordinate): number {
  const earthRadiusMeters = 6_371_000
  const latitudeDelta = toRadians(b.latitude - a.latitude)
  const longitudeDelta = toRadians(b.longitude - a.longitude)
  const latitudeA = toRadians(a.latitude)
  const latitudeB = toRadians(b.latitude)
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(longitudeDelta / 2) ** 2
  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
}

function parseTimestamp(value: string | undefined): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function sumDistance(samples: RawGpsSample[]): number {
  let distance = 0
  for (let index = 1; index < samples.length; index += 1) {
    distance += haversineMeters(samples[index - 1], samples[index])
  }
  return distance
}

export function getAccuracyWarningSegments(
  samples: RawGpsSample[],
  thresholdMeters = DEFAULT_GPS_WARNING_ACCURACY_METERS,
): AccuracyWarningSegment[] {
  const warnings: AccuracyWarningSegment[] = []
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1]
    const current = samples[index]
    const previousWarning = previous.accuracy == null || previous.accuracy > thresholdMeters
    const currentWarning = current.accuracy == null || current.accuracy > thresholdMeters
    if (!previousWarning && !currentWarning) continue

    warnings.push({
      id: `warning-${index - 1}-${index}`,
      sampleIndices: [index - 1, index],
      points: [
        { latitude: previous.latitude, longitude: previous.longitude },
        { latitude: current.latitude, longitude: current.longitude },
      ],
      reason: previous.accuracy == null || current.accuracy == null ? 'missing-accuracy' : 'low-accuracy',
    })
  }
  return warnings
}

export function getCaptureReviewMetrics(session: CaptureSession): CaptureReviewMetrics {
  const firstTimestamp = parseTimestamp(session.startedAt) ?? parseTimestamp(session.rawSamples[0]?.timestamp)
  const lastTimestamp = parseTimestamp(session.finishedAt)
    ?? parseTimestamp(session.rawSamples.at(-1)?.timestamp)
    ?? parseTimestamp(session.updatedAt)
  const durationSeconds = firstTimestamp != null && lastTimestamp != null
    ? Math.max(0, (lastTimestamp - firstTimestamp) / 1000)
    : 0
  const warnings = getAccuracyWarningSegments(session.rawSamples)
  const warningSampleCount = session.rawSamples.filter((sample) => (
    sample.accuracy == null || sample.accuracy > DEFAULT_GPS_WARNING_ACCURACY_METERS
  )).length

  return {
    distanceMeters: sumDistance(session.rawSamples),
    durationSeconds,
    candidateNodeCount: session.candidateRoute?.points.length ?? 0,
    candidateEdgeCount: session.candidateRoute?.edgeCount ?? 0,
    markerCount: session.markers.length,
    warningSampleCount,
    warningSegmentCount: warnings.length,
  }
}

function pointCoordinates(point: CaptureCoordinate): [number, number] {
  return [point.longitude, point.latitude]
}

function featureCollection(features: GeoJSON.Feature[]): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features }
}

function emptyLineFeatureCollection(): GeoJSON.FeatureCollection {
  return featureCollection([])
}

export function buildCaptureReviewGeoJson(
  session: CaptureSession,
  selection?: CaptureReviewSelection,
): CaptureReviewGeoJson {
  const rawCoordinates = session.rawSamples.map(pointCoordinates)
  const rawRoute = rawCoordinates.length >= 2
    ? featureCollection([{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: rawCoordinates } }])
    : emptyLineFeatureCollection()
  const candidatePoints = session.candidateRoute?.points ?? []
  const candidateRoute = featureCollection(candidatePoints.slice(1).map((point, index) => {
    const segmentId = `segment-${index}`
    const previous = candidatePoints[index]
    return {
      type: 'Feature' as const,
      properties: {
        segmentId,
        decision: selection?.routeSegments[segmentId] ?? 'included',
      },
      geometry: {
        type: 'LineString' as const,
        coordinates: [pointCoordinates(previous), pointCoordinates(point)],
      },
    }
  }))
  const candidateNodes = featureCollection(candidatePoints.map((point, index) => ({
    type: 'Feature' as const,
    properties: { nodeIndex: index },
    geometry: { type: 'Point' as const, coordinates: pointCoordinates(point) },
  })))
  const markers = featureCollection(session.markers.map((marker) => ({
    type: 'Feature' as const,
    properties: {
      id: marker.id,
      type: marker.type,
      label: marker.label ?? marker.type,
      decision: selection?.markers[marker.id] ?? 'included',
    },
    geometry: { type: 'Point' as const, coordinates: pointCoordinates(marker.position) },
  })))
  const gpsWarnings = featureCollection(getAccuracyWarningSegments(session.rawSamples).map((warning) => ({
    type: 'Feature' as const,
    properties: { id: warning.id, reason: warning.reason },
    geometry: { type: 'LineString' as const, coordinates: warning.points.map(pointCoordinates) },
  })))

  return {
    campus: emptyLineFeatureCollection(),
    rawRoute,
    candidateRoute,
    candidateNodes,
    markers,
    gpsWarnings,
  }
}
