import type { CaptureSession } from '../capture/types'
import type { RemoteCaptureSession } from '../capture-sync/types'

export type RemoteCaptureOpenErrorCode = 'NOT_FOUND' | 'CAMPUS_MISMATCH' | 'INVALID'

const DEFAULT_MESSAGES: Record<RemoteCaptureOpenErrorCode, string> = {
  NOT_FOUND: 'This remote Capture session could not be found.',
  CAMPUS_MISMATCH: 'This Capture session belongs to a different campus.',
  INVALID: 'This Capture session is invalid and cannot be opened.',
}

export class RemoteCaptureOpenError extends Error {
  readonly code: RemoteCaptureOpenErrorCode

  constructor(code: RemoteCaptureOpenErrorCode, message = DEFAULT_MESSAGES[code]) {
    super(message)
    this.name = 'RemoteCaptureOpenError'
    this.code = code
  }
}

export function validateRemoteCaptureSessionForCampus(
  remote: RemoteCaptureSession,
  campusId: string,
): CaptureSession {
  if (typeof campusId !== 'string' || campusId.trim().length === 0) {
    throw new RemoteCaptureOpenError('CAMPUS_MISMATCH')
  }

  if (
    typeof remote.sessionId !== 'string'
    || remote.sessionId.trim().length === 0
    || typeof remote.session !== 'object'
    || remote.session === null
  ) {
    throw new RemoteCaptureOpenError('INVALID')
  }

  if (typeof remote.campusId !== 'string' || remote.campusId !== campusId) {
    throw new RemoteCaptureOpenError('CAMPUS_MISMATCH')
  }

  const session = remote.session as CaptureSession & { id?: unknown }
  if (typeof session.id !== 'string' || session.id.trim().length === 0 || session.id !== remote.sessionId) {
    throw new RemoteCaptureOpenError('INVALID')
  }

  if (typeof session.campusId !== 'string' || session.campusId !== campusId) {
    throw new RemoteCaptureOpenError('CAMPUS_MISMATCH')
  }

  return remote.session
}
