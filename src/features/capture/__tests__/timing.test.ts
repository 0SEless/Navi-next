import { describe, expect, it } from 'vitest'
import { transitionCaptureSessionStatus } from '../timing'
import type { CaptureSession } from '../types'

const session: CaptureSession = {
  schemaVersion: 1,
  id: 'capture-timing-1',
  title: 'Timing route',
  status: 'recording',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  startedAt: '2026-09-01T00:00:00.000Z',
  rawSamples: [],
  candidateRoute: null,
  markers: [],
  lastPosition: null,
  lastError: null,
}

describe('Capture pause timing', () => {
  it('starts active timing only when Preparing explicitly enters Recording', () => {
    const preparing: CaptureSession = {
      ...session,
      status: 'preparing',
      startedAt: undefined,
    }

    const stillPreparing = transitionCaptureSessionStatus(
      preparing,
      'preparing',
      '2026-09-01T00:00:30.000Z',
    )
    const recording = transitionCaptureSessionStatus(
      stillPreparing,
      'recording',
      '2026-09-01T00:00:30.000Z',
    )

    expect(stillPreparing.startedAt).toBeUndefined()
    expect(recording.startedAt).toBe('2026-09-01T00:00:30.000Z')
    expect(recording.status).toBe('recording')
  })

  it('accumulates a pause interval on resume without mutating the source session', () => {
    const paused = transitionCaptureSessionStatus(session, 'paused', '2026-09-01T00:00:10.000Z')
    const resumed = transitionCaptureSessionStatus(paused, 'recording', '2026-09-01T00:00:25.000Z')

    expect(paused.pauseStartedAt).toBe('2026-09-01T00:00:10.000Z')
    expect(resumed.pausedDurationMs).toBe(15_000)
    expect(resumed.pauseStartedAt).toBeUndefined()
    expect(session.pauseStartedAt).toBeUndefined()
    expect(session.pausedDurationMs).toBeUndefined()
  })

  it('closes an open pause when finishing and keeps repeated transitions idempotent', () => {
    const paused = transitionCaptureSessionStatus(session, 'paused', '2026-09-01T00:00:10.000Z')
    const pausedAgain = transitionCaptureSessionStatus(paused, 'paused', '2026-09-01T00:00:20.000Z')
    const finished = transitionCaptureSessionStatus(pausedAgain, 'finished', '2026-09-01T00:00:40.000Z')

    expect(pausedAgain.pauseStartedAt).toBe('2026-09-01T00:00:10.000Z')
    expect(finished.pausedDurationMs).toBe(30_000)
    expect(finished.pauseStartedAt).toBeUndefined()
    expect(finished.finishedAt).toBe('2026-09-01T00:00:40.000Z')
  })
})
