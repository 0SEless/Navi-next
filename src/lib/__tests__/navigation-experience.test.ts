import { describe, expect, it } from 'vitest'
import {
  createNavigationExperienceState,
  estimatePresentationEtaMinutes,
  formatNavigationDistance,
  getNavigationInstruction,
  getNavigationRouteComposition,
  getNavigationRouteKey,
  getVisibleNavigationStep,
  resolveNavigationStatus,
  resolveDisplayedNavigationFloor,
  transitionNavigationExperience,
  validateNavigationRoute,
} from '../navigation-experience'
import type { NavRoute } from '@/types/route-types'

function makeRoute(path: string[]): NavRoute {
  const steps = path.map((nodeId, index) => ({
    nodeId,
    label: nodeId,
    position: { lat: 11.82 + index * 0.001, lng: 122.168 },
    floor: index,
    buildingId: 'building-1',
    type: 'walk' as const,
  }))
  return {
    path,
    steps,
    instructions: [],
    totalDistance: 100,
    totalDuration: 0,
    fromLabel: 'Start',
    toLabel: path[path.length - 1] ?? '',
    arrival: {
      nodeId: path[path.length - 1] ?? '',
      label: path[path.length - 1] ?? '',
      position: steps.at(-1)?.position ?? { lat: 0, lng: 0 },
      remainingDistance: 0,
    },
    nodeFloors: [...new Set(steps.map((step) => step.floor))],
  }
}

describe('navigation experience contract', () => {
  it('keeps route existence in route-preview until the user starts navigation', () => {
    const initial = createNavigationExperienceState()
    const preview = transitionNavigationExperience(initial, {
      type: 'route-available',
      routeKey: 'route-a',
      stepCount: 3,
    })

    expect(initial.phase).toBe('setup')
    expect(preview.phase).toBe('route-preview')
    expect(transitionNavigationExperience(preview, {
      type: 'progress',
      step: 1,
    }).phase).toBe('route-preview')
    expect(transitionNavigationExperience(preview, { type: 'start-navigation' }).phase).toBe('active')
  })

  it('separates authoritative progress from manual step preview and supports return-to-current', () => {
    let state = createNavigationExperienceState()
    state = transitionNavigationExperience(state, { type: 'route-available', routeKey: 'route-a', stepCount: 4 })
    state = transitionNavigationExperience(state, { type: 'start-navigation' })
    state = transitionNavigationExperience(state, { type: 'progress', step: 2 })
    state = transitionNavigationExperience(state, { type: 'preview-step', step: 0 })

    expect(state.actualCurrentStep).toBe(2)
    expect(state.previewedStep).toBe(0)
    expect(getVisibleNavigationStep(state)).toBe(0)

    const returned = transitionNavigationExperience(state, { type: 'return-to-current' })
    expect(returned.actualCurrentStep).toBe(2)
    expect(returned.previewedStep).toBe(2)
    expect(getVisibleNavigationStep(returned)).toBe(2)
  })

  it('resets arrival and both step cursors when a new route replaces an arrived route', () => {
    let state = createNavigationExperienceState()
    state = transitionNavigationExperience(state, { type: 'route-available', routeKey: 'route-a', stepCount: 2 })
    state = transitionNavigationExperience(state, { type: 'start-navigation' })
    state = transitionNavigationExperience(state, { type: 'progress', step: 1 })
    state = transitionNavigationExperience(state, { type: 'arrived' })

    const next = transitionNavigationExperience(state, {
      type: 'new-route',
      routeKey: 'route-b',
      stepCount: 5,
    })

    expect(state.phase).toBe('arrived')
    expect(next).toEqual({
      phase: 'route-preview',
      routeKey: 'route-b',
      routeStepCount: 5,
      actualCurrentStep: null,
      previewedStep: null,
    })
  })

  it('returns to setup when a new route is unavailable', () => {
    const state = transitionNavigationExperience(
      createNavigationExperienceState(),
      { type: 'new-route', routeKey: null, stepCount: 0 },
    )
    expect(state.phase).toBe('setup')
    expect(state.routeKey).toBeNull()
  })

  it('uses the route floor during active navigation but preserves manual inspection outside it', () => {
    expect(resolveDisplayedNavigationFloor({
      activeNavigation: true,
      routeFloor: 3,
      manuallyViewedFloor: 1,
    })).toBe(3)
    expect(resolveDisplayedNavigationFloor({
      activeNavigation: false,
      routeFloor: 3,
      manuallyViewedFloor: 1,
    })).toBe(1)
  })
})

describe('navigation route identity', () => {
  it('changes when the ordered graph path changes', () => {
    expect(getNavigationRouteKey(makeRoute(['a', 'b']))).not.toBe(
      getNavigationRouteKey(makeRoute(['a', 'c'])),
    )
    expect(getNavigationRouteKey(null)).toBeNull()
  })
})

