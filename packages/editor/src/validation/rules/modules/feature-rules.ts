import type { ValidationRule, ValidationContext } from '../types'
import type { ValidationIssue } from '../../snapshot'
import { pointInPolygon } from '@navi/core'

function hash(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h).toString(36)
}

function pointDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)
}

/**
 * Feature Extent & Endpoints Rule
 * - fromLevel <= toLevel
 * - levels keys ⊆ [fromLevel..toLevel]
 * - Endpoint rule: levels[fromLevel] and levels[toLevel] must exist
 */
export const featureExtentRule: ValidationRule = {
  ruleId: 'feature-extent',
  description: 'Staircase / Elevator Extent & Endpoint Rule',
  category: 'connectivity',
  defaultSeverity: 'warning',
  profiles: ['draft', 'publish', 'strict'],
  affinity: 'entity:feature',

  execute(context: ValidationContext): ReadonlyArray<ValidationIssue> {
    const issues: ValidationIssue[] = []

    for (const bld of context.document.buildings) {
      const features = [...(bld.staircases ?? []), ...(bld.elevators ?? [])]
      for (const feature of features) {
        const entityType = 'type' in feature && typeof feature.type === 'string' && ['standard', 'enclosed', 'open', 'spiral', 'fire_escape'].includes(feature.type)
          ? 'staircase'
          : 'elevator'

        if (feature.fromLevel > feature.toLevel) {
          issues.push({
            issueId: `feature-extent:${feature.id}:${hash('invalid-range')}`,
            ruleId: 'feature-extent',
            severity: 'error',
            message: `${entityType} "${feature.id}" has invalid extent: fromLevel (${feature.fromLevel}) > toLevel (${feature.toLevel})`,
            targets: [{ entityId: feature.id, entityType }],
          })
        }

        const levelsKeys = Object.keys(feature.levels).map(Number)
        for (const lvl of levelsKeys) {
          if (lvl < feature.fromLevel || lvl > feature.toLevel) {
            issues.push({
              issueId: `feature-extent:${feature.id}:${hash(`level-out-of-range-${lvl}`)}`,
              ruleId: 'feature-extent',
              severity: 'error',
              message: `${entityType} "${feature.id}" has access floor ${lvl} outside extent [${feature.fromLevel}..${feature.toLevel}]`,
              targets: [{ entityId: feature.id, entityType }],
            })
          }
        }

        // Endpoint rule: both fromLevel and toLevel must be access floors
        if (!feature.levels[feature.fromLevel]) {
          issues.push({
            issueId: `feature-extent:${feature.id}:${hash(`missing-endpoint-${feature.fromLevel}`)}`,
            ruleId: 'feature-extent',
            severity: 'warning',
            message: `${entityType} "${feature.id}" spans to floor ${feature.fromLevel} but has no access/geometry on that floor`,
            targets: [{ entityId: feature.id, entityType }],
          })
        }
        if (feature.toLevel !== feature.fromLevel && !feature.levels[feature.toLevel]) {
          issues.push({
            issueId: `feature-extent:${feature.id}:${hash(`missing-endpoint-${feature.toLevel}`)}`,
            ruleId: 'feature-extent',
            severity: 'warning',
            message: `${entityType} "${feature.id}" spans to floor ${feature.toLevel} but has no access/geometry on that floor`,
            targets: [{ entityId: feature.id, entityType }],
          })
        }
      }
    }

    return issues
  },
}

/**
 * Feature Overlap Rule
 * - Feature level polygon must not overlap room polygons on the same floor
 */
