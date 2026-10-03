import { describe, expect, it } from 'vitest'
import { SEMANTIC_ROOM_ID_PREFIX } from '@navi/core'
import type { CampusDocument, Floor, LocalCoord, Room, RoomDoor, Wall } from '@navi/core'
import { doorOwnershipReconcileHandler, needsDoorOwnershipReconcile } from '../door-ownership'
import type { DoorOwnershipChange } from '../door-ownership'
import { deriveRooms } from '../../geometry/room-derivation'
import { wallsToSegments } from '../../geometry/wall-to-segment'

function createDocument(): CampusDocument {
  return {
    schemaVersion: 1, version: 0,
    metadata: { campusId: 'c', name: 'C', description: '', lastModified: '', editorVersion: '' },
    buildings: [{
      id: 'b', name: 'B', code: 'B', category: 'academic', description: '', footprint: { points: [] },
      baseElevation: 0, height: 3, verticalConnectors: [], color: '#000', aliases: [], metadata: {},
      floors: [{
        id: 'f', level: 0, label: 'GF', elevation: 0, height: 3,
        rooms: [], hallways: [], staircases: [], elevators: [], entrances: [], connectorStops: [],
        parametricComponents: [], metadata: {},
      }],
    }],
    roads: [], panoramas: [], qrCheckpoints: [],
  }
}

function squareRoom(id: string, minX: number, maxX: number): Room {
  return {
    id, name: id, number: id, category: 'classroom',
    polygon: { points: [{ x: minX, y: 0 }, { x: maxX, y: 0 }, { x: maxX, y: 4 }, { x: minX, y: 4 }] },
    roomDoors: [], metadata: {},
  }
}

function door(id: string, position: LocalCoord, extra: Partial<RoomDoor> = {}): RoomDoor {
  return { id, doorType: 'standard', position, width: 0.9, metadata: {}, ...extra }
}

const ENCLOSURE_WALLS: Wall[] = [
  { id: 'w1', start: { x: 0, y: 0 }, end: { x: 4, y: 0 }, thickness: 0.15, height: 3 },
  { id: 'w2', start: { x: 4, y: 0 }, end: { x: 4, y: 4 }, thickness: 0.15, height: 3 },
  { id: 'w3', start: { x: 4, y: 4 }, end: { x: 0, y: 4 }, thickness: 0.15, height: 3 },
  { id: 'w4', start: { x: 0, y: 4 }, end: { x: 0, y: 0 }, thickness: 0.15, height: 3 },
]

/** Wall-derived semantic Room floor: one attribute-only face, canonical id required. */
function semanticFloor(): { document: CampusDocument; floor: Floor; canonicalId: string } {
  const document = createDocument()
  const floor = document.buildings[0].floors[0]
  const faceId = deriveRooms(wallsToSegments(ENCLOSURE_WALLS), [])[0]?.faceId
  if (!faceId) throw new Error('fixture did not derive an enclosed face')
  floor.rooms = []
  floor.walls = ENCLOSURE_WALLS
  floor.roomAttributes = [{ faceId, name: 'Lab', searchable: false }]
  return { document, floor, canonicalId: `${SEMANTIC_ROOM_ID_PREFIX}${faceId}` }
}

/** Legacy polygon Room floor: two disjoint rectangular rooms. */
function legacyFloor(): { document: CampusDocument; floor: Floor } {
  const document = createDocument()
  const floor = document.buildings[0].floors[0]
  floor.rooms = [squareRoom('legacy-a', 0, 4), squareRoom('legacy-b', 6, 10)]
  return { document, floor }
}

