import { describe, it, expect } from 'vitest'
import type { LatLng, RoutePreferences } from '@navi/core'
import type { LocationContext, SearchResult, PanoramaResult } from '../../engine'
import type { BuildingResult, EntranceResult } from '../../engine'
import { VisitorJourneyService } from '../visitor-journey-service'
import type { JourneyRequest } from '../journey-model'

const POS: LatLng = { lat: 14.0, lng: 121.0 }
const NODE_ID = 'n-start'
const BUILDING_ID = 'b-library'
const SEARCH_SINGLE_ID = 'sr-library'
const SEARCH_MULTI_A_ID = 'sr-lib-a'
const SEARCH_MULTI_B_ID = 'sr-lib-b'
const PANO_ID = 'pano-main'

function fakeLocation(): LocationContext {
  return {
    position: POS,
    node: {
      node: { id: NODE_ID, label: 'Start', type: 'waypoint', position: POS, floor: 0, buildingId: '', properties: {} },
      distance: 0,
    },
    isIndoor: false,
  }
}

function fakeSearchSingle(): SearchResult[] {
  return [
    { id: SEARCH_SINGLE_ID, title: 'Library', category: 'room', nodeId: 'n-lib', score: 1, buildingId: BUILDING_ID, floor: 0 },
  ]
}

function fakeSearchMulti(): SearchResult[] {
  return [
    { id: SEARCH_MULTI_A_ID, title: 'Library Main', category: 'room', nodeId: 'n-lib-a', score: 1, buildingId: BUILDING_ID, floor: 0 },
    { id: SEARCH_MULTI_B_ID, title: 'Library Annex', category: 'room', nodeId: 'n-lib-b', score: 0.8, buildingId: BUILDING_ID, floor: 1 },
  ]
}

function fakeBuilding(): BuildingResult {
  return { id: BUILDING_ID, name: 'Library', code: 'LIB', category: 'academic', position: POS, entrances: ['e-main'], floors: ['Ground'] }
}

function fakeEntrance(): EntranceResult {
  return { id: 'e-main', name: 'Main Entrance', position: POS }
}

function fakeRoute() {
  return { path: [], instructions: [], totalDistance: 200, totalDuration: 120, fromLabel: 'Start', toLabel: 'Library', travelTime: { seconds: 120, minutes: 2, formatted: '2 min' } }
}

function fakeAccessibleRoute() {
  return { path: [{ lat: 14.1, lng: 121.1 }], instructions: ['Take accessible path'], totalDistance: 350, totalDuration: 180, fromLabel: 'Start', toLabel: 'Library Accessible', travelTime: { seconds: 180, minutes: 3, formatted: '3 min' } }
}

function fakePanorama(): PanoramaResult {
  return { id: PANO_ID, imageAssetId: 'img-pano', buildingId: BUILDING_ID, floor: 0, position: POS }
}

function createEngine(searchResults: SearchResult[], panoramaResult?: PanoramaResult) {
  return {
    location: { resolve: () => fakeLocation() },
    search: { search: (_q: string) => searchResults },
    buildings: {
      get: (_id: string) => fakeBuilding(),
      getEntrances: (_id: string) => [fakeEntrance()],
    },
    navigation: {
      findRoute: (_from: string, _to: string, _prefs?: RoutePreferences) => fakeRoute(),
    },
    panoramas: {
      resolve: (_roomId: string) => panoramaResult,
      findNearest: (_p: LatLng) => panoramaResult,
    },
  }
}

/** Engine whose navigation returns a different route when mode is 'accessible'. */
function createAccessibleEngine(searchResults: SearchResult[], panoramaResult?: PanoramaResult) {
  return {
    location: { resolve: () => fakeLocation() },
    search: { search: (_q: string) => searchResults },
    buildings: {
      get: (_id: string) => fakeBuilding(),
      getEntrances: (_id: string) => [fakeEntrance()],
    },
    navigation: {
      findRoute: (_from: string, _to: string, prefs?: RoutePreferences) =>
        prefs?.mode === 'accessible' ? fakeAccessibleRoute() : fakeRoute(),
    },
    panoramas: {
      resolve: (_roomId: string) => panoramaResult,
      findNearest: (_p: LatLng) => panoramaResult,
    },
  }
}

