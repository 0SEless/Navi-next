import { beforeEach, describe, expect, it } from 'vitest'

import { CAPTURE_SCHEMA_VERSION, type CaptureSession } from '../../capture/types'
import { CaptureCloudError } from '../errors'
import { createMemoryCaptureSyncStateRepository } from '../local-state'
import { createCaptureSyncService } from '../service'
import type {
  CaptureCloudRepository,
  RemoteCaptureSummary,
  RemoteCaptureSession,
  UploadResult,
} from '../types'
import { createMemoryCaptureRepository } from '../../capture/db'

const finishedSession: CaptureSession = {
  schemaVersion: CAPTURE_SCHEMA_VERSION,
  id: 'capture-1',
  title: 'North walkway survey',
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
      accuracy: 4.5,
      altitude: 12,
      altitudeAccuracy: 3,
      heading: 90,
      speed: 1.2,
    },
    {
      sequence: 1,
      timestamp: '2026-08-31T08:00:05.000Z',
      latitude: 14.5996,
      longitude: 120.9843,
      accuracy: 5,
      altitude: 12.2,
      altitudeAccuracy: 3.2,
      heading: 92,
      speed: 1.1,
    },
  ],
  candidateRoute: {
    points: [
      { latitude: 14.5995, longitude: 120.9842 },
      { latitude: 14.5996, longitude: 120.9843 },
    ],
    sourceSampleIndices: [0, 1],
    edgeCount: 1,
    derivedFromSampleCount: 2,
    derivedAt: '2026-08-31T08:15:01.000Z',
    algorithmVersion: 'capture-v1',
  },
  markers: [
    {
      id: 'marker-1',
      type: 'hazard',
      position: { latitude: 14.59955, longitude: 120.98425 },
      label: 'Uneven paving',
      createdAt: '2026-08-31T08:05:00.000Z',
    },
  ],
  lastPosition: null,
  lastError: null,
}

const remoteSummary: RemoteCaptureSummary = {
  sessionId: finishedSession.id,
  campusId: finishedSession.campusId ?? null,
  title: finishedSession.title,
  status: finishedSession.status,
  schemaVersion: finishedSession.schemaVersion,
  contentHash: 'remote-hash',
  clientUpdatedAt: finishedSession.updatedAt,
  createdAt: finishedSession.createdAt,
  updatedAt: finishedSession.updatedAt,
}

class FakeCloudRepository implements CaptureCloudRepository {
  uploadCalls: Array<{ session: CaptureSession; expectedRemoteHash?: string | null }> = []
  updateCalls: unknown[] = []
  uploadResult: UploadResult = { kind: 'uploaded', remote: remoteSummary }
  uploadError: CaptureCloudError | null = null

  async getSession(_sessionId: string): Promise<RemoteCaptureSession | null> {
    return null
  }

  async listSessions(): Promise<RemoteCaptureSummary[]> {
    return []
  }

  async uploadSession(
    session: CaptureSession,
    expectedRemoteHash?: string | null,
  ): Promise<UploadResult> {
    this.uploadCalls.push({ session: structuredClone(session), expectedRemoteHash })
    if (this.uploadError) {
      throw this.uploadError
    }
    return this.uploadResult
  }
}

const fixedNow = () => new Date('2026-08-31T09:00:00.000Z')

describe('CaptureSyncService', () => {
  const localRepository = createMemoryCaptureRepository()
  const stateRepository = createMemoryCaptureSyncStateRepository()
  const cloud = new FakeCloudRepository()
  const service = createCaptureSyncService({
    localRepository,
    stateRepository,
    cloudRepository: cloud,
    now: fixedNow,
  })

  beforeEach(async () => {
    await localRepository.put(finishedSession)
    cloud.uploadCalls = []
    cloud.updateCalls = []
    cloud.uploadResult = { kind: 'uploaded', remote: remoteSummary }
    cloud.uploadError = null
    await stateRepository.delete(finishedSession.id)
    await stateRepository.delete('recording-1')
  })

  it('queues a finished session without calling the cloud repository', async () => {
    const state = await service.queueSession(finishedSession.id)

    expect(state.status).toBe('queued')
    expect(cloud.uploadCalls).toHaveLength(0)
  })

  it('does not call the cloud repository for a recording session', async () => {
    await localRepository.put({
      ...structuredClone(finishedSession),
      id: 'recording-1',
      status: 'recording',
      finishedAt: undefined,
    })

    await expect(service.syncSession('recording-1')).rejects.toMatchObject({
      code: 'SESSION_NOT_FINISHED',
    })
    expect(cloud.uploadCalls).toHaveLength(0)
    expect(await stateRepository.get('recording-1')).toMatchObject({
      status: 'failed',
      errorCode: 'SESSION_NOT_FINISHED',
    })
  })

  it('marks a successful upload as synced without changing raw samples', async () => {
    const before = structuredClone(finishedSession)

    const state = await service.syncSession(finishedSession.id)

    expect(state.status).toBe('synced')
    expect(state.lastSyncedHash).toMatch(/^[0-9a-f]{64}$/)
    expect(state.lastSyncedAt).toBe(fixedNow().toISOString())
    expect(cloud.uploadCalls[0]?.session.campusId).toBe(before.campusId)
    expect(cloud.uploadCalls[0]?.session.rawSamples).toEqual(before.rawSamples)
    expect(cloud.uploadCalls[0]?.session.candidateRoute).toEqual(before.candidateRoute)
    expect(cloud.uploadCalls[0]?.session.markers).toEqual(before.markers)
    expect((await localRepository.get(finishedSession.id))?.rawSamples).toEqual(before.rawSamples)
  })

  it('rejects campus-less cloud sync while preserving the local session', async () => {
    const campusless = structuredClone(finishedSession)
    delete campusless.campusId
    await localRepository.put(campusless)

    const state = await service.syncSession(campusless.id)

    expect(state).toMatchObject({
      status: 'failed',
      errorCode: 'CAMPUS_REQUIRED',
      nextRetryAt: null,
    })
    expect(cloud.uploadCalls).toHaveLength(0)
    expect((await localRepository.get(campusless.id))?.rawSamples).toEqual(finishedSession.rawSamples)
    expect((await localRepository.get(campusless.id))?.candidateRoute).toEqual(finishedSession.candidateRoute)
  })

  it('marks a network failure as failed with a retry timestamp', async () => {
    cloud.uploadError = new CaptureCloudError('NETWORK_ERROR')

    const state = await service.syncSession(finishedSession.id)

    expect(state).toMatchObject({
      status: 'failed',
      attemptCount: 1,
      errorCode: 'NETWORK_ERROR',
    })
    expect(state.nextRetryAt).toBeTruthy()
  })

  it('marks a remote hash change as conflict and never overwrites it', async () => {
    cloud.uploadResult = { kind: 'conflict', remote: remoteSummary }

    const state = await service.syncSession(finishedSession.id)

    expect(state.status).toBe('conflict')
    expect(state.errorCode).toBe('REMOTE_CONFLICT')
    expect(cloud.updateCalls).toHaveLength(0)
    expect((await localRepository.get(finishedSession.id))?.rawSamples).toEqual(
      finishedSession.rawSamples,
    )
  })
})
