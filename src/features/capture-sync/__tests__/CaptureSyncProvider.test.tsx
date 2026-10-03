import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

import { CaptureReview } from '../../capture/components/CaptureReview'
import { CaptureHome } from '../../capture/components/CaptureHome'
import { CAPTURE_SCHEMA_VERSION, type CaptureSession } from '../../capture/types'
import { CaptureSyncProvider } from '../context'
import type { CaptureSyncService } from '../service'
import type { CaptureSyncState } from '../types'

vi.mock('@/components/map/NavigationMap', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('../../capture/components/RecordingMap', () => ({
  CaptureMapLayers: () => null,
}))

const finishedSession: CaptureSession = {
  schemaVersion: CAPTURE_SCHEMA_VERSION,
  id: 'finished-1',
  title: 'Finished route',
  campusId: 'campus-1',
  status: 'finished',
  createdAt: '2026-08-31T08:00:00.000Z',
  updatedAt: '2026-08-31T08:15:00.000Z',
  startedAt: '2026-08-31T08:00:00.000Z',
  finishedAt: '2026-08-31T08:15:00.000Z',
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
  candidateRoute: null,
  markers: [],
  lastPosition: null,
  lastError: null,
}

const recordingSession: CaptureSession = {
  ...structuredClone(finishedSession),
  id: 'recording-1',
  title: 'Recording route',
  status: 'recording',
  finishedAt: undefined,
}

function localState(sessionId: string): CaptureSyncState {
  return {
    sessionId,
    status: 'local',
    attemptCount: 0,
    lastSyncedHash: null,
    lastSyncedAt: null,
    lastAttemptAt: null,
    nextRetryAt: null,
    errorCode: null,
  }
}

function stateWith(sessionId: string, changes: Partial<CaptureSyncState>): CaptureSyncState {
  return { ...localState(sessionId), ...changes }
}

function createFakeService(result: CaptureSyncState | null = null): CaptureSyncService {
  const states = new Map<string, CaptureSyncState>()
  return {
    async getState(sessionId) {
      const state = states.get(sessionId) ?? localState(sessionId)
      states.set(sessionId, state)
      return state
    },
    async queueSession(sessionId) {
      const state = stateWith(sessionId, { status: 'queued' })
      states.set(sessionId, state)
      return state
    },
    async syncSession(sessionId) {
      const state = result ?? stateWith(sessionId, { status: 'synced', lastSyncedHash: 'hash' })
      states.set(sessionId, state)
      return state
    },
    async syncQueuedSessions() {
      return []
    },
    async removeState(sessionId) {
      states.delete(sessionId)
    },
  }
}

function renderHome(options: { available?: boolean; service?: CaptureSyncService } = {}) {
  return render(
    <CaptureSyncProvider service={options.service ?? createFakeService()} available={options.available ?? true}>
      <CaptureHome
        sessions={[finishedSession, recordingSession]}
        error={null}
        isSaving={false}
        onNew={() => {}}
        onReview={() => {}}
        onDelete={() => {}}
        onImport={() => {}}
      />
    </CaptureSyncProvider>,
  )
}

describe('Capture Sync UI composition', () => {
  it('shows Sync now only for finished sessions', async () => {
    renderHome()

    expect(await screen.findByRole('button', { name: 'Sync now for Finished route' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sync now for Recording route' })).not.toBeInTheDocument()
  })

  it('shows Retry and a provider-neutral error for a failed sync', async () => {
    const service = createFakeService(
      stateWith(finishedSession.id, {
        status: 'failed',
        errorCode: 'NETWORK_ERROR',
        attemptCount: 1,
      }),
    )
    renderHome({ service })

    fireEvent.click(await screen.findByRole('button', { name: 'Sync now for Finished route' }))

    expect(await screen.findByRole('button', { name: 'Retry Finished route' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('could not reach the sync service')
    expect(screen.getByRole('alert')).not.toHaveTextContent(/supabase/i)
  })

  it('shows an actionable campus-selection error when sync is blocked', async () => {
    const service = createFakeService(
      stateWith(finishedSession.id, {
        status: 'failed',
        errorCode: 'CAMPUS_REQUIRED',
      }),
    )
    renderHome({ service })

    fireEvent.click(await screen.findByRole('button', { name: 'Sync now for Finished route' }))

    expect(await screen.findByRole('button', { name: 'Retry Finished route' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a campus before syncing.')
  })

  it('shows Conflict without offering silent overwrite', async () => {
    const service = createFakeService(
      stateWith(finishedSession.id, {
        status: 'conflict',
        errorCode: 'REMOTE_CONFLICT',
      }),
    )
    renderHome({ service })

    fireEvent.click(await screen.findByRole('button', { name: 'Sync now for Finished route' }))

    expect(await screen.findByText('Conflict')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sync now for Finished route' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry Finished route' })).not.toBeInTheDocument()
  })

  it('keeps local Review and Export available when sync is unavailable', async () => {
    const onReview = () => {}
    render(
      <CaptureSyncProvider service={createFakeService()} available={false}>
        <CaptureHome
          sessions={[finishedSession]}
          error={null}
          isSaving={false}
          onNew={() => {}}
          onReview={onReview}
          onDelete={() => {}}
          onImport={() => {}}
        />
      </CaptureSyncProvider>,
    )

    expect(await screen.findByRole('button', { name: 'Review Finished route' })).toBeInTheDocument()
    expect(screen.getByText('Local only')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sync now for Finished route' })).not.toBeInTheDocument()

    render(
      <CaptureSyncProvider service={createFakeService()} available={false}>
        <CaptureReview
          session={finishedSession}
          onBack={() => {}}
          onExport={() => {}}
          onDelete={() => {}}
        />
      </CaptureSyncProvider>,
    )
    await waitFor(() => expect(screen.getByRole('button', { name: 'Export NAVI Capture JSON' })).toBeInTheDocument())
  })
})
