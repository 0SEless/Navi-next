import type { CaptureSyncState } from './types'

export const CAPTURE_SYNC_DB_NAME = 'navi-capture-sync-v1'
export const CAPTURE_SYNC_OBJECT_STORE = 'sync-state'

export interface CaptureSyncStateRepository {
  list(): Promise<CaptureSyncState[]>
  get(sessionId: string): Promise<CaptureSyncState | null>
  put(state: CaptureSyncState): Promise<void>
  delete(sessionId: string): Promise<void>
}

export function cloneCaptureSyncState(state: CaptureSyncState): CaptureSyncState {
  if (typeof structuredClone === 'function') return structuredClone(state)
  return JSON.parse(JSON.stringify(state)) as CaptureSyncState
}

export function createLocalState(sessionId: string): CaptureSyncState {
  return {
    sessionId,
    status: 'local',
    attemptCount: 0,
    lastSyncedHash: null,
    lastSyncedAt: null,
    lastAttemptAt: null,
    nextRetryAt: null,
    errorCode: null,
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

export function openCaptureSyncDatabase(
  factory: IDBFactory | undefined = typeof indexedDB === 'undefined' ? undefined : indexedDB,
): Promise<IDBDatabase> {
  if (!factory) {
    return Promise.reject(new Error('IndexedDB is unavailable in this environment'))
  }

  return new Promise((resolve, reject) => {
    const request = factory.open(CAPTURE_SYNC_DB_NAME, 1)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(CAPTURE_SYNC_OBJECT_STORE)) {
        database.createObjectStore(CAPTURE_SYNC_OBJECT_STORE, { keyPath: 'sessionId' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Unable to open Capture sync IndexedDB'))
    request.onblocked = () => reject(new Error('Capture sync IndexedDB upgrade is blocked'))
  })
}

export function createIndexedDbCaptureSyncStateRepository(
  factory: IDBFactory | undefined = typeof indexedDB === 'undefined' ? undefined : indexedDB,
): CaptureSyncStateRepository {
  return {
    async list() {
      const database = await openCaptureSyncDatabase(factory)
      try {
        const transaction = database.transaction(CAPTURE_SYNC_OBJECT_STORE, 'readonly')
        const values = await requestResult(
          transaction.objectStore(CAPTURE_SYNC_OBJECT_STORE).getAll(),
        )
        return values.map(cloneCaptureSyncState)
      } finally {
        database.close()
      }
    },
    async get(sessionId) {
      const database = await openCaptureSyncDatabase(factory)
      try {
        const transaction = database.transaction(CAPTURE_SYNC_OBJECT_STORE, 'readonly')
        const value = await requestResult(
          transaction.objectStore(CAPTURE_SYNC_OBJECT_STORE).get(sessionId),
        )
        return value ? cloneCaptureSyncState(value) : null
      } finally {
        database.close()
      }
    },
    async put(state) {
      const database = await openCaptureSyncDatabase(factory)
      try {
        const transaction = database.transaction(CAPTURE_SYNC_OBJECT_STORE, 'readwrite')
        await requestResult(
          transaction.objectStore(CAPTURE_SYNC_OBJECT_STORE).put(cloneCaptureSyncState(state)),
        )
      } finally {
        database.close()
      }
    },
    async delete(sessionId) {
      const database = await openCaptureSyncDatabase(factory)
      try {
        const transaction = database.transaction(CAPTURE_SYNC_OBJECT_STORE, 'readwrite')
        await requestResult(transaction.objectStore(CAPTURE_SYNC_OBJECT_STORE).delete(sessionId))
      } finally {
        database.close()
      }
    },
  }
}

export function createMemoryCaptureSyncStateRepository(): CaptureSyncStateRepository {
  const records = new Map<string, CaptureSyncState>()

  return {
    async list() {
      return Array.from(records.values(), cloneCaptureSyncState)
    },
    async get(sessionId) {
      const value = records.get(sessionId)
      return value ? cloneCaptureSyncState(value) : null
    },
    async put(state) {
      records.set(state.sessionId, cloneCaptureSyncState(state))
    },
    async delete(sessionId) {
      records.delete(sessionId)
    },
  }
}
