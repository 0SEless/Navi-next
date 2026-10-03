import { describe, expect, it } from 'vitest'
import { buildCaptureReviewGeoJson, getAccuracyWarningSegments, getCaptureReviewMetrics } from '../metrics'
import type { CaptureSession } from '@/features/capture/types'

const session: CaptureSession = {
  schemaVersion: 1,
  id: 'capture-review-1',
  title: 'North path',
  status: 'finished',
  createdAt: '2026-08-31T10:00:00.000Z',
  updatedAt: '2026-08-31T10:01:00.000Z',
  startedAt: '2026-08-31T10:00:00.000Z',
  finishedAt: '2026-08-31T10:01:00.000Z',
  rawSamples: [
    { sequence: 0, timestamp: '2026-08-31T10:00:00.000Z', latitude: 11.8000, longitude: 122.1000, accuracy: 5, altitude: null, altitudeAccuracy: null, heading: null, speed: null },
    { sequence: 1, timestamp: '2026-08-31T10:00:30.000Z', latitude: 11.8005, longitude: 122.1005, accuracy: 35, altitude: null, altitudeAccuracy: null, heading: null, speed: null },
    { sequence: 2, timestamp: '2026-08-31T10:01:00.000Z', latitude: 11.8010, longitude: 122.1010, accuracy: null, altitude: null, altitudeAccuracy: null, heading: null, speed: null },
  ],
  candidateRoute: {
    points: [
      { latitude: 11.8000, longitude: 122.1000 },
      { latitude: 11.8007, longitude: 122.1007 },
      { latitude: 11.8010, longitude: 122.1010 },
    ],
    sourceSampleIndices: [0, 1, 2],
    edgeCount: 2,
    derivedFromSampleCount: 3,
    derivedAt: '2026-08-31T10:01:00.000Z',
    algorithmVersion: 'capture-dp-v1',
  },
  markers: [
    { id: 'marker-poi', type: 'poi', label: 'Library', position: { latitude: 11.8005, longitude: 122.1005 }, createdAt: '2026-08-31T10:00:30.000Z' },
  ],
}

describe('Capture Reviewer metrics and GeoJSON', () => {
  it('calculates distance, duration, and warning counts without rewriting the session', () => {
    const before = structuredClone(session)
    const metrics = getCaptureReviewMetrics(session)

    expect(metrics.distanceMeters).toBeGreaterThan(0)
    expect(metrics.durationSeconds).toBe(60)
    expect(metrics.candidateNodeCount).toBe(3)
    expect(metrics.candidateEdgeCount).toBe(2)
    expect(metrics.markerCount).toBe(1)
    expect(metrics.warningSampleCount).toBe(2)
    expect(session).toEqual(before)
  })

  it('creates contiguous warning segments for missing or low GPS accuracy', () => {
    const warnings = getAccuracyWarningSegments(session.rawSamples)

    expect(warnings).toHaveLength(2)
    expect(warnings[0].sampleIndices).toEqual([0, 1])
    expect(warnings[1].sampleIndices).toEqual([1, 2])
    expect(warnings.every((warning) => warning.id.startsWith('warning-'))).toBe(true)
  })

  it('renders raw, candidate, node, marker, and warning GeoJSON independently', () => {
    const geoJson = buildCaptureReviewGeoJson(session)

    expect(geoJson.rawRoute.features[0].geometry.type).toBe('LineString')
    expect(geoJson.rawRoute.features[0].geometry.coordinates).toHaveLength(3)
    expect(geoJson.candidateRoute.features).toHaveLength(2)
    expect(geoJson.candidateRoute.features[0].properties?.segmentId).toBe('segment-0')
    expect(geoJson.candidateNodes.features).toHaveLength(3)
    expect(geoJson.markers.features[0].properties?.type).toBe('poi')
    expect(geoJson.gpsWarnings.features).toHaveLength(2)
  })
})

