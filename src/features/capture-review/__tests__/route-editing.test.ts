import { describe, expect, it } from 'vitest'
import type { Road } from '@navi/core'
import type { CandidateRoute, CaptureCoordinate, RawGpsSample } from '@/features/capture/types'
import {
  addReviewedCandidatePoint,
  applyEndpointSnap,
  cloneCandidateRoute,
  findEndpointSnapTargets,
  moveReviewedCandidatePoint,
  removeReviewedCandidatePoint,
  resetReviewedCandidateRoute,
} from '../route-editing'

const samples: RawGpsSample[] = [0, 1, 2, 3, 4, 5, 6].map((sequence) => ({
  sequence,
  timestamp: `2026-09-01T10:0${sequence}:00.000Z`,
  latitude: 11.8 + sequence * 0.0001,
  longitude: 122.1 + sequence * 0.0001,
  accuracy: 4,
  altitude: null,
  altitudeAccuracy: null,
  heading: null,
  speed: 1,
}))

const candidate: CandidateRoute = {
  points: [samples[0], samples[2], samples[4], samples[6]].map(toCoordinate),
  sourceSampleIndices: [0, 2, 4, 6],
  edgeCount: 3,
  derivedFromSampleCount: samples.length,
  derivedAt: '2026-09-01T10:07:00.000Z',
  algorithmVersion: 'capture-quality-dp-v2',
}

function toCoordinate(sample: RawGpsSample): CaptureCoordinate {
  return { latitude: sample.latitude, longitude: sample.longitude }
}

function road(id: string, points: Road['polyline']['points']): Road {
  return {
    id,
    name: 'Existing walkway',
    polyline: { points },
    width: 3,
    surface: 'paved',
    type: 'pedestrian',
    displayMode: 'visible',
    metadata: {},
  }
}

describe('reviewed candidate route editing', () => {
  it('moves a candidate point in a clone without changing raw samples or the source candidate', () => {
    const rawBefore = structuredClone(samples)
    const candidateBefore = structuredClone(candidate)
    const moved = moveReviewedCandidatePoint(candidate, 1, { latitude: 11.80025, longitude: 122.1002 })

    expect(moved).not.toBeNull()
    expect(moved).not.toBe(candidate)
    expect(moved?.points[1]).toEqual({ latitude: 11.80025, longitude: 122.1002 })
    expect(moved?.sourceSampleIndices).toEqual(candidate.sourceSampleIndices)
    expect(candidate).toEqual(candidateBefore)
    expect(samples).toEqual(rawBefore)
  })

  it('adds the nearest usable preserved raw-trace sample instead of an arbitrary coordinate', () => {
    const added = addReviewedCandidatePoint(candidate, samples, {
      latitude: 11.80031,
      longitude: 122.10031,
    })

    expect(added).not.toBeNull()
    expect(added?.points).toContainEqual(toCoordinate(samples[3]))
    expect(added?.sourceSampleIndices).toEqual([0, 2, 3, 4, 6])
    expect(added?.edgeCount).toBe(4)
    expect(samples).toEqual(expect.arrayContaining([samples[3]]))
  })

  it('protects the minimum two-point polyline when removing a point', () => {
    const reduced = removeReviewedCandidatePoint(candidate, 1)
    const minimumCandidate = {
      ...candidate,
      points: candidate.points.slice(0, 2),
      sourceSampleIndices: candidate.sourceSampleIndices.slice(0, 2),
      edgeCount: 1,
    }

    expect(reduced?.points).toHaveLength(3)
    expect(reduced?.edgeCount).toBe(2)
    expect(removeReviewedCandidatePoint(minimumCandidate, 0)).toBeNull()
  })

  it('resets to a clone of the generated candidate and supports null reset state', () => {
    const reset = resetReviewedCandidateRoute(candidate)

    expect(reset).toEqual(candidate)
    expect(reset).not.toBe(candidate)
    expect(cloneCandidateRoute(candidate)).toEqual(candidate)
    expect(resetReviewedCandidateRoute(null)).toBeNull()
  })

  it('detects a nearby endpoint projection on existing Road geometry without changing that Road', () => {
    const existingRoad = road('road-near-start', [
      { lat: 11.80005, lng: 122.0999 },
      { lat: 11.80005, lng: 122.1001 },
    ])
    const roadBefore = structuredClone(existingRoad)
    const targets = findEndpointSnapTargets(candidate, [existingRoad], 10)

    expect(targets).toHaveLength(1)
    expect(targets[0]).toMatchObject({
      endpoint: 'start',
      roadId: existingRoad.id,
      roadName: existingRoad.name,
      segmentIndex: 0,
    })
    expect(targets[0].distanceMeters).toBeLessThanOrEqual(10)
    expect(targets[0].coordinate.latitude).toBeCloseTo(11.80005, 7)
    expect(targets[0].coordinate.longitude).toBeCloseTo(122.1, 7)
    expect(existingRoad).toEqual(roadBefore)
    expect(findEndpointSnapTargets(candidate, [road('far-road', [{ lat: 11.81, lng: 122.11 }, { lat: 11.811, lng: 122.111 }])], 10)).toEqual([])
  })

  it('applies only an explicitly selected snap target and keeps candidate provenance intact', () => {
    const existingRoad = road('road-near-start', [
      { lat: 11.80005, lng: 122.0999 },
      { lat: 11.80005, lng: 122.1001 },
    ])
    const target = findEndpointSnapTargets(candidate, [existingRoad], 10)[0]
    const snapped = applyEndpointSnap(candidate, target)

    expect(snapped).not.toBeNull()
    expect(snapped?.points[0]).toEqual(target.coordinate)
    expect(snapped?.points.slice(1)).toEqual(candidate.points.slice(1))
    expect(snapped?.sourceSampleIndices).toEqual(candidate.sourceSampleIndices)
    expect(snapped?.edgeCount).toBe(candidate.edgeCount)
    expect(candidate.points[0]).toEqual(toCoordinate(samples[0]))
  })
})
