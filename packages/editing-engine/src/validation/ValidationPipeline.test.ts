import { describe, it, expect } from 'vitest'
import { createValidationPipeline, ValidationLevel } from './ValidationPipeline'
import type { ValidationIssue } from './ValidationPipeline'

describe('ValidationPipeline', () => {
  it('starts with no validators', () => {
    const p = createValidationPipeline()
    const r = p.runEditing({})
    expect(r.passed).toBe(true)
    expect(r.issues).toHaveLength(0)
  })

  it('passes when all validators pass', () => {
    const p = createValidationPipeline()
    p.register(ValidationLevel.Editing, () => ({ level: ValidationLevel.Editing, passed: true }))
    const r = p.runEditing({})
    expect(r.passed).toBe(true)
  })

  it('fails when any validator fails', () => {
    const p = createValidationPipeline()
    p.register(ValidationLevel.Editing, () => ({ level: ValidationLevel.Editing, passed: true }))
    p.register(ValidationLevel.Editing, () => ({ level: ValidationLevel.Editing, passed: false, message: 'Self-intersecting polygon', code: 'SELF_INTERSECT' }))
    const r = p.runEditing({})
    expect(r.passed).toBe(false)
    expect(r.issues).toHaveLength(2)
    expect(r.issues[1].message).toBe('Self-intersecting polygon')
    expect(r.issues[1].code).toBe('SELF_INTERSECT')
  })

  it('null validator is skipped', () => {
    const p = createValidationPipeline()
    p.register(ValidationLevel.Editing, () => null)
    const r = p.runEditing({})
    expect(r.passed).toBe(true)
    expect(r.issues).toHaveLength(0)
  })

  it('validator can return multiple issues', () => {
    const p = createValidationPipeline()
    p.register(ValidationLevel.Editing, () => [
      { level: ValidationLevel.Editing, passed: true },
      { level: ValidationLevel.Editing, passed: false, message: 'Min area not met', code: 'MIN_AREA' },
    ])
    const r = p.runEditing({})
    expect(r.passed).toBe(false)
    expect(r.issues).toHaveLength(2)
  })

  it('separates editing, geometry, and navigation tiers', () => {
    const p = createValidationPipeline()
    p.register(ValidationLevel.Editing, () => ({ level: ValidationLevel.Editing, passed: false, message: 'Editing fail' }))
    p.register(ValidationLevel.Geometry, () => ({ level: ValidationLevel.Geometry, passed: false, message: 'Geometry fail' }))
    p.register(ValidationLevel.Navigation, () => ({ level: ValidationLevel.Navigation, passed: false, message: 'Navigation fail' }))

    const editing = p.runEditing({})
    const geometry = p.runGeometry({})
    const navigation = p.runNavigation({})

    expect(editing.passed).toBe(false)
    expect(editing.level).toBe(ValidationLevel.Editing)
    expect(geometry.passed).toBe(false)
    expect(geometry.level).toBe(ValidationLevel.Geometry)
    expect(navigation.passed).toBe(false)
    expect(navigation.level).toBe(ValidationLevel.Navigation)

    expect(editing.issues[0].message).toBe('Editing fail')
    expect(geometry.issues[0].message).toBe('Geometry fail')
    expect(navigation.issues[0].message).toBe('Navigation fail')
  })

  it('runAll returns all three tier results', () => {
    const p = createValidationPipeline()
    p.register(ValidationLevel.Editing, () => ({ level: ValidationLevel.Editing, passed: true }))
    const results = p.runAll({})
    expect(results).toHaveLength(3)
    expect(results[0].level).toBe(ValidationLevel.Editing)
    expect(results[1].level).toBe(ValidationLevel.Geometry)
    expect(results[2].level).toBe(ValidationLevel.Navigation)
  })

  it('passes context to validators', () => {
    const p = createValidationPipeline()
    p.register(ValidationLevel.Editing, (ctx: any) => {
      if (ctx.points && ctx.points.length < 3) {
        return { level: ValidationLevel.Editing, passed: false, message: 'Need 3+ points', code: 'MIN_POINTS' }
      }
      return { level: ValidationLevel.Editing, passed: true }
    })

    expect(p.runEditing({ points: [1, 2] }).passed).toBe(false)
    expect(p.runEditing({ points: [1, 2, 3, 4] }).passed).toBe(true)
  })

  it('clear removes all validators', () => {
    const p = createValidationPipeline()
    p.register(ValidationLevel.Editing, () => ({ level: ValidationLevel.Editing, passed: false }))
    p.clear()
    const r = p.runEditing({})
    expect(r.passed).toBe(true)
    expect(r.issues).toHaveLength(0)
  })

  it('includes entityId and code in issues', () => {
    const issue: ValidationIssue = {
      level: ValidationLevel.Editing,
      passed: false,
      message: 'Out of bounds',
      entityId: 'room-1',
      code: 'OUT_OF_BOUNDS',
    }
    expect(issue.entityId).toBe('room-1')
    expect(issue.code).toBe('OUT_OF_BOUNDS')
  })
})
