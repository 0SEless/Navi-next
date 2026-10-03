import { describe, it, expect } from 'vitest'
import { evaluateConstraints } from '../parameter/evaluate-constraints'
import { StairDefinition, ElevatorDefinition } from '@/types/parametric-types'

describe('evaluateConstraints', () => {
  it('returns empty for valid component', () => {
    const component = StairDefinition.create({ stepCount: 10, stepWidth: 1.2 })
    const result = evaluateConstraints(component, StairDefinition)
    expect(result).toEqual([])
  })

  it('returns error for out-of-range min value', () => {
    const component = StairDefinition.create({ stepCount: 0, stepWidth: 1.2 })
    const result = evaluateConstraints(component, StairDefinition)
    expect(result).toHaveLength(1)
    expect(result[0].code).toBe('PARAMETER_OUT_OF_RANGE')
    expect(result[0].severity).toBe('error')
    expect(result[0].target?.entityId).toBe(component.id)
  })

  it('returns error for missing required field', () => {
    const component = ElevatorDefinition.create({ width: 1.5, depth: 1.5, doorSide: undefined })
    const result = evaluateConstraints(component, ElevatorDefinition)
    expect(result).toHaveLength(1)
    expect(result[0].code).toBe('PARAMETER_REQUIRED')
  })

  it('returns multiple errors for multiple violations', () => {
    const component = StairDefinition.create({ stepCount: 0, stepWidth: 0.1 })
    const result = evaluateConstraints(component, StairDefinition)
    expect(result.length).toBeGreaterThanOrEqual(2)
  })

  it('returns unknown definition error for missing definition', () => {
    const result = evaluateConstraints({ id: 'x', definitionId: 'nope', position: { x: 0, y: 0 }, rotation: 0, properties: {} }, null as any)
    expect(result).toHaveLength(1)
    expect(result[0].code).toBe('PARAMETER_REQUIRED')
  })
})
