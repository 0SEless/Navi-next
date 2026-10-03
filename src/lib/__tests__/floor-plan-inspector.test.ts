import { describe, expect, it } from 'vitest'
import type { PlanAlignment } from '@navi/core'
import {
  deriveFloorPlanInspectorValues,
  resetFloorPlanAlignment,
  updateAlignmentFromInspector,
} from '../floor-plan-inspector'

const frame = { width: 30, height: 12 }

describe('floor-plan Inspector alignment authority', () => {
  it('derives displayed width and height from canonical axes', () => {
    expect(deriveFloorPlanInspectorValues(frame, { scaleX: 1.5, scaleY: 0.75 })).toMatchObject({
      width: 45,
      height: 9,
      x: 0,
      y: 0,
    })
  })

  it('updates X without changing dimensions or rotation', () => {
    const start: PlanAlignment = {
      offset: { x: 2, y: -3 }, scaleX: 1.4, scaleY: 0.8, rotation: 27, opacity: 0.4, locked: true,
    }
    const next = updateAlignmentFromInspector(frame, start, { field: 'x', value: 9, aspectRatioLocked: true })
    expect(next).toMatchObject({ offset: { x: 9, y: -3 }, scaleX: 1.4, scaleY: 0.8, rotation: 27, opacity: 0.4, locked: true })
  })

  it('updates Y without changing dimensions or rotation', () => {
    const start: PlanAlignment = { offset: { x: 2, y: -3 }, scaleX: 1.4, scaleY: 0.8, rotation: 27 }
    const next = updateAlignmentFromInspector(frame, start, { field: 'y', value: 9, aspectRatioLocked: true })
    expect(next).toMatchObject({ offset: { x: 2, y: 9 }, scaleX: 1.4, scaleY: 0.8, rotation: 27 })
  })

  it('changes width and preserves the current displayed ratio when locked', () => {
    const next = updateAlignmentFromInspector(frame, { scaleX: 1, scaleY: 1 }, { field: 'width', value: 35, aspectRatioLocked: true })
    expect(next.scaleX).toBeCloseTo(35 / 30, 9)
    expect(next.scaleY).toBeCloseTo(14 / 12, 9)
  })

  it('changes height independently when aspect lock is off', () => {
    const next = updateAlignmentFromInspector(frame, { scaleX: 1, scaleY: 1 }, { field: 'height', value: 20, aspectRatioLocked: false })
    expect(next.scaleX).toBe(1)
    expect(next.scaleY).toBeCloseTo(20 / 12, 9)
  })

  it('rejects non-finite, negative, and zero dimensions', () => {
    const start: PlanAlignment = { scaleX: 1.2, scaleY: 0.8 }
    for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(updateAlignmentFromInspector(frame, start, { field: 'width', value, aspectRatioLocked: false })).toBeNull()
    }
  })

  it('normalizes rotation and clamps opacity without touching geometry', () => {
    const start: PlanAlignment = { offset: { x: 4, y: 5 }, scaleX: 1.4, scaleY: 0.8, rotation: 12 }
    const rotated = updateAlignmentFromInspector(frame, start, { field: 'rotation', value: 540, aspectRatioLocked: true })
    const opaque = updateAlignmentFromInspector(frame, start, { field: 'opacity', value: 140, aspectRatioLocked: true })
    expect(rotated?.rotation).toBe(-180)
    expect(rotated).toMatchObject({ offset: start.offset, scaleX: 1.4, scaleY: 0.8 })
    expect(opaque?.opacity).toBe(1)
  })

  it('fits deterministically while preserving opacity and overlay lock', () => {
    expect(resetFloorPlanAlignment({ opacity: 0.25, locked: true, scaleX: 2, scaleY: 0.5, rotation: 40, offset: { x: 5, y: -2 } })).toEqual({
      offset: { x: 0, y: 0 }, scaleX: 1, scaleY: 1, rotation: 0, opacity: 0.25, locked: true,
    })
  })
})
