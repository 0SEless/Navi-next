import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CAPTURE_SCHEMA_VERSION, type CaptureSession } from '../../capture/types'
import { createMemoryCaptureImportManifestStore } from '../../capture-import/manifest'
import { CaptureSyncProvider } from '../../capture-sync/context'
import type { CaptureSyncService } from '../../capture-sync/service'
import type {
  CaptureCloudRepository,
  RemoteCaptureSession,
  RemoteCaptureSummary,
} from '../../capture-sync/types'
import { StudioCaptureLibrary } from '../components/StudioCaptureLibrary'

const routerPush = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush }),
}))

const summary: RemoteCaptureSummary = {
  sessionId: 'remote-session-1',
  campusId: 'campus-1',
  title: 'North walkway',
  status: 'finished',
  schemaVersion: CAPTURE_SCHEMA_VERSION,
  contentHash: 'remote-hash',
  clientUpdatedAt: '2026-08-31T08:15:00.000Z',
  createdAt: '2026-08-31T08:00:00.000Z',
  updatedAt: '2026-08-31T08:15:00.000Z',
  rawSampleCount: 2,
  candidateNodeCount: 3,
  candidateEdgeCount: 2,
  markerCount: 1,
}

const secondSummary: RemoteCaptureSummary = {
  ...summary,
  sessionId: 'remote-session-2',
  campusId: 'campus-2',
  title: 'South walkway',
}

const captureSession: CaptureSession = {
  schemaVersion: CAPTURE_SCHEMA_VERSION,
  id: summary.sessionId,
  title: summary.title,
  campusId: summary.campusId ?? undefined,
  status: 'finished',
  createdAt: summary.createdAt,
  updatedAt: summary.updatedAt,
  rawSamples: [],
  candidateRoute: null,
  markers: [],
  lastPosition: null,
  lastError: null,
}

