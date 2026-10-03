import { collectCanonicalRoomIds, recordChange } from '@navi/core'
import type { CampusDocument, Floor, RoomDoor } from '@navi/core'
import type { Command, CommandHandler, MutationResult } from './types'
import { collectFloorRoomOwnershipPolygons, resolveUniqueRoomOwner } from '../geometry/room-ownership'

// ── ROU Task 4: door.ownership.reconcile ──
// The single command behind both the silent auto-run (skipHooks) and the
// manual Outliner action (normal history path). Idempotent: a canonical
// roomId is never overridden (only its missing/stale dependent ownership
// status is healed), containment never guesses on ambiguity, and only doors
// whose serialized { roomId, ownership } pair actually changes are written
// and journaled. Self-inverse via a byte-exact presence snapshot: `null`
// means "the property was absent" so restore re-deletes it.
// `needsDoorOwnershipReconcile` mirrors this change detection purely so the
// silent auto-run can skip a no-op floor without committing (F1).

/** Byte-exact `{ roomId, ownership }` presence snapshot; `null` = was absent. */
export interface DoorOwnershipSnapshot {
  roomId: string | null
  ownership: RoomDoor['ownership'] | null
}

export interface DoorOwnershipChange {
  doorId: string
  before: DoorOwnershipSnapshot
  after: DoorOwnershipSnapshot
}

function findFloor(document: CampusDocument, buildingId: string, floorId: string) {
  const building = document.buildings.find(b => b.id === buildingId)
  if (!building) return { error: `Building not found: ${buildingId}` }
  const floor = building.floors.find(f => f.id === floorId)
  if (!floor) return { error: `Floor not found: ${floorId}` }
  return { building, floor }
}

function snapshotDoorOwnership(door: RoomDoor): DoorOwnershipSnapshot {
  return {
    roomId: door.roomId !== undefined ? door.roomId : null,
    ownership: door.ownership !== undefined ? structuredClone(door.ownership) : null,
  }
}

function applyDoorOwnershipSnapshot(door: RoomDoor, snapshot: DoorOwnershipSnapshot): void {
  if (snapshot.roomId === null) delete door.roomId
  else door.roomId = snapshot.roomId
  if (snapshot.ownership === null) delete door.ownership
  else door.ownership = structuredClone(snapshot.ownership)
}

function snapshotsEqual(a: DoorOwnershipSnapshot, b: DoorOwnershipSnapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function resolveTargetSnapshot(door: RoomDoor, polygons: ReturnType<typeof collectFloorRoomOwnershipPolygons>): DoorOwnershipSnapshot {
  const resolution = resolveUniqueRoomOwner(door.position, polygons)
  if (resolution.status === 'assigned') {
    return { roomId: resolution.roomId, ownership: { status: 'assigned' } }
  }
  if (resolution.status === 'ambiguous') {
    return { roomId: null, ownership: { status: 'ambiguous', candidateRoomIds: resolution.candidateRoomIds } }
  }
  return { roomId: null, ownership: { status: 'unassigned' } }
}

/**
 * Shared decision core for the handler and `needsDoorOwnershipReconcile`.
 * Returns the target snapshot a door requires, or `null` when it already
 * matches. A canonical roomId is authoritative — geometry never overrides
 * it — but a missing/stale dependent ownership status is healed to
 * `{ status: 'assigned' }` while the roomId is kept (F2).
 */
function requiredOwnershipTarget(
  door: RoomDoor,
  canonicalIds: Set<string>,
  polygons: ReturnType<typeof collectFloorRoomOwnershipPolygons>,
): DoorOwnershipSnapshot | null {
  if (typeof door.roomId === 'string' && canonicalIds.has(door.roomId)) {
    if (door.ownership?.status === 'assigned') return null
    return { roomId: door.roomId, ownership: { status: 'assigned' } }
  }
  const target = resolveTargetSnapshot(door, polygons)
  return snapshotsEqual(snapshotDoorOwnership(door), target) ? null : target
}

/** F1: true when a reconcile run would change at least one door's serialized pair. */
export function needsDoorOwnershipReconcile(floor: Floor): boolean {
  const doors = floor.doors ?? []
  if (doors.length === 0) return false
  const canonicalIds = collectCanonicalRoomIds(floor)
  const polygons = collectFloorRoomOwnershipPolygons(floor)
  return doors.some((door) => requiredOwnershipTarget(door, canonicalIds, polygons) !== null)
}

export const doorOwnershipReconcileHandler: CommandHandler = {
  id: 'door.ownership.reconcile',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const buildingId = payload.buildingId as string
    const floorId = payload.floorId as string
    if (!buildingId || !floorId) {
      return { success: false, error: 'buildingId and floorId are required' }
    }
    const loc = findFloor(document, buildingId, floorId)
    if ('error' in loc) return { success: false, error: loc.error }
    const { floor } = loc
    const doors = floor.doors ?? []

    if (payload.restore === true) {
      const changes = payload.changes
      if (!Array.isArray(changes)) {
        return { success: false, error: 'Restore payload requires the door ownership change snapshot array' }
      }
      for (const change of changes as DoorOwnershipChange[]) {
        if (!change?.before) continue
        const door = doors.find(candidate => candidate.id === change.doorId)
        if (!door) continue
        if (snapshotsEqual(snapshotDoorOwnership(door), change.before)) continue
        applyDoorOwnershipSnapshot(door, change.before)
        recordChange(document, { entityId: door.id, entityType: 'door', operation: 'updated' })
      }
      return { success: true, entityId: floorId, data: { buildingId, floorId, changes } }
    }

    const canonicalIds = collectCanonicalRoomIds(floor)
    const polygons = collectFloorRoomOwnershipPolygons(floor)
    const changes: DoorOwnershipChange[] = []

    for (const door of doors) {
      const target = requiredOwnershipTarget(door, canonicalIds, polygons)
      if (!target) continue
      const before = snapshotDoorOwnership(door)
      applyDoorOwnershipSnapshot(door, target)
      changes.push({ doorId: door.id, before, after: target })
      recordChange(document, { entityId: door.id, entityType: 'door', operation: 'updated' })
    }

    return { success: true, entityId: floorId, data: { buildingId, floorId, changes } }
  },
  inverse(payload: Record<string, unknown>, result: MutationResult): Command | null {
    const changes = result.data?.changes
    if (!Array.isArray(changes)) return null
    return {
      id: 'door.ownership.reconcile',
      label: 'Undo Room Ownership Reconcile',
      payload: { buildingId: payload.buildingId, floorId: payload.floorId, restore: true, changes: structuredClone(changes) },
    }
  },
}
