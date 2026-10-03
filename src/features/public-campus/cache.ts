import type { CampusBundle } from '@/types/nav-types'
import { isUsablePublicCampusBundle } from './types'

export const PUBLIC_CAMPUS_CACHE_DB_NAME = 'navi-public-campus-cache-v1'
export const PUBLIC_CAMPUS_CACHE_OBJECT_STORE = 'campuses'
export const PUBLIC_CAMPUS_CACHE_SCHEMA_VERSION = 1 as const

export interface CachedCampus {
  campusId: string
  cacheSchemaVersion: typeof PUBLIC_CAMPUS_CACHE_SCHEMA_VERSION
  revision: string | null
  downloadedAt: number
  source: 'published'
  payload: CampusBundle
}

export interface CampusCacheRepository {
  get(campusId: string): Promise<CachedCampus | null>
  put(record: CachedCampus): Promise<void>
  delete(campusId: string): Promise<void>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Returns a validated cache record, or null when persisted data is unsafe to use. */
export function validateCachedCampus(value: unknown, requestedCampusId: string): CachedCampus | null {
  if (!isRecord(value)) return null
  if (value.campusId !== requestedCampusId || typeof value.campusId !== 'string' || !value.campusId) return null
  if (value.cacheSchemaVersion !== PUBLIC_CAMPUS_CACHE_SCHEMA_VERSION) return null
  if (value.source !== 'published') return null
  if (value.revision !== null && typeof value.revision !== 'string') return null
  if (typeof value.downloadedAt !== 'number' || !Number.isFinite(value.downloadedAt) || value.downloadedAt <= 0) return null
  if (!isUsablePublicCampusBundle(value.payload)) return null
  return value as unknown as CachedCampus
}

export function cloneCachedCampus(record: CachedCampus): CachedCampus {
  if (typeof structuredClone === 'function') return structuredClone(record)
  return JSON.parse(JSON.stringify(record)) as CachedCampus
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

export function openPublicCampusCacheDatabase(
  factory: IDBFactory | undefined = typeof indexedDB === 'undefined' ? undefined : indexedDB,
): Promise<IDBDatabase> {
  if (!factory) {
    return Promise.reject(new Error('IndexedDB is unavailable in this environment'))
  }

  return new Promise((resolve, reject) => {
    const request = factory.open(PUBLIC_CAMPUS_CACHE_DB_NAME, 1)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(PUBLIC_CAMPUS_CACHE_OBJECT_STORE)) {
        database.createObjectStore(PUBLIC_CAMPUS_CACHE_OBJECT_STORE, { keyPath: 'campusId' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Unable to open public campus cache'))
    request.onblocked = () => reject(new Error('Public campus cache upgrade is blocked'))
  })
}

export function createIndexedDbCampusCacheRepository(
  factory: IDBFactory | undefined = typeof indexedDB === 'undefined' ? undefined : indexedDB,
): CampusCacheRepository {
  return {
    async get(campusId) {
      const database = await openPublicCampusCacheDatabase(factory)
      try {
        const transaction = database.transaction(PUBLIC_CAMPUS_CACHE_OBJECT_STORE, 'readonly')
        const value = await requestResult(
          transaction.objectStore(PUBLIC_CAMPUS_CACHE_OBJECT_STORE).get(campusId),
        )
        const valid = validateCachedCampus(value, campusId)
        return valid ? cloneCachedCampus(valid) : null
      } finally {
        database.close()
      }
    },
    async put(record) {
      const valid = validateCachedCampus(record, record.campusId)
      if (!valid) throw new Error('Refusing to persist an invalid public campus cache record')
      const database = await openPublicCampusCacheDatabase(factory)
      try {
        const transaction = database.transaction(PUBLIC_CAMPUS_CACHE_OBJECT_STORE, 'readwrite')
        await requestResult(
          transaction.objectStore(PUBLIC_CAMPUS_CACHE_OBJECT_STORE).put(cloneCachedCampus(valid)),
        )
      } finally {
        database.close()
      }
    },
    async delete(campusId) {
      const database = await openPublicCampusCacheDatabase(factory)
      try {
        const transaction = database.transaction(PUBLIC_CAMPUS_CACHE_OBJECT_STORE, 'readwrite')
        await requestResult(transaction.objectStore(PUBLIC_CAMPUS_CACHE_OBJECT_STORE).delete(campusId))
      } finally {
        database.close()
      }
    },
  }
}

export const indexedDbCampusCacheRepository = createIndexedDbCampusCacheRepository()

export function createMemoryCampusCacheRepository(): CampusCacheRepository {
  const records = new Map<string, CachedCampus>()

  return {
    async get(campusId) {
      const value = records.get(campusId)
      const valid = value ? validateCachedCampus(value, campusId) : null
      return valid ? cloneCachedCampus(valid) : null
    },
    async put(record) {
      const valid = validateCachedCampus(record, record.campusId)
      if (!valid) throw new Error('Refusing to persist an invalid public campus cache record')
      records.set(record.campusId, cloneCachedCampus(valid))
    },
    async delete(campusId) {
      records.delete(campusId)
    },
  }
}
