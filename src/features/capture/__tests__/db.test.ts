import { describe, expect, it } from 'vitest'
import { cloneCaptureSession, createMemoryCaptureRepository } from '../db'
import type { CaptureSession } from '../types'

const session: CaptureSession = {
  schemaVersion: 1,
  id: 'capture-db-1',
  title: 'Stored walk',
  campusId: 'campus-1',
  status: 'recording',
  createdAt: '2026-08-31T10:00:00.000Z',
  updatedAt: '2026-08-31T10:00:00.000Z',
  rawSamples: [],
  markers: [],
}

describe('Capture persistence boundary', () => {
  it('clones a session so later raw-sample mutations cannot alter the stored value', async () => {
    const repository = createMemoryCaptureRepository()
    const original = cloneCaptureSession(session)

    await repository.put(original)
    original.rawSamples.push({
      sequence: 0,
      timestamp: '2026-08-31T10:00:01.000Z',
      latitude: 11.8,
      longitude: 122.1,
      accuracy: 3,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
    })

    const stored = await repository.get(session.id)
    expect(stored?.rawSamples).toEqual([])
    expect(stored?.campusId).toBe('campus-1')
    expect(stored).not.toBe(original)
  })

  it('lists sessions in a fresh clone of their persisted values', async () => {
    const repository = createMemoryCaptureRepository()
    await repository.put(session)

    const listed = await repository.list()
    listed[0].title = 'Changed outside repository'

    expect((await repository.get(session.id))?.title).toBe('Stored walk')
    expect((await repository.get(session.id))?.campusId).toBe('campus-1')
  })
})
