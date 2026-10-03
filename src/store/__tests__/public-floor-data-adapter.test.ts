import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPublicStore } from '../public-store'
import { createMemoryCampusCacheRepository } from '@/features/public-campus/cache'

const footprint = [
  { lat: 11, lng: 122 }, { lat: 11, lng: 122.001 }, { lat: 11.001, lng: 122.001 },
]
const floorData = [0, 1, 2].map((level) => ({
  id: `floor-${level}`,
  level,
  label: `${level}F`,
  elevation: level * 4,
  planImageId: `snapshot-${level}.png`,
  planAlignment: { offset: { x: level, y: level === 0 ? 0 : -level }, scale: 1 + level, rotation: level * 9, opacity: 0.5 },
  walls: [{ id: `wall-${level}` }],
  rooms: [{ id: `room-${level}` }],
  doors: [{ id: `door-${level}` }],
  hallways: [{ id: `hall-${level}` }],
  routeNetwork: { nodes: [{ id: `route-${level}` }] },
  locked: level === 2,
}))

async function load(source: 'graph_snapshots' | 'published_maps', building: Record<string, unknown>) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({
    campusId: 'floor-campus',
    source,
    revision: source === 'published_maps' ? '7' : null,
    buildings: [building],
    nodes: [], edges: [], components: [], doors: [],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', fetchMock)
  const store = createPublicStore({ cache: createMemoryCampusCacheRepository() })
  await store.getState().fetchCampusData('floor-campus')
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(store.getState().campusOrigin).toBe('network')
  return store.getState().campus!.buildings[0]
}

describe('public floor-data adapter', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('preserves each snapshot floor and the existing building identity and geometry', async () => {
    const building = await load('graph_snapshots', {
      id: 'building-a', name: 'Hall A', code: 'HA', center: footprint[0],
      footprint, outline: footprint, floors: floorData.map(({ id, level, label, elevation }) => ({ id, level, label, elevation })),
      floorData,
    })
    expect(building).toMatchObject({ id: 'building-a', name: 'Hall A', code: 'HA', campusId: 'floor-campus', floors: [0, 1, 2], footprint, outline: footprint })
    expect(building.floorData).toHaveLength(3)
    for (const level of [0, 1, 2]) {
      expect(building.floorData?.[level]).toMatchObject(floorData[level])
      expect(building.floorData?.[level].walls).toEqual([{ id: `wall-${level}` }])
      expect(building.floorData?.[level].routeNetwork).toEqual({ nodes: [{ id: `route-${level}` }] })
    }
    expect(building.floorData?.[0].walls).not.toBe(building.floorData?.[1].walls)
  })

  it('preserves published level-keyed URLs and visual alignments', async () => {
    const urls = { 0: 'published-0.png', 1: 'published-1.png', 2: 'published-2.png' }
    const visuals = Object.fromEntries([0, 1, 2].map(level => [level, {
      imageUrl: `visual-${level}.png`, alignment: floorData[level].planAlignment,
    }]))
    const building = await load('published_maps', {
      id: 'building-a', name: 'Hall A', floors: [0, 1, 2], footprint,
      floorPlanUrls: urls, floorPlanVisuals: visuals,
    })
    expect(building.floorPlanUrls).toEqual(urls)
    expect(building.floorPlanVisuals).toEqual(visuals)
    expect(building.floorData).toBeUndefined()
  })

  it('keeps absent optional floor fields absent and derives levels from valid floorData', async () => {
    const building = await load('graph_snapshots', {
      id: 'building-a', name: 'Hall A', footprint,
      floorData: [{ id: 'gf', level: 0, planImageId: null }, { id: 'second', level: 2, rooms: [] }, { id: 'bad', level: '1' }],
    })
    expect(building.floors).toEqual([0, 2])
    expect(building.floorData).toEqual([{ id: 'gf', level: 0, planImageId: null }, { id: 'second', level: 2, rooms: [] }])
  })

  it('replaces a same-revision published cache entry made by the old lossy adapter', async () => {
    const cache = createMemoryCampusCacheRepository()
    await cache.put({
      campusId: 'floor-campus', cacheSchemaVersion: 1, revision: '7',
      downloadedAt: Date.now(), source: 'published',
      payload: {
        nodes: [], edges: [], searchEntries: [], poi: [], boundingBox: null,
        buildings: [{ id: 'building-a', name: 'Hall A', campusId: 'floor-campus', floors: [0, 1, 2], footprint, baseElevation: 0, height: 12 }],
      },
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      campusId: 'floor-campus', source: 'published_maps', revision: '7',
      nodes: [], edges: [],
      buildings: [{ id: 'building-a', name: 'Hall A', floors: [0, 1, 2], footprint, floorPlanUrls: { 0: 'published-gf', 1: 'published-1f', 2: 'published-2f' } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
    const store = createPublicStore({ cache })

    await store.getState().fetchCampusData('floor-campus')

    expect(store.getState().campusOrigin).toBe('network')
    expect(store.getState().campusRevision).toBe('7')
    expect(store.getState().campus?.buildings[0].floorPlanUrls).toEqual({ 0: 'published-gf', 1: 'published-1f', 2: 'published-2f' })
  })

  it.each(['missing building', 'missing footprint'])('replaces an incomplete same-revision campus cache: %s', async (loss) => {
    const cache = createMemoryCampusCacheRepository()
    const first = { id: 'building-a', name: 'Hall A', campusId: 'floor-campus', floors: [0], footprint, baseElevation: 0, height: 3, floorPlanUrls: { 0: 'published-gf' } }
    const second = { ...first, id: 'building-b', name: 'Hall B' }
    await cache.put({
      campusId: 'floor-campus', cacheSchemaVersion: 1, revision: '7', downloadedAt: Date.now(), source: 'published',
      payload: { nodes: [], edges: [], searchEntries: [], poi: [], boundingBox: null,
        buildings: loss === 'missing building' ? [first] : [first, { ...second, footprint: undefined }],
      },
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      campusId: 'floor-campus', source: 'published_maps', revision: '7', nodes: [], edges: [], buildings: [first, second],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
    const store = createPublicStore({ cache })
    await store.getState().fetchCampusData('floor-campus')
    expect(store.getState().campusOrigin).toBe('network')
    expect(store.getState().campus?.buildings.map((building) => building.id)).toEqual(['building-a', 'building-b'])
    expect(store.getState().campus?.buildings[1].footprint).toEqual(footprint)
    expect(store.getState().campus?.buildings[0].floorPlanUrls).toEqual({ 0: 'published-gf' })
  })

  it('retains the hydrated cache when the same-revision complete network projection is equal', async () => {
    const cache = createMemoryCampusCacheRepository()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      campusId: 'floor-campus', source: 'published_maps', revision: '7', nodes: [], edges: [],
      buildings: [{ id: 'building-a', name: 'Hall A', floors: [0, 1, 2], footprint, floorData }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
    const firstStore = createPublicStore({ cache })
    await firstStore.getState().fetchCampusData('floor-campus')
    const reloadedStore = createPublicStore({ cache })
    await reloadedStore.getState().fetchCampusData('floor-campus')
    expect(reloadedStore.getState().campusOrigin).toBe('cache')
    expect(reloadedStore.getState().campus?.buildings[0].floorData).toEqual(floorData)
    expect(reloadedStore.getState().refreshError).toBeNull()
  })
})