const remoteSession: RemoteCaptureSession = {
  ...summary,
  session: captureSession,
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

function createRepository(options: {
  summaries?: RemoteCaptureSummary[]
  remote?: RemoteCaptureSession | null
  listSessions?: CaptureCloudRepository['listSessions']
  getSession?: CaptureCloudRepository['getSession']
} = {}): CaptureCloudRepository & {
  listSessions: ReturnType<typeof vi.fn>
  getSession: ReturnType<typeof vi.fn>
} {
  const repository = {
    listSessions: options.listSessions ?? vi.fn(async () => options.summaries ?? [summary]),
    getSession: options.getSession ?? vi.fn(async () => options.remote === undefined ? remoteSession : options.remote),
    uploadSession: vi.fn(async () => ({ kind: 'unchanged' as const, remote: summary })),
  }
  return repository
}

function renderLibrary(options: {
  campusId?: string
  repository?: CaptureCloudRepository
  availability?: 'checking' | 'available' | 'unavailable'
  available?: boolean
  manifestStore?: ReturnType<typeof createMemoryCaptureImportManifestStore>
} = {}) {
  const repository = options.repository ?? createRepository()
  const availability = options.availability ?? 'available'
  const view = render(
    <CaptureSyncProvider
      service={createService()}
      available={options.available ?? availability === 'available'}
      availability={availability}
      cloudRepository={repository}
    >
      <StudioCaptureLibrary
        campusId={options.campusId ?? 'campus-1'}
        campusLabel="Demo Campus"
        manifestStore={options.manifestStore}
      />
    </CaptureSyncProvider>,
  )
  return { ...view, repository }
}

beforeEach(() => {
  routerPush.mockClear()
})

describe('StudioCaptureLibrary', () => {
  it('lists the current campus remote sessions with derived counts and exact local provenance', async () => {
    const manifestStore = createMemoryCaptureImportManifestStore()
    manifestStore.write({
      schemaVersion: 1,
      imports: [{
        captureSessionId: summary.sessionId,
        captureRouteId: 'route-1',
        captureSegmentId: 'segment-1',
        importBatchId: 'batch-1',
        canonicalRoadId: 'road-1',
        campusId: 'campus-1',
        importedAt: '2026-08-31T09:00:00.000Z',
      }],
    })
    const { repository } = renderLibrary({ manifestStore })

    expect(await screen.findByRole('heading', { name: 'Capture Library' })).toBeInTheDocument()
    expect(repository.listSessions).toHaveBeenCalledWith({ campusId: 'campus-1' })
    expect(screen.getByRole('button', { name: 'Open North walkway' })).toBeInTheDocument()
    expect(screen.getByText('Imported here')).toBeInTheDocument()
    expect(screen.getByText('2 raw samples')).toBeInTheDocument()
    expect(screen.getByText('3 candidate nodes')).toBeInTheDocument()
    expect(screen.getByText('1 marker')).toBeInTheDocument()
  })

  it('does not claim imported status without an exact session-and-campus manifest match', async () => {
    const manifestStore = createMemoryCaptureImportManifestStore()
    manifestStore.write({
      schemaVersion: 1,
      imports: [{
        captureSessionId: summary.sessionId,
        captureRouteId: 'route-1',
        captureSegmentId: 'segment-1',
        importBatchId: 'batch-1',
        canonicalRoadId: 'road-1',
        campusId: 'campus-2',
        importedAt: '2026-08-31T09:00:00.000Z',
      }],
    })

    renderLibrary({ manifestStore })

    await screen.findByRole('button', { name: 'Open North walkway' })
    expect(screen.queryByText('Imported here')).not.toBeInTheDocument()
  })

  it('fetches and validates the full session before navigating to the existing Reviewer', async () => {
    const { repository } = renderLibrary()

    const openButton = await screen.findByRole('button', { name: 'Open North walkway' })
    openButton.click()

    await waitFor(() => expect(repository.getSession).toHaveBeenCalledWith(summary.sessionId))
    expect(routerPush).toHaveBeenCalledWith(
      '/studio/campus-1/edit/capture-review?sessionId=remote-session-1',
    )
  })

  it('fails closed when remote access is unavailable and never calls the repository', async () => {
    const { repository } = renderLibrary({ availability: 'unavailable', available: false })

    expect(await screen.findByRole('alert')).toHaveTextContent(/sign in to view remote capture sessions/i)
    expect(repository.listSessions).not.toHaveBeenCalled()
    expect(repository.getSession).not.toHaveBeenCalled()
  })

  it('rejects a campus-mismatched full session before navigation', async () => {
    const { repository } = renderLibrary({
      repository: createRepository({ remote: { ...remoteSession, campusId: 'campus-2' } }),
    })

    ;(await screen.findByRole('button', { name: 'Open North walkway' })).click()

    expect(await screen.findByRole('alert')).toHaveTextContent(/different campus/i)
    expect(routerPush).not.toHaveBeenCalled()
    expect(repository.getSession).toHaveBeenCalledOnce()
  })

  it('does not let a previous campus list replace the active campus after a late response', async () => {
    let resolveFirst!: (value: RemoteCaptureSummary[]) => void
    const firstRequest = new Promise<RemoteCaptureSummary[]>((resolve) => { resolveFirst = resolve })
    const listSessions = vi.fn((options?: { campusId?: string | null }) => (
      options?.campusId === 'campus-1' ? firstRequest : Promise.resolve([secondSummary])
    ))
    const repository = createRepository({ listSessions })
    const view = renderLibrary({ repository })

    await waitFor(() => expect(listSessions).toHaveBeenCalledWith({ campusId: 'campus-1' }))
    view.rerender(
      <CaptureSyncProvider
        service={createService()}
        available
        availability="available"
        cloudRepository={repository}
      >
        <StudioCaptureLibrary campusId="campus-2" campusLabel="Second Campus" />
      </CaptureSyncProvider>,
    )

    expect(screen.queryByRole('button', { name: 'Open North walkway' })).not.toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Open South walkway' })).toBeInTheDocument()
    resolveFirst([summary])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.queryByRole('button', { name: 'Open North walkway' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open South walkway' })).toBeInTheDocument()
  })
})
