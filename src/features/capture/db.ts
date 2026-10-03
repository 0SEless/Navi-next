import type { CaptureSession } from './types'

export const CAPTURE_DB_NAME = 'navi-capture-local-v1'
export const CAPTURE_OBJECT_STORE = 'sessions'

export interface CaptureRepository {
  list(): Promise<CaptureSession[]>
  get(id: string): Promise<CaptureSession | null>
  put(session: CaptureSession): Promise<void>
  delete(id: string): Promise<void>
}

export function cloneCaptureSession(session: CaptureSession): CaptureSession {
  if (typeof structuredClone === 'function') return structuredClone(session)
  return JSON.parse(JSON.stringify(session)) as CaptureSession
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

export function openCaptureDatabase(factory: IDBFactory | undefined = typeof indexedDB === 'undefined' ? undefined : indexedDB): Promise<IDBDatabase> {
  if (!factory) {
    return Promise.reject(new Error('IndexedDB is unavailable in this environment'))
  }

  return new Promise((resolve, reject) => {
    const request = factory.open(CAPTURE_DB_NAME, 1)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(CAPTURE_OBJECT_STORE)) {
        database.createObjectStore(CAPTURE_OBJECT_STORE, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Unable to open Capture IndexedDB'))
    request.onblocked = () => reject(new Error('Capture IndexedDB upgrade is blocked'))
  })
}

export function createIndexedDbCaptureRepository(
  factory: IDBFactory | undefined = typeof indexedDB === 'undefined' ? undefined : indexedDB,
): CaptureRepository {
  return {
    async list() {
      const database = await openCaptureDatabase(factory)
      try {
        const transaction = database.transaction(CAPTURE_OBJECT_STORE, 'readonly')
        const values = await requestResult(transaction.objectStore(CAPTURE_OBJECT_STORE).getAll())
        return values.map(cloneCaptureSession)
      } finally {
        database.close()
      }
    },
    async get(id) {
      const database = await openCaptureDatabase(factory)
      try {
        const transaction = database.transaction(CAPTURE_OBJECT_STORE, 'readonly')
        const value = await requestResult(transaction.objectStore(CAPTURE_OBJECT_STORE).get(id))
        return value ? cloneCaptureSession(value) : null
      } finally {
        database.close()
      }
    },
    async put(session) {
      const database = await openCaptureDatabase(factory)
      try {
        const transaction = database.transaction(CAPTURE_OBJECT_STORE, 'readwrite')
        await requestResult(transaction.objectStore(CAPTURE_OBJECT_STORE).put(cloneCaptureSession(session)))
      } finally {
        database.close()
      }
    },
    async delete(id) {
      const database = await openCaptureDatabase(factory)
      try {
        const transaction = database.transaction(CAPTURE_OBJECT_STORE, 'readwrite')
        await requestResult(transaction.objectStore(CAPTURE_OBJECT_STORE).delete(id))
      } finally {
        database.close()
      }
    },
  }
}

export const indexedDbCaptureRepository = createIndexedDbCaptureRepository()

export const listCaptureSessions = () => indexedDbCaptureRepository.list()
export const getCaptureSession = (id: string) => indexedDbCaptureRepository.get(id)
export const putCaptureSession = (session: CaptureSession) => indexedDbCaptureRepository.put(session)
export const deleteCaptureSession = (id: string) => indexedDbCaptureRepository.delete(id)

export function createMemoryCaptureRepository(): CaptureRepository {
  const records = new Map<string, CaptureSession>()

  return {
    async list() {
      return Array.from(records.values(), cloneCaptureSession)
    },
    async get(id) {
      const value = records.get(id)
      return value ? cloneCaptureSession(value) : null
    },
    async put(session) {
      records.set(session.id, cloneCaptureSession(session))
    },
    async delete(id) {
      records.delete(id)
    },
  }
}
