import { describe, it, expect } from 'vitest'
import { StairDefinition, ElevatorDefinition, DEFINITIONS } from '@/types/parametric-types'
import type { ParametricComponent, ParametricDefinition } from '@/types/parametric-types'

// Proof that the frozen RC-1 import path (navi-next/src/types/parametric-types,
// now a re-export shim to @navi/editor) still resolves every export name and
// behaves identically after the T0.4 relocation.

describe('parametric-types shim (frozen old path → @navi/editor)', () => {
  it('re-exports both definitions with their frozen ids', () => {
    expect(StairDefinition.id).toBe('stair')
    expect(ElevatorDefinition.id).toBe('elevator')
    expect(Object.keys(DEFINITIONS)).toEqual(['stair', 'elevator'])
  })

  it('re-exports the ParametricDefinition interface contract', () => {
    const def: ParametricDefinition = StairDefinition
    expect(typeof def.create).toBe('function')
    expect(typeof def.geometry).toBe('function')
    expect(typeof def.parameters).toBe('function')
    expect(typeof def.constraints).toBe('function')
  })

  it('geometry() still returns the frozen rect+arrow primitives through the shim', () => {
    const c: ParametricComponent = {
      id: 'stair-1',
      definitionId: 'stair',
      position: { x: 10, y: 20 },
      rotation: 0,
      properties: { stepCount: 4, stepWidth: 2, stepDepth: 0.5, direction: 'east', preset: 'straight' },
    }
    const geo = StairDefinition.geometry(c)
    expect(geo).toHaveLength(2)
    expect(geo[0]).toMatchObject({ type: 'rect', x: 10, y: 20, width: 2, height: 2, rotation: 0 })
    expect(geo[1].type).toBe('arrow')
  })
})