export const featureOverlapRule: ValidationRule = {
  ruleId: 'feature-overlap',
  description: 'Staircase / Elevator Overlap with Rooms',
  category: 'geometry',
  defaultSeverity: 'error',
  profiles: ['draft', 'publish', 'strict'],
  affinity: 'entity:feature',

  execute(context: ValidationContext): ReadonlyArray<ValidationIssue> {
    const issues: ValidationIssue[] = []

    for (const bld of context.document.buildings) {
      const features = [...(bld.staircases ?? []), ...(bld.elevators ?? [])]
      for (const feature of features) {
        const entityType = 'type' in feature && typeof feature.type === 'string' && ['standard', 'enclosed', 'open', 'spiral', 'fire_escape'].includes(feature.type)
          ? 'staircase'
          : 'elevator'

        for (const [lvlKey, levelGeom] of Object.entries(feature.levels)) {
          const level = Number(lvlKey)
          const floor = bld.floors.find(f => f.level === level)
          if (!floor || !levelGeom.polygon) continue

          for (const room of floor.rooms) {
            if (!room.polygon || room.polygon.points.length < 3) continue

            // Check if any vertex of feature is inside room polygon
            let overlapping = false
            for (const pt of levelGeom.polygon.points) {
              if (pointInPolygon(pt, room.polygon)) {
                overlapping = true
                break
              }
            }

            if (overlapping) {
              issues.push({
                issueId: `feature-overlap:${feature.id}:${room.id}:${hash(`overlap-${level}`)}`,
                ruleId: 'feature-overlap',
                severity: 'error',
                message: `${entityType} "${feature.id}" on floor ${level} overlaps with room "${room.name || room.number || room.id}"`,
                targets: [
                  { entityId: feature.id, entityType },
                  { entityId: room.id, entityType: 'room' },
                ],
              })
            }
          }
        }
      }
    }

    return issues
  },
}

/**
 * Feature Connectivity Rule
 * - Feature level position / landing must be within reasonable distance of a hallway on that floor
 */
export const featureConnectivityRule: ValidationRule = {
  ruleId: 'feature-connectivity',
  description: 'Staircase / Elevator Hallway Connection',
  category: 'connectivity',
  defaultSeverity: 'error',
  profiles: ['draft', 'publish', 'strict'],
  affinity: 'entity:feature',

  execute(context: ValidationContext): ReadonlyArray<ValidationIssue> {
    const issues: ValidationIssue[] = []
    const MAX_HALLWAY_DISTANCE = 8 // meters

    for (const bld of context.document.buildings) {
      const features = [...(bld.staircases ?? []), ...(bld.elevators ?? [])]
      for (const feature of features) {
        const entityType = 'type' in feature && typeof feature.type === 'string' && ['standard', 'enclosed', 'open', 'spiral', 'fire_escape'].includes(feature.type)
          ? 'staircase'
          : 'elevator'

        for (const [lvlKey, levelGeom] of Object.entries(feature.levels)) {
          const level = Number(lvlKey)
          const floor = bld.floors.find(f => f.level === level)
          if (!floor) continue

          if (floor.hallways.length === 0) {
            issues.push({
              issueId: `feature-connectivity:${feature.id}:${hash(`no-hallways-${level}`)}`,
              ruleId: 'feature-connectivity',
              severity: 'error',
              message: `${entityType} "${feature.id}" on floor ${level} has no usable hallway on that floor`,
              targets: [{ entityId: feature.id, entityType }],
            })
            continue
          }

          const targetPos = levelGeom.landing?.position ?? levelGeom.position
          let minDist = Infinity
          for (const hw of floor.hallways) {
            for (const pt of hw.polyline.points) {
              const d = pointDistance(targetPos, pt)
              if (d < minDist) minDist = d
            }
          }

          if (minDist > MAX_HALLWAY_DISTANCE) {
            issues.push({
              issueId: `feature-connectivity:${feature.id}:${hash(`far-hallway-${level}`)}`,
              ruleId: 'feature-connectivity',
              severity: 'error',
              message: `${entityType} "${feature.id}" on floor ${level} is ${Math.round(minDist)}m from nearest hallway (max ${MAX_HALLWAY_DISTANCE}m)`,
              targets: [{ entityId: feature.id, entityType }],
            })
          }
        }
      }
    }

    return issues
  },
}
