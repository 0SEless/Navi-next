import { describe, expect, it } from 'vitest'
import { localRectangleFromDrag, normalizeLocalRectangle, rectangleCenter, resizeRectangleFootprint, rotateRectangleFootprint } from './rectangle-authoring'

describe('shared rectangle authoring contract', () => {
  it('normalizes drag direction and returns a stable corner order', () => {
    expect(normalizeLocalRectangle({ x: 8, y: 4 }, { x: 2, y: 1 })).toEqual({ min: { x: 2, y: 1 }, max: { x: 8, y: 4 } })
    expect(localRectangleFromDrag({ x: 8, y: 4 }, { x: 2, y: 1 })).toEqual([
      { x: 2, y: 1 }, { x: 8, y: 1 }, { x: 8, y: 4 }, { x: 2, y: 4 },
    ])
  })

  it('moves one rectangle corner while preserving the opposite corner and right angles', () => {
    const points = localRectangleFromDrag({ x: 0, y: 0 }, { x: 4, y: 2 })
    const resized = resizeRectangleFootprint(points, 2, { x: 8, y: 4 })
    expect(resized).toEqual([{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 4 }, { x: 0, y: 4 }])
  })

  it('rotates a rectangle around its center without changing identity or size', () => {
    const points = localRectangleFromDrag({ x: 0, y: 0 }, { x: 4, y: 2 })
    const rotated = rotateRectangleFootprint(points, Math.PI / 2)
    expect(rectangleCenter(rotated)).toEqual({ x: 2, y: 1 })
    expect(rotated[0].x).toBeCloseTo(3)
    expect(rotated[0].y).toBeCloseTo(-1)
    expect(Math.hypot(rotated[1].x - rotated[0].x, rotated[1].y - rotated[0].y)).toBeCloseTo(4)
  })
})
