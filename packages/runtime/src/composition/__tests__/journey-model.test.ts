import { describe, it, expect } from 'vitest'
import type { LatLng } from '@navi/core'
import {
  Journey,
  JourneyStatus,
  JourneyStep,
  LocateStep,
  SearchStep,
  NavigateStep,
  ArrivalStep,
  PanoramaStep,
  SelectDestinationStep,
  SelectEntranceStep,
  ConfirmStep,
  ConfirmOption,
} from '../journey-model'

const POS: LatLng = { lat: 14.0, lng: 121.0 }
const FAKE_NODE = {
  id: 'n1',
  label: 'Node',
  type: 'waypoint' as const,
  position: POS,
  floor: 0,
  buildingId: 'b1',
  properties: {},
}
const FAKE_LOCATION = {
  position: POS,
  node: { node: FAKE_NODE, distance: 5 },
  isIndoor: true,
}
const FAKE_SEARCH_RESULT = {
  id: 'sr-1',
  title: 'Room 101',
  category: 'room' as const,
  nodeId: 'n1',
  score: 1,
  buildingId: 'b1',
  floor: 0,
}
const FAKE_ROUTE = {
  path: [],
  instructions: [],
  totalDistance: 100,
  totalDuration: 60,
  fromLabel: 'Start',
  toLabel: 'End',
  travelTime: { seconds: 60, minutes: 1, formatted: '1 min' },
}
const FAKE_BUILDING = {
  id: 'b1',
  name: 'Building',
  code: 'B',
  category: 'academic' as const,
  position: POS,
  entrances: ['e1'],
  floors: ['Ground'],
}
const FAKE_ENTRANCE = {
  id: 'e1',
  name: 'Main Entrance',
  position: POS,
}
const FAKE_PANORAMA = {
  id: 'pano-1',
  imageAssetId: 'img-1',
  buildingId: 'b1',
  floor: 0,
  position: POS,
}

// ── Step variant constructability ──

describe('JourneyStep variants', () => {
  it('constructs a LocateStep', () => {
    const step: LocateStep = {
      id: 's1', kind: 'locate', location: FAKE_LOCATION,
    }
    expect(step.kind).toBe('locate')
  })

  it('constructs a SearchStep', () => {
    const step: SearchStep = {
      id: 's2', kind: 'search', results: [FAKE_SEARCH_RESULT],
    }
    expect(step.kind).toBe('search')
  })

  it('constructs a NavigateStep', () => {
    const step: NavigateStep = {
      id: 's3', kind: 'navigate',
      route: FAKE_ROUTE,
      destination: FAKE_BUILDING,
      entrance: FAKE_ENTRANCE,
    }
    expect(step.kind).toBe('navigate')
  })

  it('constructs an ArrivalStep', () => {
    const step: ArrivalStep = {
      id: 's4', kind: 'arrive',
      building: FAKE_BUILDING,
      floor: 0,
    }
    expect(step.kind).toBe('arrive')
  })

  it('constructs a PanoramaStep', () => {
    const step: PanoramaStep = {
      id: 's5', kind: 'panorama',
      panorama: FAKE_PANORAMA,
    }
    expect(step.kind).toBe('panorama')
  })

  it('constructs a SelectDestinationStep', () => {
    const step: SelectDestinationStep = {
      id: 's6', kind: 'select-destination',
      query: 'Library',
      candidates: [FAKE_SEARCH_RESULT],
    }
    expect(step.kind).toBe('select-destination')
  })

  it('constructs a SelectEntranceStep', () => {
    const step: SelectEntranceStep = {
      id: 's7', kind: 'select-entrance',
      building: FAKE_BUILDING,
      entrances: [FAKE_ENTRANCE],
    }
    expect(step.kind).toBe('select-entrance')
  })

  it('constructs a ConfirmStep', () => {
    const options: ConfirmOption[] = [
      { id: 'yes', label: 'Yes' },
      { id: 'no', label: 'No' },
    ]
    const step: ConfirmStep = {
      id: 's8', kind: 'confirm',
      prompt: 'Continue?',
      options,
    }
    expect(step.kind).toBe('confirm')
  })
})

// ── Discriminated union exhaustiveness ──

