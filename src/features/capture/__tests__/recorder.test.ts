import { describe, expect, it, vi } from 'vitest'
import { createCaptureRecorder, CAPTURE_WATCH_OPTIONS } from '../recorder'
import type { RawGpsSample } from '../types'

function position(timestamp: number): GeolocationPosition {
  return {
    timestamp,
    coords: {
      latitude: 11.8,
      longitude: 122.1,
      accuracy: 4.5,
      altitude: 12,
      altitudeAccuracy: 2,
      heading: 90,
      speed: 1.4,
      toJSON: () => ({}),
    },
    toJSON: () => ({}),
  }
}

describe('Capture foreground recorder', () => {
  it('keeps GPS observation live while gating route samples to Recording', () => {
    const callbacks: Array<{ success: PositionCallback; error: PositionErrorCallback }> = []
    const geolocation = {
      watchPosition: vi.fn((success: PositionCallback, error?: PositionErrorCallback) => {
        callbacks.push({ success, error: error ?? (() => {}) })
        return callbacks.length
      }),
      clearWatch: vi.fn(),
    }
    const onPosition = vi.fn<(sample: RawGpsSample) => void>()
    const onSample = vi.fn<(sample: RawGpsSample) => void>()
    const recorder = createCaptureRecorder({ geolocation, onPosition, onSample })

    recorder.observe()
    callbacks[0].success(position(1_756_632_000_000))
    expect(onPosition).toHaveBeenCalledTimes(1)
    expect(onSample).not.toHaveBeenCalled()

    recorder.start()
    callbacks[0].success(position(1_756_632_001_000))
    expect(onSample).toHaveBeenCalledTimes(1)

    recorder.pause()
    callbacks[0].success(position(1_756_632_002_000))
    expect(onPosition).toHaveBeenCalledTimes(3)
    expect(onPosition.mock.calls[2][0].heading).toBe(90)
    expect(onSample).toHaveBeenCalledTimes(1)
    expect(geolocation.clearWatch).not.toHaveBeenCalled()

    recorder.resume()
    callbacks[0].success(position(1_756_632_003_000))
    expect(onPosition).toHaveBeenCalledTimes(4)
    expect(onSample).toHaveBeenCalledTimes(1)
    callbacks[0].success(position(1_756_632_004_000))
    expect(onSample).toHaveBeenCalledTimes(2)
    expect(geolocation.watchPosition).toHaveBeenCalledTimes(1)
  })

  it('starts a high-accuracy watch and preserves each callback as a raw sample', () => {
    const callbacks: Array<{ success: PositionCallback; error: PositionErrorCallback }> = []
    const geolocation = {
      watchPosition: vi.fn((success: PositionCallback, error?: PositionErrorCallback) => {
        callbacks.push({ success, error: error ?? (() => {}) })
        return callbacks.length
      }),
      clearWatch: vi.fn(),
    }
    const onSample = vi.fn<(sample: RawGpsSample) => void>()
    const recorder = createCaptureRecorder({ geolocation, onSample })

    recorder.start()
    callbacks[0].success(position(1_756_632_000_000))
    callbacks[0].success(position(1_756_632_001_000))

    expect(geolocation.watchPosition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      CAPTURE_WATCH_OPTIONS,
    )
    expect(onSample).toHaveBeenCalledTimes(2)
    expect(onSample.mock.calls[0][0]).toEqual({
      sequence: 0,
      timestamp: new Date(1_756_632_000_000).toISOString(),
      latitude: 11.8,
      longitude: 122.1,
      accuracy: 4.5,
      altitude: 12,
      altitudeAccuracy: 2,
      heading: 90,
      speed: 1.4,
    })
    expect(onSample.mock.calls[1][0].sequence).toBe(1)
  })

  it('keeps the same watch across pause and resume, then stops on finish', () => {
    let nextWatchId = 0
    const geolocation = {
      watchPosition: vi.fn(() => ++nextWatchId),
      clearWatch: vi.fn(),
    }
    const recorder = createCaptureRecorder({ geolocation, onSample: vi.fn() })

    recorder.start()
    recorder.pause()
    recorder.resume()
    recorder.finish()
    recorder.resume()

    expect(geolocation.watchPosition).toHaveBeenCalledTimes(1)
    expect(geolocation.clearWatch).toHaveBeenCalledWith(1)
  })

  it('forwards geolocation errors without changing sample state', () => {
    const callbacks: Array<{ success: PositionCallback; error: PositionErrorCallback }> = []
    const geolocation = {
      watchPosition: vi.fn((success: PositionCallback, error?: PositionErrorCallback) => {
        callbacks.push({ success, error: error ?? (() => {}) })
        return 7
      }),
      clearWatch: vi.fn(),
    }
    const onError = vi.fn()
    const recorder = createCaptureRecorder({ geolocation, onSample: vi.fn(), onError })
    const error = { code: 1, message: 'permission denied' } as GeolocationPositionError

    recorder.start()
    callbacks[0].error(error)

    expect(onError).toHaveBeenCalledWith(error)
  })
})
