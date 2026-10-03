/**
 * RoomDoor Geometry Rule
 *
 * INVARIANT: A RoomDoor's position must lie on, or within tolerance of,
 * the boundary of its owning room's polygon.
 *
 * Coordinate system: building-local meters (LocalCoord = { x, y }).
 * Default tolerance: 0.5 meters (half a door width).
 *
 * This catches:
 * - Doors floating inside a room (not on any wall)
 * - Doors placed outside the room polygon
 * - Doors attached to the wrong room's boundary
 */

import type { ValidationRule, ValidationContext } from '../types'
import type { ValidationIssue } from '../../snapshot'
import { nearestPointOnPolyline, pointDistance, collectFloorDoors } from '@navi/core'
import type { LocalCoord } from '@navi/core'

const DEFAULT_TOLERANCE = 0.5 // meters

function hash(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h).toString(36)
}

/**
 * Compute the minimum distance from a point to a polygon boundary.
 * The polygon is a closed ring (first === last), so edges are between
 * consecutive points including the closing edge.
 */
function distanceToPolygonBoundary(
  point: LocalCoord,
  polygonPoints: LocalCoord[],
): number {
  let minDist = Infinity

  for (let i = 0; i < polygonPoints.length - 1; i++) {
    const a = polygonPoints[i]
    const b = polygonPoints[i + 1]
    const dist = distanceToSegment(point, a, b)
    if (dist < minDist) {
      minDist = dist
    }
  }

  return minDist
}

/**
 * Compute the minimum distance from a point to a line segment (a, b).
 */
function distanceToSegment(
  p: LocalCoord,
  a: LocalCoord,
  b: LocalCoord,
): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy

  if (lenSq === 0) {
    // Degenerate segment (a === b)
    return pointDistance(p, a)
  }

  // Project p onto the line defined by a-b, clamped to [0, 1]
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))

  // Closest point on segment
  const closest: LocalCoord = {
    x: a.x + t * dx,
    y: a.y + t * dy,
  }

  return pointDistance(p, closest)
}

export const roomDoorGeometryRule: ValidationRule = {
  ruleId: 'room-door-geometry',
  description: 'RoomDoor Geometry',
  category: 'geometry',
  defaultSeverity: 'error',
  profiles: ['draft', 'publish', 'strict'],
  affinity: 'entity:room_door',

  defaults: {
    tolerances: {
      boundaryTolerance: DEFAULT_TOLERANCE,
    },
  },

  execute(context: ValidationContext): ReadonlyArray<ValidationIssue> {
    const issues: ValidationIssue[] = []
    const tolerance = context.config.tolerances.boundaryTolerance ?? DEFAULT_TOLERANCE

    for (const bld of context.document.buildings) {
      for (const floor of bld.floors) {
        // Build room lookup by ID
        const roomById = new Map(floor.rooms.map(r => [r.id, r]))

        // P1-T6: doors read through the single-source helper — extracted
        // Floor.doors are authoritative; nested legacy arrays are the
        // fallback. The wall invariant holds for ALL door types (R9.2),
        // including 'opening'.
        for (const door of collectFloorDoors(floor)) {
          const room = roomById.get(door.roomId)
          if (!room) continue // orphan-roomId handled by connectivity rules
          const polygonPoints = room.polygon.points
          if (polygonPoints.length < 3) continue // already caught by polygon-closure rule

          const dist = distanceToPolygonBoundary(door.position, polygonPoints)

          if (dist > tolerance) {
            issues.push({
              issueId: `room-door-geometry:${door.roomId}:${hash(door.id)}`,
              ruleId: 'room-door-geometry',
              severity: 'error',
              message: `Door "${door.id}" in room "${room.id}" is ${dist.toFixed(2)}m from the room boundary (tolerance: ${tolerance}m). Door position must lie on or near the room's wall.`,
              targets: [{ entityId: room.id, entityType: 'room' }],
              location: door.position,
            })
          }
        }
      }
    }

    return issues
  },
}