describe('JourneyStep discrimination', () => {
  it('dispatches on every variant kind', () => {
    const steps: JourneyStep[] = [
      { id: 's1', kind: 'locate', location: FAKE_LOCATION },
      { id: 's2', kind: 'search', results: [FAKE_SEARCH_RESULT] },
      { id: 's3', kind: 'navigate', route: FAKE_ROUTE, destination: FAKE_BUILDING, entrance: FAKE_ENTRANCE },
      { id: 's4', kind: 'arrive', building: FAKE_BUILDING, floor: 0 },
      { id: 's5', kind: 'panorama', panorama: FAKE_PANORAMA },
      { id: 's6', kind: 'select-destination', query: 'Lib', candidates: [] },
      { id: 's7', kind: 'select-entrance', building: FAKE_BUILDING, entrances: [] },
      { id: 's8', kind: 'confirm', prompt: 'Go?', options: [] },
    ]
    const kinds = steps.map(s => s.kind)
    expect(kinds).toEqual([
      'locate', 'search', 'navigate', 'arrive', 'panorama',
      'select-destination', 'select-entrance', 'confirm',
    ])
  })
})

// ── Journey mechanics ──

function autoJourney(): Journey {
  const steps: JourneyStep[] = [
    { id: 's1', kind: 'locate', location: FAKE_LOCATION },
    { id: 's2', kind: 'search', results: [FAKE_SEARCH_RESULT] },
    { id: 's3', kind: 'navigate', route: FAKE_ROUTE, destination: FAKE_BUILDING, entrance: FAKE_ENTRANCE },
    { id: 's4', kind: 'arrive', building: FAKE_BUILDING, floor: 0 },
    { id: 's5', kind: 'panorama', panorama: FAKE_PANORAMA },
  ]
  return new Journey('j-1', { origin: POS, stops: ['Library'] }, steps)
}

function interactionJourney(): Journey {
  const steps: JourneyStep[] = [
    { id: 's1', kind: 'locate', location: FAKE_LOCATION },
    { id: 's2', kind: 'search', results: [FAKE_SEARCH_RESULT] },
    { id: 's3', kind: 'select-destination', query: 'Library', candidates: [FAKE_SEARCH_RESULT] },
    { id: 's4', kind: 'navigate', route: FAKE_ROUTE, destination: FAKE_BUILDING, entrance: FAKE_ENTRANCE },
    { id: 's5', kind: 'arrive', building: FAKE_BUILDING, floor: 0 },
    { id: 's6', kind: 'panorama', panorama: FAKE_PANORAMA },
  ]
  return new Journey('j-2', { origin: POS, stops: ['Library'] }, steps)
}

describe('Journey', () => {
  it('initial state is not-started at index 0', () => {
    const j = autoJourney()
    expect(j.status).toBe('not-started')
    expect(j.currentIndex).toBe(0)
  })

  it('current() returns first step initially', () => {
    const j = autoJourney()
    expect(j.current().kind).toBe('locate')
  })

  it('next() advances index and transitions to in-progress', () => {
    const j = autoJourney()
    const step = j.next()
    expect(step.kind).toBe('search')
    expect(j.status).toBe('in-progress')
  })

  it('previous() retreats index', () => {
    const j = autoJourney()
    j.next() // -> search
    const step = j.previous()
    expect(step.kind).toBe('locate')
    expect(j.currentIndex).toBe(0)
  })

  it('previous() at index 0 stays at 0', () => {
    const j = autoJourney()
    const step = j.previous()
    expect(step.kind).toBe('locate')
    expect(j.currentIndex).toBe(0)
  })

  it('next() does not auto-complete on last step — service controls completion', () => {
    const j = autoJourney()
    j.next() // s2
    j.next() // s3
    j.next() // s4
    const step = j.next() // s5 (last)
    expect(step.kind).toBe('panorama')
    // No auto-complete — service must call markComplete()
    expect(j.isComplete()).toBe(false)
    j.markComplete()
    expect(j.isComplete()).toBe(true)
  })

  it('isComplete() returns true after markComplete()', () => {
    const j = autoJourney()
    j.next(); j.next(); j.next(); j.next()
    j.markComplete()
    expect(j.isComplete()).toBe(true)
  })

  it('next() when complete returns last step', () => {
    const j = autoJourney()
    j.next(); j.next(); j.next(); j.next()
    j.markComplete()
    const step = j.next()
    expect(step.kind).toBe('panorama')
    expect(j.isComplete()).toBe(true)
  })

  it('previous() from complete restores in-progress', () => {
    const j = autoJourney()
    j.next(); j.next(); j.next(); j.next()
    j.markComplete()
    expect(j.status).toBe('complete')
    j.previous()
    expect(j.current().kind).toBe('arrive')
    expect(j.status).toBe('in-progress')
  })

  it('reset() restores initial state', () => {
    const j = autoJourney()
    j.next()
    j.next()
    j.reset()
    expect(j.currentIndex).toBe(0)
    expect(j.status).toBe('not-started')
    expect(j.current().kind).toBe('locate')
  })

  it('currentStepId always equals current().id', () => {
    const j = autoJourney()
    expect(j.currentStepId).toBe(j.current().id)
    j.next()
    expect(j.currentStepId).toBe(j.current().id)
  })
})

