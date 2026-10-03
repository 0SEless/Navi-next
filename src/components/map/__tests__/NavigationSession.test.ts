import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { createElement, useState } from 'react'
import { haversine } from '../../../engine/geo-utils'
import {
  createNavigationExperienceState,
  transitionNavigationExperience,
} from '../../../lib/navigation-experience'
import { NavigationSession } from '../NavigationSession'
import { useNavigationContext } from '../NavigationContext'
import { useGeolocation } from '../../../hooks/useGeolocation'
import type { NavRoute } from '../../../types/route-types'

vi.mock('../../../hooks/useGeolocation', () => ({
  useGeolocation: vi.fn(),
}))

// Import constants for direct testing
const ARRIVAL_THRESHOLD_M = 15
const DEVIATION_THRESHOLD_M = 30
const sessionRoute: NavRoute = {
  path: ['start', 'destination'],
  steps: [
    {
      nodeId: 'start',
      label: 'Start',
      position: { lat: 11.82, lng: 122.168 },
      floor: 0,
      buildingId: '',
      type: 'walk',
    },
    {
      nodeId: 'destination',
      label: 'Destination',
      position: { lat: 11.821, lng: 122.168 },
      floor: 1,
      buildingId: 'b1',
      type: 'walk',
    },
  ],
  instructions: [{
    type: 'arrive',
    text: 'Arrive at Destination',
    distance: 0,
    fromNode: 'start',
    toNode: 'destination',
  }],
  totalDistance: 100,
  totalDuration: 0,
  fromLabel: 'Start',
  toLabel: 'Destination',
  arrival: {
    nodeId: 'destination',
    label: 'Destination',
    position: { lat: 11.821, lng: 122.168 },
    remainingDistance: 0,
  },
  nodeFloors: [1, 0],
}

function SessionProbe() {
  const context = useNavigationContext()
  return createElement('output', {
    'data-testid': 'session-context',
    'data-active': String(context.sessionActive),
    'data-off-route': String(context.isOffRoute),
    'data-arrived': String(context.arrived),
    'data-remaining': String(context.routeProgress?.remainingDistance ?? ''),
    'data-building': context.buildingId ?? '',
    'data-floor': String(context.floor ?? ''),
    'data-segment': context.navigationSegment,
    'data-lat': String(context.location?.lat ?? ''),
    'data-lng': String(context.location?.lng ?? ''),
    'data-heading': String(context.heading ?? ''),
    'data-heading-source': context.headingSource,
    'data-heading-status': context.headingStatus,
  })
}

const floorRoute: NavRoute = {
  path: ['floor-start', 'entry-3f', 'room-301'],
  steps: [
    {
      nodeId: 'floor-start',
      label: 'Main Road',
      position: { lat: 11.82, lng: 122.168 },
      floor: 0,
      buildingId: '',
      type: 'walk',
    },
    {
      nodeId: 'entry-3f',
      label: 'East Upper Entrance',
      position: { lat: 11.821, lng: 122.168 },
      floor: 3,
      buildingId: 'b1',
      type: 'entrance',
    },
    {
      nodeId: 'room-301',
      label: 'CS 301',
      position: { lat: 11.822, lng: 122.168 },
      floor: 3,
      buildingId: 'b1',
      type: 'room',
    },
  ],
  instructions: [],
  totalDistance: 220,
  totalDuration: 0,
  fromLabel: 'Main Road',
  toLabel: 'CS 301',
  arrival: {
    nodeId: 'room-301',
    label: 'CS 301',
    position: { lat: 11.822, lng: 122.168 },
    remainingDistance: 0,
  },
  nodeFloors: [3, 0],
}

function SessionHarness({
  route,
  onArrival,
}: {
  route: NavRoute
  onArrival?: () => void
}) {
  const [activeFloor, setActiveFloor] = useState(0)
  return createElement(
    NavigationSession,
    { route, active: true, activeFloor, setActiveFloor, onArrival },
    createElement(SessionProbe),
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllEnvs()
})

describe('NavigationSession thresholds', () => {
  describe('arrival detection', () => {
    it('arrives within 15m of destination', () => {
      const dest = { lat: 11.8195, lng: 122.0922 }
      const user = { lat: 11.81955, lng: 122.09225 } // ~7m away
      const dist = haversine(user, dest)
      expect(dist).toBeLessThan(ARRIVAL_THRESHOLD_M)
    })

    it('does not arrive beyond 15m', () => {
      const dest = { lat: 11.8195, lng: 122.0922 }
      const user = { lat: 11.8210, lng: 122.0940 } // ~200m away
      const dist = haversine(user, dest)
      expect(dist).toBeGreaterThan(ARRIVAL_THRESHOLD_M)
    })
  })

  describe('deviation detection', () => {
    it('detects deviation beyond 30m from route', () => {
      const routePoint = { lat: 11.8195, lng: 122.0922 }
      const user = { lat: 11.8198, lng: 122.0925 } // ~40m away
      const dist = haversine(user, routePoint)
      expect(dist).toBeGreaterThan(DEVIATION_THRESHOLD_M)
    })

    it('does not trigger deviation within 30m', () => {
      const routePoint = { lat: 11.8195, lng: 122.0922 }
      const user = { lat: 11.81955, lng: 122.09225 } // ~7m away
      const dist = haversine(user, routePoint)
      expect(dist).toBeLessThan(DEVIATION_THRESHOLD_M)
    })
  })

})

