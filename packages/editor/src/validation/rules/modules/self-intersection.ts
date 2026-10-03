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

function segmentsIntersect(
  a1: { x: number; y: number }, a2: { x: number; y: number },
  b1: { x: number; y: number }, b2: { x: number; y: number },
): boolean {
  const denom = (a1.x - a2.x) * (b1.y - b2.y) - (a1.y - a2.y) * (b1.x - b2.x)
  if (Math.abs(denom) < 1e-12) return false
  const t = ((a1.x - b1.x) * (b1.y - b2.y) - (a1.y - b1.y) * (b1.x - b2.x)) / denom
  const u = -((a1.x - a2.x) * (a1.y - b1.y) - (a1.y - a2.y) * (a1.x - b1.x)) / denom
  return t > 0 && t < 1 && u > 0 && u < 1
}

function checkSelfIntersection(
  points: ReadonlyArray<{ x: number; y: number }>,
  entityId: string,
  entityLabel: string,
  entityType: string,
): ValidationIssue[] {
  for (let i = 0; i < points.length - 1; i++) {
    for (let j = i + 2; j < points.length - 1; j++) {
      if (segmentsIntersect(points[i], points[i + 1], points[j], points[j + 1])) {
        return [{
          issueId: `self-intersection:${entityId}:${hash('intersection')}`,
          ruleId: 'self-intersection',
          severity: 'error',
          message: `${entityLabel} has self-intersecting edges`,
          targets: [{ entityId, entityType }],
        }]
      }
    }
  }
  return []
}

export const selfIntersectionRule: ValidationRule = {
  ruleId: 'self-intersection',
  description: 'Self-Intersection',
  category: 'geometry',
  defaultSeverity: 'warning',
  profiles: ['draft', 'publish', 'strict'],
  affinity: 'entity:room',

  execute(context: ValidationContext): ReadonlyArray<ValidationIssue> {
    const issues: ValidationIssue[] = []

    for (const bld of context.document.buildings) {
      issues.push(...checkSelfIntersection(
        bld.footprint.points.map(p => ({ x: p.lng, y: p.lat })),
        bld.id, `Building "${bld.name}"`, 'building',
      ))
      for (const floor of bld.floors) {
        for (const room of floor.rooms) {
          issues.push(...checkSelfIntersection(
            room.polygon.points,
            room.id, `Room "${room.name}"`, 'room',
          ))
        }
      }
    }

    return issues
  },
}
