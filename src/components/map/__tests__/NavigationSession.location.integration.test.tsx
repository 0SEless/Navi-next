import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NavigationSession } from '../NavigationSession'
import { useNavigationContext } from '../NavigationContext'
import type { NavRoute } from '../../../types/route-types'

const enableDirection = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock('@/hooks/useNavigationHeading', () => ({
  useNavigationHeading: () => ({
    direction: {
      heading: null,
      source: 'none',
      status: 'location-only',
    },
    canRequestPermission: false,
    enableDirection,
  }),
}))

type PositionSuccess = PositionCallback
type PositionFailure = PositionErrorCallback

function position(latitude: number, longitude: number, timestamp: number): GeolocationPosition {
  return {
    timestamp,
    coords: {
      latitude,
      longitude,
      accuracy: 4,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
      toJSON: () => ({}),
    },
    toJSON: () => ({}),
  } as GeolocationPosition
}

const route: NavRoute = {
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
      floor: 0,
      buildingId: '',
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
  totalDistance: 111,
  totalDuration: 0,
  fromLabel: 'Start',
  toLabel: 'Destination',
  arrival: {
    nodeId: 'destination',
    label: 'Destination',
    position: { lat: 11.821, lng: 122.168 },
    remainingDistance: 0,
  },
  nodeFloors: [0],
}

function PositionConsumer() {
  const context = useNavigationContext()
  return (
    <output
      data-testid="position-consumer"
      data-active={String(context.sessionActive)}
      data-error={context.geoError ?? ''}
      data-lat={String(context.location?.lat ?? '')}
      data-lng={String(context.location?.lng ?? '')}
      data-remaining={String(context.routeProgress?.remainingDistance ?? '')}
    />
  )
}

function session(active: boolean, selectedRoute: NavRoute | null) {
  return (
    <NavigationSession
      route={selectedRoute}
      active={active}
      activeFloor={0}
      setActiveFloor={vi.fn()}
    >
      <PositionConsumer />
    </NavigationSession>
  )
}

let watchSuccess: PositionSuccess | undefined
let watchFailure: PositionFailure | undefined
let watchPosition: ReturnType<typeof vi.fn>
let getCurrentPosition: ReturnType<typeof vi.fn>
let clearWatch: ReturnType<typeof vi.fn>

beforeEach(() => {
  watchSuccess = undefined
  watchFailure = undefined
  watchPosition = vi.fn((success: PositionSuccess, failure: PositionFailure) => {
    watchSuccess = success
    watchFailure = failure
    return 73
  })
  getCurrentPosition = vi.fn()
  clearWatch = vi.fn()
  Object.defineProperty(navigator, 'geolocation', {
    value: { watchPosition, getCurrentPosition, clearWatch },
    configurable: true,
    writable: true,
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('NavigationSession foreground location acquisition', () => {
  it('uses one real watcher through setup, preview, active navigation, and end', async () => {
    const view = render(session(false, null))

    expect(watchPosition).toHaveBeenCalledTimes(1)
    expect(getCurrentPosition).not.toHaveBeenCalled()

    act(() => watchSuccess?.(position(11.8201, 122.1681, 1_000)))
    expect(screen.getByTestId('position-consumer')).toHaveAttribute('data-lat', '11.8201')
    expect(screen.getByTestId('position-consumer')).toHaveAttribute('data-active', 'false')
    expect(screen.getByTestId('position-consumer')).toHaveAttribute('data-remaining', '')

    view.rerender(session(false, route))
    act(() => watchSuccess?.(position(11.8202, 122.168, 1_500)))
    expect(screen.getByTestId('position-consumer')).toHaveAttribute('data-lat', '11.8202')
    expect(screen.getByTestId('position-consumer')).toHaveAttribute('data-remaining', '')
    expect(watchPosition).toHaveBeenCalledTimes(1)

    view.rerender(session(true, route))
    act(() => watchSuccess?.(position(11.8205, 122.168, 2_000)))
    await waitFor(() => {
      expect(screen.getByTestId('position-consumer')).toHaveAttribute('data-active', 'true')
      expect(Number(screen.getByTestId('position-consumer').getAttribute('data-remaining'))).toBeGreaterThan(0)
    })
    expect(watchPosition).toHaveBeenCalledTimes(1)

    view.rerender(session(false, route))
    act(() => watchSuccess?.(position(11.8207, 122.168, 2_500)))
    expect(screen.getByTestId('position-consumer')).toHaveAttribute('data-lat', '11.8207')
    expect(screen.getByTestId('position-consumer')).toHaveAttribute('data-active', 'false')
    expect(screen.getByTestId('position-consumer')).toHaveAttribute('data-remaining', '')
    expect(watchPosition).toHaveBeenCalledTimes(1)
    expect(clearWatch).not.toHaveBeenCalled()

    view.unmount()
    expect(clearWatch).toHaveBeenCalledTimes(1)
    expect(clearWatch).toHaveBeenCalledWith(73)
  })

  it('propagates browser errors through context and clears them after reacquisition', () => {
    render(session(false, null))

    act(() => watchFailure?.({
      code: 1,
      message: 'Location permission denied',
      PERMISSION_DENIED: 1,
      POSITION_UNAVAILABLE: 2,
      TIMEOUT: 3,
    } as GeolocationPositionError))
    expect(screen.getByTestId('position-consumer')).toHaveAttribute(
      'data-error',
      'Location permission denied',
    )

    act(() => watchSuccess?.(position(11.8201, 122.1681, 1_000)))
    expect(screen.getByTestId('position-consumer')).toHaveAttribute('data-error', '')
    expect(screen.getByTestId('position-consumer')).toHaveAttribute('data-lat', '11.8201')
  })
})
