import { describe, expect, it, vi } from 'vitest'
import { commitFloorPlanAlignment } from '../floor-plan-commit'

describe('floor-plan committed alignment authority', () => {
  it('dispatches one canonical entity update synchronously', () => {
    const execute = vi.fn(() => ({ success: true }))
    const dispatcher = { execute }
    const next = commitFloorPlanAlignment(dispatcher, 'floor-1', {
      scale: 2,
      offset: { x: 4, y: -2 },
      rotation: 540,
      opacity: 1.2,
      locked: true,
    })

    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledWith({
      id: 'entity.update',
      label: 'Update Floor Plan Alignment',
      payload: {
        entityId: 'floor-1',
        changes: {
          planAlignment: {
            offset: { x: 4, y: -2 }, scaleX: 2, scaleY: 2, rotation: -180, opacity: 1, locked: true,
          },
        },
      },
    })
    expect(next).toEqual(expect.objectContaining({ scaleX: 2, scaleY: 2, rotation: -180 }))
  })
})
