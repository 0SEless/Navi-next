import { describe, it, expect } from 'vitest'
import type { LatLng } from '@navi/core'
import {
  computeTwoPointAlignment,
  frameLocalToImagePixel,
  imagePixelToFrameLocal,
  validatePlanPoints,
  validateMapPoints,
  screenToImagePixel,
  screenToBuildingLocal,
} from '../two-point-calibration'
import { getFootprintFrameMeters, latLngToLocalMeters, transformLocalPoint } from '../floor-plan-transform'
import type { Point2D } from '../two-point-calibration'

const imageSize = { width: 1000, height: 500 }
const frame = { width: 20, height: 10 }

function makeFootprint(): LatLng[] {
  const center = { lat: 14, lng: 121 }
  const metersPerLat = 6371000 * Math.PI / 180
  const metersPerLng = metersPerLat * Math.cos(center.lat * Math.PI / 180)
  return [
    { lat: center.lat + 5 / metersPerLat, lng: center.lng - 10 / metersPerLng },
    { lat: center.lat + 5 / metersPerLat, lng: center.lng + 10 / metersPerLng },
    { lat: center.lat - 5 / metersPerLat, lng: center.lng + 10 / metersPerLng },
    { lat: center.lat - 5 / metersPerLat, lng: center.lng - 10 / metersPerLng },
  ]
}

describe('Two-Point Calibration Math', () => {
  it('computes canonical axis scales and offset from a horizontal pair', () => {
    const result = computeTwoPointAlignment([[100, 250], [900, 250]], [[-8, 0], [8, 0]], imageSize, frame)

    expect(result.scaleX).toBeCloseTo(1, 6)
    expect(result.scaleY).toBeCloseTo(1, 6)
    expect(result.rotation).toBe(0)
    expect(result.offset).toEqual({ x: 0, y: 0 })
  })

  it('keeps the same canonical transform when point order is reversed', () => {
    const forward = computeTwoPointAlignment([[100, 250], [900, 250]], [[-8, 0], [8, 0]], imageSize, frame)
    const reverse = computeTwoPointAlignment([[900, 250], [100, 250]], [[8, 0], [-8, 0]], imageSize, frame)

    expect(reverse).toEqual(forward)
  })

  it('uses clockwise rotation and never writes the legacy pixel scale', () => {
    const result = computeTwoPointAlignment([[100, 250], [900, 250]], [[0, 8], [0, -8]], imageSize, frame)

    expect(result.rotation).toBeCloseTo(90, 4)
    expect(result.scaleX).toBeCloseTo(1, 6)
    expect(result.scaleY).toBeCloseTo(1, 6)
    expect(result).not.toHaveProperty('scale')
  })

  it('derives physical scale from the frame, not raw source pixels', () => {
    const result = computeTwoPointAlignment([[250, 250], [750, 250]], [[-10, 0], [10, 0]], imageSize, frame)

    expect(result.scaleX).toBeCloseTo(2, 6)
    expect(result.scaleY).toBeCloseTo(2, 6)
  })

  it('computes translation for a non-zero source origin', () => {
    const result = computeTwoPointAlignment([[500, 250], [1000, 250]], [[10, 10], [20, 10]], imageSize, frame)

    expect(result.scaleX).toBeCloseTo(1, 6)
    expect(result.rotation).toBeCloseTo(0, 6)
    expect(result.offset?.x).toBeCloseTo(10, 6)
    expect(result.offset?.y).toBeCloseTo(10, 6)
  })

  it('rejects degenerate source and target pairs', () => {
    expect(() => computeTwoPointAlignment([[0, 250], [0, 250]], [[0, 0], [1, 0]], imageSize, frame)).toThrow('too close')
    expect(() => computeTwoPointAlignment([[0, 250], [100, 250]], [[0, 0], [0, 0]], imageSize, frame)).toThrow('too close')
  })

  it('round-trips source pixels through the frame conversion', () => {
    const pixel: Point2D = [125, 375]
    const local = imagePixelToFrameLocal(pixel, imageSize, frame)
    expect(frameLocalToImagePixel(local, imageSize, frame)[0]).toBeCloseTo(pixel[0], 8)
    expect(frameLocalToImagePixel(local, imageSize, frame)[1]).toBeCloseTo(pixel[1], 8)
  })

  it('validates plan points against image bounds and map points in local meters', () => {
    expect(validatePlanPoints([-1, 50], [50, 50], 200, 200)?.code).toBe('PLAN_POINT_A_OUT_OF_BOUNDS')
    expect(validatePlanPoints([50, 50], [250, 50], 200, 200)?.code).toBe('PLAN_POINT_B_OUT_OF_BOUNDS')
    expect(validateMapPoints([5, 5], [15, 5], [[0, 0], [20, 0], [20, 20], [0, 20]])).toBeNull()
    expect(validateMapPoints([5, 5], [25, 5], [[0, 0], [20, 0], [20, 20], [0, 20]])?.code).toBe('MAP_POINT_B_OUT_OF_BOUNDS')
  })
})

describe('Coordinate Conversion', () => {
  it('maps a screen point through the active transformed image back to source pixels', () => {
    const footprint = makeFootprint()
    const frameMeters = getFootprintFrameMeters(footprint)
    const alignment = { scaleX: 1.4, scaleY: 0.75, rotation: -23, offset: { x: 3, y: -2 } }
    const sourcePixel: Point2D = [750, 250]
    const sourceLocal = imagePixelToFrameLocal(sourcePixel, imageSize, frame)
    const targetLocal = transformLocalPoint(sourceLocal, alignment)
    const center = frameMeters.center
    const metersPerLat = 6371000 * Math.PI / 180
    const metersPerLng = metersPerLat * Math.cos(center.lat * Math.PI / 180)
    const target = {
      lat: center.lat + targetLocal.y / metersPerLat,
      lng: center.lng + targetLocal.x / metersPerLng,
    }
    const map = { unproject: () => target }
    const rect = { left: 10, top: 20 } as DOMRect

    const result = screenToImagePixel(510, 420, map, rect, footprint, imageSize.width, imageSize.height, alignment)

    expect(result[0]).toBeCloseTo(sourcePixel[0], 5)
    expect(result[1]).toBeCloseTo(sourcePixel[1], 5)
  })

  it('converts geographic deltas to true local meters using degrees-to-radians', () => {
    const centroid: Point2D = [121, 14]
    const map = { unproject: () => ({ lng: 121.001, lat: 14.001 }) }
    const rect = { left: 0, top: 0 } as DOMRect

    const result = screenToBuildingLocal(500, 400, map, rect, centroid)

    expect(result[0]).toBeCloseTo(107.9, 0)
    expect(result[1]).toBeCloseTo(111.2, 0)
  })

  it('uses a de-duplicated footprint center when converting map clicks', () => {
    const footprint = makeFootprint()
    const center = getFootprintFrameMeters(footprint).center
    const map = { unproject: () => center }
    const result = screenToBuildingLocal(0, 0, map, { left: 0, top: 0 } as DOMRect, [0, 0], [...footprint, footprint[0]])

    expect(result).toEqual([0, 0])
    expect(latLngToLocalMeters(center, center)).toEqual({ x: 0, y: 0 })
  })
})
