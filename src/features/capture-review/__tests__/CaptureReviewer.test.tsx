import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CampusDocument } from '@navi/core'
import type { CampusMap } from '@/types/campus-map'
import type { CaptureSession } from '@/features/capture/types'
import type { RemoteCaptureSession } from '@/features/capture-sync/types'
import { serializeCaptureSession } from '@/features/capture/format'
import { deriveCandidateRoute } from '@/features/capture/geometry'
import { CaptureImportAdapter, type CaptureReviewerImportHost } from '@/features/capture-import/adapter'
import { createMemoryCaptureImportManifestStore } from '@/features/capture-import/manifest'
import { createCaptureReviewStore, createMemoryReviewStorage } from '../review-store'
import { CaptureReviewer } from '../components/CaptureReviewer'

const routerPush = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush }),
}))

vi.mock('../components/CaptureReviewMap', () => ({
  CaptureReviewMap: ({
    session,
    onMovePoint,
    onAddPoint,
    onRemovePoint,
    snapTargets = [],
    onApplyEndpointSnap,
    onIgnoreEndpointSnap,
  }: {
    session: CaptureSession
    onMovePoint?: (index: number, coordinate: { latitude: number; longitude: number }) => void
    onAddPoint?: (coordinate: { latitude: number; longitude: number }) => void
    onRemovePoint?: (index: number) => void
    snapTargets?: Array<{ endpoint: 'start' | 'end'; roadName: string; coordinate: { latitude: number; longitude: number } }>
    onApplyEndpointSnap?: (target: (typeof snapTargets)[number]) => void
    onIgnoreEndpointSnap?: (target: (typeof snapTargets)[number]) => void
  }) => (
    <div
      aria-label="Capture Review Map"
      data-candidate-node-count={session.candidateRoute?.points.length ?? 0}
      data-candidate-first-lat={session.candidateRoute?.points[0]?.latitude ?? ''}
      data-marker-count={session.markers.length}
      data-raw-sample-count={session.rawSamples.length}
    >
      review map
      {onMovePoint && <button type="button" aria-label="Mock move point" onClick={() => onMovePoint(0, { latitude: 11.80025, longitude: 122.10025 })}>Mock move point</button>}
      {onAddPoint && <button type="button" aria-label="Mock add point" onClick={() => onAddPoint({ latitude: 11.80001, longitude: 122.1 })}>Mock add point</button>}
      {onRemovePoint && <button type="button" aria-label="Mock remove point" onClick={() => onRemovePoint(1)}>Mock remove point</button>}
      {snapTargets.map((target) => <span key={`${target.endpoint}-${target.roadName}`}>
        <button type="button" aria-label={`Mock apply ${target.endpoint} snap`} onClick={() => onApplyEndpointSnap?.(target)}>Mock apply snap</button>
        <button type="button" aria-label={`Mock ignore ${target.endpoint} snap`} onClick={() => onIgnoreEndpointSnap?.(target)}>Mock ignore snap</button>
      </span>)}
    </div>
  ),
}))

const session: CaptureSession = {
  schemaVersion: 1,
  id: 'review-session-1',
  title: 'Library path',
  status: 'finished',
  createdAt: '2026-08-31T10:00:00.000Z',
  updatedAt: '2026-08-31T10:01:00.000Z',
  startedAt: '2026-08-31T10:00:00.000Z',
  finishedAt: '2026-08-31T10:01:00.000Z',
  rawSamples: [
    { sequence: 0, timestamp: '2026-08-31T10:00:00.000Z', latitude: 11.8, longitude: 122.1, accuracy: 5, altitude: null, altitudeAccuracy: null, heading: null, speed: null },
    { sequence: 1, timestamp: '2026-08-31T10:00:30.000Z', latitude: 11.8005, longitude: 122.1005, accuracy: 35, altitude: null, altitudeAccuracy: null, heading: null, speed: null },
    { sequence: 2, timestamp: '2026-08-31T10:01:00.000Z', latitude: 11.801, longitude: 122.101, accuracy: 5, altitude: null, altitudeAccuracy: null, heading: null, speed: null },
  ],
  candidateRoute: {
    points: [{ latitude: 11.8, longitude: 122.1 }, { latitude: 11.8005, longitude: 122.1005 }, { latitude: 11.801, longitude: 122.101 }],
    sourceSampleIndices: [0, 1, 2],
    edgeCount: 2,
    derivedFromSampleCount: 3,
    derivedAt: '2026-08-31T10:01:00.000Z',
    algorithmVersion: 'capture-dp-v1',
  },
  markers: [{ id: 'marker-poi', type: 'poi', label: 'Library', position: { latitude: 11.8005, longitude: 122.1005 }, createdAt: '2026-08-31T10:00:30.000Z' }],
}

