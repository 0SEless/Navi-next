import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { CaptureHome } from '../../capture/components/CaptureHome'
import { CaptureShell } from '../../capture/components/CaptureShell'
import { createMemoryCaptureRepository } from '../../capture/db'
import { CAPTURE_SCHEMA_VERSION, type CaptureSession } from '../../capture/types'
import { createCaptureStore } from '../../capture/store'
import { CaptureSyncProvider } from '../context'
import { createLocalState } from '../local-state'
import type { CaptureSyncService } from '../service'
import type { CaptureSyncState } from '../types'

const session: CaptureSession = {
  schemaVersion: CAPTURE_SCHEMA_VERSION,
  id: 'capture-1',
  title: 'Saved route',
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

class FakeSyncService implements CaptureSyncService {
  states = new Map<string, CaptureSyncState>()
  syncQueuedCalls = 0
  removedSessionIds: string[] = []

  async getState(sessionId: string): Promise<CaptureSyncState> {
    const state = this.states.get(sessionId) ?? createLocalState(sessionId)
    this.states.set(sessionId, state)
    return structuredClone(state)
  }

  async queueSession(sessionId: string): Promise<CaptureSyncState> {
    const state = { ...(await this.getState(sessionId)), status: 'queued' as const }
    this.states.set(sessionId, state)
    return structuredClone(state)
  }

  async syncSession(sessionId: string): Promise<CaptureSyncState> {
    const state = { ...(await this.getState(sessionId)), status: 'synced' as const }
    this.states.set(sessionId, state)
    return structuredClone(state)
  }

  async syncQueuedSessions(): Promise<CaptureSyncState[]> {
    this.syncQueuedCalls += 1
    return Array.from(this.states.values(), (state) => structuredClone(state))
  }

  async removeState(sessionId: string): Promise<void> {
    this.removedSessionIds.push(sessionId)
    this.states.delete(sessionId)
  }
}

describe('Capture foreground retry and cleanup', () => {
  it('attempts queued sessions when the foreground online event is handled', async () => {
    const service = new FakeSyncService()
    service.states.set('capture-1', { ...createLocalState('capture-1'), status: 'queued' })

    render(
      <CaptureSyncProvider service={service} available>
        <div>Capture surface</div>
      </CaptureSyncProvider>,
    )

    fireEvent(window, new Event('online'))

    await waitFor(() => expect(service.syncQueuedCalls).toBe(1))
  })

  it('removes sync metadata when a local session is deleted', async () => {
    const repository = createMemoryCaptureRepository()
    await repository.put(session)
    const store = createCaptureStore(repository)
    const service = new FakeSyncService()
    service.states.set(session.id, { ...createLocalState(session.id), status: 'synced' })

    render(
      <CaptureSyncProvider service={service} available>
        <CaptureShell store={store} />
      </CaptureSyncProvider>,
    )

    expect(await screen.findByText('Saved route')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Delete Saved route' }))

    await waitFor(async () => expect(await repository.get(session.id)).toBeNull())
    expect(service.removedSessionIds).toContain(session.id)
  })

  it('restores failed state after a provider remount', async () => {
    const service = new FakeSyncService()
    service.states.set(session.id, {
      ...createLocalState(session.id),
      status: 'failed',
      errorCode: 'NETWORK_ERROR',
      attemptCount: 1,
    })

    const first = render(
      <CaptureSyncProvider service={service} available>
        <CaptureHome
          sessions={[session]}
          error={null}
          isSaving={false}
          onNew={() => {}}
          onReview={() => {}}
          onDelete={() => {}}
          onImport={() => {}}
        />
      </CaptureSyncProvider>,
    )
    expect(await screen.findByRole('button', { name: 'Retry Saved route' })).toBeInTheDocument()
    first.unmount()

    render(
      <CaptureSyncProvider service={service} available>
        <CaptureHome
          sessions={[session]}
          error={null}
          isSaving={false}
          onNew={() => {}}
          onReview={() => {}}
          onDelete={() => {}}
          onImport={() => {}}
        />
      </CaptureSyncProvider>,
    )
    expect(await screen.findByRole('button', { name: 'Retry Saved route' })).toBeInTheDocument()
  })
})
