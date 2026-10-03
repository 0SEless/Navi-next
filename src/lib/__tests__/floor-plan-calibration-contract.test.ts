import { describe, expect, it } from 'vitest'
import { computeTwoPointAlignment } from '../two-point-calibration'

type Point = [number, number]

function projectSourcePixel(
  pixel: Point,
  imageSize: { width: number; height: number },
  frame: { width: number; height: number },
  alignment: any,
): Point {
  const sx = alignment.scaleX ?? alignment.scale ?? 1
  const sy = alignment.scaleY ?? alignment.scale ?? 1
  const theta = ((alignment.rotation ?? 0) * Math.PI) / 180
  const local = {
    x: (pixel[0] / imageSize.width - 0.5) * frame.width * sx,
    y: (0.5 - pixel[1] / imageSize.height) * frame.height * sy,
  }
  const cos = Math.cos(theta)
  const sin = Math.sin(theta)
  return [
    local.x * cos + local.y * sin + (alignment.offset?.x ?? 0),
    -local.x * sin + local.y * cos + (alignment.offset?.y ?? 0),
  ]
}

describe('floor-plan calibration renderer contract', () => {
  it('returns canonical alignment that maps both source points to the selected local targets', () => {
    const imageSize = { width: 1000, height: 500 }
    const frame = { width: 20, height: 10 }
    const planPoints: [Point, Point] = [[100, 250], [900, 250]]
    const mapPoints: [Point, Point] = [[-8, 0], [8, 0]]

    const alignment = (computeTwoPointAlignment as any)(planPoints, mapPoints, imageSize, frame)
    const projectedA = projectSourcePixel(planPoints[0], imageSize, frame, alignment)
    const projectedB = projectSourcePixel(planPoints[1], imageSize, frame, alignment)

    expect(alignment.scaleX).toBeCloseTo(1, 6)
    expect(alignment.scaleY).toBeCloseTo(1, 6)
    expect(projectedA[0]).toBeCloseTo(mapPoints[0][0], 3)
    expect(projectedA[1]).toBeCloseTo(mapPoints[0][1], 3)
    expect(projectedB[0]).toBeCloseTo(mapPoints[1][0], 3)
    expect(projectedB[1]).toBeCloseTo(mapPoints[1][1], 3)
  })
})
