import type { CaptureSyncErrorCode } from './types'

const DEFAULT_MESSAGES: Record<CaptureSyncErrorCode, string> = {
  AUTH_REQUIRED: 'Sign in to sync this Capture session.',
  NETWORK_ERROR: 'The Capture session could not reach the sync service.',
  REMOTE_CONFLICT: 'The remote Capture session changed before this upload completed.',
  REMOTE_ERROR: 'The sync service returned an error.',
  INVALID_PAYLOAD: 'The Capture session payload is invalid.',
  UNSUPPORTED_SCHEMA: 'This Capture session format is not supported for sync.',
  PAYLOAD_TOO_LARGE: 'The Capture session is too large to sync.',
  SESSION_NOT_FINISHED: 'Finish the Capture session before syncing it.',
  CAMPUS_REQUIRED: 'Choose a campus before syncing.',
}

const DEFAULT_RETRYABLE: Record<CaptureSyncErrorCode, boolean> = {
  AUTH_REQUIRED: false,
  NETWORK_ERROR: true,
  REMOTE_CONFLICT: false,
  REMOTE_ERROR: true,
  INVALID_PAYLOAD: false,
  UNSUPPORTED_SCHEMA: false,
  PAYLOAD_TOO_LARGE: false,
  SESSION_NOT_FINISHED: false,
  CAMPUS_REQUIRED: false,
}

export interface CaptureCloudErrorOptions {
  retryable?: boolean
  cause?: unknown
}

export class CaptureCloudError extends Error {
  readonly code: CaptureSyncErrorCode
  readonly retryable: boolean
  readonly cause?: unknown

  constructor(
    code: CaptureSyncErrorCode,
    message = DEFAULT_MESSAGES[code],
    options: CaptureCloudErrorOptions = {},
  ) {
    super(message)
    this.name = 'CaptureCloudError'
    this.code = code
    this.retryable = options.retryable ?? DEFAULT_RETRYABLE[code]
    this.cause = options.cause
  }
}
