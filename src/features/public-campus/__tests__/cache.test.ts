import { describe, expect, it } from 'vitest'
import type { CampusBundle } from '@/types/nav-types'
import {
  PUBLIC_CAMPUS_CACHE_SCHEMA_VERSION,
  createMemoryCampusCacheRepository,
  validateCachedCampus,
  type CachedCampus,
} from '../cache'

const bundle = {
  nodes: [{ id: 'node-1' }],
  edges: [],
  searchEntries: [],
  buildings: [{ id: 'building-1', name: 'Main' }],
  components: [],
  doors: [],
  poi: [],
  boundingBox: null,
} as unknown as CampusBundle

const record: CachedCampus = {
  campusId: 'campus-1',
  cacheSchemaVersion: PUBLIC_CAMPUS_CACHE_SCHEMA_VERSION,
  revision: '12',
  downloadedAt: 1_756_600_000_000,
  source: 'published',
  payload: bundle,
}

describe('Public campus cache repository', () => {
  it('round-trips an isolated clone of a campus envelope', async () => {
    const repository = createMemoryCampusCacheRepository()

    await repository.put(record)
    record.payload.nodes.push({ id: 'mutated-after-write' } as never)

    const stored = await repository.get('campus-1')

    expect(stored?.payload.nodes).toHaveLength(1)
    expect(stored).not.toBe(record)
    expect(await repository.get('campus-2')).toBeNull()
  })

  it('accepts only a matching, published, version-one, usable envelope', () => {
    expect(validateCachedCampus(record, 'campus-1')).toEqual(record)

    expect(validateCachedCampus({ ...record, campusId: 'campus-2' }, 'campus-1')).toBeNull()
    expect(validateCachedCampus({ ...record, cacheSchemaVersion: 99 }, 'campus-1')).toBeNull()
    expect(validateCachedCampus({ ...record, source: 'graph_snapshot' } as never, 'campus-1')).toBeNull()
    expect(validateCachedCampus({ ...record, downloadedAt: Number.NaN }, 'campus-1')).toBeNull()
    expect(validateCachedCampus({ ...record, payload: { ...bundle, nodes: [], buildings: [] } }, 'campus-1')).toBeNull()
  })
})
