import { haversine } from '@/engine/geo-utils'
import type { CaptureSession, RawGpsSample } from './types'

export const CAPTURE_ACCURACY_THRESHOLDS = {
  goodMaximumMeters: 10,
  fairMaximumMeters: 25,
} as const

export type CaptureAccuracyQuality = 'good' | 'fair' | 'poor' | 'unknown'
export type CaptureGpsReadiness = 'acquiring' | 'ready' | 'poor' | 'unknown'

function isValidCoordinate(sample: Pick<RawGpsSample, 'latitude' | 'longitude'>): boolean {
  return Number.isFinite(sample.latitude)
    && Number.isFinite(sample.longitude)
    && sample.latitude >= -90
    && sample.latitude <= 90
    && sample.longitude >= -180
    && sample.longitude <= 180
}

function parseTimestamp(value: string | undefined): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function calculateCaptureDistanceMeters(samples: RawGpsSample[]): number {
  const validSamples = samples.filter(isValidCoordinate)
  let total = 0

  for (let index = 1; index < validSamples.length; index += 1) {
    const previous = validSamples[index - 1]
    const current = validSamples[index]
    const segment = haversine(
      { lat: previous.latitude, lng: previous.longitude },
      { lat: current.latitude, lng: current.longitude },
    )
    if (Number.isFinite(segment) && segment >= 0) total += segment
  }

  return Number.isFinite(total) && total >= 0 ? total : 0
}

export function classifyCaptureAccuracy(accuracy: number | null | undefined): CaptureAccuracyQuality {
  if (typeof accuracy !== 'number' || !Number.isFinite(accuracy) || accuracy < 0) return 'unknown'
  if (accuracy <= CAPTURE_ACCURACY_THRESHOLDS.goodMaximumMeters) return 'good'
  if (accuracy <= CAPTURE_ACCURACY_THRESHOLDS.fairMaximumMeters) return 'fair'
  return 'poor'
}

export function getCaptureGpsReadiness(sample: Pick<RawGpsSample, 'accuracy'> | null | undefined): CaptureGpsReadiness {
  if (!sample) return 'acquiring'
  const quality = classifyCaptureAccuracy(sample.accuracy)
  if (quality === 'good' || quality === 'fair') return 'ready'
  if (quality === 'poor') return 'poor'
  return 'unknown'
}

export function formatCaptureDistance(meters: number): string {
  const safeMeters = Number.isFinite(meters) && meters >= 0 ? meters : 0
  return safeMeters >= 1000 ? `${(safeMeters / 1000).toFixed(2)} km` : `${Math.round(safeMeters)} m`
}

export function formatCaptureDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Number.isFinite(durationMs) ? Math.floor(durationMs / 1000) : 0)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours === 0) return [minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':')
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':')
}

export function getActiveCaptureDurationMs(session: CaptureSession, nowMs = Date.now()): number {
  if (session.status === 'preparing') return 0
  const startedAt = parseTimestamp(session.startedAt)
  if (startedAt === null) return 0

  const fallbackNow = Number.isFinite(nowMs) ? nowMs : Date.now()
  const finishedAt = session.status === 'finished' ? parseTimestamp(session.finishedAt) : null
  const endAt = finishedAt ?? fallbackNow
  const pausedDurationMs = typeof session.pausedDurationMs === 'number'
    && Number.isFinite(session.pausedDurationMs)
    && session.pausedDurationMs >= 0
    ? session.pausedDurationMs
    : 0
  const openPauseStartedAt = session.status === 'paused' ? parseTimestamp(session.pauseStartedAt) : null
  const openPauseDurationMs = openPauseStartedAt === null ? 0 : Math.max(0, endAt - openPauseStartedAt)

  return Math.max(0, endAt - startedAt - pausedDurationMs - openPauseDurationMs)
}
