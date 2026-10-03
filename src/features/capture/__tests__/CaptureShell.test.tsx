import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryCaptureRepository } from '../db'
import { createCaptureStore } from '../store'
import { CaptureShell } from '../components/CaptureShell'

vi.mock('../components/RecordingMap', () => ({
  RecordingMap: ({
    session,
    onStart,
    onPause,
    onResume,
    onFinish,
    onAddMarker,
    onPosition,
  }: {
    session: { rawSamples: unknown[]; status: string }
    onStart?: () => void
    onPause: () => void
    onResume: () => void
    onFinish: () => void
    onAddMarker: (draft: { type: 'poi'; label: string }) => void
    onPosition?: (sample: {
      sequence: number
      timestamp: string
      latitude: number
      longitude: number
      accuracy: number
      altitude: null
      altitudeAccuracy: null
      heading: null
      speed: null
    }) => void
  }) => (
    <section aria-label="Recording Map">
      <h1>Recording Map</h1>
      <span>{session.status}</span>
      <span>{session.rawSamples.length} raw samples</span>
      <button onClick={() => onStart?.()}>Start recording</button>
      <button onClick={onPause}>Pause recording</button>
      <button onClick={onResume}>Resume recording</button>
      <button onClick={() => onPosition?.({ sequence: 0, timestamp: '2026-08-31T10:00:00.000Z', latitude: 11.8, longitude: 122.1, accuracy: 4, altitude: null, altitudeAccuracy: null, heading: null, speed: null })}>Emit GPS fix</button>
      <button onClick={onAddMarker.bind(null, { type: 'poi', label: 'Library' })}>Drop POI</button>
      <button onClick={onFinish}>Finish capture</button>
    </section>
  ),
}))

vi.mock('../components/CaptureReview', () => ({
  CaptureReview: ({
    session,
    onBack,
  }: {
    session: { rawSamples: unknown[]; candidateRoute?: unknown; markers: unknown[] }
    onBack: () => void
  }) => (
    <section aria-label="Capture Review">
      <h1>Capture Review</h1>
      <span>{session.rawSamples.length} raw samples</span>
      <span>{session.candidateRoute ? 'Candidate route ready' : 'No candidate route'}</span>
      <span>{session.markers.length} markers</span>
      <button onClick={onBack}>Back to captures</button>
    </section>
  ),
}))

describe('CaptureShell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('moves from Home to Recording and then Review while preserving the session summary', async () => {
    const store = createCaptureStore(createMemoryCaptureRepository())
    render(
      <CaptureShell
        store={store}
        campusId="campus-1"
        campusLabel="North Campus"
        campusOptions={[{ id: 'campus-1', label: 'North Campus' }]}
      />,
    )

    expect(await screen.findByRole('heading', { name: 'Capture Home' })).toBeInTheDocument()
    expect(screen.getByLabelText('Capture campus')).toHaveValue('campus-1')

    fireEvent.change(screen.getByLabelText('Capture name'), { target: { value: 'East path' } })
    fireEvent.click(screen.getByRole('button', { name: 'New capture' }))
    expect(await screen.findByRole('heading', { name: 'Recording Map' })).toBeInTheDocument()
    expect(store.getState().sessions[0].status).toBe('preparing')
    fireEvent.click(screen.getByRole('button', { name: 'Start recording' }))

    fireEvent.click(screen.getByRole('button', { name: 'Pause recording' }))
    fireEvent.click(screen.getByRole('button', { name: 'Resume recording' }))
    await store.getState().appendRawSample(store.getState().sessions[0].id, {
      sequence: 0,
      timestamp: '2026-08-31T10:00:01.000Z',
      latitude: 11.8,
      longitude: 122.1,
      accuracy: 4,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Drop POI' }))

    await waitFor(() => expect(store.getState().sessions[0].markers).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: 'Finish capture' }))

    expect(await screen.findByRole('heading', { name: 'Capture Review' })).toBeInTheDocument()
    expect(screen.getByText('1 raw samples')).toBeInTheDocument()
    expect(screen.getByText('Candidate route ready')).toBeInTheDocument()
    expect(screen.getByText('1 markers')).toBeInTheDocument()
    expect(store.getState().sessions[0].status).toBe('finished')
    expect(store.getState().sessions[0].campusId).toBe('campus-1')
  })

  it('keeps local recording available when no campus is selected', async () => {
    const store = createCaptureStore(createMemoryCaptureRepository())
    render(<CaptureShell store={store} campusOptions={[]} campusId={null} />)

    expect(await screen.findByRole('heading', { name: 'Capture Home' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Capture name'), { target: { value: 'Local path' } })
    fireEvent.click(screen.getByRole('button', { name: 'New capture' }))

    expect(await screen.findByRole('heading', { name: 'Recording Map' })).toBeInTheDocument()
    expect(store.getState().sessions[0].campusId).toBeUndefined()
  })

  it('keeps marker placement available in Preparing and Paused without route samples', async () => {
    const store = createCaptureStore(createMemoryCaptureRepository())
    render(<CaptureShell store={store} campusId="campus-1" campusOptions={[{ id: 'campus-1', label: 'North Campus' }]} />)

    fireEvent.change(await screen.findByLabelText('Capture name'), { target: { value: 'Marker states' } })
    fireEvent.click(screen.getByRole('button', { name: 'New capture' }))
    await screen.findByRole('heading', { name: 'Recording Map' })
    fireEvent.click(screen.getByRole('button', { name: 'Emit GPS fix' }))
    fireEvent.click(screen.getByRole('button', { name: 'Drop POI' }))

    await waitFor(() => expect(store.getState().sessions[0].markers).toHaveLength(1))
    expect(store.getState().sessions[0].status).toBe('preparing')
    expect(store.getState().sessions[0].rawSamples).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: 'Start recording' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pause recording' }))
    fireEvent.click(screen.getByRole('button', { name: 'Emit GPS fix' }))
    fireEvent.click(screen.getByRole('button', { name: 'Drop POI' }))

    await waitFor(() => expect(store.getState().sessions[0].markers).toHaveLength(2))
    expect(store.getState().sessions[0].status).toBe('paused')
    expect(store.getState().sessions[0].rawSamples).toEqual([])
  })

  it('restores a saved session on hydrate and opens it for review', async () => {
    const repository = createMemoryCaptureRepository()
    const seedStore = createCaptureStore(repository)
    const saved = await seedStore.getState().createSession('Saved route')
    await seedStore.getState().finishSession(saved.id)

    const store = createCaptureStore(repository)
    render(<CaptureShell store={store} />)

    expect(await screen.findByText('Saved route')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Review Saved route' }))

    expect(await screen.findByRole('heading', { name: 'Capture Review' })).toBeInTheDocument()
  })
})
