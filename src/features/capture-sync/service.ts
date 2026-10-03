import type { CaptureRepository } from '../capture/db'
import { CaptureCloudError } from './errors'
import { hashCaptureSession } from './hash'
import {
  createLocalState,
  type CaptureSyncStateRepository,
} from './local-state'
import type {
  CaptureCloudRepository,
  CaptureSyncState,
} from './types'

const DEFAULT_RETRY_DELAY_MS = 5_000

export interface CaptureSyncServiceOptions {
  localRepository: CaptureRepository
  stateRepository: CaptureSyncStateRepository
  cloudRepository: CaptureCloudRepository
  now?: () => Date
  retryDelayMs?: number
}

export interface CaptureSyncService {
  queueSession(sessionId: string): Promise<CaptureSyncState>
  syncSession(sessionId: string): Promise<CaptureSyncState>
  syncQueuedSessions(): Promise<CaptureSyncState[]>
  getState(sessionId: string): Promise<CaptureSyncState>
  removeState(sessionId: string): Promise<void>
}

function cloneDate(now: () => Date): Date {
  return new Date(now().getTime())
}

function toIso(now: () => Date): string {
  return cloneDate(now).toISOString()
}

function missingSessionError(): CaptureCloudError {
  return new CaptureCloudError('INVALID_PAYLOAD', 'Capture session was not found.')
}

function normalizeCloudError(error: unknown): CaptureCloudError {
  if (error instanceof CaptureCloudError) {
    return error
  }

  return new CaptureCloudError('REMOTE_ERROR', undefined, { cause: error })
}

function isRetryDue(state: CaptureSyncState, now: Date): boolean {
  return state.status === 'failed' && state.nextRetryAt !== null && Date.parse(state.nextRetryAt) <= now.getTime()
}

export function createCaptureSyncService({
  localRepository,
  stateRepository,
  cloudRepository,
  now = () => new Date(),
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
}: CaptureSyncServiceOptions): CaptureSyncService {
  async function requireLocalSession(sessionId: string) {
    const session = await localRepository.get(sessionId)
    if (!session) {
      throw missingSessionError()
    }
    return session
  }

  async function ensureState(sessionId: string): Promise<CaptureSyncState> {
    const existing = await stateRepository.get(sessionId)
    if (existing) {
      return existing
    }

    await requireLocalSession(sessionId)
    const state = createLocalState(sessionId)
    await stateRepository.put(state)
    return state
  }

  async function queueSession(sessionId: string): Promise<CaptureSyncState> {
    await requireLocalSession(sessionId)
    const current = await ensureState(sessionId)
    const queued: CaptureSyncState = {
      ...current,
      status: 'queued',
      errorCode: null,
      nextRetryAt: null,
    }
    await stateRepository.put(queued)
    return queued
  }

  async function syncSession(sessionId: string): Promise<CaptureSyncState> {
    const session = await requireLocalSession(sessionId)
    const current = await ensureState(sessionId)

    if (session.status !== 'finished') {
      const error = new CaptureCloudError('SESSION_NOT_FINISHED')
      const failed: CaptureSyncState = {
        ...current,
        status: 'failed',
        errorCode: error.code,
        nextRetryAt: null,
      }
      await stateRepository.put(failed)
      throw error
    }

    if (typeof session.campusId !== 'string' || session.campusId.trim().length === 0) {
      const error = new CaptureCloudError('CAMPUS_REQUIRED')
      const failed: CaptureSyncState = {
        ...current,
        status: 'failed',
        errorCode: error.code,
        nextRetryAt: null,
      }
      await stateRepository.put(failed)
      return failed
    }

    const contentHash = await hashCaptureSession(session)
    const attemptAt = toIso(now)
    const syncing: CaptureSyncState = {
      ...current,
      status: 'syncing',
      attemptCount: current.attemptCount + 1,
      lastAttemptAt: attemptAt,
      nextRetryAt: null,
      errorCode: null,
    }
    await stateRepository.put(syncing)

    try {
      const result = await cloudRepository.uploadSession(session, current.lastSyncedHash)

      if (result.kind === 'conflict') {
        const conflict: CaptureSyncState = {
          ...syncing,
          status: 'conflict',
          errorCode: 'REMOTE_CONFLICT',
          nextRetryAt: null,
        }
        await stateRepository.put(conflict)
        return conflict
      }

      const synced: CaptureSyncState = {
        ...syncing,
        status: 'synced',
        lastSyncedHash: contentHash,
        lastSyncedAt: toIso(now),
        nextRetryAt: null,
        errorCode: null,
      }
      await stateRepository.put(synced)
      return synced
    } catch (cause) {
      const error = normalizeCloudError(cause)
      const nextRetryAt = error.retryable
        ? new Date(
            cloneDate(now).getTime() + retryDelayMs * 2 ** Math.max(0, syncing.attemptCount - 1),
          ).toISOString()
        : null
      const failed: CaptureSyncState = {
        ...syncing,
        status: 'failed',
        errorCode: error.code,
        nextRetryAt,
      }
      await stateRepository.put(failed)
      return failed
    }
  }

  async function syncQueuedSessions(): Promise<CaptureSyncState[]> {
    const states = await stateRepository.list()
    const currentTime = cloneDate(now)
    const eligible = states.filter(
      (state) => state.status === 'queued' || isRetryDue(state, currentTime),
    )
    const results: CaptureSyncState[] = []

    for (const state of eligible) {
      try {
        results.push(await syncSession(state.sessionId))
      } catch {
        const latest = await stateRepository.get(state.sessionId)
        if (latest) {
          results.push(latest)
        }
      }
    }

    return results
  }

  async function getState(sessionId: string): Promise<CaptureSyncState> {
    return ensureState(sessionId)
  }

  async function removeState(sessionId: string): Promise<void> {
    await stateRepository.delete(sessionId)
  }

  return {
    queueSession,
    syncSession,
    syncQueuedSessions,
    getState,
    removeState,
  }
}
