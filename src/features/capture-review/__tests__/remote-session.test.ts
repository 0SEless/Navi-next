import { describe, expect, it } from 'vitest'

import { CAPTURE_SCHEMA_VERSION, type CaptureSession } from '../../capture/types'
import type { RemoteCaptureSession } from '../../capture-sync/types'
import {
  RemoteCaptureOpenError,
  validateRemoteCaptureSessionForCampus,
} from '../remote-session'

const captureSession: CaptureSession = {
  schemaVersion: CAPTURE_SCHEMA_VERSION,
  id: 'remote-session-1',
  title: 'North walkway',
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
  ],
  candidateRoute: {
    points: [{ latitude: 14.5995, longitude: 120.9842 }],
    sourceSampleIndices: [0],
    edgeCount: 0,
    derivedFromSampleCount: 1,
    derivedAt: '2026-08-31T08:15:01.000Z',
    algorithmVersion: 'capture-v1',
  },
  markers: [
    {
      id: 'marker-1',
      type: 'panorama',
      position: { latitude: 14.5995, longitude: 120.9842 },
      createdAt: '2026-08-31T08:05:00.000Z',
    },
  ],
  lastPosition: null,
  lastError: null,
}

const remote: RemoteCaptureSession = {
  sessionId: captureSession.id,
  campusId: captureSession.campusId ?? null,
  title: captureSession.title,
  status: captureSession.status,
  schemaVersion: captureSession.schemaVersion,
  contentHash: 'remote-hash',
  clientUpdatedAt: captureSession.updatedAt,
  createdAt: captureSession.createdAt,
  updatedAt: captureSession.updatedAt,
  rawSampleCount: 1,
  candidateNodeCount: 1,
  candidateEdgeCount: 0,
  markerCount: 1,
  session: captureSession,
}

function expectCode(action: () => unknown, code: RemoteCaptureOpenError['code']) {
  try {
    action()
  } catch (error) {
    expect(error).toBeInstanceOf(RemoteCaptureOpenError)
    expect(error).toMatchObject({ code })
    return
  }
  throw new Error(`Expected RemoteCaptureOpenError(${code})`)
}

describe('validateRemoteCaptureSessionForCampus', () => {
  it('accepts matching campus and identity data without changing the session', () => {
    const before = structuredClone(remote.session)

    expect(validateRemoteCaptureSessionForCampus(remote, 'campus-1')).toBe(remote.session)
    expect(remote.session).toEqual(before)
  })

  it('rejects a blank route campus or a missing remote campus', () => {
    expectCode(() => validateRemoteCaptureSessionForCampus(remote, ' '), 'CAMPUS_MISMATCH')
    expectCode(
      () => validateRemoteCaptureSessionForCampus({ ...remote, campusId: null }, 'campus-1'),
      'CAMPUS_MISMATCH',
    )
  })

  it('rejects summary and payload campus mismatches', () => {
    expectCode(
      () => validateRemoteCaptureSessionForCampus({ ...remote, campusId: 'campus-2' }, 'campus-1'),
      'CAMPUS_MISMATCH',
    )
    expectCode(
      () => validateRemoteCaptureSessionForCampus(
        { ...remote, session: { ...remote.session, campusId: 'campus-2' } },
        'campus-1',
      ),
      'CAMPUS_MISMATCH',
    )
  })

  it('rejects missing or inconsistent session identity', () => {
    expectCode(
      () => validateRemoteCaptureSessionForCampus({ ...remote, sessionId: ' ' }, 'campus-1'),
      'INVALID',
    )
    expectCode(
      () => validateRemoteCaptureSessionForCampus(
        { ...remote, session: { ...remote.session, id: 'different-session' } },
        'campus-1',
      ),
      'INVALID',
    )
  })
})
