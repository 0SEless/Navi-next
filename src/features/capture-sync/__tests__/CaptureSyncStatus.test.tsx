import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CaptureSyncStatus } from '../components/CaptureSyncStatus'
import type { CaptureSyncState, CaptureSyncStatus as SyncStatus } from '../types'

function state(status: SyncStatus, errorCode: CaptureSyncState['errorCode'] = null): CaptureSyncState {
  return {
    sessionId: 'capture-status-1',
    status,
    attemptCount: status === 'failed' ? 1 : 0,
    lastSyncedHash: status === 'synced' ? 'hash' : null,
    lastSyncedAt: status === 'synced' ? '2026-09-01T00:01:00.000Z' : null,
    lastAttemptAt: null,
    nextRetryAt: null,
    errorCode,
  }
}

describe('CaptureSyncStatus', () => {
  it('offers the existing Sync now action for an available finished local session', () => {
    const onSync = vi.fn()
    render(<CaptureSyncStatus title="Field route" sessionStatus="finished" available="available" syncState={state('local')} onSync={onSync} />)

    expect(screen.getByText('Saved on this device. Ready to sync.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Sync now for Field route' }))
    expect(onSync).toHaveBeenCalledTimes(1)
  })

  it('offers Retry for failed sync and keeps the provider-neutral error detail', () => {
    const onSync = vi.fn()
    render(<CaptureSyncStatus title="Field route" sessionStatus="finished" available="available" syncState={state('failed', 'NETWORK_ERROR')} errorMessage="The Capture session could not reach the sync service." onSync={onSync} />)

    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('could not reach the sync service')
    fireEvent.click(screen.getByRole('button', { name: 'Retry Field route' }))
    expect(onSync).toHaveBeenCalledTimes(1)
  })

  it('keeps conflicts visible without an overwrite action', () => {
    render(<CaptureSyncStatus title="Field route" sessionStatus="finished" available="available" syncState={state('conflict', 'REMOTE_CONFLICT')} errorMessage="A newer remote Capture session exists. Review it before trying again." onSync={vi.fn()} />)

    expect(screen.getByText('Conflict')).toBeInTheDocument()
    expect(screen.getByText('A newer remote Capture session exists. Review it before trying again.')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('keeps local review available and hides sync action when unavailable or unfinished', () => {
    const { rerender } = render(<CaptureSyncStatus title="Field route" sessionStatus="finished" available="unavailable" syncState={state('local')} onSync={vi.fn()} />)
    expect(screen.getByText('Saved on this device. Sync is currently unavailable.')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()

    rerender(<CaptureSyncStatus title="Field route" sessionStatus="recording" available="available" syncState={state('local')} onSync={vi.fn()} />)
    expect(screen.getByText('Finish the Capture session before it can sync.')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
