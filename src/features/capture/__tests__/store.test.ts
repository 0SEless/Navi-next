import { describe, expect, it } from 'vitest'
import { createMemoryCaptureRepository } from '../db'
import { createCaptureStore } from '../store'
import { getActiveCaptureDurationMs } from '../metrics'
import type { CaptureMarker, RawGpsSample } from '../types'

const sample: RawGpsSample = {
  sequence: 0,
  timestamp: '2026-08-31T10:00:01.000Z',
  latitude: 11.8,
  longitude: 122.1,
  accuracy: 3,
  altitude: null,
  altitudeAccuracy: null,
  heading: null,
  speed: null,
}

const marker: CaptureMarker = {
  id: 'marker-1',
  type: 'hazard',
  position: { latitude: 11.8, longitude: 122.1 },
  label: 'Broken path',
  note: 'Needs inspection',
  createdAt: '2026-08-31T10:00:02.000Z',
}

describe('Capture store', () => {
  it('persists raw samples and markers, derives a candidate on finish, and restores after hydrate', async () => {
    const repository = createMemoryCaptureRepository()
    const store = createCaptureStore(repository)
    await store.getState().hydrate()

    const created = await store.getState().createSession('South path', 'campus-1')
    expect(created.campusId).toBe('campus-1')
    await store.getState().setSessionStatus(created.id, 'recording')
    await store.getState().appendRawSample(created.id, sample)
    await store.getState().addMarker(created.id, marker)
    await store.getState().finishSession(created.id)

    const finished = store.getState().sessions.find((item) => item.id === created.id)
    expect(finished?.status).toBe('finished')
    expect(finished?.campusId).toBe('campus-1')
    expect(finished?.rawSamples).toEqual([sample])
    expect(finished?.markers).toEqual([marker])
    expect(finished?.candidateRoute?.sourceSampleIndices).toEqual([0])

    store.getState().resetForTests()
    await store.getState().hydrate()

    expect(store.getState().sessions).toHaveLength(1)
    expect(store.getState().sessions[0].campusId).toBe('campus-1')
    expect(store.getState().sessions[0].rawSamples).toEqual([sample])
    expect(store.getState().sessions[0].markers).toEqual([marker])
  })

  it('keeps selected session state isolated from the repository and supports deletion', async () => {
    const repository = createMemoryCaptureRepository()
    const store = createCaptureStore(repository)
    const created = await store.getState().createSession('Temporary path')

    expect(store.getState().selectedSessionId).toBe(created.id)
    await store.getState().deleteSession(created.id)

    expect(store.getState().sessions).toEqual([])
    expect(store.getState().selectedSessionId).toBeNull()
    expect(await repository.get(created.id)).toBeNull()
  })

  it('persists active timing across pause, resume, finish, and hydrate without changing raw samples', async () => {
    let now = Date.parse('2026-08-31T10:00:00.000Z')
    const repository = createMemoryCaptureRepository()
    const store = createCaptureStore(repository, { now: () => new Date(now) })
    const created = await store.getState().createSession('Timed path')
    await store.getState().setSessionStatus(created.id, 'recording')
    await store.getState().appendRawSample(created.id, sample)

    now += 10_000
    await store.getState().setSessionStatus(created.id, 'paused')
    now += 20_000
    await store.getState().setSessionStatus(created.id, 'recording')
    now += 30_000
    await store.getState().finishSession(created.id)

    const finished = store.getState().sessions[0]
    expect(finished.pausedDurationMs).toBe(20_000)
    expect(getActiveCaptureDurationMs(finished, now)).toBe(40_000)
    expect(finished.rawSamples).toEqual([sample])

    store.getState().resetForTests()
    await store.getState().hydrate()

    const restored = store.getState().sessions[0]
    expect(restored.pausedDurationMs).toBe(20_000)
    expect(getActiveCaptureDurationMs(restored, now)).toBe(40_000)
    expect(restored.rawSamples).toEqual([sample])
  })

  it('creates a Preparing session with no active time or route samples until Start', async () => {
    let now = Date.parse('2026-09-01T10:00:00.000Z')
    const store = createCaptureStore(createMemoryCaptureRepository(), { now: () => new Date(now) })

    const created = await store.getState().createSession('Preparing path', 'campus-1')
    await store.getState().appendRawSample(created.id, sample)

    expect(created.status).toBe('preparing')
    expect(created.startedAt).toBeUndefined()
    expect(store.getState().sessions[0].rawSamples).toEqual([])
    expect(getActiveCaptureDurationMs(store.getState().sessions[0], now + 30_000)).toBe(0)

    now += 30_000
    await store.getState().setSessionStatus(created.id, 'recording')
    const started = store.getState().sessions[0]
    expect(started.status).toBe('recording')
    expect(started.startedAt).toBe(new Date(now).toISOString())
  })

  it('updates the live observed position without appending a route sample', async () => {
    const store = createCaptureStore(createMemoryCaptureRepository())
    const created = await store.getState().createSession('Observed path')
    const state = store.getState() as unknown as {
      updateLastPosition?: (id: string, position: RawGpsSample) => Promise<void>
    }

    expect(state.updateLastPosition).toBeTypeOf('function')
    await state.updateLastPosition?.(created.id, sample)

    const observed = store.getState().sessions[0]
    expect(observed.status).toBe('preparing')
    expect(observed.lastPosition).toEqual(sample)
    expect(observed.rawSamples).toEqual([])

    store.getState().resetForTests()
    await store.getState().hydrate()
    expect(store.getState().sessions[0].lastPosition).toEqual(sample)
    expect(store.getState().sessions[0].rawSamples).toEqual([])
  })

  it('keeps markers independent from route samples in Preparing and Paused', async () => {
    const store = createCaptureStore(createMemoryCaptureRepository())
    const created = await store.getState().createSession('Marker path', 'campus-1')
    await store.getState().addMarker(created.id, marker)
    await store.getState().setSessionStatus(created.id, 'recording')
    await store.getState().setSessionStatus(created.id, 'paused')
    await store.getState().appendRawSample(created.id, sample)
    await store.getState().addMarker(created.id, { ...marker, id: 'marker-2', type: 'poi' })

    const paused = store.getState().sessions[0]
    expect(paused.status).toBe('paused')
    expect(paused.rawSamples).toEqual([])
    expect(paused.markers.map((item) => item.id)).toEqual(['marker-1', 'marker-2'])
  })

  it('finishes safely from Preparing without inventing recording time', async () => {
    const store = createCaptureStore(createMemoryCaptureRepository())
    const created = await store.getState().createSession('Unstarted path')

    await store.getState().finishSession(created.id)

    const finished = store.getState().sessions[0]
    expect(finished.status).toBe('finished')
    expect(finished.startedAt).toBeUndefined()
    expect(finished.rawSamples).toEqual([])
    expect(getActiveCaptureDurationMs(finished)).toBe(0)
  })
})
