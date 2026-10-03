import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useNavigationHeading } from '../useNavigationHeading'

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

function dispatchOrientation(overrides: Record<string, unknown>) {
  const event = new Event('deviceorientation')
  Object.assign(event, overrides)
  window.dispatchEvent(event)
}

afterEach(() => {
  if (originalDeviceOrientationDescriptor) {
    Object.defineProperty(window, 'DeviceOrientationEvent', originalDeviceOrientationDescriptor)
  } else {
    delete (window as Window & { DeviceOrientationEvent?: unknown }).DeviceOrientationEvent
  }
  vi.restoreAllMocks()
})

describe('useNavigationHeading', () => {
  it('adapts a fresh moving GPS sample through the Capture fallback contract', () => {
    setDeviceOrientationConstructor(undefined)
    const timestamp = Date.now()

    const { result } = renderHook(() => useNavigationHeading({
      position: { lat: 11.8, lng: 122.1 },
      heading: 90,
      speed: 1,
      timestamp,
      enabled: true,
    }))

    expect(result.current.direction).toEqual({ status: 'gps-fallback', source: 'gps', heading: 90 })
  })

  it('requests orientation permission only through the returned user-gesture callback', async () => {
    const requestPermission = vi.fn<() => Promise<'granted'>>().mockResolvedValue('granted')
    setDeviceOrientationConstructor({ requestPermission })

    const { result } = renderHook(() => useNavigationHeading({ enabled: true }))

    expect(requestPermission).not.toHaveBeenCalled()
    expect(result.current.direction.status).toBe('permission-required')
    expect(result.current.canRequestPermission).toBe(true)

    await act(async () => { await result.current.enableDirection() })

    expect(requestPermission).toHaveBeenCalledTimes(1)
  })

  it('observes a permission-capable orientation source passively without requesting permission', async () => {
    const requestPermission = vi.fn<() => Promise<'granted'>>().mockResolvedValue('granted')
    setDeviceOrientationConstructor({ requestPermission })

    const { result, unmount } = renderHook(() => useNavigationHeading({ enabled: true }))

    expect(requestPermission).not.toHaveBeenCalled()
    expect(result.current.direction.status).toBe('permission-required')

    act(() => dispatchOrientation({ absolute: true, alpha: 90 }))

    await act(async () => undefined)
    expect(requestPermission).not.toHaveBeenCalled()
    expect(result.current.direction).toEqual({ status: 'available', source: 'device', heading: 270 })

    unmount()
  })

  it('does not turn an invalid or stale sample into a heading', () => {
    setDeviceOrientationConstructor(undefined)

    const { result } = renderHook(() => useNavigationHeading({
      heading: Number.NaN,
      speed: 1,
      timestamp: Date.now() - 20_000,
      enabled: true,
    }))

    expect(result.current.direction.heading).toBeNull()
    expect(result.current.direction.source).toBe('none')
  })
})
