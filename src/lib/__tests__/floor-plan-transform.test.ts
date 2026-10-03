import { describe, expect, it } from 'vitest'
import type { LatLng } from '@navi/core'
import {
  getFootprintFrameMeters,
  getPlanDimensionsMeters,
  inverseTransformLocalPoint,
  resolvePlanAlignment,
  transformLocalPoint,
} from '../floor-plan-transform'

const R = 6371000
const DEG_TO_RAD = Math.PI / 180

function makeFootprint(closed: boolean): LatLng[] {
  const center = { lat: 14, lng: 121 }
  const metersPerLat = R * DEG_TO_RAD
  const metersPerLng = metersPerLat * Math.cos(center.lat * DEG_TO_RAD)
  const points: LatLng[] = [
    { lat: center.lat + 5 / metersPerLat, lng: center.lng - 10 / metersPerLng },
    { lat: center.lat + 5 / metersPerLat, lng: center.lng + 10 / metersPerLng },
    { lat: center.lat - 5 / metersPerLat, lng: center.lng + 10 / metersPerLng },
    { lat: center.lat - 5 / metersPerLat, lng: center.lng - 10 / metersPerLng },
  ]
  return closed ? [...points, points[0]] : points
}

describe('floor-plan transform authority', () => {
  it('resolves explicit axes ahead of legacy scale and supplies safe defaults', () => {
    expect(resolvePlanAlignment({ scale: 3, scaleX: 2 })).toEqual({
      offset: { x: 0, y: 0 },
      scaleX: 2,
      scaleY: 3,
      rotation: 0,
      opacity: 0.7,
      locked: false,
    })
  })

  it('normalizes invalid optional values without producing non-finite output', () => {
    const resolved = resolvePlanAlignment({
      offset: { x: Number.NaN, y: Number.POSITIVE_INFINITY },
      scale: 0,
      scaleX: -2,
      scaleY: Number.NaN,
      rotation: Number.POSITIVE_INFINITY,
      opacity: 4,
    })
    expect(resolved.offset).toEqual({ x: 0, y: 0 })
    expect(resolved.scaleX).toBe(1)
    expect(resolved.scaleY).toBe(1)
    expect(resolved.rotation).toBe(0)
    expect(resolved.opacity).toBe(1)
    expect(Object.values(resolved).flatMap(value => typeof value === 'object' && value ? Object.values(value) : value))
      .not.toContain(Infinity)
  })

  it('treats open and repeated-closed footprints as the same meter frame', () => {
    const open = getFootprintFrameMeters(makeFootprint(false))
    const closed = getFootprintFrameMeters(makeFootprint(true))
    expect(closed.center).toEqual(open.center)
    expect(closed.width).toBeCloseTo(open.width, 9)
    expect(closed.height).toBeCloseTo(open.height, 9)
    expect(closed.corners).toEqual(open.corners)
  })

  it('scales in image-local axes before clockwise rotation and applies true-meter offset', () => {
    const alignment = resolvePlanAlignment({ scaleX: 2, scaleY: 0.5, rotation: 90, offset: { x: 4, y: -3 } })
    const transformed = transformLocalPoint({ x: 3, y: 2 }, alignment)
    expect(transformed.x).toBeCloseTo(5, 9)
    expect(transformed.y).toBeCloseTo(-9, 9)
  })

  it('round-trips local points through the transform and its inverse', () => {
    const alignment = resolvePlanAlignment({ scaleX: 1.8, scaleY: 0.65, rotation: -37, offset: { x: -4, y: 9 } })
    const source = { x: -6.25, y: 2.75 }
    const result = inverseTransformLocalPoint(transformLocalPoint(source, alignment), alignment)
    expect(result.x).toBeCloseTo(source.x, 9)
    expect(result.y).toBeCloseTo(source.y, 9)
  })

  it('derives physical display dimensions from the footprint frame and axis scales', () => {
    const frame = getFootprintFrameMeters(makeFootprint(false))
    const dimensions = getPlanDimensionsMeters(frame, { scaleX: 1.5, scaleY: 0.75 })
    expect(dimensions.width).toBeCloseTo(30, 6)
    expect(dimensions.height).toBeCloseTo(7.5, 6)
  })
})
