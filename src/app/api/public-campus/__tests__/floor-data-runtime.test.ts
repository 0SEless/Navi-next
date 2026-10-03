import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@supabase/ssr', () => ({ createServerClient: vi.fn() }))

import { createServerClient } from '@supabase/ssr'
import { GET } from '../route'
import { createPublicStore } from '@/store/public-store'
import { createMemoryCampusCacheRepository } from '@/features/public-campus/cache'
import { resolvePublicFloorPlan } from '@/lib/public-floor-plan'
import { buildFromCampusBundle } from '@/components/map/NavigationRenderModel'

const footprint = [
  { lat: 11, lng: 122 }, { lat: 11, lng: 122.001 }, { lat: 11.001, lng: 122.001 },
]
const snapshotFloors = [0, 1, 2].map(level => ({
  id: `floor-${level}`, level,
  planImageId: `snapshot-${level}`,
  planAlignment: { offset: { x: level, y: 0 }, scale: 1, rotation: 0, opacity: 0.5 },
  walls: [{ id: `wall-${level}` }],
  rooms: [{ id: `room-${level}` }],
  doors: [{ id: `door-${level}` }],
  hallways: [{ id: `hall-${level}` }],
}))

function configureSource(published: unknown | null, snapshot: unknown) {
  const reads: string[] = []
  ;(createServerClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    from: (table: string) => {
      reads.push(table)
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({
        data: table === 'published_maps' ? published && { artifacts: published } : { data: snapshot },
        error: null,
      }) }) }) }
    },
  })
  vi.stubGlobal('fetch', vi.fn(async (url: string) => GET(new NextRequest(`http://localhost${url}`))))
  return reads
}

async function loadFromApi() {
  const store = createPublicStore({ cache: createMemoryCampusCacheRepository() })
  await store.getState().fetchCampusData('floor-campus')
  expect(store.getState().campusOrigin).toBe('network')
  return store.getState().campus!
}

describe('public-campus API to User/Navigate floor-data boundary', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('carries snapshot GF/1F/2F to the store and selects isolated plans and room projections', async () => {
    const components = [0, 1, 2].map(level => ({
      id: `room-${level}`, type: 'room', name: `Room ${level}`, buildingId: 'hall', floor: level,
      position: footprint[0], polygon: footprint,
    }))
    const reads = configureSource(null, {
      buildings: [{ id: 'hall', name: 'Hall', floors: [0, 1, 2], footprint, floorData: snapshotFloors }],
      nodes: [], edges: [], components, doors: [],
    })
    const bundle = await loadFromApi()
    const building = bundle.buildings[0]
    const model = buildFromCampusBundle(bundle)
    expect(reads).toEqual(['published_maps', 'graph_snapshots'])
    for (const level of [0, 1, 2]) {
      expect(resolvePublicFloorPlan(building, level)).toMatchObject({
        imageUrl: `snapshot-${level}`,
        floorData: { id: `floor-${level}`, walls: [{ id: `wall-${level}` }] },
      })
      expect(model.indoor.rooms.filter(room => room.buildingId === 'hall' && room.floor === level).map(room => room.id)).toEqual([`room-${level}`])
    }
  })

  it('uses only published plans when a published row exists, even if draft floorData exists', async () => {
    const reads = configureSource({
      graph: { campusId: 'floor-campus', nodes: [], edges: [] },
      buildingIndex: { buildings: [{
        id: 'hall', name: 'Hall', floors: [0, 1, 2], footprint,
        floorPlanUrls: { 0: 'published-0', 1: 'published-1', 2: 'published-2' },
        floorPlanVisuals: Object.fromEntries([0, 1, 2].map(level => [level, {
          imageUrl: `published-${level}`,
          alignment: { offset: { x: level, y: 0 }, scale: 1, rotation: 0, opacity: 0.5 },
        }])),
      }] },
      searchIndex: { entries: [] }, poiIndex: { points: [] },
      metadata: { campusId: 'floor-campus', revision: '7' },
    }, {
      buildings: [{ id: 'hall', name: 'Draft Hall', floorData: snapshotFloors }],
      nodes: [], edges: [],
    })
    const bundle = await loadFromApi()
    expect(reads).toEqual(['published_maps'])
    expect(bundle.buildings[0].name).toBe('Hall')
    expect(bundle.buildings[0].floorData).toBeUndefined()
    for (const level of [0, 1, 2]) {
      expect(resolvePublicFloorPlan(bundle.buildings[0], level)).toMatchObject({
        imageUrl: `published-${level}`,
        alignment: { offset: { x: level, y: 0 } },
      })
    }
  })
})