describe('door.ownership.reconcile', () => {
  it('adopts an orphan door contained by exactly one semantic room', () => {
    const { document, floor, canonicalId } = semanticFloor()
    floor.doors = [door('orphan', { x: 2, y: 2 })]

    const result = doorOwnershipReconcileHandler.execute(document, { buildingId: 'b', floorId: 'f' })

    expect(result.success).toBe(true)
    expect(result.entityId).toBe('f')
    expect(result.data).toMatchObject({ buildingId: 'b', floorId: 'f' })
    const changes = result.data?.changes as DoorOwnershipChange[]
    expect(changes).toHaveLength(1)
    expect(changes[0]).toEqual({
      doorId: 'orphan',
      before: { roomId: null, ownership: null },
      after: { roomId: canonicalId, ownership: { status: 'assigned' } },
    })
    expect(floor.doors?.[0]).toMatchObject({ roomId: canonicalId, ownership: { status: 'assigned' } })
    expect(document._changeJournal).toEqual([{ entityId: 'orphan', entityType: 'door', operation: 'updated' }])
    expect(document.version).toBe(1)
  })

  it('marks a door outside every room unassigned and clears a stale roomId', () => {
    const { document, floor } = legacyFloor()
    floor.doors = [door('outside', { x: 20, y: 20 }, { roomId: 'ghost-room', ownership: { status: 'assigned' } })]

    const result = doorOwnershipReconcileHandler.execute(document, { buildingId: 'b', floorId: 'f' })

    expect(result.success).toBe(true)
    const changes = result.data?.changes as DoorOwnershipChange[]
    expect(changes).toHaveLength(1)
    expect(changes[0]).toEqual({
      doorId: 'outside',
      before: { roomId: 'ghost-room', ownership: { status: 'assigned' } },
      after: { roomId: null, ownership: { status: 'unassigned' } },
    })
    expect('roomId' in (floor.doors?.[0] ?? {})).toBe(false)
    expect(floor.doors?.[0].ownership).toEqual({ status: 'unassigned' })
  })

  it('marks a door inside overlapping rooms ambiguous with every candidate and clears roomId', () => {
    const { document, floor } = legacyFloor()
    floor.rooms.push(squareRoom('legacy-overlap', 2, 12))
    floor.doors = [door('overlap', { x: 3, y: 2 })]

    const result = doorOwnershipReconcileHandler.execute(document, { buildingId: 'b', floorId: 'f' })

    expect(result.success).toBe(true)
    const changes = result.data?.changes as DoorOwnershipChange[]
    expect(changes).toHaveLength(1)
    expect(changes[0].after).toEqual({
      roomId: null,
      ownership: { status: 'ambiguous', candidateRoomIds: ['legacy-a', 'legacy-overlap'] },
    })
    expect('roomId' in (floor.doors?.[0] ?? {})).toBe(false)
    expect(floor.doors?.[0].ownership).toEqual({ status: 'ambiguous', candidateRoomIds: ['legacy-a', 'legacy-overlap'] })
  })

  it('never overrides a valid explicit assignment, even when the door is geometrically elsewhere', () => {
    const { document, floor } = legacyFloor()
    floor.doors = [door('assigned', { x: 100, y: 100 }, { roomId: 'legacy-a', ownership: { status: 'assigned' } })]
    const before = JSON.stringify(floor.doors)

    const result = doorOwnershipReconcileHandler.execute(document, { buildingId: 'b', floorId: 'f' })

    expect(result.success).toBe(true)
    expect(result.data?.changes).toEqual([])
    expect(JSON.stringify(floor.doors)).toBe(before)
    expect(document.version).toBe(0)
    expect(document._changeJournal).toBeUndefined()
  })

  it('is idempotent — a second run reports zero changes', () => {
    const { document, floor } = semanticFloor()
    floor.doors = [door('orphan', { x: 2, y: 2 })]

    const first = doorOwnershipReconcileHandler.execute(document, { buildingId: 'b', floorId: 'f' })
    expect((first.data?.changes as DoorOwnershipChange[]).length).toBe(1)
    const afterFirst = JSON.stringify(floor.doors)
    const versionAfterFirst = document.version

    const second = doorOwnershipReconcileHandler.execute(document, { buildingId: 'b', floorId: 'f' })

    expect(second.success).toBe(true)
    expect(second.data?.changes).toEqual([])
    expect(JSON.stringify(floor.doors)).toBe(afterFirst)
    expect(document.version).toBe(versionAfterFirst)
  })

  it('restores the pre-command doors byte-exact through its own inverse', () => {
    const { document, floor } = legacyFloor()
    floor.doors = [
      door('adopt', { x: 2, y: 2 }),
      door('clear', { x: 20, y: 20 }, { roomId: 'ghost-room', ownership: { status: 'assigned' } }),
      door('keep', { x: 100, y: 100 }, { roomId: 'legacy-b', ownership: { status: 'assigned' } }),
    ]
    const before = JSON.parse(JSON.stringify(floor.doors))

    const payload = { buildingId: 'b', floorId: 'f' }
    const result = doorOwnershipReconcileHandler.execute(document, payload)
    const changes = result.data?.changes as DoorOwnershipChange[]
    expect(changes.map(change => change.doorId)).toEqual(['adopt', 'clear'])

    const inverse = doorOwnershipReconcileHandler.inverse?.(payload, result)
    expect(inverse).not.toBeNull()
    expect(inverse?.id).toBe('door.ownership.reconcile')
    expect(inverse?.payload).toMatchObject({ buildingId: 'b', floorId: 'f', restore: true })

    const restored = doorOwnershipReconcileHandler.execute(document, inverse?.payload ?? {})

    expect(restored.success).toBe(true)
    expect(JSON.parse(JSON.stringify(floor.doors))).toEqual(before)
  })

  it('heals a canonical roomId whose ownership status is stale, keeping the assignment', () => {
    const { document, floor } = legacyFloor()
    floor.doors = [door('stale-pair', { x: 100, y: 100 }, { roomId: 'legacy-a', ownership: { status: 'unassigned' } })]
    const before = JSON.parse(JSON.stringify(floor.doors))

    const result = doorOwnershipReconcileHandler.execute(document, { buildingId: 'b', floorId: 'f' })

    expect(result.success).toBe(true)
    const changes = result.data?.changes as DoorOwnershipChange[]
    expect(changes).toEqual([{
      doorId: 'stale-pair',
      before: { roomId: 'legacy-a', ownership: { status: 'unassigned' } },
      after: { roomId: 'legacy-a', ownership: { status: 'assigned' } },
    }])
    expect(floor.doors?.[0]).toMatchObject({ roomId: 'legacy-a', ownership: { status: 'assigned' } })
    expect(document._changeJournal).toEqual([{ entityId: 'stale-pair', entityType: 'door', operation: 'updated' }])

    const afterFirst = JSON.stringify(floor.doors)
    const second = doorOwnershipReconcileHandler.execute(document, { buildingId: 'b', floorId: 'f' })
    expect(second.data?.changes).toEqual([])
    expect(JSON.stringify(floor.doors)).toBe(afterFirst)

    const inverse = doorOwnershipReconcileHandler.inverse?.({ buildingId: 'b', floorId: 'f' }, result)
    const restored = doorOwnershipReconcileHandler.execute(document, inverse?.payload ?? {})
    expect(restored.success).toBe(true)
    expect(JSON.parse(JSON.stringify(floor.doors))).toEqual(before)
  })

  it('heals a canonical roomId with missing ownership without re-evaluating geometry', () => {
    const { document, floor } = legacyFloor()
    floor.doors = [
      door('missing-ownership', { x: 20, y: 20 }, { roomId: 'legacy-a' }),
      door('settled', { x: 100, y: 100 }, { roomId: 'legacy-b', ownership: { status: 'assigned' } }),
    ]

    const result = doorOwnershipReconcileHandler.execute(document, { buildingId: 'b', floorId: 'f' })

    const changes = result.data?.changes as DoorOwnershipChange[]
    expect(changes.map(change => change.doorId)).toEqual(['missing-ownership'])
    expect(changes[0].after).toEqual({ roomId: 'legacy-a', ownership: { status: 'assigned' } })
    expect(floor.doors?.[0]).toMatchObject({ roomId: 'legacy-a', ownership: { status: 'assigned' } })
    expect(floor.doors?.[1]).toMatchObject({ roomId: 'legacy-b', ownership: { status: 'assigned' } })
  })
})

