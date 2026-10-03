import type { NavRoute, NavRouteStep, NavInstructionType } from '@/types/route-types'

export type NavigationExperiencePhase = 'setup' | 'route-preview' | 'active' | 'arrived'

export interface NavigationExperienceState {
  phase: NavigationExperiencePhase
  routeKey: string | null
  routeStepCount: number
  /** Progress derived from GPS projection; never changed by preview controls. */
  actualCurrentStep: number | null
  /** The step currently shown while the user browses a route preview. */
  previewedStep: number | null
}

export type NavigationExperienceEvent =
  | { type: 'route-available'; routeKey: string; stepCount: number }
  | { type: 'new-route'; routeKey: string | null; stepCount: number }
  | { type: 'start-navigation' }
  | { type: 'progress'; step: number }
  | { type: 'preview-step'; step: number }
  | { type: 'return-to-current' }
  | { type: 'arrived' }
  | { type: 'reset' }

export function createNavigationExperienceState(): NavigationExperienceState {
  return {
    phase: 'setup',
    routeKey: null,
    routeStepCount: 0,
    actualCurrentStep: null,
    previewedStep: null,
  }
}

function normalizeStep(step: number, stepCount: number): number | null {
  if (stepCount <= 0 || !Number.isFinite(step)) return null
  return Math.min(Math.max(Math.floor(step), 0), stepCount - 1)
}

function routeState(
  routeKey: string | null,
  stepCount: number,
): NavigationExperienceState {
  const count = Number.isFinite(stepCount) ? Math.max(Math.floor(stepCount), 0) : 0
  return {
    phase: routeKey && count > 0 ? 'route-preview' : 'setup',
    routeKey: routeKey && count > 0 ? routeKey : null,
    routeStepCount: routeKey && count > 0 ? count : 0,
    actualCurrentStep: null,
    previewedStep: null,
  }
}

export function transitionNavigationExperience(
  state: NavigationExperienceState,
  event: NavigationExperienceEvent,
): NavigationExperienceState {
  switch (event.type) {
    case 'route-available':
    case 'new-route':
      return routeState(event.routeKey, event.stepCount)

    case 'start-navigation':
      return state.phase === 'route-preview' && state.routeKey
        ? { ...state, phase: 'active' }
        : state

    case 'progress': {
      if (state.phase !== 'active') return state
      const actualCurrentStep = normalizeStep(event.step, state.routeStepCount)
      if (actualCurrentStep === null) return state
      return {
        ...state,
        actualCurrentStep,
        previewedStep: state.previewedStep ?? actualCurrentStep,
      }
    }

    case 'preview-step': {
      const previewedStep = normalizeStep(event.step, state.routeStepCount)
      return previewedStep === null ? state : { ...state, previewedStep }
    }

    case 'return-to-current':
      return { ...state, previewedStep: state.actualCurrentStep }

    case 'arrived':
      return state.phase === 'active' ? { ...state, phase: 'arrived' } : state

    case 'reset':
      return createNavigationExperienceState()
  }
}

export function getVisibleNavigationStep(
  state: NavigationExperienceState,
): number | null {
  return state.previewedStep ?? state.actualCurrentStep
}

/** Stable identity for the ordered graph route used by session reset guards. */
export function getNavigationRouteKey(route: Pick<NavRoute, 'path'> | null): string | null {
  if (!route || route.path.length === 0) return null
  return JSON.stringify(route.path)
}

export type NavigationRouteValidationReason =
  | 'missing'
  | 'invalid-shape'
  | 'invalid-position'
  | 'non-positive-distance'

export interface NavigationRouteValidation {
  valid: boolean
  reason: NavigationRouteValidationReason | null
}

/**
 * Guard the student-facing navigation session at the app boundary.
 *
 * This intentionally does not inspect or alter A* output. A zero-distance
 * route with an authored stairs/elevator floor transition remains eligible;
 * ordinary duplicate-position routes do not become active guidance.
 */
export function validateNavigationRoute(route: NavRoute | null): NavigationRouteValidation {
  if (!route) return { valid: false, reason: 'missing' }
  if (!Array.isArray(route.path) || !Array.isArray(route.steps) || route.path.length === 0) {
    return { valid: false, reason: 'invalid-shape' }
  }
  if (route.steps.length !== route.path.length || !Number.isFinite(route.totalDistance) || route.totalDistance < 0) {
    return { valid: false, reason: 'invalid-shape' }
  }

  for (const [index, step] of route.steps.entries()) {
    if (
      step.nodeId !== route.path[index]
      || !Number.isFinite(step.position?.lat)
      || !Number.isFinite(step.position?.lng)
      || !Number.isFinite(step.floor)
    ) {
      return { valid: false, reason: 'invalid-position' }
    }
  }

  // A one-node route is a useful already-at-destination state.
  if (route.steps.length === 1 || route.totalDistance > 0) {
    return { valid: true, reason: null }
  }

  const hasSemanticVerticalTransition = route.steps.some((step, index) => {
    if (index === 0 || (step.type !== 'stairs' && step.type !== 'elevator')) return false
    const previous = route.steps[index - 1]
    return step.floor !== previous.floor
  })

  return hasSemanticVerticalTransition
    ? { valid: true, reason: null }
    : { valid: false, reason: 'non-positive-distance' }
}

