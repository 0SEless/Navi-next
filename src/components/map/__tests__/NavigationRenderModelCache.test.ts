import { describe, expect, it, vi } from 'vitest'
import type { CampusBundle } from '@/types/nav-types'
import {
  buildFromCampusBundle,
  createNavigationRenderModelCache,
  getCachedNavigationRenderModel,
  type NavigationRenderModel,
} from '../NavigationRenderModel'

const bundle = {
  campusName: 'Cache Test Campus',
  nodes: [],
  edges: [],
  searchEntries: [],
  buildings: [{
    id: 'library',
    name: 'Library',
    campusId: 'cache-test',
    floors: [1, 2],
    footprint: [
      { lat: 11.82, lng: 122.168 },
      { lat: 11.821, lng: 122.168 },
      { lat: 11.821, lng: 122.169 },
    ],
    baseElevation: 0,
    height: 8,
  }],
  poi: [],
  boundingBox: { minLat: 11.82, maxLat: 11.821, minLng: 122.168, maxLng: 122.169 },
} satisfies CampusBundle

function emptyModel(): NavigationRenderModel {
  return {
    buildings: [],
    entrances: [],
    boundary: null,
    nodes: [],
    edges: [],
    indoor: {
      rooms: [],
      hallways: [],
      stairs: [],
      elevators: [],
      doors: [],
      pois: [],
      walls: [],
      openings: [],
    },
  }
}

describe('NavigationRenderModel bundle identity cache', () => {
  it('builds the model on first use of a CampusBundle', () => {
    const built = emptyModel()
    const builder = vi.fn((): NavigationRenderModel => built)
    const getModel = createNavigationRenderModelCache(builder)

    expect(getModel(bundle)).toBe(built)
    expect(builder).toHaveBeenCalledTimes(1)
    expect(builder).toHaveBeenCalledWith(bundle)
  })

  it('reuses the model after Explore unmounts and mounts again with the same CampusBundle', () => {
    const builder = vi.fn((): NavigationRenderModel => emptyModel())
    const getModel = createNavigationRenderModelCache(builder)

    const firstExploreModel = getModel(bundle)
    // The route-level ExploreMap unmounts; the module/runtime cache remains alive.
    const returnedExploreModel = getModel(bundle)

    expect(returnedExploreModel).toBe(firstExploreModel)
    expect(builder).toHaveBeenCalledTimes(1)
  })

  it('retains the app-scoped model between route-level ExploreMap mounts', () => {
    const routeBundle = { ...bundle }

    const firstExploreModel = getCachedNavigationRenderModel(routeBundle)
    // Home can mount between these calls without owning or clearing this cache.
    const returnedExploreModel = getCachedNavigationRenderModel(routeBundle)

    expect(returnedExploreModel).toBe(firstExploreModel)
  })

  it('builds a fresh model for a different CampusBundle object', () => {
    const builder = vi.fn((): NavigationRenderModel => emptyModel())
    const getModel = createNavigationRenderModelCache(builder)
    const first = getModel(bundle)
    const replacedBundle = { ...bundle }

    const replaced = getModel(replacedBundle)

    expect(replaced).not.toBe(first)
    expect(builder).toHaveBeenCalledTimes(2)
    expect(builder).toHaveBeenLastCalledWith(replacedBundle)
  })

  it('preserves the existing buildFromCampusBundle output', () => {
    const getModel = createNavigationRenderModelCache()

    expect(getModel(bundle)).toEqual(buildFromCampusBundle(bundle))
    expect(getModel(bundle).buildings).toHaveLength(1)
    expect(getModel(bundle).buildings[0]).toMatchObject({ id: 'library', name: 'Library' })
  })
})
