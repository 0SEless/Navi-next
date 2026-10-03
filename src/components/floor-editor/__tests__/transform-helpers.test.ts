import { describe, it, expect } from 'vitest'
import type { ParametricComponent } from '@/types/parametric-types'
import { applyTranslation, applyRotation, setPosition } from '../transform-helpers'

function makeComponent(overrides?: Partial<ParametricComponent>): ParametricComponent {
  return {
    id: 'test-1', definitionId: 'stair',
    position: { x: 10, y: 20 }, rotation: 0,
    properties: { stepCount: 4 },
    ...overrides,
  }
}

describe('applyTranslation', () => {
  it('adds delta to position', () => {
    const c = makeComponent()
    const result = applyTranslation(c, { x: 5, y: -3 })
    expect(result.position).toEqual({ x: 15, y: 17 })
  })

  it('does not mutate original', () => {
    const c = makeComponent()
    applyTranslation(c, { x: 100, y: 100 })
    expect(c.position).toEqual({ x: 10, y: 20 })
  })
})

describe('applyRotation', () => {
  it('sets rotation', () => {
    const c = makeComponent()
    const result = applyRotation(c, 90)
    expect(result.rotation).toBe(90)
  })

  it('does not mutate original', () => {
    const c = makeComponent()
    applyRotation(c, 45)
    expect(c.rotation).toBe(0)
  })
})

describe('setPosition', () => {
  it('sets absolute position', () => {
    const c = makeComponent()
    const result = setPosition(c, { x: 99, y: 88 })
    expect(result.position).toEqual({ x: 99, y: 88 })
  })

  it('does not mutate original', () => {
    const c = makeComponent()
    setPosition(c, { x: 1, y: 2 })
    expect(c.position).toEqual({ x: 10, y: 20 })
  })
})
