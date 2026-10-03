import { describe, expect, it } from 'vitest'
import type { ValidationIssue } from './snapshot'
import { presentValidationIssue } from './presentation'

function issue(overrides: Partial<ValidationIssue> = {}): ValidationIssue {
  return {
    issueId: 'issue-1',
    ruleId: 'unknown-rule',
    severity: 'error',
    message: 'The validation rule failed.',
    targets: [],
    ...overrides,
  }
}

describe('presentValidationIssue', () => {
  it('explains a disconnected route network in administrator language', () => {
    const result = presentValidationIssue(issue({ ruleId: 'route-network-disconnected' }))

    expect(result.ruleLabel).toBe('Route network')
    expect(result.title).toBe('Disconnected route network')
    expect(result.guidance).toMatch(/connect/i)
    expect(result.guidance).toMatch(/route/i)
  })

  it('explains invalid entrance access without inventing a target', () => {
    const source = issue({
      ruleId: 'route-entrance-access',
      targets: [{ entityId: 'entrance-1', entityType: 'entrance' }],
    })
    const result = presentValidationIssue(source)

    expect(result.title).toBe('Entrance route access is invalid')
    expect(result.guidance).toMatch(/entrance/i)
    expect(result.guidance).toMatch(/route/i)
    expect(source).toEqual({
      issueId: 'issue-1',
      ruleId: 'route-entrance-access',
      severity: 'error',
      message: 'The validation rule failed.',
      targets: [{ entityId: 'entrance-1', entityType: 'entrance' }],
    })
  })

  it('turns geometry rule IDs into readable repair guidance', () => {
    const result = presentValidationIssue(issue({ ruleId: 'polygon-closure' }))

    expect(result.ruleLabel).toBe('Geometry')
    expect(result.title).toBe('Polygon is not closed')
    expect(result.guidance).toMatch(/close/i)
  })

  it('uses a deterministic readable fallback for custom rules', () => {
    const result = presentValidationIssue(issue({ ruleId: 'campus-custom-rule' }))

    expect(result.ruleLabel).toBe('Custom rule')
    expect(result.title).toBe('Campus custom rule')
    expect(result.title).not.toContain('campus-custom-rule')
    expect(result.guidance).toMatch(/inspect/i)
  })

  it('explains when an issue has no map target without adding coordinates', () => {
    const source = issue({ ruleId: 'route-network-disconnected', targets: [] })
    const result = presentValidationIssue(source)

    expect(result.guidance).toMatch(/target/i)
    expect(result).not.toHaveProperty('location')
    expect(source.targets).toEqual([])
  })
})
