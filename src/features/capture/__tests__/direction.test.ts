import { describe, expect, it } from 'vitest'
import {
  buildCaptureDirectionGeoJson,
  getReliableCaptureGpsHeading,
  normalizeCaptureHeading,
  readCaptureDeviceFacingHeading,
  resolveCaptureDirection,
  shortestCaptureHeadingDelta,
  smoothCaptureHeading,
} from '../direction'

describe('Capture direction contracts', () => {
  it('normalizes finite headings into the map bearing range', () => {
    expect(normalizeCaptureHeading(360)).toBe(0)
    expect(normalizeCaptureHeading(-90)).toBe(270)
    expect(normalizeCaptureHeading(720)).toBe(0)
    expect(normalizeCaptureHeading(Number.NaN)).toBeNull()
    expect(normalizeCaptureHeading(Number.POSITIVE_INFINITY)).toBeNull()
  })

  it('uses shortest circular deltas and smooths across the 0/360 boundary', () => {
    expect(shortestCaptureHeadingDelta(350, 10)).toBe(20)
    expect(shortestCaptureHeadingDelta(10, 350)).toBe(-20)

    const smoothed = smoothCaptureHeading(359, 1, { smoothingFactor: 0.5, deadbandDegrees: 0 })
    expect(smoothed).toBe(0)
    expect(smoothed).not.toBeCloseTo(180, 0)
  })

  it('suppresses tiny circular jitter but follows a meaningful turn', () => {
    expect(smoothCaptureHeading(90, 90.5, { smoothingFactor: 0.5, deadbandDegrees: 1 })).toBe(90)

    const meaningful = smoothCaptureHeading(90, 100, { smoothingFactor: 0.5, deadbandDegrees: 1 })
    expect(meaningful).toBe(95)
  })

  it('reads absolute device-facing heading without accepting relative alpha', () => {
    expect(readCaptureDeviceFacingHeading({
      absolute: true,
      alpha: 90,
    })).toBe(270)

    expect(readCaptureDeviceFacingHeading({
      absolute: false,
      alpha: 90,
    })).toBeNull()

    expect(readCaptureDeviceFacingHeading({
      absolute: false,
      alpha: 90,
      webkitCompassHeading: 135,
    })).toBe(135)
  })

  it('accepts GPS movement heading only while moving and while fresh', () => {
    expect(getReliableCaptureGpsHeading({
      heading: 90,
      speed: 1,
      timestamp: '2026-09-01T00:00:00.000Z',
    }, Date.parse('2026-09-01T00:00:05.000Z'))).toBe(90)

    expect(getReliableCaptureGpsHeading({
      heading: 90,
      speed: 0.1,
      timestamp: '2026-09-01T00:00:00.000Z',
    }, Date.parse('2026-09-01T00:00:05.000Z'))).toBeNull()

    expect(getReliableCaptureGpsHeading({
      heading: 90,
      speed: 1,
      timestamp: '2026-09-01T00:00:00.000Z',
    }, Date.parse('2026-09-01T00:00:20.000Z'))).toBeNull()
  })

  it('prefers device-facing heading, then GPS fallback, then location-only states', () => {
    expect(resolveCaptureDirection({
      deviceSupport: 'supported',
      permission: 'granted',
      deviceHeading: { heading: 45, timestampMs: 1_000 },
      gpsHeading: 90,
      nowMs: 1_500,
      orientationEventSeen: true,
    })).toEqual({ status: 'available', source: 'device', heading: 45 })

    expect(resolveCaptureDirection({
      deviceSupport: 'supported',
      permission: 'granted',
      gpsHeading: 90,
      nowMs: 1_500,
      orientationEventSeen: true,
    })).toEqual({ status: 'gps-fallback', source: 'gps', heading: 90 })

    expect(resolveCaptureDirection({
      deviceSupport: 'unsupported',
      permission: 'unknown',
      nowMs: 1_500,
    })).toEqual({ status: 'unsupported', source: 'none', heading: null })

    expect(resolveCaptureDirection({
      deviceSupport: 'supported',
      permission: 'denied',
      nowMs: 1_500,
    })).toEqual({ status: 'denied', source: 'none', heading: null })

    expect(resolveCaptureDirection({
      deviceSupport: 'supported',
      permission: 'granted',
      deviceHeading: { heading: Number.NaN, timestampMs: 1_000 },
      gpsHeading: 180,
      nowMs: 1_500,
      orientationEventSeen: true,
    })).toEqual({ status: 'gps-fallback', source: 'gps', heading: 180 })
  })

  it('reports permission-required without prompting and can retain a GPS fallback', () => {
    expect(resolveCaptureDirection({
      deviceSupport: 'permission-required',
      permission: 'unknown',
      gpsHeading: 180,
      nowMs: 1_500,
    })).toEqual({ status: 'permission-required', source: 'gps', heading: 180 })
  })

  it('builds one finite geographic arrow point anchored at the display coordinate', () => {
    const geoJson = buildCaptureDirectionGeoJson({ latitude: 11.8, longitude: 122.1 }, 90)

    const result = geoJson as unknown as Record<string, unknown>
    expect(result).toHaveProperty('arrow')
    expect(result).not.toHaveProperty('glow')
    if (!('arrow' in result)) return

    const arrow = result.arrow as GeoJSON.FeatureCollection<GeoJSON.Point, GeoJSON.GeoJsonProperties>
    expect(arrow.features).toHaveLength(1)
    expect(arrow.features[0].geometry.type).toBe('Point')
    expect(arrow.features[0].geometry.coordinates).toEqual([122.1, 11.8])
    expect(arrow.features[0].properties).toEqual({ kind: 'capture-direction-arrow', heading: 90 })
    expect(result).not.toHaveProperty('cone')
    expect(JSON.stringify(geoJson)).not.toMatch(/NaN|Infinity/)

    const empty = buildCaptureDirectionGeoJson({ latitude: 11.8, longitude: 122.1 }, null)
    const emptyResult = empty as unknown as Record<string, unknown>
    expect(emptyResult).toHaveProperty('arrow')
    if (!('arrow' in emptyResult)) return
    expect((emptyResult.arrow as GeoJSON.FeatureCollection).features).toHaveLength(0)
  })

  it('normalizes the arrow heading without mutating raw display-only inputs', () => {
    const rawPoints = [
      { latitude: 11.8, longitude: 122.1 },
      { latitude: 11.8001, longitude: 122.1001 },
    ]
    const markers = [{ latitude: 11.8, longitude: 122.1 }]
    const rawBefore = structuredClone(rawPoints)
    const markersBefore = structuredClone(markers)
    const geoJson = buildCaptureDirectionGeoJson(rawPoints[0], -90)

    expect(rawPoints).toEqual(rawBefore)
    expect(markers).toEqual(markersBefore)
    const result = geoJson as unknown as { arrow?: GeoJSON.FeatureCollection<GeoJSON.Point> }
    expect(result.arrow).toBeDefined()
    if (!result.arrow) return
    expect(result.arrow.features[0].geometry.coordinates).toEqual([122.1, 11.8])
    expect(result.arrow.features[0].properties?.heading).toBe(270)
    expect(JSON.stringify(geoJson)).not.toMatch(/NaN|Infinity/)
  })

  it('keeps one geographic heading property so Heading-Up camera rotation does not double-rotate the arrow', () => {
    const geoJson = buildCaptureDirectionGeoJson({ latitude: 11.8, longitude: 122.1 }, 90)
    const result = geoJson as unknown as { arrow?: GeoJSON.FeatureCollection<GeoJSON.Point> }
    expect(result.arrow).toBeDefined()
    if (!result.arrow) return
    expect(result.arrow.features[0].properties?.heading).toBe(90)
  })
})
