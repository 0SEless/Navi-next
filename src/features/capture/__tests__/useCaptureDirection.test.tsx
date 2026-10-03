import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useCaptureDirection } from '../hooks/useCaptureDirection'

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

describe('useCaptureDirection', () => {
  it('reports unsupported without registering listeners', () => {
    setDeviceOrientationConstructor(undefined)
    const addEventListener = vi.spyOn(window, 'addEventListener')

    const { result } = renderHook(() => useCaptureDirection({ now: () => 1_000 }))

    expect(result.current.direction).toEqual({ status: 'unsupported', source: 'none', heading: null })
    expect(result.current.canRequestPermission).toBe(false)
    expect(addEventListener).not.toHaveBeenCalledWith('deviceorientation', expect.any(Function))
  })

  it('does not request permission until enableDirection is called', async () => {
    const requestPermission = vi.fn<() => Promise<'granted'>>().mockResolvedValue('granted')
    setDeviceOrientationConstructor({ requestPermission })

    const { result } = renderHook(() => useCaptureDirection({ now: () => 1_000 }))

    expect(requestPermission).not.toHaveBeenCalled()
    expect(result.current.direction.status).toBe('permission-required')
    expect(result.current.canRequestPermission).toBe(true)

    await act(async () => { await result.current.enableDirection() })

    expect(requestPermission).toHaveBeenCalledTimes(1)
    expect(result.current.direction.status).toBe('location-only')
  })

  it('uses a fresh absolute device heading after explicit permission', async () => {
    const requestPermission = vi.fn<() => Promise<'granted'>>().mockResolvedValue('granted')
    setDeviceOrientationConstructor({ requestPermission })
    const { result } = renderHook(() => useCaptureDirection({ now: () => 1_000 }))

    await act(async () => { await result.current.enableDirection() })
    act(() => dispatchOrientation({ absolute: true, alpha: 90 }))

    expect(result.current.direction).toEqual({ status: 'available', source: 'device', heading: 270 })
    expect(result.current.directionGeoJson.arrow.features).toHaveLength(0)
  })

  it('falls back to fresh GPS movement direction and cleans listeners on unmount', () => {
    setDeviceOrientationConstructor({})
    const removeEventListener = vi.spyOn(window, 'removeEventListener')
    const { result, unmount } = renderHook(() => useCaptureDirection({
      now: () => Date.parse('2026-09-01T00:00:05.000Z'),
      gpsSample: {
        heading: 90,
        speed: 1,
        timestamp: '2026-09-01T00:00:00.000Z',
      },
      position: { latitude: 11.8, longitude: 122.1 },
    }))

    expect(result.current.direction).toEqual({ status: 'gps-fallback', source: 'gps', heading: 90 })
    expect(result.current.directionGeoJson.arrow.features).toHaveLength(1)

    unmount()
    expect(removeEventListener).toHaveBeenCalledWith('deviceorientation', expect.any(Function))
    expect(removeEventListener).toHaveBeenCalledWith('deviceorientationabsolute', expect.any(Function))
  })
})
