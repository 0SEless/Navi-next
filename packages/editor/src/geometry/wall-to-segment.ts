import type { Wall } from '@navi/core'
import type { WallSegment } from './wall-topology'

/**
 * Convert a Wall (from @navi/core entities) to a WallSegment (from wall-topology.ts).
 * Both have {x, y} point structures; this is a structural type cast.
 */
export function wallToSegment(wall: Wall): WallSegment {
  return { id: wall.id, sourceWallId: wall.id, start: wall.start, end: wall.end }
}

/**
 * Convert an array of Walls to WallSegments.
 */
export function wallsToSegments(walls: Wall[]): WallSegment[] {
  return walls.map(wallToSegment)
}
