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

export const connectorConnectivityRule: ValidationRule = {
  ruleId: 'connector-connectivity',
  description: 'Connector Connectivity',
  category: 'connectivity',
  defaultSeverity: 'error',
  profiles: ['draft', 'publish', 'strict'],
  affinity: 'entity:vertical_connector',

  execute(context: ValidationContext): ReadonlyArray<ValidationIssue> {
    const issues: ValidationIssue[] = []

    for (const bld of context.document.buildings) {
      const stopMap = new Map<string, string>()
      for (const floor of bld.floors) {
        for (const stop of floor.connectorStops) {
          stopMap.set(stop.id, floor.id)
        }
      }

      for (const conn of bld.verticalConnectors) {
        if (conn.stopIds.length < 2) {
          issues.push({
            issueId: `connector-connectivity:${conn.id}:${hash('too-few-stops')}`,
            ruleId: 'connector-connectivity',
            severity: 'error',
            message: `VerticalConnector "${conn.id}" has fewer than 2 stops`,
            targets: [{ entityId: conn.id, entityType: 'vertical_connector' }],
          })
          continue
        }

        const floorsReferenced = new Set<string>()
        for (let i = 0; i < conn.stopIds.length; i++) {
          const sid = conn.stopIds[i]
          const floorId = stopMap.get(sid)
          if (!floorId) {
            issues.push({
              issueId: `connector-connectivity:${conn.id}:${hash('missing-stop-' + i)}`,
              ruleId: 'connector-connectivity',
              severity: 'error',
              message: `VerticalConnector "${conn.id}" references non-existent stop "${sid}"`,
              targets: [{ entityId: conn.id, entityType: 'vertical_connector' }],
            })
            continue
          }
          floorsReferenced.add(floorId)
        }

        if (floorsReferenced.size < 2) {
          issues.push({
            issueId: `connector-connectivity:${conn.id}:${hash('same-floor')}`,
            ruleId: 'connector-connectivity',
            severity: 'error',
            message: `VerticalConnector "${conn.id}" stops must span at least 2 different floors`,
            targets: [{ entityId: conn.id, entityType: 'vertical_connector' }],
          })
        }
      }

      for (const floor of bld.floors) {
        for (const stop of floor.connectorStops) {
          const parent = bld.verticalConnectors.find(c => c.stopIds.includes(stop.id))
          if (!parent) {
            issues.push({
              issueId: `connector-connectivity:${stop.id}:${hash('orphan-stop')}`,
              ruleId: 'connector-connectivity',
              severity: 'warning',
              message: `ConnectorStop "${stop.id}" is not referenced by any VerticalConnector in building "${bld.id}"`,
              targets: [{ entityId: stop.id, entityType: 'connector_stop' }],
            })
          }
        }
      }
    }

    return issues
  },
}