export type NavigationStatus = 'on-route' | 'off-route' | 'arrived'

/** Arrival has presentation precedence over deviation when both are reported. */
export function resolveNavigationStatus(input: {
  arrived: boolean
  isOffRoute: boolean
}): NavigationStatus {
  if (input.arrived) return 'arrived'
  if (input.isOffRoute) return 'off-route'
  return 'on-route'
}

export function resolveDisplayedNavigationFloor(input: {
  activeNavigation: boolean
  routeFloor?: number | null
  manuallyViewedFloor?: number | null
  fallbackFloor?: number | null
}): number | null {
  if (input.activeNavigation && input.routeFloor !== undefined && input.routeFloor !== null) {
    return input.routeFloor
  }
  return input.manuallyViewedFloor ?? input.fallbackFloor ?? null
}

/**
 * Presentation-only walking speed. This is deliberately separate from
 * `NavRoute.totalDuration` and never feeds back into A* cost or edge weights.
 */
export const NAVIGATION_PRESENTATION_WALKING_SPEED_MPS = 1.2

/** Estimate whole-minute ETA from remaining route distance for UI display. */
export function estimatePresentationEtaMinutes(distanceMeters: number): number | null {
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) return null
  if (distanceMeters === 0) return 0
  return Math.max(
    1,
    Math.round(distanceMeters / (NAVIGATION_PRESENTATION_WALKING_SPEED_MPS * 60)),
  )
}

/** Format distance at the precision appropriate for a student-facing route UI. */
export function formatNavigationDistance(distanceMeters: number): string {
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) return '—'
  if (distanceMeters < 1000) return `${Math.round(distanceMeters)} m`

  const kilometres = Math.round((distanceMeters / 1000) * 10) / 10
  return `${kilometres % 1 === 0 ? kilometres.toFixed(0) : kilometres.toFixed(1)} km`
}

export interface NavigationFloorTransition {
  /** Index of the route step where the connector reaches the new floor. */
  stepIndex: number
  connector: 'stairs' | 'elevator'
  fromFloor: number
  toFloor: number
  label: string
}

export interface NavigationRouteComposition {
  destination: NavRouteStep | null
  targetBuildingId: string | null
  /** The first entrance already present in the ordered graph route. */
  selectedEntrance: NavRouteStep | null
  entranceFloor: number | null
  destinationFloor: number | null
  /** Floors represented by building-backed route steps, in route order. */
  routeFloors: number[]
  floorTransitions: NavigationFloorTransition[]
}

/**
 * Derive route presentation context from the computed path only.
 *
 * This helper intentionally has no building metadata lookup and no fallback
 * entrance/floor selection. A missing route field remains missing in the UI.
 */
export function getNavigationRouteComposition(
  route: NavRoute | null,
): NavigationRouteComposition {
  const steps = route?.steps ?? []
  const destination = steps.at(-1) ?? null
  const selectedEntrance = steps.find(
    (step) => step.type === 'entrance' && step.buildingId !== '',
  ) ?? null
  const targetBuildingId = selectedEntrance?.buildingId
    ?? (destination?.buildingId || null)

  const routeFloors = [...new Set(
    steps
      .filter((step) => step.buildingId !== '' && Number.isFinite(step.floor))
      .map((step) => step.floor),
  )]

  const floorTransitions: NavigationFloorTransition[] = []
  for (let index = 1; index < steps.length; index += 1) {
    const step = steps[index]
    const previous = steps[index - 1]
    if (
      (step.type === 'stairs' || step.type === 'elevator')
      && step.floor !== previous.floor
    ) {
      floorTransitions.push({
        stepIndex: index,
        connector: step.type,
        fromFloor: previous.floor,
        toFloor: step.floor,
        label: step.label || step.type,
      })
    }
  }

  return {
    destination,
    targetBuildingId,
    selectedEntrance,
    entranceFloor: selectedEntrance?.floor ?? null,
    destinationFloor: destination?.buildingId ? destination.floor : null,
    routeFloors,
    floorTransitions,
  }
}

export interface NavigationInstructionView {
  type: NavInstructionType
  text: string
  distance: number
  stepIndex: number
}

/** Return an instruction only when it is present in the route contract. */
export function getNavigationInstruction(
  route: NavRoute | null,
  stepIndex: number,
): NavigationInstructionView | null {
  if (!route || !Number.isInteger(stepIndex) || stepIndex < 0) return null
  const instruction = route.instructions[stepIndex]
  if (!instruction || instruction.text.trim() === '') return null
  return {
    type: instruction.type,
    text: instruction.text,
    distance: instruction.distance,
    stepIndex,
  }
}
