import type { RawGpsSample } from './types'

export const CAPTURE_WATCH_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 10_000,
  maximumAge: 0,
}

export interface CaptureRecorderDependencies {
  geolocation: Pick<Geolocation, 'watchPosition' | 'clearWatch'>
  onSample: (sample: RawGpsSample) => void
  onPosition?: (sample: RawGpsSample) => void
  onError?: (error: GeolocationPositionError) => void
  now?: () => number
}

export interface CaptureRecorder {
  observe(): void
  start(): void
  pause(): void
  resume(): void
  finish(): void
  destroy(): void
}

function nullableFinite(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function toRawSample(position: GeolocationPosition, sequence: number, now: () => number): RawGpsSample {
  const timestamp = Number.isFinite(position.timestamp) ? position.timestamp : now()
  return {
    sequence,
    timestamp: new Date(timestamp).toISOString(),
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: nullableFinite(position.coords.accuracy),
    altitude: nullableFinite(position.coords.altitude),
    altitudeAccuracy: nullableFinite(position.coords.altitudeAccuracy),
    heading: nullableFinite(position.coords.heading),
    speed: nullableFinite(position.coords.speed),
  }
}

export function createCaptureRecorder(deps: CaptureRecorderDependencies): CaptureRecorder {
  let watchId: number | null = null
  let sequence = 0
  let samplingEnabled = false
  let skipNextSample = false
  let finished = false
  let destroyed = false

  const handlePosition: PositionCallback = (position) => {
    if (finished || destroyed) return
    const sample = toRawSample(position, sequence, deps.now ?? Date.now)
    deps.onPosition?.({ ...sample })
    if (!samplingEnabled) return
    if (skipNextSample) {
      skipNextSample = false
      return
    }
    deps.onSample({ ...sample })
    sequence += 1
  }

  const handleError: PositionErrorCallback = (error) => {
    if (!finished && !destroyed) deps.onError?.(error)
  }

  const ensureWatch = () => {
    if (watchId !== null || finished || destroyed) return
    watchId = deps.geolocation.watchPosition(handlePosition, handleError, CAPTURE_WATCH_OPTIONS)
  }

  const observe = () => {
    samplingEnabled = false
    ensureWatch()
  }

  const start = () => {
    ensureWatch()
    samplingEnabled = true
    skipNextSample = false
  }

  const pause = () => {
    samplingEnabled = false
    skipNextSample = false
  }

  const resume = () => {
    ensureWatch()
    samplingEnabled = true
    skipNextSample = true
  }

  const stopWatch = () => {
    if (watchId === null) return
    deps.geolocation.clearWatch(watchId)
    watchId = null
  }

  return {
    observe,
    start,
    pause,
    resume,
    finish() {
      finished = true
      samplingEnabled = false
      stopWatch()
    },
    destroy() {
      destroyed = true
      samplingEnabled = false
      stopWatch()
    },
  }
}
