import { describe, expect, it } from 'vitest'
import { resolvePublicFloorPlan } from '../public-floor-plan'
import type { Building } from '@/types/nav-types'

const building: Building = {
  id: 'hall', name: 'Hall', campusId: 'campus', floors: [0, 1, 2],
  footprint: [], baseElevation: 0, height: 12,
  floorPlanUrls: { 0: 'legacy-gf', 1: 'legacy-1f' },
  floorPlanVisuals: {
    0: { imageUrl: 'visual-gf', alignment: { offset: { x: 50, y: 0 }, scale: 1, rotation: 0, opacity: 0.5 } },
    1: { imageUrl: 'visual-1f', alignment: { offset: { x: 51, y: 0 }, scale: 1, rotation: 0, opacity: 0.5 } },
    2: { imageUrl: 'visual-2f', alignment: { offset: { x: 52, y: 0 }, scale: 1, rotation: 0, opacity: 0.5 } },
  },
  floorData: [
    { id: 'gf', level: 0, planImageId: 'explicit-gf', planAlignment: { offset: { x: 0, y: 0 }, scale: 1, rotation: 0, opacity: 0.7 }, walls: [{ id: 'gf-wall' }] },
    { id: '1f', level: 1, planImageId: 'explicit-1f', planAlignment: { offset: { x: 1, y: 0 }, scale: 2, rotation: 9, opacity: 0.8 }, walls: [{ id: '1f-wall' }] },
    { id: '2f', level: 2, planImageId: 'explicit-2f', planAlignment: { offset: { x: 2, y: 0 }, scale: 3, rotation: 18, opacity: 0.9 }, walls: [{ id: '2f-wall' }] },
  ],
}

describe('resolvePublicFloorPlan', () => {
  it.each([0, 1, 2])('uses only level %i explicit plan, alignment, and floor data', (level) => {
    const plan = resolvePublicFloorPlan(building, level)
    expect(plan.imageUrl).toBe(`explicit-${['gf', '1f', '2f'][level]}`)
    expect(plan.alignment?.offset?.x).toBe(level)
    expect(plan.floorData?.walls).toEqual([{ id: `${['gf', '1f', '2f'][level]}-wall` }])
  })

  it('falls back to same-level published URL and visual alignment', () => {
    const legacy = { ...building, floorData: undefined }
    expect(resolvePublicFloorPlan(legacy, 1)).toMatchObject({
      imageUrl: 'legacy-1f', alignment: legacy.floorPlanVisuals?.[1].alignment,
    })
    expect(resolvePublicFloorPlan(legacy, 2).imageUrl).toBe('visual-2f')
  })

  it('does not borrow any plan from another level and honors explicit removal', () => {
    const missing = { ...building, floorData: [{ id: 'gf', level: 0, planImageId: null }], floorPlanUrls: { 0: 'legacy-gf' }, floorPlanVisuals: undefined }
    expect(resolvePublicFloorPlan(missing, 0).imageUrl).toBeUndefined()
    expect(resolvePublicFloorPlan(missing, 1).imageUrl).toBeUndefined()
    expect(resolvePublicFloorPlan(missing, 2).imageUrl).toBeUndefined()
    expect(resolvePublicFloorPlan(missing, 99)).toEqual({ imageUrl: undefined, alignment: undefined, floorData: undefined })
  })
})
