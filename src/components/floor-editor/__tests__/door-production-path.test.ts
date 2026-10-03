import { describe, expect, it } from 'vitest'
import type { Opening, Wall } from '@navi/core'
import {
  deriveDoorLineEndpoints,
  deriveDoorOrientation,
} from '@navi/editor/src/geometry/opening-position'

const horizontalWall: Wall = {
  id: 'wall-1',
  start: { x: 0, y: 0 },
  end: { x: 10, y: 0 },
  thickness: 0.15,
  height: 3.5,
}

function door(orientation?: number): Opening {
  return {
    id: 'door-1',
    type: 'door',
    wallId: horizontalWall.id,
    offset: 5,
    width: 2,
    ...(orientation !== undefined ? { orientation } : {}),
  }
}

describe('production Door direction', () => {
  it.each([
    { label: 'horizontal', a: { x: 1, y: 2 }, b: { x: 4, y: 2 }, degrees: 0 },
    { label: 'vertical', a: { x: 1, y: 2 }, b: { x: 1, y: -2 }, degrees: -90 },
    { label: 'diagonal', a: { x: -2, y: -1 }, b: { x: 1, y: 2 }, degrees: 45 },
    { label: 'reverse horizontal', a: { x: 4, y: 2 }, b: { x: 1, y: 2 }, degrees: 180 },
  ])('derives $label orientation from the original local A→B vector', ({ a, b, degrees }) => {
    expect(deriveDoorOrientation(a, b)).toBeCloseTo(degrees)
  })

  it('builds a horizontal Door LineString in local meters', () => {
    const [p1, p2] = deriveDoorLineEndpoints(door(0), horizontalWall)

    expect(p1).toEqual({ x: 4, y: 0 })
    expect(p2).toEqual({ x: 6, y: 0 })
  })

  it('builds a vertical Door LineString in local meters', () => {
    const [p1, p2] = deriveDoorLineEndpoints(door(90), horizontalWall)

    expect(p1.x).toBeCloseTo(5)
    expect(p1.y).toBeCloseTo(-1)
    expect(p2.x).toBeCloseTo(5)
    expect(p2.y).toBeCloseTo(1)
  })

  it('builds a diagonal Door LineString in local meters', () => {
    const [p1, p2] = deriveDoorLineEndpoints(door(45), horizontalWall)
    const component = Math.SQRT1_2

    expect(p1.x).toBeCloseTo(5 - component)
    expect(p1.y).toBeCloseTo(-component)
    expect(p2.x).toBeCloseTo(5 + component)
    expect(p2.y).toBeCloseTo(component)
  })

  it('uses the documented legacy wall-perpendicular direction when orientation is absent', () => {
    const [p1, p2] = deriveDoorLineEndpoints(door(), horizontalWall)

    expect(p1.x).toBeCloseTo(5)
    expect(p1.y).toBeCloseTo(-1)
    expect(p2.x).toBeCloseTo(5)
    expect(p2.y).toBeCloseTo(1)
  })
})
