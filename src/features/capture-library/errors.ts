import { RemoteCaptureOpenError } from '../capture-review/remote-session'
import { CaptureCloudError } from '../capture-sync/errors'

export function captureLibraryErrorMessage(error: unknown): string {
  if (error instanceof RemoteCaptureOpenError) {
    switch (error.code) {
      case 'NOT_FOUND':
        return 'This remote Capture session could not be found.'
      case 'CAMPUS_MISMATCH':
        return 'This Capture session belongs to a different campus.'
      case 'INVALID':
        return 'This remote Capture session is invalid and cannot be reviewed.'
    }
  }

  if (error instanceof CaptureCloudError) {
    switch (error.code) {
      case 'AUTH_REQUIRED':
        return 'Sign in to view remote Capture sessions.'
      case 'NETWORK_ERROR':
        return 'Capture Library is temporarily unavailable. Try again.'
      case 'REMOTE_CONFLICT':
        return 'This remote Capture session changed. Refresh and try again.'
      case 'INVALID_PAYLOAD':
      case 'UNSUPPORTED_SCHEMA':
        return 'This remote Capture session is invalid and cannot be reviewed.'
      case 'PAYLOAD_TOO_LARGE':
      case 'SESSION_NOT_FINISHED':
      case 'REMOTE_ERROR':
        return 'Capture Library could not load remote sessions. Try again.'
    }
  }

  return 'Capture Library could not load remote sessions. Try again.'
}
