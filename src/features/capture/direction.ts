import type { CaptureCoordinate, RawGpsSample } from './types'
import { buildPassiveLocationArrowGeoJson } from '@/lib/navigation-heading-arrow'

export const CAPTURE_GPS_HEADING_MIN_SPEED_MPS = 0.5
export const CAPTURE_GPS_HEADING_MAX_AGE_MS = 15_000
export const CAPTURE_DEVICE_HEADING_MAX_AGE_MS = 3_000
export const CAPTURE_HEADING_SMOOTHING_FACTOR = 0.35
export const CAPTURE_HEADING_DEADBAND_DEGREES = 1.5

export type CaptureDirectionStatus =
  | 'available'
  | 'permission-required'
  | 'denied'
  | 'unsupported'
  | 'unreliable'
  | 'gps-fallback'
  | 'location-only'

export type CaptureDirectionSource = 'device' | 'gps' | 'none'
export type CaptureDeviceOrientationSupport = 'supported' | 'permission-required' | 'unsupported'
export type CaptureDeviceOrientationPermission = 'unknown' | 'granted' | 'denied'

export interface CaptureDeviceFacingSignal {
  heading: number
  timestampMs: number
}

export interface CaptureOrientationEventLike {
  absolute?: boolean
  alpha?: number | null
  webkitCompassHeading?: number | null
}

export interface CaptureGpsHeadingSample {
  heading: RawGpsSample['heading']
  speed: RawGpsSample['speed']
  timestamp: RawGpsSample['timestamp']
}

export interface ResolveCaptureDirectionInput {
  deviceSupport: CaptureDeviceOrientationSupport
  permission: CaptureDeviceOrientationPermission
  deviceHeading?: CaptureDeviceFacingSignal | null
  gpsHeading?: number | null
  nowMs: number
  orientationEventSeen?: boolean
}

export interface CaptureDirectionResolution {
  status: CaptureDirectionStatus
  source: CaptureDirectionSource
  heading: number | null
}

export interface CaptureDirectionGeoJson {
  arrow: GeoJSON.FeatureCollection<GeoJSON.Point, GeoJSON.GeoJsonProperties>
}

export interface CaptureHeadingSmoothingOptions {
  smoothingFactor?: number
  deadbandDegrees?: number
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isFresh(timestampMs: number, nowMs: number, maxAgeMs: number): boolean {
  if (!isFiniteNumber(timestampMs) || !isFiniteNumber(nowMs)) return false
  const age = nowMs - timestampMs
  return age >= 0 && age <= maxAgeMs
}

export function normalizeCaptureHeading(degrees: number | null | undefined): number | null {
  if (!isFiniteNumber(degrees)) return null
  const normalized = degrees % 360
  return normalized < 0 ? normalized + 360 : normalized
}

export function shortestCaptureHeadingDelta(fromDegrees: number, toDegrees: number): number | null {
  const from = normalizeCaptureHeading(fromDegrees)
  const to = normalizeCaptureHeading(toDegrees)
  if (from === null || to === null) return null
  return ((to - from + 540) % 360) - 180
}

export function smoothCaptureHeading(
  currentDegrees: number | null | undefined,
  targetDegrees: number | null | undefined,
  options: CaptureHeadingSmoothingOptions = {},
): number | null {
  const target = normalizeCaptureHeading(targetDegrees)
  if (target === null) return null

  const current = normalizeCaptureHeading(currentDegrees)
  if (current === null) return target

  const delta = shortestCaptureHeadingDelta(current, target)
  if (delta === null) return null

  const deadband = isFiniteNumber(options.deadbandDegrees)
    ? Math.max(0, options.deadbandDegrees)
    : CAPTURE_HEADING_DEADBAND_DEGREES
  if (Math.abs(delta) <= deadband) return current

  const smoothingFactor = isFiniteNumber(options.smoothingFactor)
    ? Math.min(1, Math.max(0, options.smoothingFactor))
    : CAPTURE_HEADING_SMOOTHING_FACTOR
  return normalizeCaptureHeading(current + delta * smoothingFactor)
}

export function readCaptureDeviceFacingHeading(event: CaptureOrientationEventLike): number | null {
  if (isFiniteNumber(event.webkitCompassHeading)) {
    return normalizeCaptureHeading(event.webkitCompassHeading)
  }

  if (event.absolute !== true || !isFiniteNumber(event.alpha)) return null
  return normalizeCaptureHeading(360 - event.alpha)
}

export function getReliableCaptureGpsHeading(sample: CaptureGpsHeadingSample, nowMs: number): number | null {
  const timestampMs = Date.parse(sample.timestamp)
  if (!isFresh(timestampMs, nowMs, CAPTURE_GPS_HEADING_MAX_AGE_MS)) return null
  if (!isFiniteNumber(sample.speed) || sample.speed < CAPTURE_GPS_HEADING_MIN_SPEED_MPS) return null
  return normalizeCaptureHeading(sample.heading)
}

function getReliableDeviceHeading(signal: CaptureDeviceFacingSignal | null | undefined, nowMs: number): number | null {
  if (!signal || !isFresh(signal.timestampMs, nowMs, CAPTURE_DEVICE_HEADING_MAX_AGE_MS)) return null
  return normalizeCaptureHeading(signal.heading)
}

function getNormalizedHeading(heading: number | null | undefined): number | null {
  return normalizeCaptureHeading(heading)
}

function fallbackResolution(gpsHeading: number | null, noGpsStatus: CaptureDirectionStatus): CaptureDirectionResolution {
  if (gpsHeading !== null) return { status: 'gps-fallback', source: 'gps', heading: gpsHeading }
  return { status: noGpsStatus, source: 'none', heading: null }
}

export function resolveCaptureDirection(input: ResolveCaptureDirectionInput): CaptureDirectionResolution {
  const deviceHeading = getReliableDeviceHeading(input.deviceHeading, input.nowMs)
  const gpsHeading = getNormalizedHeading(input.gpsHeading)

  if ((input.deviceSupport === 'supported' || input.deviceSupport === 'permission-required') && input.permission === 'granted' && deviceHeading !== null) {
    return { status: 'available', source: 'device', heading: deviceHeading }
  }

  if (input.deviceSupport === 'permission-required' && input.permission === 'unknown') {
    if (gpsHeading !== null) return { status: 'permission-required', source: 'gps', heading: gpsHeading }
    return { status: 'permission-required', source: 'none', heading: null }
  }

  if (input.deviceSupport === 'unsupported') {
    return fallbackResolution(gpsHeading, 'unsupported')
  }

  if (input.permission === 'denied') {
    return fallbackResolution(gpsHeading, 'denied')
  }

  if (gpsHeading !== null) {
    return { status: 'gps-fallback', source: 'gps', heading: gpsHeading }
  }

  if (input.orientationEventSeen) {
    return { status: 'unreliable', source: 'none', heading: null }
  }

  return { status: 'location-only', source: 'none', heading: null }
}

export function buildCaptureDirectionGeoJson(position: CaptureCoordinate, heading: number | null): CaptureDirectionGeoJson {
  return {
    arrow: buildPassiveLocationArrowGeoJson(position, heading, 'capture-direction-arrow'),
  }
}
