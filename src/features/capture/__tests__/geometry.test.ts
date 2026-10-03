import { describe, expect, it } from 'vitest'
import { deriveCandidateRoute, type CaptureRouteDetail } from '../geometry'
import { haversineMeters } from '@/features/capture-review/metrics'
import type { RawGpsSample } from '../types'

const EARTH_RADIUS_METERS = 6_371_008.8
const ORIGIN = { latitude: 11.8, longitude: 122.1 }
const METERS_PER_DEGREE_LATITUDE = Math.PI * EARTH_RADIUS_METERS / 180
const METERS_PER_DEGREE_LONGITUDE = METERS_PER_DEGREE_LATITUDE * Math.cos(ORIGIN.latitude * Math.PI / 180)

function sample(sequence: number, latitude: number, longitude: number): RawGpsSample {
  return {
    sequence,
    timestamp: new Date(Date.parse('2026-08-31T10:00:00.000Z') + sequence * 1000).toISOString(),
    latitude,
    longitude,
    accuracy: 4,
    altitude: null,
    altitudeAccuracy: null,
    heading: null,
    speed: null,
  }
}

function coordinate(xMeters: number, yMeters: number) {
  return {
    latitude: ORIGIN.latitude + yMeters / METERS_PER_DEGREE_LATITUDE,
    longitude: ORIGIN.longitude + xMeters / METERS_PER_DEGREE_LONGITUDE,
  }
}

function pathSamples(points: Array<[number, number]>, options: { accuracy?: number | null; speed?: number | null } = {}) {
  return points.map(([xMeters, yMeters], index) => ({
    ...sample(index, coordinate(xMeters, yMeters).latitude, coordinate(xMeters, yMeters).longitude),
    accuracy: options.accuracy ?? 4,
    speed: options.speed ?? null,
  }))
}

function maxCandidateSegmentMeters(points: Array<{ latitude: number; longitude: number }>) {
  return points.slice(1).reduce((maximum, point, index) => Math.max(maximum, haversineMeters(points[index], point)), 0)
}

function gentleCurveSamples() {
  return pathSamples(Array.from({ length: 25 }, (_, index) => {
    const progress = index / 24
    return [index * 4, 3.5 * Math.sin(progress * Math.PI)] as [number, number]
  }))
}

