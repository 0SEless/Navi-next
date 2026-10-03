/**
 * P2-T3: Hit-testing for floor geometry in building-local meters.
 *
 * Converts a building-local point → entity match by testing against
 * rooms (point-in-polygon), hallways (point-near-polyline),
 * staircases/elevators (polygon or position proximity).
 *
 * All geometry is in building-local meters. The caller must convert
 * screen coordinates to building-local via screenToWorld() from P2-T1.
 */

import type { FloorGeometryFloor } from '@navi/core'

// ── Types ──

interface Point {
  x: number
  y: number
}

export type HitEntityType = 'room' | 'hallway' | 'staircase' | 'elevator' | 'door' | 'poi' | 'qrCheckpoint'

export interface HitResult {
  type: HitEntityType
  id: string
  name: string
}

// ── Geometry primitives ──

/**
 * Point-in-polygon test using ray casting algorithm.
 * Returns true if the point is inside the polygon boundary.
 */
export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  if (polygon.length < 3) return false

  let inside = false
  const n = polygon.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y
    const xj = polygon[j].x, yj = polygon[j].y

    // Check if ray from point going right crosses this edge
    if (
      ((yi > point.y) !== (yj > point.y)) &&
      (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi)
    ) {
      inside = !inside
    }
  }
  return inside
}

/**
 * Squared distance from point to line segment (p1 → p2).
 * Avoids sqrt for performance; use with squared threshold.
 */
function distSqToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy

  if (lenSq === 0) {
    // Degenerate segment (a === b)
    const ex = p.x - a.x
    const ey = p.y - a.y
    return ex * ex + ey * ey
  }

  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))

  const projX = a.x + t * dx
  const projY = a.y + t * dy
  const ex = p.x - projX
  const ey = p.y - projY
  return ex * ex + ey * ey
}

/**
 * Point-near-polyline test. Returns true if the point is within
 * `threshold` meters of any segment in the polyline.
 */
export function pointNearPolyline(point: Point, polyline: Point[], threshold: number): boolean {
  if (polyline.length < 2) return false

  const thrSq = threshold * threshold
  for (let i = 0; i < polyline.length - 1; i++) {
    if (distSqToSegment(point, polyline[i], polyline[i + 1]) <= thrSq) {
      return true
    }
  }
  return false
}

/**
 * Point near a feature position (circle hit test).
 * Accepts any object with a `position: { x, y }` property.
 */
function pointNearPosition(
  point: Point,
  feature: { position: { x: number; y: number } },
  threshold: number,
): boolean {
  const dx = point.x - feature.position.x
  const dy = point.y - feature.position.y
  return dx * dx + dy * dy <= threshold * threshold
}

// ── Floor hit-testing ──

const HALLWAY_THRESHOLD = 1.5 // meters — hallway polyline hit zone
const POSITION_THRESHOLD = 2.0 // meters — position-only feature hit zone
const DOOR_HALF_WIDTH = 0.6 // meters — half of standard door width

/**
 * Generate a small rectangle polygon around a door position.
 * The rectangle is aligned with axes (rotation=0 simplification).
 */
function doorHitPolygon(
  door: { position: { x: number; y: number }; width: number },
): Point[] {
  const hw = (door.width || 1.2) / 2
  return [
    { x: door.position.x - hw, y: door.position.y - DOOR_HALF_WIDTH },
    { x: door.position.x + hw, y: door.position.y - DOOR_HALF_WIDTH },
    { x: door.position.x + hw, y: door.position.y + DOOR_HALF_WIDTH },
    { x: door.position.x - hw, y: door.position.y + DOOR_HALF_WIDTH },
  ]
}

/**
 * Hit-test a building-local point against all geometry on a floor.
 * Returns the first match in priority order:
 * rooms → hallways → doors → staircases → elevators → pois → qrCheckpoints.
 * Returns null if no geometry matches.
 */
export function hitTestFloor(point: Point, floor: FloorGeometryFloor): HitResult | null {
  // 1. Check rooms (polygon containment)
  for (const room of floor.rooms) {
    if (pointInPolygon(point, room.polygon.points)) {
      return { type: 'room', id: room.id, name: room.name }
    }
  }

  // 2. Check hallways (polyline proximity)
  for (const hw of floor.hallways) {
    if (pointNearPolyline(point, hw.polyline.points, HALLWAY_THRESHOLD)) {
      return { type: 'hallway', id: hw.id, name: hw.name }
    }
  }

  // 3. Check doors (small rectangle around position)
  for (const door of floor.doors) {
    if (pointInPolygon(point, doorHitPolygon(door))) {
      return { type: 'door', id: door.id, name: door.doorType }
    }
  }

  // 4. Check staircases (polygon or position)
  for (const stair of floor.staircases) {
    if (stair.polygon && stair.polygon.points.length >= 3) {
      if (pointInPolygon(point, stair.polygon.points)) {
        return { type: 'staircase', id: stair.id, name: stair.name }
      }
    } else if (pointNearPosition(point, stair, POSITION_THRESHOLD)) {
      return { type: 'staircase', id: stair.id, name: stair.name }
    }
  }

  // 5. Check elevators (polygon or position)
  for (const elev of floor.elevators) {
    if (elev.polygon && elev.polygon.points.length >= 3) {
      if (pointInPolygon(point, elev.polygon.points)) {
        return { type: 'elevator', id: elev.id, name: elev.name }
      }
    } else if (pointNearPosition(point, elev, POSITION_THRESHOLD)) {
      return { type: 'elevator', id: elev.id, name: elev.name }
    }
  }

  // 6. Check POIs (position proximity)
  for (const poi of floor.pois) {
    if (pointNearPosition(point, poi, POSITION_THRESHOLD)) {
      return { type: 'poi', id: poi.id, name: poi.name }
    }
  }

  // 7. Check QR checkpoints (position proximity)
  for (const qr of floor.qrCheckpoints) {
    if (pointNearPosition(point, qr, POSITION_THRESHOLD)) {
      return { type: 'qrCheckpoint', id: qr.id, name: qr.label }
    }
  }

  return null
}
