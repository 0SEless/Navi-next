import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPublicStore } from '../public-store'
import type { CampusBundle } from '@/types/nav-types'
import { createMemoryCampusCacheRepository, type CachedCampus } from '@/features/public-campus/cache'

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

function bundle(revision: string, campusId = 'phase9b-campus'): CampusBundle {
  const node1 = revision + '-node-1'
  const node2 = revision + '-node-2'
  return {
    nodes: [
      { id: node1, label: 'Node ' + revision + ' A', position: { lat: 14, lng: 121 }, floor: 0, buildingId: revision + '-building', campusId, type: 'outdoor' },
      { id: node2, label: 'Node ' + revision + ' B', position: { lat: 14.001, lng: 121.001 }, floor: 0, buildingId: revision + '-building', campusId, type: 'outdoor' },
    ],
    edges: [{ id: revision + '-edge', from: node1, to: node2, distance: 1, weight: 1, type: 'walk' }],
    searchEntries: [{ id: revision + '-search', label: 'Search ' + revision, type: 'room', nodeId: node1 }],
    buildings: [{
      id: revision + '-building',
      name: 'Building ' + revision,
      campusId,
      floors: [0],
      footprint: [],
      baseElevation: 0,
      height: 0,
    }],
    components: [{ id: revision + '-room', type: 'room' }],
    doors: [],
    poi: [{ id: revision + '-poi' }],
    boundingBox: { minLat: 14, maxLat: 14.001, minLng: 121, maxLng: 121.001 },
  }
}

function cachedCampus(revision: string, campusId = 'phase9b-campus'): CachedCampus {
  return {
    campusId,
    cacheSchemaVersion: 1,
    revision,
    downloadedAt: Date.now(),
    source: 'published',
    payload: bundle(revision, campusId),
  }
}

function networkPayload(
  revision: string,
  campusId = 'phase9b-campus',
  overrides: Record<string, unknown> = {},
) {
  const node1 = revision + '-node-1'
  const node2 = revision + '-node-2'
  return {
    campusId,
    source: 'published_maps',
    revision,
    nodes: [
      { id: node1, label: 'Node ' + revision + ' A', position: { lat: 14, lng: 121 }, floor: 0, buildingId: revision + '-building', type: 'outdoor' },
      { id: node2, label: 'Node ' + revision + ' B', position: { lat: 14.001, lng: 121.001 }, floor: 0, buildingId: revision + '-building', type: 'outdoor' },
    ],
    edges: [{ id: revision + '-edge', from: node1, to: node2, distance: 1, weight: 1, type: 'walk' }],
    buildings: [{
      id: revision + '-building',
      name: 'Building ' + revision,
      floors: [{ level: 0 }],
    }],
    components: [{ id: revision + '-room', type: 'room' }],
    doors: [],
    artifacts: {
      searchIndex: {
        entries: [{ id: revision + '-search', label: 'Search ' + revision, type: 'room', nodeId: node1 }],
      },
      poiIndex: { points: [{ id: revision + '-poi' }] },
      floorGeometry: { schemaVersion: 1, campusId, buildings: [{ id: revision + '-building' }] },
      panoramaIndex: { version: revision, entries: [{ id: revision + '-pano' }] },
      qrIndex: { schemaVersion: 1, formatVersion: 1, campusId, checkpoints: [{ id: revision + '-qr' }] },
      metadata: {
        campusId,
        revision,
        compilerVersion: 'compiler-' + revision,
        compiledAt: '2026-09-06T00:00:0' + revision + ':00.000Z',
      },
    },
    ...overrides,
  }
}

