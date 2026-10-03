import { describe, it, expect } from 'vitest'
import type { ParametricComponent, ParametricDefinition, PrimitiveGeometry, RectGeometry, ArrowGeometry } from '../parametric-types'
import { StairDefinition, ElevatorDefinition, DEFINITIONS } from '../parametric-types'

describe('ParametricComponent type', () => {
  it('accepts valid stair component', () => {
    const stair: ParametricComponent = {
      id: 'stair-1', definitionId: 'stair',
      position: { x: 10, y: 20 }, rotation: 0,
      properties: { stepCount: 4, stepWidth: 1.2, stepDepth: 0.3, direction: 'east', preset: 'straight' },
    }
    expect(stair.id).toBe('stair-1')
    expect(stair.properties.stepCount).toBe(4)
  })

  it('accepts valid elevator component', () => {
    const elev: ParametricComponent = {
      id: 'elev-1', definitionId: 'elevator',
      position: { x: 5, y: 5 }, rotation: 90,
      properties: { width: 1.5, depth: 1.5, doorSide: 'front' },
    }
    expect(elev.id).toBe('elev-1')
    expect(elev.properties.doorSide).toBe('front')
  })
})

describe('StairDefinition', () => {
  it('has id "stair"', () => {
    expect(StairDefinition.id).toBe('stair')
  })

  it('creates component with defaults', () => {
    const c = StairDefinition.create({ position: { x: 0, y: 0 } })
    expect(c.definitionId).toBe('stair')
    expect(c.properties.stepCount).toBe(4)
    expect(c.properties.stepWidth).toBe(1.2)
  })

  it('geometry returns a rect + arrow', () => {
    const c = StairDefinition.create({ position: { x: 10, y: 10 }, stepCount: 4 })
    const geo = StairDefinition.geometry(c)
    expect(geo.length).toBe(2)
    expect(geo[0].type).toBe('rect')
    expect(geo[1].type).toBe('arrow')
  })

  it('parameters returns 5 specs', () => {
    const params = StairDefinition.parameters()
    expect(params).toHaveLength(5)
    expect(params[0].key).toBe('stepCount')
  })

  it('constraints returns 3 rules', () => {
    const c = StairDefinition.constraints()
    expect(c).toHaveLength(3)
    expect(c[0].field).toBe('stepCount')
  })

  it('geometry is deterministic (pure function)', () => {
    const c = StairDefinition.create({ position: { x: 10, y: 10 }, stepCount: 4, stepWidth: 1.2, stepDepth: 0.3, direction: 'east' })
    const g1 = StairDefinition.geometry(c)
    const g2 = StairDefinition.geometry(c)
    expect(g1).toEqual(g2)
  })
})

describe('ElevatorDefinition', () => {
  it('has id "elevator"', () => {
    expect(ElevatorDefinition.id).toBe('elevator')
  })

  it('creates component with defaults', () => {
    const c = ElevatorDefinition.create({ position: { x: 0, y: 0 } })
    expect(c.definitionId).toBe('elevator')
    expect(c.properties.width).toBe(1.5)
    expect(c.properties.depth).toBe(1.5)
  })

  it('geometry returns a rect + arrow', () => {
    const c = ElevatorDefinition.create({ position: { x: 10, y: 10 } })
    const geo = ElevatorDefinition.geometry(c)
    expect(geo.length).toBe(2)
    expect(geo[0].type).toBe('rect')
    expect(geo[1].type).toBe('arrow')
  })

  it('parameters returns 3 specs', () => {
    const params = ElevatorDefinition.parameters()
    expect(params).toHaveLength(3)
    expect(params[2].key).toBe('doorSide')
  })
})

describe('DEFINITIONS map', () => {
  it('contains stair and elevator', () => {
    expect(Object.keys(DEFINITIONS)).toEqual(['stair', 'elevator'])
  })

  it('each definition has required interface methods', () => {
    for (const def of Object.values(DEFINITIONS)) {
      expect(typeof def.id).toBe('string')
      expect(typeof def.create).toBe('function')
      expect(typeof def.geometry).toBe('function')
      expect(typeof def.parameters).toBe('function')
      expect(typeof def.constraints).toBe('function')
    }
  })
})
