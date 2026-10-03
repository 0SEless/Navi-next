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

export const disconnectedGraphRule: ValidationRule = {
  ruleId: 'disconnected-graph',
  description: 'Detects orphan nodes — entities not connected to the navigation graph',
  category: 'connectivity',
  defaultSeverity: 'warning',
  profiles: ['draft', 'publish', 'strict'],
  affinity: 'global',

  execute(context: ValidationContext): ReadonlyArray<ValidationIssue> {
    const issues: ValidationIssue[] = []
    const graph = context.analysis.graph
    if (!graph || graph.connectedComponentCount <= 1) return issues

    issues.push({
      issueId: `disconnected-graph:${hash(String(graph.connectedComponentCount))}`,
      ruleId: 'disconnected-graph',
      severity: 'warning',
      message: `Navigation graph has ${graph.connectedComponentCount} disconnected components`,
      targets: [],
    })
    return issues
  },
}

export const missingNameRule: ValidationRule = {
  ruleId: 'missing-name',
  description: 'Flags entities without a name or label',
  category: 'metadata',
  defaultSeverity: 'warning',
  profiles: ['draft', 'publish', 'strict'],
  affinity: 'global',

  execute(context: ValidationContext): ReadonlyArray<ValidationIssue> {
    const issues: ValidationIssue[] = []
    const meta = context.analysis.metadata
    if (!meta) return issues

    for (const entityId of meta.unnamedEntityIds) {
      issues.push({
        issueId: `missing-name:${entityId}:${hash(entityId)}`,
        ruleId: 'missing-name',
        fixId: 'metadata.assign-name',
        severity: 'info',
        message: `Entity "${entityId}" has no name or label`,
        targets: [{ entityId, entityType: 'unknown' }],
      })
    }
    return issues
  },
}

export const zeroAreaPolygonRule: ValidationRule = {
  ruleId: 'zero-area-polygon',
  description: 'Flags polygons with near-zero area',
  category: 'geometry',
  defaultSeverity: 'error',
  profiles: ['publish', 'strict'],
  affinity: 'global',

  execute(context: ValidationContext): ReadonlyArray<ValidationIssue> {
    const issues: ValidationIssue[] = []
    const geo = context.analysis.geometry
    if (!geo) return issues

    for (const polygonId of geo.zeroAreaPolygonIds) {
      issues.push({
        issueId: `zero-area-polygon:${polygonId}:${hash(polygonId)}`,
        ruleId: 'zero-area-polygon',
        severity: 'error',
        message: `Polygon "${polygonId}" has near-zero area`,
        targets: [{ entityId: polygonId, entityType: 'room' }],
        location: { x: 0, y: 0 },
      })
    }
    return issues
  },
}