function stubFetch(handler: (url: string) => Promise<Response>) {
  const fetchMock = vi.fn((url: string) => handler(url))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('usePublicStore — Phase 9B preservation and atomicity', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('preserves a known-good published R when refresh returns an HTTP error', async () => {
    const cache = createMemoryCampusCacheRepository()
    await cache.put(cachedCampus('1'))
    const store = createPublicStore({ cache })
    stubFetch(() => jsonResponse({ error: 'unavailable' }, 503))

    await store.getState().fetchCampusData('phase9b-campus')

    expect(store.getState().campus?.nodes[0].id).toBe('1-node-1')
    expect(store.getState().campusData?.source).toBe('published_maps')
    expect(store.getState().campusRevision).toBe('1')
    expect(store.getState().campusOrigin).toBe('cache')
    expect(store.getState().refreshError).toBe('No campus data available')
  })

  it('preserves published R when the R+1 response fails normalization', async () => {
    const cache = createMemoryCampusCacheRepository()
    await cache.put(cachedCampus('1'))
    const store = createPublicStore({ cache })
    stubFetch(() => jsonResponse({
      ...networkPayload('2'),
      campusId: 'different-campus',
    }))

    await store.getState().fetchCampusData('phase9b-campus')

    expect(store.getState().campus?.nodes[0].id).toBe('1-node-1')
    expect(store.getState().campusRevision).toBe('1')
    expect(store.getState().campusOrigin).toBe('cache')
    expect(store.getState().refreshError).toBe('No campus data available')
  })

  it('replaces the complete CampusBundle atomically for a valid R+1', async () => {
    const cache = createMemoryCampusCacheRepository()
    await cache.put(cachedCampus('1'))
    const store = createPublicStore({ cache })
    const observed: Array<{
      revision: string | null
      nodeId: string | undefined
      searchId: string | undefined
      buildingId: string | undefined
      poiId: string | undefined
      floorGeometryCampusId: string | undefined
      panoramaVersion: string | undefined
      qrCampusId: string | undefined
    }> = []
    const unsubscribe = store.subscribe((state) => {
      observed.push({
        revision: state.campusRevision,
        nodeId: state.campus?.nodes[0]?.id,
        searchId: state.campus?.searchEntries[0]?.id,
        buildingId: state.campus?.buildings[0]?.id,
        poiId: (state.campus?.poi[0] as { id?: string } | undefined)?.id,
        floorGeometryCampusId: state.campus?.floorGeometry?.campusId,
        panoramaVersion: state.campus?.panoramaIndex?.version,
        qrCampusId: state.campus?.qrIndex?.campusId,
      })
    })
    stubFetch(() => jsonResponse(networkPayload('2')))

    await store.getState().fetchCampusData('phase9b-campus')
    unsubscribe()

    const state = store.getState()
    expect(state.campusRevision).toBe('2')
    expect(state.campus?.nodes[0].id).toBe('2-node-1')
    expect(state.campus?.searchEntries[0].id).toBe('2-search')
    expect(state.campus?.buildings[0].id).toBe('2-building')
    expect((state.campus?.poi[0] as { id?: string }).id).toBe('2-poi')
    expect(state.campus?.floorGeometry?.campusId).toBe('phase9b-campus')
    expect(state.campus?.panoramaIndex?.version).toBe('2')
    expect(state.campus?.qrIndex?.campusId).toBe('phase9b-campus')

    const newerRevisionSnapshots = observed.filter((entry) => entry.revision === '2')
    expect(newerRevisionSnapshots).toHaveLength(1)
    expect(newerRevisionSnapshots[0]).toMatchObject({
      nodeId: '2-node-1',
      searchId: '2-search',
      buildingId: '2-building',
      poiId: '2-poi',
      floorGeometryCampusId: 'phase9b-campus',
      panoramaVersion: '2',
      qrCampusId: 'phase9b-campus',
    })
  })

  it('keeps the stable bundle object on a same-revision refresh', async () => {
    const cache = createMemoryCampusCacheRepository()
    await cache.put(cachedCampus('1'))
    const store = createPublicStore({ cache })
    stubFetch(() => jsonResponse(networkPayload('1')))

    await store.getState().fetchCampusData('phase9b-campus')
    const stableBundle = store.getState().campus

    expect(stableBundle).not.toBeNull()
    expect(store.getState().campusRevision).toBe('1')
    expect(store.getState().campusOrigin).toBe('cache')

    await store.getState().fetchCampusData('phase9b-campus')

    expect(store.getState().campus).toBe(stableBundle)
    expect(store.getState().campusRevision).toBe('1')
    expect(store.getState().campusOrigin).toBe('cache')
    expect(store.getState().refreshError).toBeNull()
  })

  it('does not retain campus A runtime data after campus B loads', async () => {
    const store = createPublicStore({ cache: createMemoryCampusCacheRepository() })
    stubFetch((url) => url.includes('campus-a')
      ? jsonResponse(networkPayload('1', 'campus-a'))
      : jsonResponse(networkPayload('2', 'campus-b')))

    await store.getState().fetchCampusData('campus-a')
    await store.getState().fetchCampusData('campus-b')

    const state = store.getState()
    expect(state.currentCampusId).toBe('campus-b')
    expect(state.campus?.nodes[0].id).toBe('2-node-1')
    expect(state.campus?.buildings[0].id).toBe('2-building')
    expect(state.campus?.searchEntries[0].id).toBe('2-search')
    expect(state.campus?.components?.[0].id).toBe('2-room')
    expect(state.campus?.poi[0]).toEqual({ id: '2-poi' })
    expect(state.campus?.floorGeometry?.campusId).toBe('campus-b')
    expect(state.campus?.panoramaIndex?.version).toBe('2')
    expect(state.campus?.qrIndex?.campusId).toBe('campus-b')
  })
})