const campusMap: CampusMap = {
  id: 'campus-1',
  name: 'Demo Campus',
  schoolName: 'Demo School',
  boundary: [],
  center: { lat: 11.8, lng: 122.1 },
  createdAt: '2026-08-31T10:00:00.000Z',
  updatedAt: '2026-08-31T10:00:00.000Z',
  stats: { buildings: 0, nodes: 0, edges: 0 },
}

const remoteSession: RemoteCaptureSession = {
  sessionId: 'remote-session-1',
  campusId: 'campus-1',
  title: 'Remote library path',
  status: 'finished',
  schemaVersion: 1,
  contentHash: 'remote-hash',
  clientUpdatedAt: session.updatedAt,
  createdAt: session.createdAt,
  updatedAt: session.updatedAt,
  rawSampleCount: session.rawSamples.length,
  candidateNodeCount: session.candidateRoute?.points.length ?? 0,
  candidateEdgeCount: session.candidateRoute?.edgeCount ?? 0,
  markerCount: session.markers.length,
  session: { ...structuredClone(session), id: 'remote-session-1', campusId: 'campus-1', title: 'Remote library path' },
}

function renderRemoteReviewer(options: {
  remoteSessionId?: string
  getRemoteSession?: (sessionId: string) => Promise<RemoteCaptureSession | null>
} = {}) {
  const reviewStore = createCaptureReviewStore(createMemoryReviewStorage())
  const listSessions = vi.fn(async () => [session])
  const getRemoteSession = options.getRemoteSession ?? vi.fn(async () => remoteSession)
  const view = render(
    <CaptureReviewer
      reviewStore={reviewStore}
      listSessions={listSessions}
      campusMaps={[campusMap]}
      remoteCampusId="campus-1"
      remoteSessionId={options.remoteSessionId ?? remoteSession.sessionId}
      getRemoteSession={getRemoteSession}
      backLabel="Back to Capture Library"
    />,
  )
  return { ...view, reviewStore, listSessions, getRemoteSession }
}

beforeEach(() => {
  routerPush.mockClear()
})

function renderReviewer(options: { importHost?: CaptureReviewerImportHost; session?: CaptureSession } = {}) {
  const reviewStore = createCaptureReviewStore(createMemoryReviewStorage())
  const reviewSession = options.session ?? session
  const listSessions = vi.fn(async () => [reviewSession])
  const onBack = vi.fn()
  const view = render(<CaptureReviewer reviewStore={reviewStore} listSessions={listSessions} campusMaps={options.importHost ? [campusMap] : []} importHost={options.importHost} onBack={onBack} />)
  return { ...view, reviewStore, listSessions, onBack }
}

