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

export const roadConnectivityRule: ValidationRule = {
  ruleId: 'road-connectivity',
  description: 'Road Connectivity',
  category: 'connectivity',
  defaultSeverity: 'warning',
  profiles: ['draft', 'publish', 'strict'],
  affinity: 'entity:road',

  execute(context: ValidationContext): ReadonlyArray<ValidationIssue> {
    const issues: ValidationIssue[] = []
    const entranceIds = new Set<string>()
    for (const bld of context.document.buildings) {
      for (const floor of bld.floors) {
        for (const ent of floor.entrances) entranceIds.add(ent.id)
      }
    }

    for (const road of context.document.roads) {
      if (!road.polyline || !road.polyline.points || road.polyline.points.length < 2) {
        issues.push({
          issueId: `road-connectivity:${road.id}:${hash('dangling')}`,
          ruleId: 'road-connectivity',
          severity: 'warning',
          message: `Road "${road.id}" has fewer than 2 points (dangling road)`,
          targets: [{ entityId: road.id, entityType: 'road' }],
        })
      }
      if (road.connectorEntranceId && !entranceIds.has(road.connectorEntranceId)) {
        issues.push({
          issueId: `road-connectivity:${road.id}:${hash('missing-entrance')}`,
          ruleId: 'road-connectivity',
          severity: 'error',
          message: `Road "${road.id}" references non-existent entrance "${road.connectorEntranceId}"`,
          targets: [{ entityId: road.id, entityType: 'road' }],
          fixId: 'metadata.clear-entrance-reference',
        })
      }
    }

    return issues
  },
}
