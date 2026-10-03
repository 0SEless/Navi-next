import { describe, expect, it } from 'vitest'
import { calculateCaptureDistanceMeters, classifyCaptureAccuracy, formatCaptureDistance, formatCaptureDuration, getActiveCaptureDurationMs, getCaptureGpsReadiness } from '../metrics'
import type { CaptureSession, RawGpsSample } from '../types'

function sample(overrides: Partial<RawGpsSample> = {}): RawGpsSample {
  return {
    sequence: 0,
    timestamp: '2026-09-01T00:00:00.000Z',
    latitude: 11.8000,
    longitude: 122.1000,
    accuracy: 5,
    altitude: null,
    altitudeAccuracy: null,
    heading: null,
    speed: null,
    ...overrides,
  }
}

function session(overrides: Partial<CaptureSession> = {}): CaptureSession {
  return {
    schemaVersion: 1,
    id: 'capture-metrics-1',
    title: 'Metrics route',
    status: 'finished',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:01:00.000Z',
    startedAt: '2026-09-01T00:00:00.000Z',
    finishedAt: '2026-09-01T00:01:00.000Z',
    rawSamples: [],
    candidateRoute: null,
    markers: [],
    lastPosition: null,
    lastError: null,
    ...overrides,
  }
}

describe('Capture field metrics', () => {
  it('derives GPS readiness separately from Capture recording state', () => {
    expect(getCaptureGpsReadiness(null)).toBe('acquiring')
    expect(getCaptureGpsReadiness(sample({ accuracy: 5 }))).toBe('ready')
    expect(getCaptureGpsReadiness(sample({ accuracy: 30 }))).toBe('poor')
    expect(getCaptureGpsReadiness(sample({ accuracy: null }))).toBe('unknown')
  })

  it('returns zero distance for an empty or one-point raw trace', () => {
    expect(calculateCaptureDistanceMeters([])).toBe(0)
    expect(calculateCaptureDistanceMeters([sample()])).toBe(0)
  })

  it('sums valid GPS segments without mutating the raw samples', () => {
    const samples = [
      sample({ sequence: 0 }),
      sample({ sequence: 1, latitude: 11.8001, longitude: 122.1001 }),
      sample({ sequence: 2, latitude: 11.8002, longitude: 122.1002 }),
    ]
    const before = structuredClone(samples)

    const distance = calculateCaptureDistanceMeters(samples)

    expect(distance).toBeGreaterThan(0)
    expect(Number.isFinite(distance)).toBe(true)
    expect(samples).toEqual(before)
  })

  it('ignores malformed coordinates instead of producing NaN', () => {
    const distance = calculateCaptureDistanceMeters([
      sample(),
      sample({ sequence: 1, latitude: Number.NaN }),
      sample({ sequence: 2, latitude: 11.8002, longitude: 122.1002 }),
    ])

    expect(Number.isFinite(distance)).toBe(true)
    expect(distance).toBeGreaterThan(0)
  })

  it('classifies only finite non-negative accuracy values', () => {
    expect(classifyCaptureAccuracy(10)).toBe('good')
    expect(classifyCaptureAccuracy(10.01)).toBe('fair')
    expect(classifyCaptureAccuracy(25)).toBe('fair')
    expect(classifyCaptureAccuracy(25.01)).toBe('poor')
    expect(classifyCaptureAccuracy(null)).toBe('unknown')
    expect(classifyCaptureAccuracy(Number.NaN)).toBe('unknown')
    expect(classifyCaptureAccuracy(-1)).toBe('unknown')
  })

  it('formats distance and active time for a compact field HUD', () => {
    expect(formatCaptureDistance(0)).toBe('0 m')
    expect(formatCaptureDistance(123.4)).toBe('123 m')
    expect(formatCaptureDistance(1_234)).toBe('1.23 km')
    expect(formatCaptureDuration(0)).toBe('00:00')
    expect(formatCaptureDuration(65_000)).toBe('01:05')
    expect(formatCaptureDuration(3_661_000)).toBe('01:01:01')
  })

  it('derives elapsed time from session timestamps without mutating the session', () => {
    const finished = session()
    const recording = session({ status: 'recording', finishedAt: undefined })
    const before = structuredClone(finished)

    expect(getActiveCaptureDurationMs(finished, Date.parse('2026-09-01T00:02:00.000Z'))).toBe(60_000)
    expect(getActiveCaptureDurationMs(recording, Date.parse('2026-09-01T00:00:30.000Z'))).toBe(30_000)
    expect(finished).toEqual(before)
  })
})
