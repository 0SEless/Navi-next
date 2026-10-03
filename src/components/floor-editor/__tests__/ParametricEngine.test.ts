import { describe, it, expect, beforeEach } from 'vitest'
import { ParametricEngine } from '../ParametricEngine'
import { StairDefinition, ElevatorDefinition } from '@/types/parametric-types'

describe('ParametricEngine', () => {
  let engine: ParametricEngine

  beforeEach(() => {
    engine = new ParametricEngine()
    engine.register(StairDefinition)
    engine.register(ElevatorDefinition)
  })

  it('creates a stair with defaults', () => {
    const c = engine.create(StairDefinition, { position: { x: 10, y: 20 } })
    expect(c.id).toMatch(/^parametric-/)
    expect(c.definitionId).toBe('stair')
    expect(c.position).toEqual({ x: 10, y: 20 })
    expect(c.properties.stepCount).toBe(4)
  })

  it('creates an elevator with defaults', () => {
    const c = engine.create(ElevatorDefinition, { position: { x: 5, y: 5 } })
    expect(c.definitionId).toBe('elevator')
    expect(c.properties.width).toBe(1.5)
  })

  it('get returns undefined for unknown id', () => {
    expect(engine.get('nonexistent')).toBeUndefined()
  })

  it('get returns component after creation', () => {
    const c = engine.create(StairDefinition, { position: { x: 0, y: 0 } })
    expect(engine.get(c.id)).toBeDefined()
    expect(engine.get(c.id)!.id).toBe(c.id)
  })

  it('getAll returns all components', () => {
    engine.create(StairDefinition, { position: { x: 0, y: 0 } })
    engine.create(ElevatorDefinition, { position: { x: 1, y: 1 } })
    expect(engine.getAll()).toHaveLength(2)
  })

  it('remove deletes a component', () => {
    const c = engine.create(StairDefinition, { position: { x: 0, y: 0 } })
    expect(engine.remove(c.id)).toBe(true)
    expect(engine.get(c.id)).toBeUndefined()
  })

  it('remove returns false for unknown id', () => {
    expect(engine.remove('nonexistent')).toBe(false)
  })

  it('updateProperty updates a single property', () => {
    const c = engine.create(StairDefinition, { position: { x: 0, y: 0 } })
    engine.updateProperty(c.id, 'stepCount', 8)
    expect(engine.get(c.id)!.properties.stepCount).toBe(8)
    expect(engine.get(c.id)!.properties.stepWidth).toBe(1.2)
  })

  it('getGeometry returns primitives from the definition', () => {
    const c = engine.create(StairDefinition, { position: { x: 10, y: 10 } })
    const geo = engine.getGeometry(c)
    expect(geo.length).toBeGreaterThanOrEqual(1)
    expect(geo[0].type).toBe('rect')
  })

  it('validate returns errors for invalid properties', () => {
    const c = engine.create(StairDefinition, { position: { x: 0, y: 0 }, stepCount: 0 })
    const diags = engine.validate(c)
    expect(diags.length).toBeGreaterThanOrEqual(1)
    expect(diags[0].severity).toBe('error')
  })

  it('validate returns empty for valid component', () => {
    const c = engine.create(ElevatorDefinition, { position: { x: 0, y: 0 }, width: 1.5, depth: 1.5, doorSide: 'front' })
    const diags = engine.validate(c)
    expect(diags.filter(d => d.severity === 'error')).toHaveLength(0)
  })

  it('getDefinition returns registered definition', () => {
    expect(engine.getDefinition('stair')).toBe(StairDefinition)
    expect(engine.getDefinition('elevator')).toBe(ElevatorDefinition)
    expect(engine.getDefinition('bogus')).toBeUndefined()
  })

  it('handles multiple components independently', () => {
    const s1 = engine.create(StairDefinition, { position: { x: 0, y: 0 } })
    const e1 = engine.create(ElevatorDefinition, { position: { x: 10, y: 10 } })
    const posBefore = engine.get(s1.id)!.position
    expect(posBefore).toEqual({ x: 0, y: 0 })
    expect(engine.get(e1.id)!.position).toEqual({ x: 10, y: 10 })
  })
})
