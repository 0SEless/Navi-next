/**
 * Canonical room identity helpers.
 *
 * Semantic (wall-derived) rooms have two identity sources:
 *   - `RoomAttributes.roomId` — stable semantic room ID (W15E), when present.
 *   - `RoomAttributes.faceId` — wall-topology face lineage, always present.
 *
 * Every consumer must resolve identity through `canonicalRoomId` so that rooms
 * without an assigned `roomId` still get one stable, collision-free identity:
 * `semantic-room-<faceId>`.
 */

export const SEMANTIC_ROOM_ID_PREFIX = 'semantic-room-'

export interface RoomIdentityAttributes {
  roomId?: string
  faceId: string
}

export interface RoomIdentityFloor {
  rooms: Array<{ id: string }>
  roomAttributes?: RoomIdentityAttributes[]
}

/** Resolve the canonical identity for a semantic room's attributes. */
export function canonicalRoomId(attributes: RoomIdentityAttributes): string {
  return attributes.roomId
    ? attributes.roomId
    : `${SEMANTIC_ROOM_ID_PREFIX}${attributes.faceId}`
}

/** Union of legacy room ids and canonical semantic room ids (deduplicated). */
export function collectCanonicalRoomIds(floor: RoomIdentityFloor): Set<string> {
  const ids = new Set<string>()
  for (const room of floor.rooms) ids.add(room.id)
  for (const attributes of floor.roomAttributes ?? []) ids.add(canonicalRoomId(attributes))
  return ids
}

/** Sorted canonical id list — stable input for fingerprints and comparisons. */
export function canonicalRoomIds(floor: RoomIdentityFloor): string[] {
  return [...collectCanonicalRoomIds(floor)].sort()
}

/** Whether `id` references a known room on the floor (legacy or semantic). */
export function isKnownRoomId(floor: RoomIdentityFloor, id: string | undefined): boolean {
  if (id === undefined) return false
  return collectCanonicalRoomIds(floor).has(id)
}
