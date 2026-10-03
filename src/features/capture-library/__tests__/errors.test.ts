import { describe, expect, it } from 'vitest'

import { CaptureCloudError } from '../../capture-sync/errors'
import { RemoteCaptureOpenError } from '../../capture-review/remote-session'
import { captureLibraryErrorMessage } from '../errors'

describe('captureLibraryErrorMessage', () => {
  it('maps provider-neutral cloud failures without exposing provider details', () => {
    const message = captureLibraryErrorMessage(new CaptureCloudError('REMOTE_ERROR', 'PostgREST table error'))

    expect(message).toMatch(/could not load|unavailable|try again/i)
    expect(message).not.toMatch(/postgrest|supabase|table error/i)
  })

  it('maps semantic session-open failures', () => {
    expect(captureLibraryErrorMessage(new RemoteCaptureOpenError('NOT_FOUND'))).toMatch(/not be found/i)
    expect(captureLibraryErrorMessage(new RemoteCaptureOpenError('CAMPUS_MISMATCH'))).toMatch(/different campus/i)
  })

  it('uses a safe fallback for unknown failures', () => {
    expect(captureLibraryErrorMessage(new Error('database secret'))).toMatch(/could not load/i)
    expect(captureLibraryErrorMessage(new Error('database secret'))).not.toMatch(/database secret/i)
  })
})