describe('needsDoorOwnershipReconcile', () => {
  it('returns false for a clean floor with settled doors', () => {
    const { floor, canonicalId } = semanticFloor()
    expect(needsDoorOwnershipReconcile(floor)).toBe(false)

    floor.doors = [
      door('assigned', { x: 2, y: 2 }, { roomId: canonicalId, ownership: { status: 'assigned' } }),
      door('outside', { x: 50, y: 50 }, { ownership: { status: 'unassigned' } }),
    ]
    expect(needsDoorOwnershipReconcile(floor)).toBe(false)
  })

  it('returns true for an orphan door until the reconcile adopts it (adopted state is false)', () => {
    const { document, floor } = semanticFloor()
    floor.doors = [door('orphan', { x: 2, y: 2 })]
    expect(needsDoorOwnershipReconcile(floor)).toBe(true)

    doorOwnershipReconcileHandler.execute(document, { buildingId: 'b', floorId: 'f' })
    expect(needsDoorOwnershipReconcile(floor)).toBe(false)
  })

  it('returns true for a canonical roomId with stale ownership', () => {
    const { floor, canonicalId } = semanticFloor()
    floor.doors = [door('stale', { x: 2, y: 2 }, { roomId: canonicalId, ownership: { status: 'unassigned' } })]
    expect(needsDoorOwnershipReconcile(floor)).toBe(true)
  })

  it('returns true for a canonical roomId with missing ownership and false after healing', () => {
    const { document, floor, canonicalId } = semanticFloor()
    floor.doors = [door('missing', { x: 2, y: 2 }, { roomId: canonicalId })]
    expect(needsDoorOwnershipReconcile(floor)).toBe(true)

    doorOwnershipReconcileHandler.execute(document, { buildingId: 'b', floorId: 'f' })
    expect(needsDoorOwnershipReconcile(floor)).toBe(false)
  })
})
