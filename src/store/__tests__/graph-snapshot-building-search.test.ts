import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemoryCampusCacheRepository } from '@/features/public-campus/cache'
import { createPublicStore } from '../public-store'

const campusId = 'map-map-1-repe'
const footprint = [
  { lat: 11.818, lng: 122.169 },
  { lat: 11.8181, lng: 122.169 },
  { lat: 11.8181, lng: 122.1691 },
  { lat: 11.818, lng: 122.1691 },
  { lat: 11.818, lng: 122.169 },
]

const snapshot = {
  campusId,
  source: 'graph_snapshots',
  buildings: [
    {
      id: 'building-library',
      name: 'Central Library',
      center: { lat: 11.818, lng: 122.169 },
      floors: [0],
      footprint,
    },
    {
      id: 'building-arts',
      name: 'Arts Hall',
      center: { lat: 11.819, lng: 122.17 },
      floors: [0],
      footprint,
    },
  ],
  components: [],
  nodes: [
    {
      id: 'N-LIBRARY-ENTRANCE',
      name: 'Library Entrance',
      label: 'Library Entrance',
      type: 'building_entrance',
      buildingId: 'building-library',
      floor: 0,
      campusId,
      position: { lat: 11.818, lng: 122.169 },
    },
    {
      id: 'N-ARTS-CROSSING',
      name: 'Arts crossing',
      label: 'Arts crossing',
      type: 'intersection',
      buildingId: 'building-arts',
      floor: 0,
      campusId,
      position: { lat: 11.819, lng: 122.17 },
    },
    {
      id: 'N-ROAD-CROSSING',
      name: 'Road crossing',
      label: 'Road crossing',
      type: 'intersection',
      buildingId: '',
      floor: 0,
      campusId,
      position: { lat: 11.82, lng: 122.171 },
    },
  ],
  edges: [
    { id: 'E-LIBRARY-ARTS', from: 'N-LIBRARY-ENTRANCE', to: 'N-ARTS-CROSSING', type: 'walk', distance: 40, campusId },
    { id: 'E-ARTS-ROAD', from: 'N-ARTS-CROSSING', to: 'N-ROAD-CROSSING', type: 'walk', distance: 35, campusId },
  ],
  pois: [],
}

async function loadSnapshot(data: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })))
  const store = createPublicStore({ cache: createMemoryCampusCacheRepository() })
  await store.getState().fetchCampusData(campusId)
  return store
}

describe('graph snapshot building navigation search', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('exposes snapshot buildings without a search index and links only explicit entrances', async () => {
    const store = await loadSnapshot(snapshot)
    const library = store.getState().search('Central Library')
    const arts = store.getState().search('Arts Hall')

    expect(library).toMatchObject([
      { id: 'building-library', label: 'Central Library', type: 'building', nodeId: 'N-LIBRARY-ENTRANCE' },
    ])
    expect(arts).toMatchObject([
      { id: 'building-arts', label: 'Arts Hall', type: 'building' },
    ])
    expect(arts[0].nodeId).toBeUndefined()
  })

  it('accepts an explicit search-index node link only when that node exists', async () => {
    const indexedSnapshot = {
      ...snapshot,
      artifacts: {
        searchIndex: [
          { id: 'building-arts', label: 'Arts Hall', type: 'building', nodeId: 'N-ROAD-CROSSING' },
          { id: 'building-library', label: 'Central Library', type: 'building', nodeId: 'missing-node' },
        ],
      },
    }
    const store = await loadSnapshot(indexedSnapshot)
    const arts = store.getState().search('Arts Hall')
    const library = store.getState().search('Central Library')

    expect(arts).toMatchObject([{ id: 'building-arts', type: 'building', nodeId: 'N-ROAD-CROSSING' }])
    expect(library).toMatchObject([{ id: 'building-library', type: 'building', nodeId: 'N-LIBRARY-ENTRANCE' }])
  })
})
