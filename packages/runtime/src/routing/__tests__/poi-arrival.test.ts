import { describe, expect, it } from 'vitest'
import type { POI } from '@navi/core'
import {
  distanceToPoiGeometry,
  isPoiArrival,
  POI_ARRIVAL_TOLERANCE_METERS,
} from '../poi-arrival'

const METERS_PER_DEGREE = 111_320

function eastMeters(meters: number) {
  return { lat: 0, lng: meters / METERS_PER_DEGREE }
}

function poi(overrides: Partial<POI> = {}): POI {
  return {
    id: 'poi-arrival',
    label: 'Arrival POI',
    category: 'study_area',
    position: eastMeters(0),
    properties: {},
    source: 'authored',
    sourceId: 'poi-arrival',
    ...overrides,
  }
}

describe('Phase 4D POI arrival geometry contract', () => {
  it('centralizes a bounded 15 meter tolerance', () => {
    expect(POI_ARRIVAL_TOLERANCE_METERS).toBe(15)
    expect(isPoiArrival(eastMeters(15), poi(), {})).toBe(true)
    expect(isPoiArrival(eastMeters(15.1), poi(), {})).toBe(false)
  })

  it('supports legacy position-only and explicit Point POIs', () => {
    expect(isPoiArrival(eastMeters(10), poi(), {})).toBe(true)
    expect(isPoiArrival(eastMeters(20), poi(), {})).toBe(false)
    expect(isPoiArrival(eastMeters(10), poi({
      geometry: { type: 'point', position: eastMeters(40) },
    }), {})).toBe(false)
  })

  it('uses Circle radius plus tolerance instead of requiring the center', () => {
    const target = poi({
      position: eastMeters(100),
      geometry: { type: 'circle', center: eastMeters(100), radius: 40 },
    })
    expect(isPoiArrival(eastMeters(130), target, {})).toBe(true)
    expect(isPoiArrival(eastMeters(155), target, {})).toBe(true)
    expect(isPoiArrival(eastMeters(160.1), target, {})).toBe(false)
    expect(distanceToPoiGeometry(eastMeters(130), target)).toBe(0)
  })

  it('arrives inside or near the boundary of a Rectangle', () => {
    const target = poi({
      position: eastMeters(100),
      geometry: {
        type: 'rectangle',
        points: [
          { lat: -20 / METERS_PER_DEGREE, lng: 80 / METERS_PER_DEGREE },
          { lat: -20 / METERS_PER_DEGREE, lng: 120 / METERS_PER_DEGREE },
          { lat: 20 / METERS_PER_DEGREE, lng: 120 / METERS_PER_DEGREE },
          { lat: 20 / METERS_PER_DEGREE, lng: 80 / METERS_PER_DEGREE },
        ],
      },
    })
    expect(isPoiArrival(eastMeters(100), target, {})).toBe(true)
    expect(isPoiArrival(eastMeters(130), target, {})).toBe(true)
    expect(isPoiArrival(eastMeters(140.1), target, {})).toBe(false)
  })

  it('arrives inside or near the boundary of an open Polygon ring', () => {
    const target = poi({
      position: eastMeters(100),
      geometry: {
        type: 'polygon',
        points: [
          { lat: -20 / METERS_PER_DEGREE, lng: 80 / METERS_PER_DEGREE },
          { lat: -20 / METERS_PER_DEGREE, lng: 120 / METERS_PER_DEGREE },
          { lat: 20 / METERS_PER_DEGREE, lng: 120 / METERS_PER_DEGREE },
          { lat: 20 / METERS_PER_DEGREE, lng: 80 / METERS_PER_DEGREE },
        ],
      },
    })
    expect(isPoiArrival(eastMeters(100), target, {})).toBe(true)
    expect(isPoiArrival(eastMeters(130), target, {})).toBe(true)
    expect(isPoiArrival(eastMeters(140.1), target, {})).toBe(false)
  })

  it('requires matching building and floor context for indoor POIs', () => {
    const target = poi({
      buildingId: 'building-a',
      floor: 2,
      geometry: { type: 'point', position: eastMeters(0) },
    })
    expect(isPoiArrival(eastMeters(0), target, { buildingId: 'building-a', floor: 2 })).toBe(true)
    expect(isPoiArrival(eastMeters(0), target, { buildingId: 'building-a', floor: 1 })).toBe(false)
    expect(isPoiArrival(eastMeters(0), target, { buildingId: 'building-b', floor: 2 })).toBe(false)
    expect(isPoiArrival(eastMeters(0), target, {})).toBe(false)
  })

  it('fails safely for malformed geometry and invalid positions', () => {
    expect(isPoiArrival(eastMeters(0), poi({
      geometry: { type: 'polygon', points: [{ lat: 0, lng: 0 }, { lat: 0, lng: 0 }] },
    }), {})).toBe(false)
    expect(distanceToPoiGeometry({ lat: Number.NaN, lng: 0 }, poi())).toBeNull()
  })
})
