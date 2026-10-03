import { create } from 'zustand'
import { cloneCaptureSession, indexedDbCaptureRepository, type CaptureRepository } from './db'
import { deriveCandidateRoute } from './geometry'
import { transitionCaptureSessionStatus } from './timing'
import type { CaptureMarker, CaptureSession, CaptureSessionStatus, RawGpsSample } from './types'

export interface CaptureStoreState {
  sessions: CaptureSession[]
  selectedSessionId: string | null
  hydrated: boolean
  isSaving: boolean
  error: string | null
  hydrate: () => Promise<void>
  createSession: (title?: string, campusId?: string) => Promise<CaptureSession>
  selectSession: (id: string | null) => void
  updateLastPosition: (id: string, sample: RawGpsSample) => Promise<void>
  appendRawSample: (id: string, sample: RawGpsSample) => Promise<void>
  setSessionStatus: (id: string, status: CaptureSessionStatus) => Promise<void>
  addMarker: (id: string, marker: CaptureMarker) => Promise<void>
  removeMarker: (id: string, markerId: string) => Promise<void>
  deriveCandidate: (id: string) => Promise<void>
  finishSession: (id: string) => Promise<void>
  setSessionError: (id: string, error: string | null) => Promise<void>
  importSession: (session: CaptureSession) => Promise<void>
  deleteSession: (id: string) => Promise<void>
  persistSession: (session: CaptureSession) => Promise<void>
  resetForTests: () => void
}

function createId(prefix: string) {
  const randomUuid = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${prefix}-${randomUuid}`
}

function sortSessions(sessions: CaptureSession[]) {
  return sessions.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export interface CaptureStoreOptions {
  now?: () => Date
}

export function createCaptureStore(
  repository: CaptureRepository = indexedDbCaptureRepository,
  options: CaptureStoreOptions = {},
) {
  const now = options.now ?? (() => new Date())
  const nowIso = () => new Date(now().getTime()).toISOString()
  let writeQueue = Promise.resolve()

  const queuePersistence = (session: CaptureSession, set: (state: Partial<CaptureStoreState>) => void) => {
    const snapshot = cloneCaptureSession(session)
    set({ isSaving: true, error: null })
    writeQueue = writeQueue
      .catch(() => undefined)
      .then(() => repository.put(snapshot))
      .finally(() => set({ isSaving: false }))
    return writeQueue
  }

  const replaceSession = (sessions: CaptureSession[], updated: CaptureSession) =>
    sortSessions(sessions.map((session) => session.id === updated.id ? cloneCaptureSession(updated) : session))

  return create<CaptureStoreState>((set, get) => {
    const updateSession = async (id: string, updater: (session: CaptureSession) => CaptureSession) => {
      const current = get().sessions.find((session) => session.id === id)
      if (!current) throw new Error(`Capture session not found: ${id}`)
      const updated = cloneCaptureSession(updater(cloneCaptureSession(current)))
      set({ sessions: replaceSession(get().sessions, updated) })
      await queuePersistence(updated, set)
    }

    return {
      sessions: [],
      selectedSessionId: null,
      hydrated: false,
      isSaving: false,
      error: null,

      async hydrate() {
        try {
          const sessions = await repository.list()
          set({ sessions: sortSessions(sessions), hydrated: true, error: null })
        } catch (error) {
          set({ hydrated: true, error: error instanceof Error ? error.message : 'Unable to restore Capture sessions' })
        }
      },

      async createSession(title = 'Untitled capture', campusId) {
        const createdAt = nowIso()
        const normalizedCampusId = campusId?.trim() || undefined
        const session: CaptureSession = {
          schemaVersion: 1,
          id: createId('capture'),
          title: title.trim() || 'Untitled capture',
          status: 'preparing',
          createdAt,
          updatedAt: createdAt,
          rawSamples: [],
          candidateRoute: null,
          markers: [],
          lastPosition: null,
          lastError: null,
          ...(normalizedCampusId ? { campusId: normalizedCampusId } : {}),
        }
        set({ sessions: sortSessions([...get().sessions, session]), selectedSessionId: session.id, hydrated: true })
        await queuePersistence(session, set)
        return cloneCaptureSession(session)
      },

      selectSession(id) {
        set({ selectedSessionId: id })
      },

      async updateLastPosition(id, sample) {
        await updateSession(id, (session) => {
          if (session.status === 'finished') return session
          return {
            ...session,
            updatedAt: nowIso(),
            lastPosition: { ...sample },
            lastError: null,
          }
        })
      },

      async appendRawSample(id, sample) {
        await updateSession(id, (session) => {
          if (session.status !== 'recording') return session
          return {
            ...session,
            updatedAt: nowIso(),
            rawSamples: [...session.rawSamples, { ...sample }],
            lastPosition: { ...sample },
            lastError: null,
          }
        })
      },

      async setSessionStatus(id, status) {
        await updateSession(id, (session) => {
          const updatedAt = nowIso()
          return {
            ...transitionCaptureSessionStatus(session, status, updatedAt),
            updatedAt,
            lastError: null,
          }
        })
      },

      async addMarker(id, marker) {
        await updateSession(id, (session) => ({
          ...session,
          updatedAt: nowIso(),
          markers: [...session.markers, cloneCaptureSession({ ...session, markers: [marker] }).markers[0]],
        }))
      },

      async removeMarker(id, markerId) {
        await updateSession(id, (session) => ({
          ...session,
          updatedAt: nowIso(),
          markers: session.markers.filter((marker) => marker.id !== markerId),
        }))
      },

      async deriveCandidate(id) {
        await updateSession(id, (session) => ({
          ...session,
          updatedAt: nowIso(),
          candidateRoute: deriveCandidateRoute(session.rawSamples, { derivedAt: nowIso() }),
        }))
      },

      async finishSession(id) {
        await updateSession(id, (session) => {
          const finishedAt = nowIso()
          const transitioned = transitionCaptureSessionStatus(session, 'finished', finishedAt)
          return {
            ...transitioned,
            updatedAt: finishedAt,
            candidateRoute: deriveCandidateRoute(session.rawSamples, { derivedAt: finishedAt }),
            lastError: null,
          }
        })
      },

      async setSessionError(id, error) {
        await updateSession(id, (session) => ({ ...session, updatedAt: nowIso(), lastError: error }))
      },

      async importSession(session) {
        const imported = cloneCaptureSession(session)
        set({ sessions: replaceSession(get().sessions, imported), selectedSessionId: imported.id, hydrated: true })
        await queuePersistence(imported, set)
      },

      async deleteSession(id) {
        await repository.delete(id)
        set({
          sessions: get().sessions.filter((session) => session.id !== id),
          selectedSessionId: get().selectedSessionId === id ? null : get().selectedSessionId,
        })
      },

      async persistSession(session) {
        const snapshot = cloneCaptureSession(session)
        set({ sessions: replaceSession(get().sessions, snapshot) })
        await queuePersistence(snapshot, set)
      },

      resetForTests() {
        set({ sessions: [], selectedSessionId: null, hydrated: false, isSaving: false, error: null })
      },
    }
  })
}

export type CaptureStore = ReturnType<typeof createCaptureStore>

export const useCaptureStore = createCaptureStore()
