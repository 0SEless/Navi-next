import type { LatLng } from '@/types/nav-types'

export const NAVI_DEV_SIMULATION_POSITION = {
  lat: 11.81830075,
  lng: 122.17159818,
} as const satisfies LatLng

export const NAVI_DEV_SIMULATION_DEFAULT_HEADING = 0
export const NAVI_DEV_SIMULATION_SPEED_MPS = 1
export const NAVI_DEV_SIMULATION_STEP_DEGREES = 0.00001

export type NavigationDevMoveDirection = 'north' | 'south' | 'east' | 'west'

export interface NavigationDevSimulationState {
  position: LatLng
  heading: number
  speed: number
  timestamp: number
}

/** Development simulation is opt-in and can never be enabled by production. */
export function isNavigationDevSimulationEnabled(): boolean {
  return process.env.NODE_ENV !== 'production'
    && process.env.NEXT_PUBLIC_NAVI_DEV_LOCATION === '1'
}

export function normalizeNavigationDevHeading(value: number): number {
  if (!Number.isFinite(value)) return NAVI_DEV_SIMULATION_DEFAULT_HEADING
  const rounded = Math.round(value)
  return ((rounded % 360) + 360) % 360
}

export function createNavigationDevSimulation(now = Date.now()): NavigationDevSimulationState {
  return {
    position: { ...NAVI_DEV_SIMULATION_POSITION },
    heading: NAVI_DEV_SIMULATION_DEFAULT_HEADING,
    speed: NAVI_DEV_SIMULATION_SPEED_MPS,
    timestamp: now,
  }
}

export function updateNavigationDevHeading(
  state: NavigationDevSimulationState,
  heading: number,
  timestamp = Date.now(),
): NavigationDevSimulationState {
  return {
    ...state,
    heading: normalizeNavigationDevHeading(heading),
    timestamp,
  }
}

export function nudgeNavigationDevSimulation(
  state: NavigationDevSimulationState,
  direction: NavigationDevMoveDirection,
  timestamp = Date.now(),
): NavigationDevSimulationState {
  const latDelta = direction === 'north'
    ? NAVI_DEV_SIMULATION_STEP_DEGREES
    : direction === 'south'
      ? -NAVI_DEV_SIMULATION_STEP_DEGREES
      : 0
  const lngDelta = direction === 'east'
    ? NAVI_DEV_SIMULATION_STEP_DEGREES
    : direction === 'west'
      ? -NAVI_DEV_SIMULATION_STEP_DEGREES
      : 0

  return {
    ...state,
    position: {
      ...state.position,
      lat: state.position.lat + latDelta,
      lng: state.position.lng + lngDelta,
    },
    timestamp,
  }
}