describe('CaptureReviewer', () => {
  it('starts loading sessions without deferring the initial list request', async () => {
    const { listSessions } = renderReviewer()

    expect(listSessions).toHaveBeenCalledOnce()
    expect(await screen.findByRole('heading', { name: 'Library path' })).toBeInTheDocument()
  })

  it('opens a valid local session with metrics, layer controls, and review-only decisions', async () => {
    const { reviewStore } = renderReviewer()

    expect(await screen.findByRole('heading', { name: 'Capture Reviewer' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Library path' })).toBeInTheDocument()
    expect(screen.getAllByText(/Local session/).length).toBeGreaterThan(0)
    expect(screen.getByLabelText('Capture Review Map')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import available after review' })).toBeDisabled()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Raw GPS' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Candidate section 1' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Marker: Library' }))

    expect(reviewStore.getState().layers.rawGps).toBe(false)
    expect(reviewStore.getState().getSelection(session.id)).toEqual({
      routeSegments: { 'segment-0': 'excluded' },
      markers: { 'marker-poi': 'excluded' },
    })
    expect(screen.getByText('1 min')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'GPS warnings' })).toBeInTheDocument()
  })

  it('changes Route Detail on a derived review clone without mutating the loaded Capture session', async () => {
    const detailRawSamples = Array.from({ length: 25 }, (_, index) => {
      const progress = index / 24
      return {
        sequence: index,
        timestamp: new Date(Date.parse('2026-08-31T10:00:00.000Z') + index * 1000).toISOString(),
        latitude: 11.8 + (3.5 * Math.sin(progress * Math.PI)) / 111195,
        longitude: 122.1 + (index * 4) / (111195 * Math.cos(11.8 * Math.PI / 180)),
        accuracy: 4,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
      }
    })
    const detailSession: CaptureSession = {
      ...structuredClone(session),
      id: 'review-detail-session',
      rawSamples: detailRawSamples,
      candidateRoute: deriveCandidateRoute(detailRawSamples, { detail: 'balanced', derivedAt: session.updatedAt }),
    }
    const rawBefore = structuredClone(detailSession.rawSamples)
    const candidateBefore = structuredClone(detailSession.candidateRoute)
    const reviewStore = createCaptureReviewStore(createMemoryReviewStorage())
    const listSessions = vi.fn(async () => [detailSession])

    render(<CaptureReviewer reviewStore={reviewStore} listSessions={listSessions} campusMaps={[]} />)

    await screen.findByRole('heading', { name: 'Capture Reviewer' })
    const map = screen.getByLabelText('Capture Review Map')
    const balancedCount = Number(map.getAttribute('data-candidate-node-count'))
    fireEvent.change(screen.getByLabelText('Route detail'), { target: { value: '2' } })

    await waitFor(() => expect(Number(map.getAttribute('data-candidate-node-count'))).toBeGreaterThan(balancedCount))
    expect(detailSession.rawSamples).toEqual(rawBefore)
    expect(detailSession.candidateRoute).toEqual(candidateBefore)
    expect(detailSession.markers).toEqual(session.markers)
  })

  it('exposes Reviewer edit controls and keeps move/add/remove/reset on a clone', async () => {
    const editingSession: CaptureSession = {
      ...structuredClone(session),
      id: 'review-edit-session',
      rawSamples: [
        { ...session.rawSamples[0], sequence: 0, speed: 1 },
        { ...session.rawSamples[0], sequence: 1, latitude: 11.80001, longitude: 122.1, speed: 1 },
        { ...session.rawSamples[0], sequence: 2, latitude: 11.80002, longitude: 122.1, speed: 1 },
        { ...session.rawSamples[0], sequence: 3, latitude: 11.80004, longitude: 122.1, speed: 1 },
        { ...session.rawSamples[0], sequence: 4, latitude: 11.8001, longitude: 122.1, speed: 1 },
      ],
    }
    const rawBefore = structuredClone(editingSession.rawSamples)
    const candidateBefore = structuredClone(editingSession.candidateRoute)
    renderReviewer({ session: editingSession })

    await screen.findByRole('heading', { name: 'Capture Reviewer' })
    const map = screen.getByLabelText('Capture Review Map')
    const initialCount = Number(map.getAttribute('data-candidate-node-count'))
    const initialFirstLatitude = map.getAttribute('data-candidate-first-lat')

    expect(screen.getByRole('button', { name: 'Move point' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add point' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove point' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reset route' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Move point' }))
    fireEvent.click(screen.getByRole('button', { name: 'Mock move point' }))
    await waitFor(() => expect(map.getAttribute('data-candidate-first-lat')).not.toBe(initialFirstLatitude))

    fireEvent.click(screen.getByRole('button', { name: 'Add point' }))
    fireEvent.click(screen.getByRole('button', { name: 'Mock add point' }))
    await waitFor(() => expect(Number(map.getAttribute('data-candidate-node-count'))).toBe(initialCount + 1))

    fireEvent.click(screen.getByRole('button', { name: 'Remove point' }))
    fireEvent.click(screen.getByRole('button', { name: 'Mock remove point' }))
    await waitFor(() => expect(Number(map.getAttribute('data-candidate-node-count'))).toBe(initialCount))

    fireEvent.click(screen.getByRole('button', { name: 'Reset route' }))
    await waitFor(() => expect(map.getAttribute('data-candidate-first-lat')).toBe(initialFirstLatitude))
    expect(editingSession.rawSamples).toEqual(rawBefore)
    expect(editingSession.candidateRoute).toEqual(candidateBefore)
  })

  it('clears reviewed edits when Route Detail changes and keeps Raw GPS a visibility-only toggle', async () => {
    renderReviewer()
    await screen.findByRole('heading', { name: 'Capture Reviewer' })
    const map = screen.getByLabelText('Capture Review Map')
    const generatedFirstLatitude = map.getAttribute('data-candidate-first-lat')

    fireEvent.click(screen.getByRole('button', { name: 'Move point' }))
    fireEvent.click(screen.getByRole('button', { name: 'Mock move point' }))
    await waitFor(() => expect(map.getAttribute('data-candidate-first-lat')).not.toBe(generatedFirstLatitude))

    fireEvent.click(screen.getByLabelText('Raw GPS'))
    expect(screen.getByLabelText('Raw GPS')).not.toBeChecked()
    fireEvent.change(screen.getByLabelText('Route detail'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('Route detail'), { target: { value: '1' } })
    await waitFor(() => expect(map.getAttribute('data-candidate-first-lat')).toBe(generatedFirstLatitude))
    expect(screen.getByLabelText('Raw GPS')).not.toBeChecked()
  })

  it('shows endpoint snap choices only as explicit, cancellable Reviewer actions', async () => {
    const existingRoads = [{
      id: 'road-near-start',
      name: 'Existing walkway',
      polyline: { points: [{ lat: 11.80005, lng: 122.0999 }, { lat: 11.80005, lng: 122.1001 }] },
      width: 3,
      surface: 'paved' as const,
      type: 'pedestrian' as const,
      displayMode: 'visible' as const,
      metadata: {},
    }]
    const importHost: CaptureReviewerImportHost = {
      adapter: new CaptureImportAdapter({
        executor: { executeBatch: vi.fn(() => ({ success: true, results: [{ success: true, entityId: 'road-1' }] })) },
        manifestStore: createMemoryCaptureImportManifestStore(),
      }),
      existingRoads,
      getContext: () => ({ authoritativeCampusId: 'campus-1', captureCampusId: 'campus-1', studioCampusId: 'campus-1', roadWidthMeters: 3 }),
    }
    const roadBefore = structuredClone(existingRoads)
    const first = renderReviewer({ importHost })

    await screen.findByRole('heading', { name: 'Capture Reviewer' })
    const map = screen.getByLabelText('Capture Review Map')
    const initialFirstLatitude = map.getAttribute('data-candidate-first-lat')
    expect(screen.getByRole('button', { name: 'Snap start to Existing walkway' })).toBeInTheDocument()
    expect(map.getAttribute('data-candidate-first-lat')).toBe(initialFirstLatitude)

    fireEvent.click(screen.getByRole('button', { name: 'Ignore start snap' }))
    expect(map.getAttribute('data-candidate-first-lat')).toBe(initialFirstLatitude)
    first.unmount()
    const second = renderReviewer({ importHost })
    await screen.findByRole('heading', { name: 'Capture Reviewer' })
    const secondMap = screen.getAllByLabelText('Capture Review Map').at(-1)!
    expect(secondMap.getAttribute('data-candidate-first-lat')).toBe(initialFirstLatitude)
    fireEvent.click(screen.getAllByRole('button', { name: 'Snap start to Existing walkway' }).at(-1)!)
    await waitFor(() => expect(secondMap.getAttribute('data-candidate-first-lat')).not.toBe(initialFirstLatitude))
    expect(existingRoads).toEqual(roadBefore)
    second.unmount()
  })

  it('rejects an invalid package without replacing the current review item', async () => {
    renderReviewer()
    const input = screen.getByLabelText('Open .navicapture.json')
    const file = new File(['{"format":"wrong"}'], 'bad.navicapture.json', { type: 'application/json' })

    fireEvent.change(input, { target: { files: [file] } })

    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid navi capture file/i)
    expect(screen.getByRole('heading', { name: 'Library path' })).toBeInTheDocument()
  })

  it('opens a valid .navicapture.json package as a local file review item', async () => {
    renderReviewer()
    const input = screen.getByLabelText('Open .navicapture.json')
    const file = new File([serializeCaptureSession(session)], 'library.navicapture.json', { type: 'application/json' })

    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => expect(screen.getAllByText(/Local file/).length).toBeGreaterThan(0))
    expect(screen.getByRole('heading', { name: 'Library path' })).toBeInTheDocument()
  })

  it('keeps a CampusDocument snapshot unchanged when the Reviewer is opened, used, and closed', async () => {
    const beforeDocument: CampusDocument = {
      schemaVersion: 1,
      version: 4,
      metadata: { campusId: 'campus-1', name: 'Demo Campus', description: '', lastModified: '2026-08-31', editorVersion: 'test' },
      buildings: [],
      roads: [],
      panoramas: [],
      qrCheckpoints: [],
    }
    const documentSnapshot = structuredClone(beforeDocument)
    const { onBack } = renderReviewer()

    await screen.findByRole('heading', { name: 'Library path' })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Candidate section 1' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Marker: Library' }))
    fireEvent.click(screen.getByRole('button', { name: 'Back to Studio' }))

    expect(beforeDocument).toEqual(documentSnapshot)
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('previews an outdoor import, cancel dispatches nothing, and import dispatches selected Roads', async () => {
    const executeBatch = vi.fn(() => ({
      success: true,
      results: [{ success: true, entityId: 'road-imported-1', data: { id: 'road-imported-1' } }],
    }))
    const importHost: CaptureReviewerImportHost = {
      adapter: new CaptureImportAdapter({
        executor: { executeBatch },
        manifestStore: createMemoryCaptureImportManifestStore(),
      }),
      existingRoads: [],
      getContext: () => ({
        authoritativeCampusId: 'campus-1',
        captureCampusId: 'campus-1',
        studioCampusId: 'campus-1',
        roadWidthMeters: 3,
      }),
    }
    renderReviewer({ importHost })

    await screen.findByRole('heading', { name: 'Library path' })
    expect(screen.getByText('Studio import')).toBeInTheDocument()
    expect(screen.getByText('Review and import selected outdoor pathways into the current Studio draft.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Candidate section 1' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Candidate section 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Review import' }))
    expect(screen.getByRole('dialog')).toHaveTextContent(/existing pathways/i)
    expect(screen.getByRole('dialog')).toHaveTextContent(/proposed captured pathway/i)

    fireEvent.click(screen.getByRole('button', { name: 'Cancel import' }))
    expect(executeBatch).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Review import' }))
    fireEvent.click(screen.getByRole('dialog').querySelector('button[aria-label="Import selected"]')!)

    expect(executeBatch).toHaveBeenCalledOnce()
    expect(await screen.findByRole('status')).toHaveTextContent(/imported/i)

    fireEvent.click(screen.getByRole('button', { name: 'Review import' }))
    expect(screen.getByRole('dialog')).toHaveTextContent(/already imported/i)
    expect(screen.getByRole('button', { name: 'Import selected' })).toBeDisabled()
  })

  it('passes reviewed candidate geometry through CaptureImportAdapter without changing raw evidence', async () => {
    const executeBatch = vi.fn(() => ({
      success: true,
      results: [{ success: true, entityId: 'road-reviewed-1' }],
    }))
    const importHost: CaptureReviewerImportHost = {
      adapter: new CaptureImportAdapter({
        executor: { executeBatch },
        manifestStore: createMemoryCaptureImportManifestStore(),
      }),
      existingRoads: [],
      getContext: () => ({ authoritativeCampusId: 'campus-1', captureCampusId: 'campus-1', studioCampusId: 'campus-1', roadWidthMeters: 3 }),
    }
    const rawBefore = structuredClone(session.rawSamples)
    renderReviewer({ importHost })

    await screen.findByRole('heading', { name: 'Capture Reviewer' })
    fireEvent.click(screen.getByRole('button', { name: 'Move point' }))
    fireEvent.click(screen.getByRole('button', { name: 'Mock move point' }))
    await waitFor(() => expect(screen.getByLabelText('Capture Review Map')).toHaveAttribute('data-candidate-first-lat', '11.80025'))

    fireEvent.click(screen.getByRole('button', { name: 'Review import' }))
    fireEvent.click(screen.getByRole('button', { name: 'Import selected' }))

    expect(executeBatch).toHaveBeenCalledOnce()
    expect(executeBatch.mock.calls[0][0][0].payload.points[0]).toEqual({ lat: 11.80025, lng: 122.10025 })
    expect(session.rawSamples).toEqual(rawBefore)
  })

  it('loads only the requested remote session and preserves its evidence layers', async () => {
    const { listSessions, getRemoteSession } = renderRemoteReviewer()

    expect(listSessions).not.toHaveBeenCalled()
    expect(await screen.findByRole('heading', { name: 'Remote library path' })).toBeInTheDocument()
    expect(getRemoteSession).toHaveBeenCalledWith('remote-session-1')
    expect(screen.queryByLabelText('Open .navicapture.json')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Capture Review Map')).toHaveAttribute('data-raw-sample-count', '3')
    expect(screen.getByLabelText('Capture Review Map')).toHaveAttribute('data-candidate-node-count', '3')
    expect(screen.getByLabelText('Capture Review Map')).toHaveAttribute('data-marker-count', '1')
    expect(screen.getAllByText(/Remote session/).length).toBeGreaterThan(0)
  })

  it('rejects a remote session whose campus does not match the Reviewer campus', async () => {
    renderRemoteReviewer({
      getRemoteSession: vi.fn(async () => ({ ...remoteSession, campusId: 'campus-2' })),
    })

    expect(await screen.findByRole('alert')).toHaveTextContent(/different campus/i)
    expect(screen.queryByRole('heading', { name: 'Remote library path' })).not.toBeInTheDocument()
  })

  it('reports a missing remote session without falling back to local sessions', async () => {
    const { listSessions } = renderRemoteReviewer({
      getRemoteSession: vi.fn(async () => null),
    })

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be found/i)
    expect(listSessions).not.toHaveBeenCalled()
    expect(screen.queryByRole('heading', { name: 'Library path' })).not.toBeInTheDocument()
  })

  it('clears stale content and ignores session A after session B becomes active', async () => {
    let resolveA!: (value: RemoteCaptureSession) => void
    let resolveB!: (value: RemoteCaptureSession) => void
    const pendingA = new Promise<RemoteCaptureSession>((resolve) => { resolveA = resolve })
    const pendingB = new Promise<RemoteCaptureSession>((resolve) => { resolveB = resolve })
    const getRemoteSession = vi.fn((sessionId: string) => sessionId === 'remote-a' ? pendingA : pendingB)
    const reviewStore = createCaptureReviewStore(createMemoryReviewStorage())
    const view = render(
      <CaptureReviewer
        reviewStore={reviewStore}
        campusMaps={[campusMap]}
        remoteCampusId="campus-1"
        remoteSessionId="remote-a"
        getRemoteSession={getRemoteSession}
      />,
    )

    await waitFor(() => expect(getRemoteSession).toHaveBeenCalledWith('remote-a'))
    view.rerender(
      <CaptureReviewer
        reviewStore={reviewStore}
        campusMaps={[campusMap]}
        remoteCampusId="campus-1"
        remoteSessionId="remote-b"
        getRemoteSession={getRemoteSession}
      />,
    )

    expect(screen.queryByRole('heading', { name: 'Remote library path' })).not.toBeInTheDocument()
    resolveB({ ...remoteSession, sessionId: 'remote-b', session: { ...remoteSession.session, id: 'remote-b', title: 'Remote B' } })
    expect(await screen.findByRole('heading', { name: 'Remote B' })).toBeInTheDocument()
    resolveA({ ...remoteSession, sessionId: 'remote-a', session: { ...remoteSession.session, id: 'remote-a', title: 'Remote A' } })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.queryByRole('heading', { name: 'Remote A' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Remote B' })).toBeInTheDocument()
  })

  it('ignores a remote result after the Reviewer unmounts', async () => {
    let resolveRemote!: (value: RemoteCaptureSession) => void
    const pending = new Promise<RemoteCaptureSession>((resolve) => { resolveRemote = resolve })
    const getRemoteSession = vi.fn(() => pending)
    const view = renderRemoteReviewer({ getRemoteSession })

    await waitFor(() => expect(getRemoteSession).toHaveBeenCalled())
    view.unmount()
    resolveRemote(remoteSession)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(getRemoteSession).toHaveBeenCalledOnce()
  })

  it('uses the Capture Library back action for remote review', async () => {
    const { getRemoteSession } = renderRemoteReviewer()

    await screen.findByRole('heading', { name: 'Remote library path' })
    fireEvent.click(screen.getByRole('button', { name: 'Back to Capture Library' }))

    expect(getRemoteSession).toHaveBeenCalledOnce()
    expect(routerPush).toHaveBeenCalledWith('/studio/campus-1/edit/capture-library')
  })
})
