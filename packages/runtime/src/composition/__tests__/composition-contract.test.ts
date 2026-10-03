import { describe, it, expect } from 'vitest'
import type { LatLng } from '@navi/core'
import type {
  LocationContext,
  SnapResult,
  SearchResult,
  PanoramaResult,
} from '../../engine'
import { ReferenceCompositionService } from '../reference-composition-service'
import type { CompositionService } from '../composition-service'

// ── Fake RuntimeEngine — proves composition depends only on contracts ──
// The reference service must never know it's talking to fakes.

const FAKE_POSITION: LatLng = { lat: 14.0, lng: 121.0 }

const FAKE_SNAP: SnapResult = {
  node: {
    id: 'n1',
    label: 'Test Node',
    type: 'waypoint',
    position: FAKE_POSITION,
    floor: 0,
    buildingId: 'b1',
    properties: {},
  },
  distance: 5,
}

const FAKE_CONTEXT: LocationContext = {
  position: FAKE_POSITION,
  node: FAKE_SNAP,
  building: {
    id: 'b1',
    name: 'Test Building',
    code: 'TB',
    category: 'academic',
    position: FAKE_POSITION,
    entrances: ['e1'],
    floors: ['Ground'],
  },
  isIndoor: true,
}

const FAKE_SEARCH_RESULT: SearchResult = {
  id: 'sr-1',
  title: 'Room 101',
  category: 'room',
  nodeId: 'n1',
  score: 1,
  buildingId: 'b1',
  floor: 0,
}

const FAKE_PANORAMA: PanoramaResult = {
  id: 'pano-1',
  imageAssetId: 'img-1',
  buildingId: 'b1',
  floor: 0,
  position: FAKE_POSITION,
}

function fakeEngine() {
  return {
    location: {
      resolve(_position: LatLng): LocationContext {
        return FAKE_CONTEXT
      },
    },
    search: {
      search(_query: string): SearchResult[] {
        return [FAKE_SEARCH_RESULT]
      },
    },
    panoramas: {
      resolve(_roomId: string): PanoramaResult | undefined {
        return FAKE_PANORAMA
      },
      findNearest(_position: LatLng): PanoramaResult | undefined {
        return FAKE_PANORAMA
      },
    },
    // Only the capabilities used by the reference service are needed.
    // Other capabilities (navigation, buildings, data) are intentionally absent
    // to prove composition services only depend on what they import.
  }
}

describe('ReferenceCompositionService (M7.0 contract test)', () => {
  it('is a CompositionService', () => {
    const svc: CompositionService = new ReferenceCompositionService(
      fakeEngine() as never,
    )
    expect(svc).toBeDefined()
  })

  it('suggestStartingPoint returns a journey model from capability results', () => {
    const svc = new ReferenceCompositionService(fakeEngine() as never)
    const journey = svc.suggestStartingPoint(FAKE_POSITION)
    expect(journey.position).toEqual(FAKE_POSITION)
    expect(journey.location.isIndoor).toBe(true)
    expect(journey.suggestion).toBeDefined()
    expect(journey.suggestion!.title).toBe('Room 101')
    expect(journey.arrivalPanorama).toBeDefined()
    expect(journey.arrivalPanorama!.id).toBe('pano-1')
  })

  it('never accesses LoadedPackage or artifacts (proven by fake contract)', () => {
    const engine = fakeEngine() as never
    // The fake has no `data`, `navigation`, `buildings`, or `LoadedPackage`
    // properties. If the service tried to access them, TS or runtime would fail.
    const svc = new ReferenceCompositionService(engine)
    const journey = svc.suggestStartingPoint(FAKE_POSITION)
    // All data came from capability delegation — no artifact escapes
    expect(Object.keys(journey)).toEqual([
      'position',
      'location',
      'suggestion',
      'arrivalPanorama',
    ])
  })

  it('journey step navigation is synchronous and stateful', () => {
    const svc = new ReferenceCompositionService(fakeEngine() as never)
    expect(svc.current().index).toBe(0)
    const step1 = svc.next()
    expect(step1.index).toBe(1)
    const step2 = svc.next()
    expect(step2.index).toBe(2)
    // Stays at last step
    const step3 = svc.next()
    expect(step3.index).toBe(2)
    svc.reset()
    expect(svc.current().index).toBe(0)
  })

  it('returns undefined suggestion when search returns empty', () => {
    const emptySearchEngine = {
      location: { resolve: () => FAKE_CONTEXT },
      search: { search: () => [] as SearchResult[] },
      panoramas: {
        resolve: () => undefined,
        findNearest: () => FAKE_PANORAMA,
      },
    }
    const svc = new ReferenceCompositionService(emptySearchEngine as never)
    const journey = svc.suggestStartingPoint(FAKE_POSITION)
    expect(journey.suggestion).toBeUndefined()
  })
})
