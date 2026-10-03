import type { Floor, RoomDoor } from './entities'

// ── P1-T6 (R2.4/D7): single-source door access ──
// After extraction, the canonical home for doors is Floor.doors. Legacy
// documents may still carry nested room.roomDoors (valid input). This
// helper enforces ONE source per document state — never a union of both:
//   - extracted doors present → they are authoritative
//   - otherwise → fall back to the nested legacy arrays (read-only view)
// Consumers (graph adapter, validation rules, rendering) MUST read doors
// through this helper so extraction never silently hides doors.

export function collectFloorDoors(floor: Pick<Floor, 'doors'> & { rooms: Array<{ roomDoors: RoomDoor[] }> }): RoomDoor[] {
  if (floor.doors !== undefined) return floor.doors
  const nested: RoomDoor[] = []
  for (const room of floor.rooms) nested.push(...room.roomDoors)
  return nested
}