describe('NavigationSession route replacement contract', () => {
  it('does not carry an arrived state into a replacement route', () => {
    let state = createNavigationExperienceState()
    state = transitionNavigationExperience(state, { type: 'route-available', routeKey: 'old', stepCount: 2 })
    state = transitionNavigationExperience(state, { type: 'start-navigation' })
    state = transitionNavigationExperience(state, { type: 'progress', step: 1 })
    state = transitionNavigationExperience(state, { type: 'arrived' })

    const replacement = transitionNavigationExperience(state, {
      type: 'new-route',
      routeKey: 'new',
      stepCount: 2,
    })

    expect(replacement.phase).toBe('route-preview')
    expect(replacement.actualCurrentStep).toBeNull()
    expect(replacement.previewedStep).toBeNull()
  })
})

describe('NavigationSession active boundary and projection context', () => {
  it('feeds the opt-in simulated position and heading through context while inactive', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('NEXT_PUBLIC_NAVI_DEV_LOCATION', '1')
    vi.mocked(useGeolocation).mockReturnValue({
      latitude: 10,
      longitude: 20,
      accuracy: 5,
      heading: null,
      speed: null,
      timestamp: Date.now(),
      error: null,
      loading: false,
    })

    render(createElement(
      NavigationSession,
      {
        route: sessionRoute,
        active: false,
        activeFloor: 0,
        setActiveFloor: vi.fn(),
        locationOverride: {
          position: { lat: 11.81830075, lng: 122.17159818 },
          heading: 359,
          speed: 1,
          timestamp: Date.now(),
        },
      },
      createElement(SessionProbe),
    ))

    await waitFor(() => {
      expect(screen.getByTestId('session-context')).toHaveAttribute('data-lat', '11.81830075')
      expect(screen.getByTestId('session-context')).toHaveAttribute('data-lng', '122.17159818')
      expect(screen.getByTestId('session-context')).toHaveAttribute('data-heading', '359')
      expect(screen.getByTestId('session-context')).toHaveAttribute('data-heading-source', 'gps')
      expect(screen.getByTestId('session-context')).toHaveAttribute('data-heading-status', 'gps-fallback')
    })
    expect(screen.getByTestId('session-context')).toHaveAttribute('data-active', 'false')
    expect(screen.getByTestId('session-context')).toHaveAttribute('data-remaining', '')
  })

  it('ignores a simulation override in production and keeps real geolocation data', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_NAVI_DEV_LOCATION', '1')
    vi.mocked(useGeolocation).mockReturnValue({
      latitude: 11.82,
      longitude: 122.168,
      accuracy: 5,
      heading: null,
      speed: null,
      timestamp: Date.now(),
      error: null,
      loading: false,
    })

    render(createElement(
      NavigationSession,
      {
        route: sessionRoute,
        active: false,
        activeFloor: 0,
        setActiveFloor: vi.fn(),
        locationOverride: {
          position: { lat: 11.81830075, lng: 122.17159818 },
          heading: 90,
          speed: 1,
          timestamp: Date.now(),
        },
      },
      createElement(SessionProbe),
    ))

    await waitFor(() => {
      expect(screen.getByTestId('session-context')).toHaveAttribute('data-lat', '11.82')
      expect(screen.getByTestId('session-context')).toHaveAttribute('data-lng', '122.168')
    })
    expect(screen.getByTestId('session-context')).toHaveAttribute('data-heading', '')
    expect(screen.getByTestId('session-context')).toHaveAttribute('data-heading-source', 'none')
  })

  it('does not initialize arrival or automatic floor switching before Start Navigation', async () => {
    vi.mocked(useGeolocation).mockReturnValue({
      latitude: sessionRoute.arrival.position.lat,
      longitude: sessionRoute.arrival.position.lng,
      accuracy: 5,
      error: null,
      loading: false,
    })
    const setActiveFloor = vi.fn()
    const onArrival = vi.fn()

    render(createElement(
      NavigationSession,
      {
        route: sessionRoute,
        active: false,
        activeFloor: 0,
        setActiveFloor,
        onArrival,
      },
      createElement(SessionProbe),
    ))

    await waitFor(() => {
      expect(screen.getByTestId('session-context')).toHaveAttribute('data-active', 'false')
    })
    expect(onArrival).not.toHaveBeenCalled()
    expect(setActiveFloor).not.toHaveBeenCalled()
    expect(screen.getByTestId('session-context')).toHaveAttribute('data-remaining', '')
  })

  it('exposes projected remaining distance and deviation only during active navigation', async () => {
    vi.mocked(useGeolocation).mockReturnValue({
      // Stay beside the route midpoint so the deviation assertion does not
      // also exercise the route helper's intentional "past the end" clamp.
      latitude: 11.8205,
      longitude: 122.169,
      accuracy: 5,
      error: null,
      loading: false,
    })

    render(createElement(
      NavigationSession,
      {
        route: sessionRoute,
        active: true,
        activeFloor: 0,
        setActiveFloor: vi.fn(),
      },
      createElement(SessionProbe),
    ))

    await waitFor(() => {
      expect(screen.getByTestId('session-context')).toHaveAttribute('data-active', 'true')
      expect(screen.getByTestId('session-context')).toHaveAttribute('data-arrived', 'false')
      expect(screen.getByTestId('session-context')).toHaveAttribute('data-off-route', 'true')
    })
    expect(Number(screen.getByTestId('session-context').getAttribute('data-remaining'))).toBeGreaterThanOrEqual(0)
  })

  it('exposes resolved GPS heading additively without changing projected progress', async () => {
    vi.mocked(useGeolocation).mockReturnValue({
      latitude: 11.825,
      longitude: 122.168,
      accuracy: 5,
      heading: 90,
      speed: 1,
      timestamp: Date.now(),
      error: null,
      loading: false,
    })

    render(createElement(
      NavigationSession,
      {
        route: sessionRoute,
        active: true,
        activeFloor: 0,
        setActiveFloor: vi.fn(),
      },
      createElement(SessionProbe),
    ))

    await waitFor(() => {
      expect(screen.getByTestId('session-context')).toHaveAttribute('data-heading', '90')
      expect(screen.getByTestId('session-context')).toHaveAttribute('data-heading-source', 'gps')
      expect(screen.getByTestId('session-context')).toHaveAttribute('data-heading-status', 'gps-fallback')
    })
    expect(Number(screen.getByTestId('session-context').getAttribute('data-remaining'))).toBeGreaterThanOrEqual(0)
  })

  it('switches to the route-selected entrance floor at the projected entrance', async () => {
    vi.mocked(useGeolocation).mockReturnValue({
      latitude: 11.8205,
      longitude: 122.168,
      accuracy: 5,
      error: null,
      loading: false,
    })
    const view = render(createElement(SessionHarness, { route: floorRoute }))

    await waitFor(() => {
      expect(screen.getByTestId('session-context')).toHaveAttribute('data-segment', 'outdoor')
    })
    expect(screen.getByTestId('session-context')).toHaveAttribute('data-building', '')
    expect(screen.getByTestId('session-context')).toHaveAttribute('data-floor', '0')

    vi.mocked(useGeolocation).mockReturnValue({
      latitude: floorRoute.steps[1].position.lat,
      longitude: floorRoute.steps[1].position.lng,
      accuracy: 5,
      error: null,
      loading: false,
    })
    view.rerender(createElement(SessionHarness, { route: floorRoute }))

    await waitFor(() => {
      expect(screen.getByTestId('session-context')).toHaveAttribute('data-segment', 'entrance')
      expect(screen.getByTestId('session-context')).toHaveAttribute('data-building', 'b1')
      expect(screen.getByTestId('session-context')).toHaveAttribute('data-floor', '3')
    })
  })

  it('clears arrival when the ordered route is replaced', async () => {
    vi.mocked(useGeolocation).mockReturnValue({
      latitude: floorRoute.arrival.position.lat,
      longitude: floorRoute.arrival.position.lng,
      accuracy: 5,
      error: null,
      loading: false,
    })
    const onArrival = vi.fn()
    const view = render(createElement(SessionHarness, { route: floorRoute, onArrival }))

    await waitFor(() => {
      expect(screen.getByTestId('session-context')).toHaveAttribute('data-arrived', 'true')
    })
    expect(onArrival).toHaveBeenCalledTimes(1)

    const replacementRoute: NavRoute = {
      ...floorRoute,
      path: ['replacement-start', 'replacement-destination'],
      steps: [
        { ...floorRoute.steps[0], nodeId: 'replacement-start' },
        {
          ...floorRoute.steps[2],
          nodeId: 'replacement-destination',
          position: { lat: 11.83, lng: 122.168 },
        },
      ],
      arrival: {
        ...floorRoute.arrival,
        nodeId: 'replacement-destination',
        position: { lat: 11.83, lng: 122.168 },
      },
    }
    vi.mocked(useGeolocation).mockReturnValue({
      latitude: replacementRoute.steps[0].position.lat,
      longitude: replacementRoute.steps[0].position.lng,
      accuracy: 5,
      error: null,
      loading: false,
    })
    view.rerender(createElement(SessionHarness, { route: replacementRoute, onArrival }))

    await waitFor(() => {
      expect(screen.getByTestId('session-context')).toHaveAttribute('data-arrived', 'false')
    })
    expect(onArrival).toHaveBeenCalledTimes(1)
  })
})