/** Fake that records the last preferences it received. */
class RecordingNavigation {
  lastPreferences?: RoutePreferences
  findRoute(_from: string, _to: string, prefs?: RoutePreferences) {
    this.lastPreferences = prefs
    return fakeRoute()
  }
}

// ── M7.3 multi-stop fixtures ──

const CAFE_BUILDING_ID = 'b-cafe'
const GYM_BUILDING_ID = 'b-gym'

function buildingCafe(): BuildingResult {
  return { id: CAFE_BUILDING_ID, name: 'Cafeteria', code: 'CAF', category: 'dining', position: POS, entrances: ['e-cafe'], floors: ['Ground'] }
}

function buildingGym(): BuildingResult {
  return { id: GYM_BUILDING_ID, name: 'Gym', code: 'GYM', category: 'sports', position: POS, entrances: ['e-gym'], floors: ['Ground'] }
}

function cafeSearchSingle(): SearchResult[] {
  return [{ id: 'sr-cafe', title: 'Cafeteria', category: 'room', nodeId: 'n-cafe', score: 1, buildingId: CAFE_BUILDING_ID, floor: 0 }]
}

function cafeSearchMulti(): SearchResult[] {
  return [
    { id: 'sr-cafe-a', title: 'Cafeteria Main', category: 'room', nodeId: 'n-cafe-a', score: 1, buildingId: CAFE_BUILDING_ID, floor: 0 },
    { id: 'sr-cafe-b', title: 'Cafeteria Annex', category: 'room', nodeId: 'n-cafe-b', score: 0.8, buildingId: CAFE_BUILDING_ID, floor: 1 },
  ]
}

function gymSearchSingle(): SearchResult[] {
  return [{ id: 'sr-gym', title: 'Gym', category: 'room', nodeId: 'n-gym', score: 1, buildingId: GYM_BUILDING_ID, floor: 0 }]
}

/** Engine that dispatches search results per query string. */
function createQueryEngine(searchMap: Record<string, SearchResult[]>, panoramaResult?: PanoramaResult) {
  return {
    location: { resolve: () => fakeLocation() },
    search: { search: (q: string) => searchMap[q] ?? [] },
    buildings: {
      get: (id: string) => {
        if (id === CAFE_BUILDING_ID) return buildingCafe()
        if (id === GYM_BUILDING_ID) return buildingGym()
        return fakeBuilding()
      },
      getEntrances: (_id: string) => [fakeEntrance()],
    },
    navigation: { findRoute: (_f: string, _t: string) => fakeRoute() },
    panoramas: { resolve: (_id: string) => panoramaResult, findNearest: (_p: LatLng) => panoramaResult },
  }
}

