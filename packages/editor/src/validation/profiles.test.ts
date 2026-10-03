import { describe, it, expect } from 'vitest'
import { getProfile, getProfiles, getDefaultProfile, resolveConfig } from './profiles'
import type { ValidationProfile } from './rules/types'

describe('getProfile', () => {
  it('returns draft profile', () => {
    const p = getProfile('draft')
    expect(p.id).toBe('draft')
    expect(p.label).toBe('Draft')
    expect(p.tolerances['geometry.overlapTolerance']).toBe(2.0)
  })

  it('returns publish profile', () => {
    const p = getProfile('publish')
    expect(p.id).toBe('publish')
    expect(p.label).toBe('Publish')
    expect(p.tolerances['geometry.overlapTolerance']).toBe(1.0)
  })

  it('returns strict profile', () => {
    const p = getProfile('strict')
    expect(p.id).toBe('strict')
    expect(p.label).toBe('Strict')
    expect(p.tolerances['geometry.overlapTolerance']).toBe(0.1)
  })

  it('throws for unknown profile', () => {
    expect(() => getProfile('unknown' as any)).toThrow('Unknown validation profile')
  })
})

describe('getProfiles', () => {
  it('returns all three profiles', () => {
    const profiles = getProfiles()
    expect(profiles.length).toBe(3)
    expect(profiles.map(p => p.id).sort()).toEqual(['draft', 'publish', 'strict'])
  })
})

describe('getDefaultProfile', () => {
  it('returns draft', () => {
    expect(getDefaultProfile()).toBe('draft')
  })
})

describe('resolveConfig', () => {
  const baseProfile: ValidationProfile = {
    id: 'draft',
    label: 'Draft',
    description: 'test',
    tolerances: { 'test.tol': 2.0, 'test.onlyProfile': 99 },
  }

  it('returns profile tolerances when no rule defaults', () => {
    const config = resolveConfig(baseProfile)
    expect(config.tolerances['test.tol']).toBe(2.0)
    expect(config.tolerances['test.onlyProfile']).toBe(99)
  })

  it('merges rule defaults with profile tolerances (profile wins)', () => {
    const config = resolveConfig(baseProfile, { 'test.tol': 0.5, 'test.ruleDefault': 1.0 })
    expect(config.tolerances['test.tol']).toBe(2.0)
    expect(config.tolerances['test.ruleDefault']).toBe(1.0)
    expect(config.tolerances['test.onlyProfile']).toBe(99)
  })

  it('includes severity overrides from profile', () => {
    const profile: ValidationProfile = {
      id: 'publish',
      label: 'Publish',
      description: 'test',
      tolerances: {},
      severityOverrides: { 'some.rule': 'warning' },
    }
    const config = resolveConfig(profile)
    expect(config.severityOverrides['some.rule']).toBe('warning')
  })

  it('returns frozen objects', () => {
    const config = resolveConfig(baseProfile)
    expect(Object.isFrozen(config.tolerances)).toBe(true)
    expect(Object.isFrozen(config.severityOverrides)).toBe(true)
  })
})
