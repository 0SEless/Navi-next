import { describe, expect, it } from 'vitest'
import { getCaptureSyncPresentation } from '../presentation'
import type { CaptureSyncStatus } from '../types'

function present(overrides: Partial<Parameters<typeof getCaptureSyncPresentation>[0]> = {}) {
  return getCaptureSyncPresentation({
    status: 'local',
    availability: 'available',
    sessionStatus: 'finished',
    ...overrides,
  })
}

describe('Capture sync presentation', () => {
  it('keeps unavailable local sessions local-only without an action', () => {
    expect(present({ availability: 'unavailable' })).toMatchObject({
      label: 'Local',
      action: 'none',
      tone: 'neutral',
    })
    expect(present({ availability: 'unavailable' }).detail).toMatch(/device|unavailable/i)
  })

  it('offers sync only for a finished local session when sync is available', () => {
    expect(present()).toMatchObject({ label: 'Local', action: 'sync', tone: 'info' })
    expect(present({ sessionStatus: 'recording' })).toMatchObject({ action: 'none' })
  })

  it.each([
    ['queued', 'Queued', 'none'],
    ['syncing', 'Syncing', 'none'],
    ['synced', 'Synced', 'none'],
    ['failed', 'Failed', 'retry'],
    ['conflict', 'Conflict', 'none'],
  ] as Array<[CaptureSyncStatus, string, 'none' | 'sync' | 'retry']>)('maps %s to %s with %s action', (status, label, action) => {
    expect(present({ status })).toMatchObject({ label, action })
  })

  it('does not offer retry while sync is unavailable', () => {
    expect(present({ status: 'failed', availability: 'unavailable' })).toMatchObject({ action: 'none', label: 'Failed' })
  })

  it('keeps conflicts visible without an overwrite or retry action', () => {
    const result = present({ status: 'conflict', errorMessage: 'A newer remote Capture session exists. Review it before trying again.' })

    expect(result).toMatchObject({ label: 'Conflict', action: 'none', tone: 'warning' })
    expect(result.detail).toContain('newer remote Capture')
    expect(result.detail).not.toMatch(/overwrite|supabase/i)
  })

  it('uses provider-neutral error detail without exposing provider terminology', () => {
    const result = present({ status: 'failed', errorMessage: 'The Capture session could not reach the sync service.' })

    expect(result).toMatchObject({ label: 'Failed', action: 'retry', tone: 'error' })
    expect(result.detail).toBe('The Capture session could not reach the sync service.')
    expect(result.detail).not.toMatch(/supabase|postgrest|table/i)
  })

  it('reports checking availability without inventing a synced state', () => {
    expect(present({ availability: 'checking' })).toMatchObject({ label: 'Local', action: 'none', tone: 'info' })
    expect(present({ availability: 'checking' }).detail).toMatch(/checking/i)
  })
})
