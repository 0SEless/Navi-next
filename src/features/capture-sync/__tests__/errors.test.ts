import { describe, expect, it } from 'vitest'

import { CaptureCloudError } from '../errors'
import type { CaptureSyncErrorCode } from '../types'

describe('CaptureCloudError', () => {
  it('exposes provider-neutral codes and retry behavior', () => {
    const retryable = new CaptureCloudError('NETWORK_ERROR')
    const auth = new CaptureCloudError('AUTH_REQUIRED')
    const campus = new CaptureCloudError('CAMPUS_REQUIRED')

    expect(retryable).toBeInstanceOf(Error)
    expect(retryable.name).toBe('CaptureCloudError')
    expect(retryable.code).toBe('NETWORK_ERROR')
    expect(retryable.retryable).toBe(true)
    expect(auth.code).toBe('AUTH_REQUIRED')
    expect(auth.retryable).toBe(false)
    expect(campus.code).toBe('CAMPUS_REQUIRED')
    expect(campus.message).toBe('Choose a campus before syncing.')
    expect(campus.retryable).toBe(false)
  })

  it('supports every declared sync error code without provider details', () => {
    const codes: CaptureSyncErrorCode[] = [
      'AUTH_REQUIRED',
      'NETWORK_ERROR',
      'REMOTE_CONFLICT',
      'REMOTE_ERROR',
      'INVALID_PAYLOAD',
      'UNSUPPORTED_SCHEMA',
      'PAYLOAD_TOO_LARGE',
      'SESSION_NOT_FINISHED',
      'CAMPUS_REQUIRED',
    ]

    for (const code of codes) {
      const error = new CaptureCloudError(code)

      expect(error.code).toBe(code)
      expect(error.message).not.toMatch(/supabase|postgres|fetch/i)
    }
  })

  it('allows a provider-neutral message and cause to be supplied', () => {
    const cause = new Error('transport detail')
    const error = new CaptureCloudError('REMOTE_ERROR', 'Remote request failed', {
      retryable: true,
      cause,
    })

    expect(error.message).toBe('Remote request failed')
    expect(error.retryable).toBe(true)
    expect(error.cause).toBe(cause)
  })
})
