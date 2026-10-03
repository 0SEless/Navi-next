import { useEffect, type ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { CaptureSyncProvider, useCaptureSync } from '../context'
import type { CaptureSyncService } from '../service'
import type { CaptureSession } from '../../capture/types'
import type {
  CaptureCloudRepository,
  RemoteCaptureSession,
  RemoteCaptureSummary,
} from '../types'

const remoteSummary: RemoteCaptureSummary = {
  sessionId: 'remote-session-1',
  campusId: 'campus-1',
  title: 'North walkway',
  status: 'finished',
  schemaVersion: 1,
  contentHash: 'remote-hash',
  clientUpdatedAt: '2026-08-31T08:15:00.000Z',
  createdAt: '2026-08-31T08:00:00.000Z',
  updatedAt: '2026-08-31T08:15:00.000Z',
  rawSampleCount: 1,
  candidateNodeCount: 0,
  candidateEdgeCount: 0,
  markerCount: 0,
}

const remoteSession: RemoteCaptureSession = {
  ...remoteSummary,
  session: { id: remoteSummary.sessionId } as CaptureSession,
}

function createService(): CaptureSyncService {
  return {
    getState: vi.fn(async () => null),
    queueSession: vi.fn(async () => null),
    syncSession: vi.fn(async () => null),
    syncQueuedSessions: vi.fn(async () => []),
    removeState: vi.fn(async () => {}),
  }
}

function createRepository(): CaptureCloudRepository & {
  listCalls: Array<{ campusId?: string | null } | undefined>
  getCalls: string[]
} {
  const repository = {
    listCalls: [] as Array<{ campusId?: string | null } | undefined>,
    getCalls: [] as string[],
    listSessions: vi.fn(async (options?: { campusId?: string | null }) => {
      repository.listCalls.push(options)
      return [remoteSummary]
    }),
    getSession: vi.fn(async (sessionId: string) => {
      repository.getCalls.push(sessionId)
      return remoteSession
    }),
    uploadSession: vi.fn(async () => ({ kind: 'unchanged' as const, remote: remoteSummary })),
  }
  return repository
}

function RemoteReadProbe({ onError }: { onError: (error: unknown) => void }) {
  const captureSync = useCaptureSync()

  useEffect(() => {
    void captureSync
      .listRemoteSessions({ campusId: 'campus-1' })
      .then((summaries) => {
        document.body.dataset.summaryId = summaries[0]?.sessionId ?? ''
      })
      .catch(onError)

    void captureSync
      .getRemoteSession('remote-session-1')
      .then((session) => {
        document.body.dataset.sessionId = session?.sessionId ?? ''
      })
      .catch(onError)
  }, [captureSync, onError])

  return <output data-testid="remote-read-state">ready</output>
}

function renderProbe(
  repository: CaptureCloudRepository,
  options: { available?: boolean; onError?: (error: unknown) => void } = {},
) {
  return render(
    <CaptureSyncProvider
      service={createService()}
      available={options.available ?? true}
      cloudRepository={repository}
    >
      <RemoteReadProbe onError={options.onError ?? (() => {})} />
    </CaptureSyncProvider>,
  )
}

describe('CaptureSyncProvider remote reads', () => {
  it('forwards campus-filtered summaries and full-session reads to the cloud repository', async () => {
    const repository = createRepository()

    renderProbe(repository)

    await screen.findByTestId('remote-read-state')
    await vi.waitFor(() => {
      expect(repository.listCalls).toEqual([{ campusId: 'campus-1' }])
      expect(repository.getCalls).toEqual(['remote-session-1'])
      expect(document.body.dataset.summaryId).toBe('remote-session-1')
      expect(document.body.dataset.sessionId).toBe('remote-session-1')
    })
  })

  it('rejects remote reads when the provider is unavailable instead of using local data', async () => {
    const repository = createRepository()
    const errors: unknown[] = []

    renderProbe(repository, { available: false, onError: (error) => errors.push(error) })

    await vi.waitFor(() => expect(errors).toHaveLength(2))
    expect(errors).toEqual([
      expect.objectContaining({ code: 'AUTH_REQUIRED' }),
      expect.objectContaining({ code: 'AUTH_REQUIRED' }),
    ])
    expect(repository.listSessions).not.toHaveBeenCalled()
    expect(repository.getSession).not.toHaveBeenCalled()
  })
})
