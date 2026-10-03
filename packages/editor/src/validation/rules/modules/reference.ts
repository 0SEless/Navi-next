import type { ValidationRule, ValidationContext } from '../types'
import type { ValidationIssue } from '../../snapshot'

export const referenceRule: ValidationRule = {
  ruleId: 'reference',
  description: 'Reference Validator',
  category: 'connectivity',
  defaultSeverity: 'warning',
  profiles: ['draft', 'publish', 'strict'],
  affinity: 'global',

  execute(_context: ValidationContext): ReadonlyArray<ValidationIssue> {
    return []
  },
}
