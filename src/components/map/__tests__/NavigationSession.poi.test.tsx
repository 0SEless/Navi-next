import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { NavigationSession } from '../NavigationSession'
import { useNavigationContext } from '../NavigationContext'
import { useGeolocation } from '../../../hooks/useGeolocation'
import type { POI } from '@navi/core'
import type { NavRoute } from '../../../types/route-types'

vi.mock('../../../hooks/useGeolocation', () => ({
  useGeolocation: vi.fn(),
}))

vi.mock('@/hooks/useNavigationHeading', () => ({
  useNavigationHeading: () => ({
    direction: { heading: null, source: 'none', status: 'location-only' },
    canRequestPermission: false,
    enableDirection: vi.fn(async () => undefined),
  }),
}))

const poi: POI = {
  id: 'poi-study-area',
  label: 'Study Area',
  category: 'study_area',
  position: { lat: 0, lng: 0.002 },
  buildingId: 'building-a',
  floor: 2,
  source: 'authored',
  sourceId: 'poi-study-area',
  properties: {},
  geometry: { type: 'point', position: { lat: 0, lng: 0.002 } },
}

const route: NavRoute = {
  path: ['start', 'approach', 'poi-study-area'],
  steps: [
    { nodeId: 'start', label: 'Start', position: { lat: 0, lng: 0 }, floor: 0, buildingId: '', type: 'walk' },
    { nodeId: 'approach', label: 'Approach', position: { lat: 0, lng: 0.001 }, floor: 2, buildingId: 'building-a', type: 'walk' },
    { nodeId: 'poi-study-area', label: 'Study Area', position: { lat: 0, lng: 0.0017 }, floor: 2, buildingId: 'building-a', type: 'walk' },
  ],
  instructions: [
    { type: 'walk', text: 'Continue to Approach', distance: 100, fromNode: 'start', toNode: 'approach' },
    { type: 'arrive', text: 'Arrive at Study Area', distance: 0, fromNode: 'poi-study-area', toNode: 'poi-study-area' },
  ],
  totalDistance: 188,
  totalDuration: 0,
  fromLabel: 'Start',
  toLabel: 'Study Area',
  arrival: {
    nodeId: 'poi-study-area',
    label: 'Study Area',
    position: { lat: 0, lng: 0.0017 },
    remainingDistance: 0,
  },
  nodeFloors: [2, 0],
  destination: { entityType: 'poi', entityId: 'poi-study-area' },
}

function Probe() {
  const context = useNavigationContext()
  return createElement('output', {
    'data-testid': 'poi-session-context',
    'data-arrived': String(context.arrived),
    'data-off-route': String(context.isOffRoute),
    'data-destination': context.destination?.entityId ?? '',
    'data-remaining': String(context.routeProgress?.remainingDistance ?? ''),
  })
}

function session(
  position: { lat: number; lng: number },
  options: { floor?: number; buildingId?: string; onArrival?: () => void } = {},
) {
  vi.mocked(useGeolocation).mockReturnValue({
    latitude: position.lat,
    longitude: position.lng,
    accuracy: 4,
    heading: null,
    speed: null,
    timestamp: Date.now(),
    error: null,
    loading: false,
  })
  return (
    <NavigationSession
      route={route}
      active
      activeFloor={options.floor ?? 2}
      setActiveFloor={vi.fn()}
      poiDestination={poi}
      locationContext={
        options.floor === undefined && options.buildingId === undefined
          ? undefined
          : { floor: options.floor, buildingId: options.buildingId }
      }
      onArrival={options.onArrival}
    >
      <Probe />
    </NavigationSession>
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Phase 4D NavigationSession authored POI contract', () => {
  it('does not treat the Phase 4C approach endpoint as POI arrival', async () => {
    const onArrival = vi.fn()
    render(session(route.arrival.position, { onArrival }))

    await waitFor(() => expect(screen.getByTestId('poi-session-context')).toHaveAttribute('data-arrived', 'false'))
    expect(onArrival).not.toHaveBeenCalled()
    expect(screen.getByTestId('poi-session-context')).toHaveAttribute('data-destination', 'poi-study-area')
  })

  it('arrives from POI geometry, even when the position is outside the route line', async () => {
    const onArrival = vi.fn()
    render(session(poi.position, { onArrival }))

    await waitFor(() => expect(screen.getByTestId('poi-session-context')).toHaveAttribute('data-arrived', 'true'))
    expect(screen.getByTestId('poi-session-context')).toHaveAttribute('data-off-route', 'false')
    expect(onArrival).toHaveBeenCalledTimes(1)
  })

  it('rejects a same-coordinate arrival on the wrong floor or building', async () => {
    const wrongFloor = render(session(poi.position, { floor: 1, buildingId: 'building-a' }))
    await waitFor(() => expect(screen.getByTestId('poi-session-context')).toHaveAttribute('data-arrived', 'false'))

    wrongFloor.rerender(session(poi.position, { floor: 2, buildingId: 'building-b' }))
    await waitFor(() => expect(screen.getByTestId('poi-session-context')).toHaveAttribute('data-arrived', 'false'))
  })

  it('emits arrival once across repeated inside-geometry updates', async () => {
    const onArrival = vi.fn()
    const view = render(session(poi.position, { onArrival }))
    await waitFor(() => expect(onArrival).toHaveBeenCalledTimes(1))

    act(() => view.rerender(session(poi.position, { onArrival })))
    act(() => view.rerender(session({ lat: 0, lng: 0.00199 }, { onArrival })))
    expect(onArrival).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('poi-session-context')).toHaveAttribute('data-arrived', 'true')
  })

  it('keeps completion stable after the position leaves the arrival geometry', async () => {
    const onArrival = vi.fn()
    const view = render(session(poi.position, { onArrival }))
    await waitFor(() => expect(onArrival).toHaveBeenCalledTimes(1))

    act(() => view.rerender(session(route.arrival.position, { onArrival })))

    expect(screen.getByTestId('poi-session-context')).toHaveAttribute('data-arrived', 'true')
    expect(onArrival).toHaveBeenCalledTimes(1)
  })

  it('keeps ordinary route progress available before POI arrival', async () => {
    render(session({ lat: 0, lng: 0.0005 }))
    await waitFor(() => {
      expect(Number(screen.getByTestId('poi-session-context').getAttribute('data-remaining'))).toBeGreaterThan(0)
    })
    expect(screen.getByTestId('poi-session-context')).toHaveAttribute('data-arrived', 'false')
  })
})
