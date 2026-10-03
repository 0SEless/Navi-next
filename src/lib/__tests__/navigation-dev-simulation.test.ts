import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createNavigationDevSimulation,
  isNavigationDevSimulationEnabled,
  nudgeNavigationDevSimulation,
  normalizeNavigationDevHeading,
  updateNavigationDevHeading,
} from '../navigation-dev-simulation'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('navigation development simulation contract', () => {
  it('requires the explicit flag and a non-production environment', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('NEXT_PUBLIC_NAVI_DEV_LOCATION', '1')
    expect(isNavigationDevSimulationEnabled()).toBe(true)

    vi.stubEnv('NODE_ENV', 'production')
    expect(isNavigationDevSimulationEnabled()).toBe(false)

    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('NEXT_PUBLIC_NAVI_DEV_LOCATION', '0')
    expect(isNavigationDevSimulationEnabled()).toBe(false)
  })

  it('creates the requested campus coordinate with a deterministic default heading', () => {
    expect(createNavigationDevSimulation(1234)).toEqual({
      position: { lat: 11.81830075, lng: 122.17159818 },
      heading: 0,
      speed: 1,
      timestamp: 1234,
    })
  })

  it('normalizes slider values without changing Capture smoothing contracts', () => {
    expect(normalizeNavigationDevHeading(359)).toBe(359)
    expect(normalizeNavigationDevHeading(360)).toBe(0)
    expect(normalizeNavigationDevHeading(-1)).toBe(359)
    expect(normalizeNavigationDevHeading(Number.NaN)).toBe(0)

    const state = createNavigationDevSimulation(1234)
    expect(updateNavigationDevHeading(state, 359, 2000)).toMatchObject({ heading: 359, timestamp: 2000 })
    expect(updateNavigationDevHeading(state, 361, 3000)).toMatchObject({ heading: 1, timestamp: 3000 })
  })

  it('nudges only the simulated position and preserves heading state', () => {
    const state = updateNavigationDevHeading(createNavigationDevSimulation(1234), 90, 2000)

    expect(nudgeNavigationDevSimulation(state, 'north', 3000)).toEqual({
      ...state,
      position: { lat: 11.81831075, lng: 122.17159818 },
      timestamp: 3000,
    })
    expect(nudgeNavigationDevSimulation(state, 'west', 4000)).toEqual({
      ...state,
      position: { lat: 11.81830075, lng: 122.17158818 },
      timestamp: 4000,
    })
  })
})
