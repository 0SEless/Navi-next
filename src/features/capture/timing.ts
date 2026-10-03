import type { CaptureSession, CaptureSessionStatus } from './types'

function parseTimestamp(value: string | undefined): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function persistedPauseDuration(session: CaptureSession): number {
  return typeof session.pausedDurationMs === 'number'
    && Number.isFinite(session.pausedDurationMs)
    && session.pausedDurationMs >= 0
    ? session.pausedDurationMs
    : 0
}

/**
 * Applies a Capture lifecycle transition without mutating the input session.
 * Pause timing is Capture metadata only; raw GPS samples and candidate geometry
 * remain untouched by this helper.
 */
export function transitionCaptureSessionStatus(
  session: CaptureSession,
  status: CaptureSessionStatus,
  at: string,
): CaptureSession {
  const next: CaptureSession = { ...session, status }
  let pausedDurationMs = persistedPauseDuration(session)

  if (session.status === 'paused' && status !== 'paused') {
    const pauseStartedAt = parseTimestamp(session.pauseStartedAt)
    const resumedAt = parseTimestamp(at)
    if (pauseStartedAt !== null && resumedAt !== null) {
      pausedDurationMs += Math.max(0, resumedAt - pauseStartedAt)
    }
  }

  if (pausedDurationMs > 0 || session.pausedDurationMs !== undefined) {
    next.pausedDurationMs = pausedDurationMs
  }

  if (status === 'paused') {
    if (session.status !== 'paused') next.pauseStartedAt = at
  } else {
    next.pauseStartedAt = undefined
  }

  if (status === 'recording' && !next.startedAt) next.startedAt = at
  next.finishedAt = status === 'finished' ? at : undefined
  return next
}
