import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NavigationSession } from '../NavigationSession'
import { useNavigationContext } from '../NavigationContext'

type OrientationConstructor = {
  requestPermission?: () => Promise<'granted' | 'denied'>
}

const originalDeviceOrientationDescriptor = Object.getOwnPropertyDescriptor(window, 'DeviceOrientationEvent')

function setDeviceOrientationConstructor(value: OrientationConstructor | undefined) {
  if (value === undefined) {
    Object.defineProperty(window, 'DeviceOrientationEvent', { configurable: true, value: undefined })
  } else {
    Object.defineProperty(window, 'DeviceOrientationEvent', { configurable: true, value })
  }
}

function dispatchOrientation(heading: number) {
  const event = new Event('deviceorientation')
  Object.assign(event, { absolute: true, alpha: 360 - heading })
  window.dispatchEvent(event)
}

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

function HeadingConsumer() {
  const context = useNavigationContext()
  return (
    <output
      data-testid="heading-context"
      data-heading={String(context.heading ?? '')}
      data-source={context.headingSource}
      data-status={context.headingStatus}
      data-active={String(context.sessionActive)}
    />
  )
}

let watchSuccess: PositionCallback | undefined
let watchPosition: ReturnType<typeof vi.fn>
let clearWatch: ReturnType<typeof vi.fn>

beforeEach(() => {
  const requestPermission = vi.fn<() => Promise<'granted'>>().mockResolvedValue('granted')
  setDeviceOrientationConstructor({ requestPermission })
  watchSuccess = undefined
  watchPosition = vi.fn((success: PositionCallback) => {
    watchSuccess = success
    return 73
  })
  clearWatch = vi.fn()
  Object.defineProperty(navigator, 'geolocation', {
    value: { watchPosition, clearWatch },
    configurable: true,
    writable: true,
  })
})

afterEach(() => {
  cleanup()
  if (originalDeviceOrientationDescriptor) {
    Object.defineProperty(window, 'DeviceOrientationEvent', originalDeviceOrientationDescriptor)
  } else {
    delete (window as Window & { DeviceOrientationEvent?: unknown }).DeviceOrientationEvent
  }
  vi.restoreAllMocks()
})

function session() {
  return (
    <NavigationSession
      route={null}
      active={false}
      activeFloor={0}
      setActiveFloor={vi.fn()}
    >
      <HeadingConsumer />
    </NavigationSession>
  )
}

describe('NavigationSession passive heading observation', () => {
  it('observes heading in setup without a route, camera action, or permission request', async () => {
    const requestPermission = (window.DeviceOrientationEvent as OrientationConstructor).requestPermission
    const addEventListener = vi.spyOn(window, 'addEventListener')
    const removeEventListener = vi.spyOn(window, 'removeEventListener')
    const view = render(session())

    expect(watchPosition).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('heading-context')).toHaveAttribute('data-active', 'false')
    expect(requestPermission).not.toHaveBeenCalled()

    act(() => watchSuccess?.(position(11.82, 122.168, Date.now())))
    act(() => dispatchOrientation(0))
    await waitFor(() => expect(screen.getByTestId('heading-context')).toHaveAttribute('data-heading', '0'))
    expect(screen.getByTestId('heading-context')).toHaveAttribute('data-source', 'device')

    act(() => dispatchOrientation(90))
    await waitFor(() => expect(screen.getByTestId('heading-context')).toHaveAttribute('data-heading', '90'))
    act(() => dispatchOrientation(180))
    await waitFor(() => expect(screen.getByTestId('heading-context')).toHaveAttribute('data-heading', '180'))
    expect(requestPermission).not.toHaveBeenCalled()

    view.unmount()
    expect(clearWatch).toHaveBeenCalledWith(73)
    expect(removeEventListener).toHaveBeenCalledWith('deviceorientation', expect.any(Function))
    expect(removeEventListener).toHaveBeenCalledWith('deviceorientationabsolute', expect.any(Function))
    expect(addEventListener.mock.calls.filter(([type]) => type === 'deviceorientation')).toHaveLength(1)
  })

  it('does not duplicate heading listeners or foreground watchers across remounts', () => {
    const addEventListener = vi.spyOn(window, 'addEventListener')
    const removeEventListener = vi.spyOn(window, 'removeEventListener')

    const first = render(session())
    first.unmount()
    const second = render(session())
    second.unmount()

    expect(watchPosition).toHaveBeenCalledTimes(2)
    expect(clearWatch).toHaveBeenCalledTimes(2)
    expect(addEventListener.mock.calls.filter(([type]) => type === 'deviceorientation')).toHaveLength(2)
    expect(removeEventListener.mock.calls.filter(([type]) => type === 'deviceorientation')).toHaveLength(2)
  })
})
