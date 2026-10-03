import type { CaptureCoordinate, RawGpsSample } from './types'

const EARTH_RADIUS_METERS = 6_371_008.8

export const CAPTURE_DISPLAY_STATIONARY_MIN_DEADBAND_METERS = 3
export const CAPTURE_DISPLAY_STATIONARY_ACCURACY_FACTOR = 0.75
export const CAPTURE_DISPLAY_DEFAULT_ACCURACY_METERS = 5
export const CAPTURE_DISPLAY_POOR_ACCURACY_THRESHOLD_METERS = 15
export const CAPTURE_DISPLAY_CONFIDENT_SPEED_MPS = 0.75
export const CAPTURE_DISPLAY_CONFIRMATION_PROGRESS_METERS = 0.5

export interface CaptureDisplayPositionStabilizerOptions {
  minDeadbandMeters?: number
  accuracyFactor?: number
  defaultAccuracyMeters?: number
  poorAccuracyThresholdMeters?: number
  confidentSpeedMps?: number
  confirmationProgressMeters?: number
}

export interface CaptureDisplayPositionStabilizer {
  update: (sample: RawGpsSample) => CaptureCoordinate | null
  getCurrent: () => CaptureCoordinate | null
  reset: () => void
}

interface VectorMeters {
  east: number
  north: number
}

interface PendingPosition {
  coordinate: CaptureCoordinate
  vector: VectorMeters
  distanceMeters: number
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isValidCoordinate(coordinate: CaptureCoordinate | null | undefined): coordinate is CaptureCoordinate {
  return Boolean(coordinate)
    && isFiniteNumber(coordinate.latitude)
    && isFiniteNumber(coordinate.longitude)
    && coordinate.latitude >= -90
    && coordinate.latitude <= 90
    && coordinate.longitude >= -180
    && coordinate.longitude <= 180
}

function cloneCoordinate(coordinate: CaptureCoordinate | null): CaptureCoordinate | null {
  return coordinate ? { latitude: coordinate.latitude, longitude: coordinate.longitude } : null
}

function normalizedAccuracy(accuracy: number | null | undefined, fallback: number | null): number | null {
  if (!isFiniteNumber(accuracy) || accuracy < 0) return fallback
  return accuracy
}

function coordinateKey(sample: RawGpsSample): string {
  return `${sample.sequence}:${sample.timestamp}:${sample.latitude}:${sample.longitude}`
}

function vectorBetween(from: CaptureCoordinate, to: CaptureCoordinate): VectorMeters {
  const latitudeRadians = from.latitude * Math.PI / 180
  const metersPerDegreeLatitude = Math.PI * EARTH_RADIUS_METERS / 180
  const metersPerDegreeLongitude = metersPerDegreeLatitude * Math.cos(latitudeRadians)
  return {
    east: (to.longitude - from.longitude) * metersPerDegreeLongitude,
    north: (to.latitude - from.latitude) * metersPerDegreeLatitude,
  }
}

function vectorLength(vector: VectorMeters): number {
  return Math.hypot(vector.east, vector.north)
}

function sameDirection(a: VectorMeters, b: VectorMeters): boolean {
  const aLength = vectorLength(a)
  const bLength = vectorLength(b)
  if (aLength === 0 || bLength === 0) return false
  return (a.east * b.east + a.north * b.north) / (aLength * bLength) >= 0.35
}

export function getCaptureDisplayNoiseEnvelopeMeters(
  accuracy: number | null | undefined,
  options: Pick<CaptureDisplayPositionStabilizerOptions, 'minDeadbandMeters' | 'accuracyFactor' | 'defaultAccuracyMeters'> = {},
): number {
  const minDeadband = isFiniteNumber(options.minDeadbandMeters)
    ? Math.max(0, options.minDeadbandMeters)
    : CAPTURE_DISPLAY_STATIONARY_MIN_DEADBAND_METERS
  const accuracyFactor = isFiniteNumber(options.accuracyFactor)
    ? Math.max(0, options.accuracyFactor)
    : CAPTURE_DISPLAY_STATIONARY_ACCURACY_FACTOR
  const defaultAccuracy = isFiniteNumber(options.defaultAccuracyMeters)
    ? Math.max(0, options.defaultAccuracyMeters)
    : CAPTURE_DISPLAY_DEFAULT_ACCURACY_METERS
  const referenceAccuracy = normalizedAccuracy(accuracy, defaultAccuracy) ?? defaultAccuracy
  return Math.max(minDeadband, referenceAccuracy * accuracyFactor)
}

export function createCaptureDisplayPositionStabilizer(
  options: CaptureDisplayPositionStabilizerOptions = {},
): CaptureDisplayPositionStabilizer {
  const poorAccuracyThreshold = isFiniteNumber(options.poorAccuracyThresholdMeters)
    ? Math.max(0, options.poorAccuracyThresholdMeters)
    : CAPTURE_DISPLAY_POOR_ACCURACY_THRESHOLD_METERS
  const confidentSpeed = isFiniteNumber(options.confidentSpeedMps)
    ? Math.max(0, options.confidentSpeedMps)
    : CAPTURE_DISPLAY_CONFIDENT_SPEED_MPS
  const confirmationProgress = isFiniteNumber(options.confirmationProgressMeters)
    ? Math.max(0, options.confirmationProgressMeters)
    : CAPTURE_DISPLAY_CONFIRMATION_PROGRESS_METERS

  let current: CaptureCoordinate | null = null
  let lastSampleKey: string | null = null
  let pending: PendingPosition | null = null

  const accept = (coordinate: CaptureCoordinate) => {
    current = cloneCoordinate(coordinate)
    pending = null
    return cloneCoordinate(current)
  }

  return {
    update(sample) {
      const key = coordinateKey(sample)
      if (key === lastSampleKey) return cloneCoordinate(current)
      lastSampleKey = key

      const candidate: CaptureCoordinate = {
        latitude: sample.latitude,
        longitude: sample.longitude,
      }
      if (!isValidCoordinate(candidate)) {
        pending = null
        return cloneCoordinate(current)
      }

      if (!current) return accept(candidate)

      const vector = vectorBetween(current, candidate)
      const distanceMeters = vectorLength(vector)
      const noiseEnvelopeMeters = getCaptureDisplayNoiseEnvelopeMeters(sample.accuracy, options)
      if (distanceMeters <= noiseEnvelopeMeters) {
        pending = null
        return cloneCoordinate(current)
      }

      const accuracy = normalizedAccuracy(sample.accuracy, null)
      const poorAccuracy = accuracy === null || accuracy > poorAccuracyThreshold
      const speedIsCredible = isFiniteNumber(sample.speed) && sample.speed >= confidentSpeed
      if (!poorAccuracy && speedIsCredible) return accept(candidate)

      if (
        pending
        && sameDirection(pending.vector, vector)
        && distanceMeters >= pending.distanceMeters
        && vectorLength(vectorBetween(pending.coordinate, candidate)) >= confirmationProgress
      ) {
        return accept(candidate)
      }

      pending = {
        coordinate: cloneCoordinate(candidate) ?? candidate,
        vector,
        distanceMeters,
      }
      return cloneCoordinate(current)
    },
    getCurrent: () => cloneCoordinate(current),
    reset() {
      current = null
      lastSampleKey = null
      pending = null
    },
  }
}
