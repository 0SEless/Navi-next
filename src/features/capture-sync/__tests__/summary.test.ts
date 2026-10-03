import { describe, expect, it } from 'vitest'

import { CAPTURE_SCHEMA_VERSION, type CaptureSession } from '../../capture/types'
import { getCaptureSummaryDetails } from '../summary'

const session: CaptureSession = {
  schemaVersion: CAPTURE_SCHEMA_VERSION,
  id: 'capture-summary-1',
  title: 'Summary route',
  campusId: 'campus-1',
  status: 'finished',
  createdAt: '2026-08-31T08:00:00.000Z',
  updatedAt: '2026-08-31T08:15:00.000Z',
  rawSamples: [
    {
      sequence: 0,
      timestamp: '2026-08-31T08:00:00.000Z',
      latitude: 14.5995,
      longitude: 120.9842,
      accuracy: 4,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
    },
    {
      sequence: 1,
      timestamp: '2026-08-31T08:00:05.000Z',
      latitude: 14.5996,
      longitude: 120.9843,
      accuracy: 4,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
    },
  ],
  candidateRoute: {
    points: [
      { latitude: 14.5995, longitude: 120.9842 },
      { latitude: 14.59955, longitude: 120.98425 },
      { latitude: 14.5996, longitude: 120.9843 },
    ],
    sourceSampleIndices: [0, 1],
    edgeCount: 2,
    derivedFromSampleCount: 2,
    derivedAt: '2026-08-31T08:15:01.000Z',
    algorithmVersion: 'capture-v1',
  },
  markers: [
    {
      id: 'marker-1',
      type: 'panorama',
      position: { latitude: 14.59955, longitude: 120.98425 },
      createdAt: '2026-08-31T08:05:00.000Z',
    },
  ],
  lastPosition: null,
  lastError: null,
}

describe('getCaptureSummaryDetails', () => {
  it('derives raw, candidate, edge, and marker counts without mutating the session', () => {
    const before = structuredClone(session)

    expect(getCaptureSummaryDetails(session)).toEqual({
      rawSampleCount: 2,
      candidateNodeCount: 3,
      candidateEdgeCount: 2,
      markerCount: 1,
    })
    expect(session).toEqual(before)
  })

  it('returns zero candidate counts when a session has no candidate route', () => {
    const withoutCandidate = { ...session, candidateRoute: null }

    expect(getCaptureSummaryDetails(withoutCandidate)).toEqual({
      rawSampleCount: 2,
      candidateNodeCount: 0,
      candidateEdgeCount: 0,
      markerCount: 1,
    })
  })
})
