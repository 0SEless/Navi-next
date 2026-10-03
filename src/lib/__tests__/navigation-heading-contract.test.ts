import { describe, expect, it } from 'vitest'
import {
  getReliableCaptureGpsHeading,
  resolveCaptureDirection,
  smoothCaptureHeading,
} from '@/features/capture/direction'

describe('navigation heading contract', () => {
  it('takes the short path when the heading crosses north', () => {
    expect(smoothCaptureHeading(359, 1, { smoothingFactor: 0.5, deadbandDegrees: 0 })).toBe(0)
  })

  it('rejects slow or stale GPS course samples', () => {
    const sample = {
      heading: 180,
      speed: 0.4,
      timestamp: '2026-09-06T00:00:00.000Z',
    }

    expect(getReliableCaptureGpsHeading(sample, Date.parse('2026-09-06T00:00:05.000Z'))).toBeNull()
    expect(getReliableCaptureGpsHeading({ ...sample, speed: 1 }, Date.parse('2026-09-06T00:00:20.000Z'))).toBeNull()
  })

  it('falls back from stale device orientation to a valid GPS course', () => {
    expect(resolveCaptureDirection({
      deviceSupport: 'supported',
      permission: 'granted',
      deviceHeading: { heading: 90, timestampMs: 0 },
      gpsHeading: 180,
      nowMs: 4_000,
      orientationEventSeen: true,
    })).toEqual({ status: 'gps-fallback', source: 'gps', heading: 180 })
  })

  it('returns an explicit no-heading resolution when every source is unavailable', () => {
    expect(resolveCaptureDirection({
      deviceSupport: 'unsupported',
      permission: 'unknown',
      nowMs: 1_000,
    })).toEqual({ status: 'unsupported', source: 'none', heading: null })
  })
})
