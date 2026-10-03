import type { ValidationRule, ValidationContext } from '../types'
import type { ValidationIssue } from '../../snapshot'

export const missingFootprintRule: ValidationRule = {
  ruleId: 'missing-footprint',
  description: 'Missing building footprint',
  category: 'integrity',
  defaultSeverity: 'warning',
  profiles: ['draft', 'publish', 'strict'],
  affinity: 'global',

  execute(context: ValidationContext): ReadonlyArray<ValidationIssue> {
    const issues: ValidationIssue[] = []
    for (const bld of context.document.buildings) {
      const pts = bld.footprint?.points ?? []
      if (pts.length < 3) {
        issues.push({
          issueId: `missing-footprint:${bld.id}`,
          ruleId: 'missing-footprint',
          severity: 'warning',
          message: `Building "${bld.name}" has no footprint polygon — coordinate transforms will use fallback origin (0,0)`,
          targets: [{ entityId: bld.id, entityType: 'building' }],
        })
      }
    }
    return issues
  },
}