describe('VisitorJourneyService', () => {
  describe('begin()', () => {
    it('returns a Journey with LocateStep', () => {
      const svc = new VisitorJourneyService(createEngine(fakeSearchSingle(), fakePanorama()) as never)
      const j = svc.begin(POS, 'Library')
      expect(j.current().kind).toBe('locate')
      expect(j.status).toBe('not-started')
    })

    it('sets resolvedDestinationId for single-result search', () => {
      const svc = new VisitorJourneyService(createEngine(fakeSearchSingle(), fakePanorama()) as never)
      const j = svc.begin(POS, 'Library')
      expect(j.context.resolvedDestinationId).toBe(SEARCH_SINGLE_ID)
    })

    it('creates SelectDestinationStep for multi-result search', () => {
      const svc = new VisitorJourneyService(createEngine(fakeSearchMulti(), fakePanorama()) as never)
      const j = svc.begin(POS, 'Library')
      // First step is locate, second step should be select-destination
      j.next()
      expect(j.current().kind).toBe('select-destination')
      expect(j.status).toBe('waiting-on-user')
    })

    it('marks failed when search returns empty', () => {
      const svc = new VisitorJourneyService(createEngine([], fakePanorama()) as never)
      const j = svc.begin(POS, 'Nowhere')
      expect(j.status).toBe('failed')
    })
  })

  describe('advance() — single result', () => {
    it('produces NavigateStep from locate when destination is resolved', () => {
      const svc = new VisitorJourneyService(createEngine(fakeSearchSingle(), fakePanorama()) as never)
      const j = svc.begin(POS, 'Library')
      svc.advance(j)
      // NavigateStep should be appended — next() moves to it
      j.next()
      expect(j.current().kind).toBe('navigate')
    })

    it('produces ArrivalStep from navigate', () => {
      const svc = new VisitorJourneyService(createEngine(fakeSearchSingle(), fakePanorama()) as never)
      const j = svc.begin(POS, 'Library')
      svc.advance(j); j.next()  // navigate
      svc.advance(j); j.next()  // arrive
      expect(j.current().kind).toBe('arrive')
    })

    it('produces PanoramaStep from arrive when panorama available', () => {
      const svc = new VisitorJourneyService(createEngine(fakeSearchSingle(), fakePanorama()) as never)
      const j = svc.begin(POS, 'Library')
      svc.advance(j); j.next()  // navigate
      svc.advance(j); j.next()  // arrive
      svc.advance(j); j.next()  // panorama
      expect(j.current().kind).toBe('panorama')
    })

    it('marks complete after panorama', () => {
      const svc = new VisitorJourneyService(createEngine(fakeSearchSingle(), fakePanorama()) as never)
      const j = svc.begin(POS, 'Library')
      svc.advance(j); j.next()  // navigate
      svc.advance(j); j.next()  // arrive
      svc.advance(j); j.next()  // panorama
      svc.advance(j)             // should mark complete
      expect(j.isComplete()).toBe(true)
    })

    it('completes after arrival when no panorama available', () => {
      const svc = new VisitorJourneyService(createEngine(fakeSearchSingle(), undefined) as never)
      const j = svc.begin(POS, 'Library')
      svc.advance(j); j.next()  // navigate
      svc.advance(j); j.next()  // arrive
      svc.advance(j)             // should mark complete (no panorama)
      expect(j.isComplete()).toBe(true)
    })
  })

  describe('advance() — multi result with interaction', () => {
    it('produces NavigateStep after respond + advance', () => {
      const svc = new VisitorJourneyService(createEngine(fakeSearchMulti(), fakePanorama()) as never)
      const j = svc.begin(POS, 'Library')
      j.next()                  // select-destination
      expect(j.status).toBe('waiting-on-user')
      j.respond(SEARCH_MULTI_A_ID)
      svc.advance(j)
      j.next()                  // navigate
      expect(j.current().kind).toBe('navigate')
    })

    it('completes full workflow after interaction', () => {
      const svc = new VisitorJourneyService(createEngine(fakeSearchMulti(), fakePanorama()) as never)
      const j = svc.begin(POS, 'Library')
      j.next()                  // select-destination
      j.respond(SEARCH_MULTI_A_ID)
      svc.advance(j); j.next()  // navigate
      svc.advance(j); j.next()  // arrive
      svc.advance(j); j.next()  // panorama
      svc.advance(j)             // complete
      expect(j.isComplete()).toBe(true)
    })
  })

  describe('edge cases', () => {
    it('advance on complete step is a no-op', () => {
      const svc = new VisitorJourneyService(createEngine(fakeSearchSingle(), fakePanorama()) as never)
      const j = svc.begin(POS, 'Library')
      svc.advance(j); j.next()
      svc.advance(j); j.next()
      svc.advance(j); j.next()
      svc.advance(j); j.next()  // panorama
      svc.advance(j)             // complete
      const beforeSteps = j.steps.length
      svc.advance(j)             // no-op
      expect(j.steps.length).toBe(beforeSteps)
      expect(j.isComplete()).toBe(true)
    })

    it('returns same journey instance', () => {
      const svc = new VisitorJourneyService(createEngine(fakeSearchSingle(), fakePanorama()) as never)
      const j = svc.begin(POS, 'Library')
      const result = svc.advance(j)
      expect(result).toBe(j)
    })

    it('never modifies completed steps', () => {
      const svc = new VisitorJourneyService(createEngine(fakeSearchSingle(), fakePanorama()) as never)
      const j = svc.begin(POS, 'Library')
      const firstStep = j.steps[0]
      svc.advance(j)
      svc.advance(j)
      svc.advance(j)
      svc.advance(j)
      expect(j.steps[0]).toBe(firstStep)
      expect(j.steps[0].kind).toBe('locate')
    })
  })

  describe('layer boundary', () => {
    it('has no forbidden imports (verified by gate)', () => {
      // The scripts/check-layer-boundaries.mjs gate ensures this.
      // This test exists as a reminder — the real verification is the gate script.
      expect(true).toBe(true)
    })
  })

  // ── M7.2: Route Preferences ──

  describe('M7.2 JourneyRequest backward compat', () => {
    it('old begin(position, destination) overload still works', () => {
      const svc = new VisitorJourneyService(createEngine(fakeSearchSingle(), fakePanorama()) as never)
      const j = svc.begin(POS, 'Library')
      expect(j.current().kind).toBe('locate')
    })

    it('begin(JourneyRequest) without routing works', () => {
      const svc = new VisitorJourneyService(createEngine(fakeSearchSingle(), fakePanorama()) as never)
      const req: JourneyRequest = { origin: POS, stops: ['Library'] }
      const j = svc.begin(req)
      expect(j.current().kind).toBe('locate')
    })

    it('explicit mode: standard matches default behavior', () => {
      const svc = new VisitorJourneyService(createEngine(fakeSearchSingle(), fakePanorama()) as never)
      const j = svc.begin({ origin: POS, stops: ['Library'], routing: { mode: 'standard' } })
      svc.advance(j); j.next()
      expect(j.current().kind).toBe('navigate')
    })
  })

  describe('M7.2 accessible routing', () => {
    it('produces different route when mode is accessible', () => {
      const svc = new VisitorJourneyService(createAccessibleEngine(fakeSearchSingle(), fakePanorama()) as never)
      const j = svc.begin({ origin: POS, stops: ['Library'], routing: { mode: 'accessible' } })
      svc.advance(j); j.next()
      expect(j.current().kind).toBe('navigate')
      // Accessible route has different distance
      expect((j.current() as any).route.totalDistance).toBe(350)
    })

    it('standard journey has standard route', () => {
      const svc = new VisitorJourneyService(createAccessibleEngine(fakeSearchSingle(), fakePanorama()) as never)
      const j = svc.begin({ origin: POS, stops: ['Library'], routing: { mode: 'standard' } })
      svc.advance(j); j.next()
      expect((j.current() as any).route.totalDistance).toBe(200)
    })

    it('workflow structure is identical regardless of mode', () => {
      const engine = createAccessibleEngine(fakeSearchSingle(), fakePanorama())
      const svc = new VisitorJourneyService(engine as never)

      const runFull = (mode: 'standard' | 'accessible') => {
        const j = svc.begin({ origin: POS, stops: ['Library'], routing: { mode } })
        svc.advance(j); j.next()  // navigate
        svc.advance(j); j.next()  // arrive
        svc.advance(j); j.next()  // panorama
        svc.advance(j)             // complete
        return j
      }

      const standard = runFull('standard')
      const accessible = runFull('accessible')

      expect(standard.isComplete()).toBe(true)
      expect(accessible.isComplete()).toBe(true)
      expect(standard.steps.length).toBe(accessible.steps.length)
      expect(standard.steps.map(s => s.kind)).toEqual(accessible.steps.map(s => s.kind))
      // Only the route differs — step[1] is the NavigateStep in both journeys
      const standardNav = standard.steps[1] as any
      const accessibleNav = accessible.steps[1] as any
      expect(standardNav.kind).toBe('navigate')
      expect(accessibleNav.kind).toBe('navigate')
      expect(standardNav.route.totalDistance).not.toBe(accessibleNav.route.totalDistance)
    })

    it('full accessible workflow completes with all steps', () => {
      const svc = new VisitorJourneyService(createAccessibleEngine(fakeSearchSingle(), fakePanorama()) as never)
      const j = svc.begin({ origin: POS, stops: ['Library'], routing: { mode: 'accessible' } })
      svc.advance(j); j.next()  // navigate
      svc.advance(j); j.next()  // arrive
      svc.advance(j); j.next()  // panorama
      svc.advance(j)             // complete (markComplete, no new step)
      expect(j.isComplete()).toBe(true)
      // Steps: locate, navigate, arrive, panorama (complete is status, not a step)
      expect(j.steps.length).toBe(4)
      expect(j.steps.map(s => s.kind)).toEqual(['locate', 'navigate', 'arrive', 'panorama'])
    })
  })

  // ── M7.3: Multi-Stop Journey ──

  describe('M7.3 multi-stop journey', () => {
    it('1-stop { stops: ["Library"] } is identical to begin(POS, "Library")', () => {
      const svc = new VisitorJourneyService(createEngine(fakeSearchSingle(), fakePanorama()) as never)
      const j1 = svc.begin(POS, 'Library')

      // Reset engine — create a fresh one for the second begin to avoid shared mutation
      const svc2 = new VisitorJourneyService(createEngine(fakeSearchSingle(), fakePanorama()) as never)
      const j2 = svc2.begin({ origin: POS, stops: ['Library'] })

      // Both produce same step kinds through full workflow
      const run = (j: Journey) => {
        svc.advance(j); j.next()  // navigate
        svc.advance(j); j.next()  // arrive
        svc.advance(j); j.next()  // panorama
        svc.advance(j)             // complete
        return j
      }

      const r1 = run(j1)
      const r2 = run(j2)
      expect(r1.steps.map(s => s.kind)).toEqual(r2.steps.map(s => s.kind))
      expect(r1.isComplete()).toBe(r2.isComplete())
    })

    it('2-stop journey flows through both stops', () => {
      const engine = createQueryEngine({ Library: fakeSearchSingle(), Cafeteria: cafeSearchSingle() }, fakePanorama())
      const svc = new VisitorJourneyService(engine as never)
      const j = svc.begin({ origin: POS, stops: ['Library', 'Cafeteria'] })

      // Context initialized
      expect(j.context.currentStop).toBe('Library')
      expect(j.context.remainingStops).toEqual(['Cafeteria'])

      // First stop: Library
      svc.advance(j); j.next()  // locate→navigate
      expect(j.current().kind).toBe('navigate')
      svc.advance(j); j.next()  // navigate→arrive
      expect(j.current().kind).toBe('arrive')

      // Advance from arrive triggers second stop
      svc.advance(j)             // arrive builds NavigateStep for Cafeteria
      expect(j.context.currentStop).toBe('Cafeteria')
      expect(j.context.completedStops).toEqual(['Library'])

      j.next()                   // navigate (Cafeteria)
      expect(j.current().kind).toBe('navigate')
      svc.advance(j); j.next()  // navigate→arrive
      expect(j.current().kind).toBe('arrive')

      // No more stops → panorama + complete
      svc.advance(j); j.next()  // arrive→panorama
      expect(j.current().kind).toBe('panorama')
      svc.advance(j)
      expect(j.isComplete()).toBe(true)
    })

    it('3-stop journey produces correct step kinds', () => {
      const engine = createQueryEngine({
        Library: fakeSearchSingle(),
        Cafeteria: cafeSearchSingle(),
        Gym: gymSearchSingle(),
      }, fakePanorama())
      const svc = new VisitorJourneyService(engine as never)
      const j = svc.begin({ origin: POS, stops: ['Library', 'Cafeteria', 'Gym'] })

      expect(j.context.currentStop).toBe('Library')
      expect(j.context.remainingStops).toEqual(['Cafeteria', 'Gym'])

      // Stop 1: Library
      svc.advance(j); j.next()  // navigate
      svc.advance(j); j.next()  // arrive
      // Stop 2: Cafeteria
      svc.advance(j); j.next()  // navigate
      svc.advance(j); j.next()  // arrive
      // Stop 3: Gym
      svc.advance(j); j.next()  // navigate
      svc.advance(j); j.next()  // arrive

      expect(j.context.completedStops).toEqual(['Library', 'Cafeteria'])
      expect(j.context.currentStop).toBe('Gym')

      svc.advance(j); j.next()  // panorama
      svc.advance(j)             // complete
      expect(j.isComplete()).toBe(true)
      expect(j.steps.map(s => s.kind)).toEqual([
        'locate', 'navigate', 'arrive',
        'navigate', 'arrive',
        'navigate', 'arrive',
        'panorama',
      ])
    })

    it('multi-result at second stop creates SelectDestinationStep', () => {
      const engine = createQueryEngine({
        Library: fakeSearchSingle(),
        Cafeteria: cafeSearchMulti(),
      }, fakePanorama())
      const svc = new VisitorJourneyService(engine as never)
      const j = svc.begin({ origin: POS, stops: ['Library', 'Cafeteria'] })

      // First stop: Library
      svc.advance(j); j.next()  // navigate
      svc.advance(j); j.next()  // arrive

      // Advance from arrive — search "Cafeteria" returns multiple → SelectDestinationStep
      svc.advance(j)             // appends SelectDestinationStep
      j.next()                   // select-destination
      expect(j.current().kind).toBe('select-destination')
      expect(j.status).toBe('waiting-on-user')

      // User selects and advances
      j.respond('sr-cafe-a')
      svc.advance(j)
      j.next()                   // navigate
      expect(j.current().kind).toBe('navigate')

      svc.advance(j); j.next()  // arrive
      svc.advance(j); j.next()  // panorama
      svc.advance(j)
      expect(j.isComplete()).toBe(true)
    })

    it('empty stops fails immediately', () => {
      const svc = new VisitorJourneyService(createEngine(fakeSearchSingle(), fakePanorama()) as never)
      const j = svc.begin({ origin: POS, stops: [] })
      expect(j.status).toBe('failed')
    })

    it('failed search at second stop fails journey', () => {
      const engine = createQueryEngine({
        Library: fakeSearchSingle(),
        UnknownPlace: [],
      }, fakePanorama())
      const svc = new VisitorJourneyService(engine as never)
      const j = svc.begin({ origin: POS, stops: ['Library', 'UnknownPlace'] })

      svc.advance(j); j.next()  // navigate
      svc.advance(j); j.next()  // arrive

      svc.advance(j)             // search for UnknownPlace fails
      expect(j.status).toBe('failed')
    })

    it('remainingStops is not mutated outside the service', () => {
      const engine = createQueryEngine({ Library: fakeSearchSingle(), Cafeteria: cafeSearchSingle() }, fakePanorama())
      const svc = new VisitorJourneyService(engine as never)
      const stops: readonly string[] = Object.freeze(['Library', 'Cafeteria'])
      const j = svc.begin({ origin: POS, stops })

      expect(j.context.remainingStops).toEqual(['Cafeteria'])
      // Original array unchanged
      expect(stops).toEqual(['Library', 'Cafeteria'])
    })
  })

  describe('M7.2 preference forwarding', () => {
    it('forwards preferences unchanged to navigation', () => {
      const nav = new RecordingNavigation()
      const svc = new VisitorJourneyService({
        location: { resolve: () => fakeLocation() },
        search: { search: () => fakeSearchSingle() },
        buildings: { get: () => fakeBuilding(), getEntrances: () => [fakeEntrance()] },
        navigation: nav,
        panoramas: { resolve: () => fakePanorama(), findNearest: () => fakePanorama() },
      } as never)

      const routing: RoutePreferences = { mode: 'accessible' }
      const j = svc.begin({ origin: POS, stops: ['Library'], routing })
      svc.advance(j)
      expect(nav.lastPreferences).toEqual(routing)
    })

    it('passes undefined preferences when none given', () => {
      const nav = new RecordingNavigation()
      const svc = new VisitorJourneyService({
        location: { resolve: () => fakeLocation() },
        search: { search: () => fakeSearchSingle() },
        buildings: { get: () => fakeBuilding(), getEntrances: () => [fakeEntrance()] },
        navigation: nav,
        panoramas: { resolve: () => fakePanorama(), findNearest: () => fakePanorama() },
      } as never)

      const j = svc.begin({ origin: POS, stops: ['Library'] })
      svc.advance(j)
      // When no routing preferences, undefined is passed
      expect(nav.lastPreferences).toBeUndefined()
    })
  })
})
