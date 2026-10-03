import { describe, expect, it } from 'vitest'
import type { NavigationContextValue } from '@/components/map/NavigationContext'
import type { Building, CampusBundle, SearchEntry } from '@/types/nav-types'
import {
  filterExploreEntries,
  getAvailablePanoramas,
  getExploreCategories,
  getExploreFloors,
  resolveExploreBuildingColor,
  resolveExploreContext,
  resolveStableExploreDestination,
} from '../explore-contracts'

const building: Building = {
  id: 'b1',
  name: 'Library',
  campusId: 'campus-1',
  floors: [1, 3],
  floorData: [{ level: 2 }],
  footprint: [
    { lat: 11.82, lng: 122.16 },
    { lat: 11.821, lng: 122.16 },
    { lat: 11.821, lng: 122.161 },
  ],
  baseElevation: 0,
  height: 12,
  color: '#7C3AED',
}

const entries: SearchEntry[] = [
  {
    id: 'building-b1',
    label: 'Library',
    type: 'building',
    nodeId: 'building-destination-b1',
    buildingId: 'b1',
    tags: ['study'],
  },
  {
    id: 'room-b1-201',
    label: 'Room 201',
    type: 'room',
    nodeId: 'room-node-201',
    buildingId: 'b1',
    floor: 2,
    tags: ['study'],
  },
  {
    id: 'facility-b1-cafe',
    label: 'Campus Cafe',
    type: 'facility',
    nodeId: 'facility-node-cafe',
    buildingId: 'b1',
    tags: ['food'],
  },
  {
    id: 'room-b2-101',
    label: 'Room 101',
    type: 'room',
    nodeId: 'room-node-101',
    buildingId: 'b2',
    floor: 1,
  },
]

const authoredPoiEntry = {
  id: 'poi-study-area',
  label: 'Student Study Area',
  type: 'poi',
  position: { lat: 11.8205, lng: 122.1605 },
  tags: ['student', 'study', 'area'],
  category: 'study_area',
  buildingId: 'b1',
  floor: 1,
  floorId: 'f1',
  source: 'authored',
  sourceId: 'poi-study-area',
} as unknown as SearchEntry

const bundle = {
  nodes: [],
  edges: [],
  searchEntries: entries,
  buildings: [building],
  components: [],
  poi: [],
  boundingBox: null,
  panoramaIndex: {
    version: '1',
    panoramas: [
      {
        id: 'pano-library',
        title: 'Library lobby',
        imageAssetId: 'asset-library-lobby',
        buildingId: 'b1',
        floor: 1,
        position: { lat: 11.82, lng: 122.16 },
        hotspots: [],
      },
      {
        id: 'pano-no-asset',
        title: 'Not published',
        imageAssetId: '',
        buildingId: 'b1',
        position: { lat: 11.82, lng: 122.16 },
        hotspots: [],
      },
      {
        id: 'pano-other-building',
        title: 'Other building',
        imageAssetId: 'asset-other',
        buildingId: 'b2',
        position: { lat: 11.82, lng: 122.16 },
        hotspots: [],
      },
    ],
  },
} as CampusBundle

describe('Explore contracts', () => {
  it('derives only the selected building floors and never invents GF', () => {
    expect(getExploreFloors(bundle, 'b1')).toEqual([3, 2, 1])
    expect(getExploreFloors(bundle, 'missing-building')).toEqual([])
  })

  it('derives categories only from supported published search entries', () => {
    expect(getExploreCategories(bundle)).toEqual(['building', 'room', 'facility'])
    expect(filterExploreEntries(bundle, { query: 'food', category: 'all' })).toEqual([
      entries[2],
    ])
    expect(filterExploreEntries(bundle, { query: '', category: 'room', buildingId: 'b1' })).toEqual([
      entries[1],
    ])
  })

  it('discovers authored POIs by normalized category words without a route node', () => {
    const poiBundle = {
      ...bundle,
      searchEntries: [...entries, authoredPoiEntry],
    }
    expect(getExploreCategories(poiBundle)).toEqual(['building', 'room', 'facility', 'poi'])
    expect(filterExploreEntries(poiBundle, { query: 'study area', category: 'poi' })).toEqual([
      authoredPoiEntry,
    ])
    expect(authoredPoiEntry.nodeId).toBeUndefined()
  })

  it('keeps a live parent navigation context authoritative over Explore selection', () => {
    const parentContext: NavigationContextValue = {
      location: { lat: 11.821, lng: 122.161 },
      buildingId: 'route-building',
      floor: 3,
      navigationSegment: 'indoor',
      route: {
        path: ['outside', 'route-node'],
        steps: [],
        instructions: [],
        totalDistance: 1,
        totalDuration: 1,
        fromLabel: 'Outside',
        toLabel: 'Library',
        arrival: {
          nodeId: 'route-node',
          label: 'Library',
          position: { lat: 11.821, lng: 122.161 },
          remainingDistance: 0,
        },
        nodeFloors: [3],
      },
      currentNodeId: 'route-node',
    }

    expect(resolveExploreContext({
      parentContext,
      selectedBuildingId: 'selected-building',
      indoorContext: { active: true, buildingId: 'selected-building', floorId: 1 },
      activeFloor: 1,
    })).toMatchObject({
      surface: 'active-navigation',
      buildingId: 'route-building',
      floor: 3,
    })
  })

  it('resolves Explore building colors as presentation values without mutation', () => {
    const before = structuredClone(building)
    expect(resolveExploreBuildingColor(building, 'department')).toBe('#7C3AED')
    expect(resolveExploreBuildingColor(building, 'navi')).toBe('#0F6B3A')
    expect(resolveExploreBuildingColor(building, 'uniform')).toBe('#CBD5E1')
    expect(building).toEqual(before)
  })

  it('uses only stable indexed destinations and never falls back to an arbitrary node', () => {
    expect(resolveStableExploreDestination(bundle, { buildingId: 'b1' })).toEqual({
      id: 'building-b1',
      nodeId: 'building-destination-b1',
      type: 'building',
    })
    expect(resolveStableExploreDestination(bundle, { buildingId: 'missing-building' })).toBeNull()
    expect(resolveStableExploreDestination({ ...bundle, searchEntries: [] }, { buildingId: 'b1' })).toBeNull()
  })

  it('exposes only real panoramas with a published asset for the selected building', () => {
    expect(getAvailablePanoramas(bundle, 'b1').map(panorama => panorama.id)).toEqual(['pano-library'])
    expect(getAvailablePanoramas({ ...bundle, panoramaIndex: undefined }, 'b1')).toEqual([])
    // T2: the publish route stores an explicit `null` (route.ts `?? null`)
    // and public-store passes it through its type-only cast — consumers
    // must be null-safe, not just undefined-safe.
    expect(getAvailablePanoramas({ ...bundle, panoramaIndex: null as unknown as undefined }, 'b1')).toEqual([])
  })
})
