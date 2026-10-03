import { describe, expect, it } from 'vitest'
import { parseCaptureFile, serializeCaptureSession } from '../format'
import type { CaptureSession } from '../types'

const session: CaptureSession = {
  schemaVersion: 1,
  id: 'capture-1',
  title: 'North path',
  status: 'finished',
  createdAt: '2026-08-31T10:00:00.000Z',
  updatedAt: '2026-08-31T10:01:00.000Z',
  startedAt: '2026-08-31T10:00:00.000Z',
  finishedAt: '2026-08-31T10:01:00.000Z',
  rawSamples: [
    {
      sequence: 0,
      timestamp: '2026-08-31T10:00:00.000Z',
      latitude: 11.8,
      longitude: 122.1,
      accuracy: 5,
      altitude: 12,
      altitudeAccuracy: 2,
      heading: 90,
      speed: 1.2,
    },
  ],
  candidateRoute: {
    points: [{ latitude: 11.8, longitude: 122.1 }],
    sourceSampleIndices: [0],
    edgeCount: 0,
    derivedFromSampleCount: 1,
    derivedAt: '2026-08-31T10:01:00.000Z',
    algorithmVersion: 'capture-dp-v1',
  },
  markers: [
    {
      id: 'marker-1',
      type: 'panorama',
      label: 'Gate',
      note: 'Face the courtyard',
      position: { latitude: 11.8, longitude: 122.1 },
      accuracy: 5,
      createdAt: '2026-08-31T10:00:30.000Z',
    },
  ],
}

describe('NAVI Capture file format', () => {
  it('round-trips a Preparing session without starting its active timer', () => {
    const preparing = {
      ...session,
      status: 'preparing' as const,
      startedAt: undefined,
      finishedAt: undefined,
      rawSamples: [],
      candidateRoute: null,
    }

    expect(parseCaptureFile(serializeCaptureSession(preparing))).toEqual(preparing)
  })

  it('round-trips a complete session with the navicapture envelope', () => {
    const timedSession = { ...session, pausedDurationMs: 15_000, pauseStartedAt: undefined }
    const text = serializeCaptureSession(timedSession, '2026-08-31T10:02:00.000Z')
    const parsed = JSON.parse(text)

    expect(parsed.format).toBe('navi-capture')
    expect(parsed.schemaVersion).toBe(1)
    expect(parsed.exportedAt).toBe('2026-08-31T10:02:00.000Z')
    expect(parseCaptureFile(text)).toEqual(timedSession)
  })

  it('rejects unsupported schemas and invalid coordinates', () => {
    expect(() => parseCaptureFile(JSON.stringify({ format: 'navi-capture', schemaVersion: 2 }))).toThrow(/schema/i)

    const invalid = JSON.parse(serializeCaptureSession(session))
    invalid.session.rawSamples[0].latitude = 999
    expect(() => parseCaptureFile(JSON.stringify(invalid))).toThrow(/latitude/i)
  })

  it('rejects invalid optional pause timing metadata', () => {
    const invalid = JSON.parse(serializeCaptureSession(session))
    invalid.session.pausedDurationMs = -1
    expect(() => parseCaptureFile(JSON.stringify(invalid))).toThrow(/pausedDurationMs/i)
  })
})
