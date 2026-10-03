import { describe, expect, it } from 'vitest'

import { CAPTURE_SCHEMA_VERSION, type CaptureSession } from '../../capture/types'
import { hashCaptureSession } from '../hash'

const session: CaptureSession = {
  schemaVersion: CAPTURE_SCHEMA_VERSION,
  id: 'capture-1',
  title: 'North walkway survey',
  campusId: 'campus-1',
  status: 'finished',
  createdAt: '2026-08-31T08:00:00.000Z',
  updatedAt: '2026-08-31T08:15:00.000Z',
  startedAt: '2026-08-31T08:00:00.000Z',
  finishedAt: '2026-08-31T08:15:00.000Z',
  rawSamples: [
    {
      sequence: 0,
      timestamp: '2026-08-31T08:00:00.000Z',
      latitude: 14.5995,
      longitude: 120.9842,
      accuracy: 4.5,
      altitude: 12,
      altitudeAccuracy: 3,
      heading: 90,
      speed: 1.2,
    },
    {
      sequence: 1,
      timestamp: '2026-08-31T08:00:05.000Z',
      latitude: 14.5996,
      longitude: 120.9843,
      accuracy: 5,
      altitude: 12.2,
      altitudeAccuracy: 3.2,
      heading: 92,
      speed: 1.1,
    },
  ],
  candidateRoute: {
    points: [
      { latitude: 14.5995, longitude: 120.9842 },
      { latitude: 14.5996, longitude: 120.9843 },
    ],
    sourceSampleIndices: [0, 1],
    edgeCount: 1,
    derivedFromSampleCount: 2,
    derivedAt: '2026-08-31T08:15:01.000Z',
    algorithmVersion: 'capture-v1',
  },
  markers: [
    {
      id: 'marker-1',
      type: 'panorama',
      position: { latitude: 14.59955, longitude: 120.98425 },
      label: 'Library corner',
      note: 'Capture panorama here',
      accuracy: 4.8,
      createdAt: '2026-08-31T08:05:00.000Z',
    },
  ],
  lastPosition: null,
  lastError: null,
}

describe('hashCaptureSession', () => {
  it('returns the same digest for the same complete session', async () => {
    expect(await hashCaptureSession(session)).toBe(
      await hashCaptureSession(structuredClone(session)),
    )
  })

  it('changes when a raw sample changes but does not mutate the source', async () => {
    const before = structuredClone(session)
    const first = await hashCaptureSession(session)
    const changed = structuredClone(session)
    changed.rawSamples[0].accuracy = 1

    const second = await hashCaptureSession(changed)

    expect(second).not.toBe(first)
    expect(session).toEqual(before)
  })

  it('includes candidate geometry and derivation metadata in the digest', async () => {
    const first = await hashCaptureSession(session)
    const changed = structuredClone(session)
    changed.candidateRoute!.points[1].latitude += 0.0001
    changed.candidateRoute!.algorithmVersion = 'capture-v2'

    expect(await hashCaptureSession(changed)).not.toBe(first)
  })

  it('includes marker data in the digest', async () => {
    const first = await hashCaptureSession(session)
    const changed = structuredClone(session)
    changed.markers[0].note = 'Updated field note'

    expect(await hashCaptureSession(changed)).not.toBe(first)
  })

  it('preserves ordered raw samples and candidate points', async () => {
    const first = await hashCaptureSession(session)
    const changed = structuredClone(session)
    changed.rawSamples.reverse()
    changed.candidateRoute!.points.reverse()

    expect(await hashCaptureSession(changed)).not.toBe(first)
  })
})
