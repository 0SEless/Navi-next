import { latLngEquals, localCoordEquals } from '@navi/core'
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

export const polygonClosureRule: ValidationRule = {
  ruleId: 'polygon-closure',
  description: 'Polygon Closure',
  category: 'geometry',
  defaultSeverity: 'warning',
  profiles: ['draft', 'publish', 'strict'],
  affinity: 'entity:room',

  execute(context: ValidationContext): ReadonlyArray<ValidationIssue> {
    const issues: ValidationIssue[] = []

    for (const bld of context.document.buildings) {
      if (bld.footprint.points.length < 3) {
        issues.push({
          issueId: `polygon-closure:${bld.id}:${hash('too-few-points')}`,
          ruleId: 'polygon-closure',
          severity: 'error',
          message: `Building "${bld.name}" footprint has fewer than 3 points`,
          targets: [{ entityId: bld.id, entityType: 'building' }],
        })
        continue
      }
      const first = bld.footprint.points[0]
      const last = bld.footprint.points[bld.footprint.points.length - 1]
      if (!latLngEquals(first, last)) {
        issues.push({
          issueId: `polygon-closure:${bld.id}:${hash('not-closed')}`,
          ruleId: 'polygon-closure',
          severity: 'error',
          message: `Building "${bld.name}" footprint is not closed (first point ≠ last point)`,
          targets: [{ entityId: bld.id, entityType: 'building' }],
          fixId: 'geometry.close-polygon',
        })
      }
      for (const floor of bld.floors) {
        for (const room of floor.rooms) {
          if (room.polygon.points.length < 3) {
            issues.push({
              issueId: `polygon-closure:${room.id}:${hash('room-too-few')}`,
              ruleId: 'polygon-closure',
              severity: 'error',
              message: `Room "${room.name}" has fewer than 3 points`,
              targets: [{ entityId: room.id, entityType: 'room' }],
            })
            continue
          }
          const rf = room.polygon.points[0]
          const rl = room.polygon.points[room.polygon.points.length - 1]
          if (!localCoordEquals(rf, rl)) {
            issues.push({
              issueId: `polygon-closure:${room.id}:${hash('room-not-closed')}`,
              ruleId: 'polygon-closure',
              severity: 'error',
              message: `Room "${room.name}" polygon is not closed`,
              targets: [{ entityId: room.id, entityType: 'room' }],
              fixId: 'geometry.close-polygon',
            })
          }
        }
      }
    }

    return issues
  },
}