// ── Interaction steps ──

describe('Journey interaction steps', () => {
  it('reaching select-destination sets waiting-on-user', () => {
    const j = interactionJourney()
    j.next() // s1 -> s2 (search)
    j.next() // s2 -> s3 (select-destination)
    expect(j.status).toBe('waiting-on-user')
    expect(j.current().kind).toBe('select-destination')
  })

  it('respond(string) on select-destination resumes journey', () => {
    const j = interactionJourney()
    j.next() // search
    j.next() // select-destination
    expect(j.status).toBe('waiting-on-user')
    j.respond('sr-1')
    expect(j.status).toBe('in-progress')
    // respond stores input at the current step — service calls advance() to proceed
    expect(j.current().kind).toBe('select-destination')
  })

  it('respond(boolean) on confirm works', () => {
    const steps: JourneyStep[] = [
      { id: 's1', kind: 'locate', location: FAKE_LOCATION },
      { id: 's2', kind: 'confirm', prompt: 'Continue?', options: [{ id: 'y', label: 'Yes' }, { id: 'n', label: 'No' }] },
      { id: 's3', kind: 'search', results: [] },
    ]
    const j = new Journey('j-3', { origin: POS, stops: ['Test'] }, steps)
    j.next() // confirm
    expect(j.status).toBe('waiting-on-user')
    j.respond(true)
    expect(j.status).toBe('in-progress')
    expect(j.current().kind).toBe('confirm')
  })

  it('respond() with wrong type on confirm throws', () => {
    const steps: JourneyStep[] = [
      { id: 's1', kind: 'locate', location: FAKE_LOCATION },
      { id: 's2', kind: 'confirm', prompt: 'Continue?', options: [{ id: 'y', label: 'Yes' }] },
    ]
    const j = new Journey('j-4', { origin: POS, stops: ['Test'] }, steps)
    j.next()
    expect(() => j.respond(42)).toThrow('Expected a boolean')
  })

  it('respond() with empty string on select-destination throws', () => {
    const j = interactionJourney()
    j.next()
    j.next()
    expect(() => j.respond('')).toThrow('non-empty string')
  })

  it('respond() while not waiting-on-user throws', () => {
    const j = autoJourney()
    expect(() => j.respond('x')).toThrow('Cannot respond when journey is not waiting')
  })

  it('next() while waiting-on-user throws', () => {
    const j = interactionJourney()
    j.next()
    j.next()
    expect(j.status).toBe('waiting-on-user')
    expect(() => j.next()).toThrow('Cannot advance while waiting')
  })

  it('respond() can lead into another interaction step', () => {
    const steps: JourneyStep[] = [
      { id: 's1', kind: 'locate', location: FAKE_LOCATION },
      { id: 's2', kind: 'select-destination', query: 'Lib', candidates: [FAKE_SEARCH_RESULT] },
      { id: 's3', kind: 'select-entrance', building: FAKE_BUILDING, entrances: [FAKE_ENTRANCE] },
      { id: 's4', kind: 'panorama', panorama: FAKE_PANORAMA },
    ]
    const j = new Journey('j-5', { origin: POS, stops: ['Library'] }, steps)
    j.next() // select-destination
    j.respond('sr-1')
    expect(j.current().kind).toBe('select-destination')
    expect(j.status).toBe('in-progress')
    j.next() // select-entrance
    expect(j.current().kind).toBe('select-entrance')
    expect(j.status).toBe('waiting-on-user')
    j.respond('e1')
    expect(j.current().kind).toBe('select-entrance')
    expect(j.status).toBe('in-progress')
  })
})

// ── Immutability ──

describe('JourneyStep immutability', () => {
  it('step properties cannot be reassigned (compile-time readonly)', () => {
    const step: LocateStep = { id: 's1', kind: 'locate', location: FAKE_LOCATION }
    // The following line would fail at compile time:
    // (step as any).kind = 'search'
    // But at runtime, plain objects are mutable unless frozen.
    // The readonly modifier is our TypeScript contract.
    expect(step.kind).toBe('locate')
  })
})
