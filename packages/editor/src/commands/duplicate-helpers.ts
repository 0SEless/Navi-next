import type { LocalCoord, PointOfInterestGeometry, RoomDoor } from '@navi/core'

// ── ROU Task 7: reusable duplication helper ──
// Pure builder for a duplicated authored entity at a building-local offset.
// Copies authoring fields (doorType/position+offset/width/depth/rotation/angle/
// translated geometry/name/metadata/connectedToType) and NEVER copies room
// identity (`roomId`/`ownership`), route connectivity (`routeConnection`),
// or the other-side reference (`connectedToId`) — the caller re-evaluates
// ownership by containment at the duplicate's position. Reusable for
// stairs/elevators when they gain room ownership.

function translateGeometry(
  geometry: PointOfInterestGeometry | undefined,
  offset: LocalCoord,
): PointOfInterestGeometry | undefined {
  if (geometry === undefined) return undefined
  if (geometry.type === 'rectangle') {
    return {
      ...structuredClone(geometry),
      min: { x: geometry.min.x + offset.x, y: geometry.min.y + offset.y },
      max: { x: geometry.max.x + offset.x, y: geometry.max.y + offset.y },
    }
  }
  return structuredClone(geometry)
}

export function buildDuplicatedDoor(source: RoomDoor, id: string, offset: LocalCoord): RoomDoor {
  const geometry = translateGeometry(source.geometry, offset)
  return {
    id,
    doorType: source.doorType,
    position: { x: source.position.x + offset.x, y: source.position.y + offset.y },
    width: source.width,
    ...(source.depth !== undefined ? { depth: source.depth } : {}),
    ...(source.rotation !== undefined ? { rotation: source.rotation } : {}),
    ...(source.angle !== undefined ? { angle: source.angle } : {}),
    ...(geometry !== undefined ? { geometry: geometry as RoomDoor['geometry'] } : {}),
    ...(source.name !== undefined ? { name: source.name } : {}),
    connectedToType: source.connectedToType ?? 'room',
    metadata: structuredClone(source.metadata ?? {}),
  }
}
