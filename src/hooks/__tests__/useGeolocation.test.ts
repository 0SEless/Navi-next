import { StrictMode, createElement, type ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGeolocation } from '../useGeolocation'

type PositionSuccess = PositionCallback
type PositionFailure = PositionErrorCallback

function position(
  latitude: number,
  longitude: number,
  {
    accuracy = 5,
    heading = null,
    speed = null,
    timestamp = 1_000,
  }: {
    accuracy?: number
    heading?: number | null
    speed?: number | null
    timestamp?: number
  } = {},
): GeolocationPosition {
  return {
    timestamp,
    coords: {
      latitude,
      longitude,
      accuracy,
      altitude: null,
      altitudeAccuracy: null,
      heading,
      speed,
      toJSON: () => ({}),
    },
    toJSON: () => ({}),
  } as GeolocationPosition
}

function geolocationError(code: number, message: string): GeolocationPositionError {
  return {
    code,
    message,
    PERMISSION_DENIED: 1,
    POSITION_UNAVAILABLE: 2,
    TIMEOUT: 3,
  } as GeolocationPositionError
}

let getCurrentPosition: ReturnType<typeof vi.fn>
let watchPosition: ReturnType<typeof vi.fn>
let clearWatch: ReturnType<typeof vi.fn>

beforeEach(() => {
  getCurrentPosition = vi.fn((success: PositionSuccess) => {
    success(position(11.8195, 122.0922, { accuracy: 10 }))
  })
  watchPosition = vi.fn(() => 42)
  clearWatch = vi.fn()

  Object.defineProperty(navigator, 'geolocation', {
    value: { getCurrentPosition, watchPosition, clearWatch },
    configurable: true,
    writable: true,
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useGeolocation', () => {
  it('retains native position metadata from one-shot acquisition', () => {
    getCurrentPosition.mockImplementationOnce((success: PositionSuccess) => {
      success(position(11.8195, 122.0922, {
        accuracy: 10,
        heading: 135,
        speed: 1.25,
        timestamp: 12_345,
      }))
    })

    const { result } = renderHook(() => useGeolocation())

    expect(result.current).toEqual({
      latitude: 11.8195,
      longitude: 122.0922,
      accuracy: 10,
      heading: 135,
      speed: 1.25,
      timestamp: 12_345,
      loading: false,
      error: null,
    })
  })

  it('delivers P2 when it arrives 500 ms after P1 and then callbacks stop', () => {
    let success: PositionSuccess | undefined
    watchPosition.mockImplementationOnce((onSuccess: PositionSuccess) => {
      success = onSuccess
      return 42
    })
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_500)

    const { result } = renderHook(() => useGeolocation({ watch: true }))

    act(() => success?.(position(11.8201, 122.1681, { timestamp: 1_000 })))
    act(() => success?.(position(11.8202, 122.1682, {
      accuracy: 3,
      heading: 90,
      speed: 1.4,
      timestamp: 1_500,
    })))

    expect(result.current).toMatchObject({
      latitude: 11.8202,
      longitude: 122.1682,
      accuracy: 3,
      heading: 90,
      speed: 1.4,
      timestamp: 1_500,
      error: null,
      loading: false,
    })
  })

  it('preserves every browser-delivered update in a normal callback burst', () => {
    let success: PositionSuccess | undefined
    watchPosition.mockImplementationOnce((onSuccess: PositionSuccess) => {
      success = onSuccess
      return 42
    })
    const { result } = renderHook(() => useGeolocation({ watch: true }))

    act(() => {
      success?.(position(11.8201, 122.1681, { timestamp: 1_000 }))
      success?.(position(11.8202, 122.1682, { timestamp: 1_200 }))
      success?.(position(11.8203, 122.1683, { timestamp: 1_400 }))
    })

    expect(result.current).toMatchObject({
      latitude: 11.8203,
      longitude: 122.1683,
      timestamp: 1_400,
    })
  })

  it('does not recreate its watcher on an ordinary rerender and clears it on unmount', () => {
    const { rerender, unmount } = renderHook(
      ({ watch }) => useGeolocation({ watch }),
      { initialProps: { watch: true } },
    )

    expect(watchPosition).toHaveBeenCalledTimes(1)
    rerender({ watch: true })
    expect(watchPosition).toHaveBeenCalledTimes(1)

    unmount()
    expect(clearWatch).toHaveBeenCalledTimes(1)
    expect(clearWatch).toHaveBeenCalledWith(42)
  })

  it('keeps at most one live watcher through React Strict Mode setup and cleanup', () => {
    let nextId = 100
    let maxActive = 0
    const activeIds = new Set<number>()
    watchPosition.mockImplementation(() => {
      const id = nextId++
      activeIds.add(id)
      maxActive = Math.max(maxActive, activeIds.size)
      return id
    })
    clearWatch.mockImplementation((id: number) => {
      activeIds.delete(id)
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      createElement(StrictMode, null, children)
    )

    const { unmount } = renderHook(() => useGeolocation({ watch: true }), { wrapper })

    expect(maxActive).toBe(1)
    expect(activeIds.size).toBe(1)
    unmount()
    expect(activeIds.size).toBe(0)
  })

  it.each([
    [1, 'Location permission denied'],
    [2, 'Position unavailable'],
    [3, 'Location request timed out'],
  ])('surfaces geolocation error %i, preserves the last fix, and recovers on success', (code, message) => {
    let success: PositionSuccess | undefined
    let failure: PositionFailure | undefined
    watchPosition.mockImplementationOnce((onSuccess: PositionSuccess, onError: PositionFailure) => {
      success = onSuccess
      failure = onError
      return 42
    })
    const { result } = renderHook(() => useGeolocation({ watch: true }))

    act(() => success?.(position(11.8201, 122.1681, { timestamp: 1_000 })))
    act(() => failure?.(geolocationError(code, message)))

    expect(result.current).toMatchObject({
      latitude: 11.8201,
      longitude: 122.1681,
      error: message,
      loading: false,
    })

    act(() => success?.(position(11.8202, 122.1682, { timestamp: 2_000 })))
    expect(result.current).toMatchObject({
      latitude: 11.8202,
      longitude: 122.1682,
      error: null,
      loading: false,
    })
  })

  it('reacquires a watcher after unmount and remount', () => {
    watchPosition
      .mockImplementationOnce(() => 42)
      .mockImplementationOnce(() => 43)

    const first = renderHook(() => useGeolocation({ watch: true }))
    first.unmount()
    const second = renderHook(() => useGeolocation({ watch: true }))

    expect(watchPosition).toHaveBeenCalledTimes(2)
    expect(clearWatch).toHaveBeenCalledWith(42)
    second.unmount()
    expect(clearWatch).toHaveBeenLastCalledWith(43)
  })
})