describe('deriveCandidateRoute', () => {
  it('simplifies into a separate candidate without mutating raw samples', () => {
    const rawSamples = [
      sample(0, 11.800000, 122.100000),
      sample(1, 11.800001, 122.100010),
      sample(2, 11.800002, 122.100020),
      sample(3, 11.800100, 122.100100),
    ]
    const before = structuredClone(rawSamples)

    const candidate = deriveCandidateRoute(rawSamples, { toleranceMeters: 5 })

    expect(candidate).not.toBeNull()
    expect(candidate?.points[0]).toEqual({ latitude: rawSamples[0].latitude, longitude: rawSamples[0].longitude })
    expect(candidate?.points.at(-1)).toEqual({ latitude: rawSamples.at(-1)?.latitude, longitude: rawSamples.at(-1)?.longitude })
    expect(candidate?.points.length).toBeLessThan(rawSamples.length)
    expect(candidate?.sourceSampleIndices[0]).toBe(0)
    expect(candidate?.sourceSampleIndices.at(-1)).toBe(rawSamples.length - 1)
    expect(rawSamples).toEqual(before)
    expect(candidate?.points).not.toBe(rawSamples)
  })

  it('returns null for an empty raw sample collection', () => {
    expect(deriveCandidateRoute([])).toBeNull()
  })

  it('keeps a straight noisy path compact while preserving every raw sample', () => {
    const rawSamples = pathSamples(Array.from({ length: 25 }, (_, index) => [index * 4, index % 2 === 0 ? 0.8 : -0.7] as [number, number]))
    const before = structuredClone(rawSamples)

    const candidate = deriveCandidateRoute(rawSamples, { detail: 'balanced' })

    expect(candidate).not.toBeNull()
    expect(candidate?.points.length).toBeLessThan(rawSamples.length * 0.6)
    expect(candidate?.algorithmVersion).toBe('capture-quality-dp-v2')
    expect(rawSamples).toEqual(before)
  })

  it('retains enough source geometry for a gentle curve and bounds long retained segments', () => {
    const rawSamples = gentleCurveSamples()
    const candidate = deriveCandidateRoute(rawSamples, { detail: 'balanced' })

    expect(candidate).not.toBeNull()
    expect(candidate!.points.length).toBeGreaterThanOrEqual(6)
    expect(candidate!.points.some((point) => point.latitude > ORIGIN.latitude + 2 / METERS_PER_DEGREE_LATITUDE)).toBe(true)
    expect(maxCandidateSegmentMeters(candidate!.points)).toBeLessThanOrEqual(12.5)
    expect(candidate!.sourceSampleIndices.every((index) => index >= 0 && index < rawSamples.length)).toBe(true)
  })

  it('preserves a sharp turn and both bends of an S-curve', () => {
    const sharpTurn = pathSamples([[0, 0], [5, 0], [10, 0], [10, 5], [10, 10], [10, 15]])
    const sharpCandidate = deriveCandidateRoute(sharpTurn, { detail: 'balanced' })
    expect(sharpCandidate?.sourceSampleIndices).toContain(2)
    expect(sharpCandidate?.sourceSampleIndices.some((index) => index === 3 || index === 4)).toBe(true)

    const sCurve = pathSamples(Array.from({ length: 25 }, (_, index) => {
      const progress = index / 24
      return [index * 4, 8 * Math.sin(progress * Math.PI * 2)] as [number, number]
    }))
    const sCandidate = deriveCandidateRoute(sCurve, { detail: 'balanced' })
    expect(sCandidate?.points.some((point) => point.latitude > ORIGIN.latitude + 3 / METERS_PER_DEGREE_LATITUDE)).toBe(true)
    expect(sCandidate?.points.some((point) => point.latitude < ORIGIN.latitude - 3 / METERS_PER_DEGREE_LATITUDE)).toBe(true)
  })

  it('rejects an isolated low-confidence GPS spike from candidate geometry', () => {
    const rawSamples = pathSamples([[0, 0], [5, 0], [10, 0], [15, 35], [20, 0], [25, 0], [30, 0]])
    rawSamples[3].accuracy = 60
    const before = structuredClone(rawSamples)

    const candidate = deriveCandidateRoute(rawSamples, { detail: 'detailed' })

    expect(candidate?.sourceSampleIndices).not.toContain(3)
    expect(candidate?.points.some((point) => point.latitude > ORIGIN.latitude + 20 / METERS_PER_DEGREE_LATITUDE)).toBe(false)
    expect(rawSamples).toEqual(before)
  })

  it('collapses stationary jitter without deleting it from raw evidence', () => {
    const rawSamples = pathSamples([
      [0, 0], [0.8, -0.7], [-0.6, 0.6], [0.5, 0.4], [-0.4, -0.5], [0.2, 0.3],
    ], { speed: 0 })
    const before = structuredClone(rawSamples)

    const candidate = deriveCandidateRoute(rawSamples, { detail: 'detailed' })

    expect(candidate?.points.length).toBeLessThanOrEqual(2)
    expect(rawSamples).toEqual(before)
  })

  it.each([
    ['simpler', 5.5, 20],
    ['balanced', 3, 12],
    ['detailed', 1.5, 8],
  ] as Array<[CaptureRouteDetail, number, number]>)('uses the %s route-detail profile', (detail, toleranceMeters, maxSegmentLengthMeters) => {
    const candidate = deriveCandidateRoute(gentleCurveSamples(), { detail })

    expect(candidate).not.toBeNull()
    expect(candidate?.algorithmVersion).toBe('capture-quality-dp-v2')
    expect(maxCandidateSegmentMeters(candidate!.points)).toBeLessThanOrEqual(maxSegmentLengthMeters + 0.5)
    if (detail === 'simpler') expect(candidate!.points.length).toBeLessThanOrEqual(7)
    if (detail === 'balanced') expect(candidate!.points.length).toBeGreaterThan(deriveCandidateRoute(gentleCurveSamples(), { toleranceMeters, maxSegmentLengthMeters: 20 })!.points.length - 1)
  })

  it('increases useful trace detail without interpolating points', () => {
    const rawSamples = gentleCurveSamples()
    const simpler = deriveCandidateRoute(rawSamples, { detail: 'simpler' })
    const balanced = deriveCandidateRoute(rawSamples, { detail: 'balanced' })
    const detailed = deriveCandidateRoute(rawSamples, { detail: 'detailed' })

    expect(simpler && balanced && detailed).toBeTruthy()
    expect(simpler!.points.length).toBeLessThan(balanced!.points.length)
    expect(balanced!.points.length).toBeLessThan(detailed!.points.length)
    expect(detailed!.sourceSampleIndices.every((index) => rawSamples[index] !== undefined)).toBe(true)
  })
})