describe('navigation route safety and status precedence', () => {
  it('rejects ordinary non-positive routes while allowing semantic vertical transitions', () => {
    const zeroDistance = makeRoute(['a', 'b'])
    zeroDistance.totalDistance = 0

    expect(validateNavigationRoute(zeroDistance)).toEqual({
      valid: false,
      reason: 'non-positive-distance',
    })

    const verticalTransition = makeRoute(['a', 'stairs', 'b'])
    verticalTransition.totalDistance = 0
    verticalTransition.steps[1] = {
      ...verticalTransition.steps[1],
      type: 'stairs',
      floor: 1,
    }

    expect(validateNavigationRoute(verticalTransition)).toEqual({ valid: true, reason: null })
  })

  it('treats a single-node route as an already-at-destination route', () => {
    const route = makeRoute(['a'])
    route.totalDistance = 0

    expect(validateNavigationRoute(route)).toEqual({ valid: true, reason: null })
  })

  it('makes arrival win over off-route presentation', () => {
    expect(resolveNavigationStatus({ arrived: true, isOffRoute: true })).toBe('arrived')
    expect(resolveNavigationStatus({ arrived: false, isOffRoute: true })).toBe('off-route')
    expect(resolveNavigationStatus({ arrived: false, isOffRoute: false })).toBe('on-route')
  })
})

describe('navigation presentation contracts', () => {
  it('derives a rounded presentation ETA without changing route cost or duration', () => {
    expect(estimatePresentationEtaMinutes(320)).toBe(4)
    expect(estimatePresentationEtaMinutes(0)).toBe(0)
    expect(estimatePresentationEtaMinutes(Number.NaN)).toBeNull()
  })

  it('formats route distance without fake second-level precision', () => {
    expect(formatNavigationDistance(320)).toBe('320 m')
    expect(formatNavigationDistance(1250)).toBe('1.3 km')
  })

  it('derives the graph-selected entrance, target building, and actual floor transitions', () => {
    const route = makeRoute(['outdoor', 'east-upper-entrance', 'stairs-3f', 'room-301'])
    route.steps[0] = { ...route.steps[0], floor: 0, buildingId: '', type: 'walk' }
    route.steps[1] = {
      ...route.steps[1],
      label: 'East Upper Entrance',
      floor: 3,
      buildingId: 'cs-building',
      type: 'entrance',
    }
    route.steps[2] = {
      ...route.steps[2],
      label: 'Stairs',
      floor: 3,
      buildingId: 'cs-building',
      type: 'stairs',
    }
    route.steps[3] = {
      ...route.steps[3],
      label: 'CS 301',
      floor: 3,
      buildingId: 'cs-building',
      type: 'walk',
    }
    route.nodeFloors = [3, 0]

    const composition = getNavigationRouteComposition(route)

    expect(composition.targetBuildingId).toBe('cs-building')
    expect(composition.selectedEntrance).toMatchObject({
      nodeId: 'east-upper-entrance',
      label: 'East Upper Entrance',
      floor: 3,
    })
    expect(composition.entranceFloor).toBe(3)
    expect(composition.destination).toMatchObject({ nodeId: 'room-301', label: 'CS 301', floor: 3 })
    expect(composition.floorTransitions).toEqual([])
  })

  it('reports a connector transition only when the route actually changes floors', () => {
    const route = makeRoute(['outdoor', 'entrance-1f', 'stairs-1f', 'stairs-3f', 'room-301'])
    route.steps[0] = { ...route.steps[0], floor: 0, buildingId: '', type: 'walk' }
    route.steps[1] = { ...route.steps[1], floor: 1, buildingId: 'cs-building', type: 'entrance' }
    route.steps[2] = { ...route.steps[2], floor: 1, buildingId: 'cs-building', type: 'stairs' }
    route.steps[3] = { ...route.steps[3], floor: 3, buildingId: 'cs-building', type: 'stairs' }
    route.steps[4] = { ...route.steps[4], floor: 3, buildingId: 'cs-building', type: 'walk' }

    expect(getNavigationRouteComposition(route).floorTransitions).toEqual([
      {
        stepIndex: 3,
        connector: 'stairs',
        fromFloor: 1,
        toFloor: 3,
        label: 'stairs-3f',
      },
    ])
  })

  it('uses only route-backed instruction text and does not invent turn semantics', () => {
    const route = makeRoute(['a', 'b'])
    route.instructions = [{
      type: 'walk',
      text: 'Continue along Main Road',
      distance: 85,
      fromNode: 'a',
      toNode: 'b',
    }]

    expect(getNavigationInstruction(route, 0)).toEqual({
      type: 'walk',
      text: 'Continue along Main Road',
      distance: 85,
      stepIndex: 0,
    })
    expect(getNavigationInstruction(route, 1)).toBeNull()
  })
})
