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

export const entranceConnectivityRule: ValidationRule = {
  ruleId: 'entrance-connectivity',
  description: 'Entrance Connectivity',
  category: 'connectivity',
  defaultSeverity: 'warning',
  profiles: ['draft', 'publish', 'strict'],
  affinity: 'entity:entrance',

  execute(context: ValidationContext): ReadonlyArray<ValidationIssue> {
    const issues: ValidationIssue[] = []
    const roadIds = new Set(context.document.roads.map(r => r.id))

    for (const bld of context.document.buildings) {
      for (const floor of bld.floors) {
        for (const ent of floor.entrances) {
          if (ent.connectorRoadId && !roadIds.has(ent.connectorRoadId)) {
            issues.push({
              issueId: `entrance-connectivity:${ent.id}:${hash('missing-road')}`,
              ruleId: 'entrance-connectivity',
              severity: 'error',
              message: `Entrance "${ent.label}" references non-existent road "${ent.connectorRoadId}"`,
              targets: [{ entityId: ent.id, entityType: 'entrance' }],
              fixId: 'metadata.clear-road-reference',
            })
          }
        }
      }
    }

    return issues
  },
}
