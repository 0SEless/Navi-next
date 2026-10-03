import { describe, expect, it } from 'vitest'
import type { PointOfInterest, PointOfInterestGeometry, WorldPOIGeometry } from '@navi/core'
import {
  getPointOfInterestPosition,
  getWorldPointOfInterestRepresentative,
  isOutdoorPointOfInterest,
  resolvePointOfInterestGeometry,
  validatePointOfInterestGeometry,
  validateWorldPointOfInterestGeometry,
} from '@navi/core'

const point = (x: number, y: number) => ({ x, y })
const latLng = (lat: number, lng: number) => ({ lat, lng })

describe('Phase 3B POI geometry contract', () => {
  it('resolves legacy and explicit point records without mutating their stored representation', () => {
    const legacy: PointOfInterest = {
      id: 'poi-legacy',
      name: 'Legacy Marker',
      category: 'other',
      position: point(4, -2),
    }
    const explicit: PointOfInterest = {
      id: 'poi-explicit',
      name: 'Explicit Marker',
      category: 'other',
      geometry: { type: 'point', position: point(8, 3) },
    }

    expect(resolvePointOfInterestGeometry(legacy)).toEqual({ type: 'point', position: point(4, -2) })
    expect(getPointOfInterestPosition(legacy)).toEqual(point(4, -2))
    expect(legacy).not.toHaveProperty('geometry')

    expect(resolvePointOfInterestGeometry(explicit)).toEqual(explicit.geometry)
    expect(getPointOfInterestPosition(explicit)).toEqual(point(8, 3))
    expect(explicit).not.toHaveProperty('position')
  })

  it.each([
    { type: 'point', position: point(1, 2) },
    { type: 'circle', center: point(1, 2), radius: 2.5 },
    { type: 'rectangle', min: point(-2, -1), max: point(3, 4) },
    { type: 'polygon', points: [point(0, 0), point(5, 0), point(5, 3), point(0, 3)] },
  ] satisfies PointOfInterestGeometry[])('accepts valid $type geometry in local coordinates', (geometry) => {
    expect(validatePointOfInterestGeometry(geometry)).toEqual({ valid: true })
  })

  it.each([
    { type: 'circle', center: point(0, 0), radius: 0 },
    { type: 'circle', center: point(0, 0), radius: -1 },
    { type: 'circle', center: point(Number.NaN, 0), radius: 1 },
    { type: 'circle', center: point(0, Number.POSITIVE_INFINITY), radius: 1 },
    { type: 'rectangle', min: point(0, 0), max: point(0, 2) },
    { type: 'rectangle', min: point(2, 2), max: point(1, 3) },
    { type: 'rectangle', min: point(0, 0), max: point(Number.NaN, 2) },
    { type: 'polygon', points: [point(0, 0), point(1, 1)] },
    { type: 'polygon', points: [point(0, 0), point(1, 1), point(2, 2)] },
    { type: 'polygon', points: [point(0, 0), point(Number.POSITIVE_INFINITY, 0), point(0, 1)] },
  ])('rejects invalid geometry %#', (geometry) => {
    const result = validatePointOfInterestGeometry(geometry)
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.error).toBeTruthy()
  })

  it('preserves polygon point order and treats the ring as implicitly closed', () => {
    const geometry: PointOfInterestGeometry = {
      type: 'polygon',
      points: [point(2, 1), point(6, 1), point(5, 5), point(1, 4)],
    }

    expect(validatePointOfInterestGeometry(geometry)).toEqual({ valid: true })
    expect(resolvePointOfInterestGeometry({
      id: 'poi-polygon',
      name: 'Polygon POI',
      category: 'other',
      geometry,
    })).toEqual(geometry)
  })
})

describe('Outdoor POI world geometry contract', () => {
  it.each([
    { type: 'point', position: latLng(25.6328, 122.9278) },
    { type: 'circle', center: latLng(25.6328, 122.9278), radius: 12.5 },
    {
      type: 'rectangle',
      points: [latLng(25.632, 122.927), latLng(25.632, 122.928), latLng(25.633, 122.928), latLng(25.633, 122.927)],
    },
    {
      type: 'polygon',
      points: [latLng(25.632, 122.927), latLng(25.633, 122.927), latLng(25.633, 122.928), latLng(25.632, 122.928)],
    },
  ] satisfies WorldPOIGeometry[])('accepts valid $type world geometry', (geometry) => {
    expect(validateWorldPointOfInterestGeometry(geometry)).toEqual({ valid: true })
  })

  it.each([
    { type: 'point', position: latLng(Number.NaN, 122.9) },
    { type: 'point', position: latLng(95, 122.9) },
    { type: 'circle', center: latLng(25.6, 122.9), radius: 0 },
    { type: 'circle', center: latLng(25.6, 122.9), radius: -2 },
    { type: 'rectangle', points: [latLng(25.6, 122.9), latLng(25.6, 122.91), latLng(25.61, 122.91)] },
    { type: 'rectangle', points: [latLng(25.6, 122.9), latLng(25.6, 122.91), latLng(25.6, 122.91), latLng(25.6, 122.9)] },
    { type: 'polygon', points: [latLng(25.6, 122.9), latLng(25.61, 122.9)] },
    { type: 'polygon', points: [latLng(25.6, 122.9), latLng(25.61, 122.9), latLng(25.6, 122.9)] },
    {
      type: 'polygon',
      points: [latLng(25.6, 122.9), latLng(25.61, 122.9), latLng(25.62, 122.9)],
    },
  ])('rejects invalid world geometry %#', (geometry) => {
    const result = validateWorldPointOfInterestGeometry(geometry)
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.error).toBeTruthy()
  })

  it('resolves deterministic representatives for every world geometry kind', () => {
    expect(getWorldPointOfInterestRepresentative({ type: 'point', position: latLng(1, 2) })).toEqual(latLng(1, 2))
    expect(getWorldPointOfInterestRepresentative({ type: 'circle', center: latLng(3, 4), radius: 5 })).toEqual(latLng(3, 4))
    expect(getWorldPointOfInterestRepresentative({
      type: 'rectangle',
      points: [latLng(0, 0), latLng(0, 2), latLng(2, 2), latLng(2, 0)],
    })).toEqual(latLng(1, 1))
    const polygonCentroid = getWorldPointOfInterestRepresentative({
      type: 'polygon',
      points: [latLng(0, 0), latLng(0, 4), latLng(4, 4), latLng(4, 0)],
    })
    expect(polygonCentroid.lat).toBeCloseTo(2, 6)
    expect(polygonCentroid.lng).toBeCloseTo(2, 6)
  })

  it('identifies outdoor records by scope while indoor records stay unchanged', () => {
    expect(isOutdoorPointOfInterest({
      id: 'poi-guard-post',
      name: 'Guard Post',
      category: 'other',
      scope: 'outdoor',
      geometry: { type: 'point', position: latLng(1, 2) },
    })).toBe(true)
    expect(isOutdoorPointOfInterest({
      id: 'poi-indoor',
      name: 'Printer',
      category: 'printer',
      position: point(1, 2),
    })).toBe(false)
  })
})
