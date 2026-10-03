import type { ValidationRule, ValidationContext } from '../types'
import type { ValidationIssue } from '../../snapshot'

function hash(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h).toString(36)
}

export const floorMetadataRule: ValidationRule = {
  ruleId: 'floor-metadata',
  description: 'Floor Metadata',
  category: 'metadata',
  defaultSeverity: 'warning',
  profiles: ['draft', 'publish', 'strict'],
  affinity: 'entity:building',

  execute(context: ValidationContext): ReadonlyArray<ValidationIssue> {
    const issues: ValidationIssue[] = []

    for (const bld of context.document.buildings) {
      for (const floor of bld.floors) {
        if (!floor.id || floor.id.trim() === '') {
          issues.push({
            issueId: `floor-metadata:${floor.id ?? 'unknown'}:${hash('missing-id')}`,
            ruleId: 'floor-metadata',
            severity: 'error',
            message: `Floor in building "${bld.name}" has no ID`,
            targets: [],
          })
        }
        if (typeof floor.level !== 'number') {
          issues.push({
            issueId: `floor-metadata:${floor.id}:${hash('missing-level')}`,
            ruleId: 'floor-metadata',
            severity: 'warning',
            message: `Floor "${floor.label}" has no level number`,
            targets: [{ entityId: floor.id, entityType: 'floor' }],
            fixId: 'metadata.assign-floor-level',
          })
        }
      }
    }

    return issues
  },
}
