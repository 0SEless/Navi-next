import { describe, it, expect } from 'vitest'
import { matchRoomAttributes, applyRoomAttributes, getRoomByFaceId, getSearchableRooms } from '../semantic-room-store'
import { FaceIdentityTracker, matchDerivedRoomIdentities, type IdentityMatchResult } from '../face-identity'
import type { DerivedRoom } from '../room-derivation'
import type { LocalPolygon, RoomAttributes } from '@navi/core'

// ── Helpers ──

function makePolygon(points: { x: number; y: number }[]): LocalPolygon {
  const pts = points.map((p) => ({ x: p.x, y: p.y }))
  const first = pts[0]
  const last = pts[pts.length - 1]
  if (first.x !== last.x || first.y !== last.y) {
    pts.push({ x: first.x, y: first.y })
  }
  return { points: pts }
}

function makeRoom(
  id: string,
  polygon: { x: number; y: number }[],
): DerivedRoom {
  return {
    id,
    name: `Room ${id}`,
    number: '1',
    category: 'other',
    polygon: makePolygon(polygon),
    roomDoors: [],
    metadata: {},
  }
}

// ── Case 1: Assign and retrieve ──

describe('W6B Case 1: Assign and retrieve', () => {
  it('creates room → assigns "Computer Laboratory" → retrieves attributes → correct', () => {
    const attrs: RoomAttributes = {
      faceId: 'face-0',
      name: 'Computer Laboratory',
      number: 'CL-101',
      category: 'laboratory',
      searchable: true,
    }

    // Store in Floor.roomAttributes (simulated as array)
    const floorAttrs: RoomAttributes[] = [attrs]

    const retrieved = getRoomByFaceId(floorAttrs, 'face-0')
    expect(retrieved).toBeDefined()
    expect(retrieved!.name).toBe('Computer Laboratory')
    expect(retrieved!.number).toBe('CL-101')
    expect(retrieved!.category).toBe('laboratory')
    expect(retrieved!.searchable).toBe(true)
  })

  it('getSearchableRooms returns only searchable rooms', () => {
    const floorAttrs: RoomAttributes[] = [
      { faceId: 'face-0', name: 'Room A', searchable: true },
      { faceId: 'face-1', name: 'Room B', searchable: false },
    ]

    const searchable = getSearchableRooms(floorAttrs)
    expect(searchable).toHaveLength(1)
    expect(searchable[0].name).toBe('Room A')
  })
})

// ── Case 2: Stability through wall edits ──

describe('W6B Case 2: Stability through wall edits', () => {
  it('assigns room → moves wall slightly → same semantic room attached', () => {
    const tracker = new FaceIdentityTracker(0.7)

    // Initial: rectangle 10×8
    const rooms1 = [
      makeRoom('r1', [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 8 },
        { x: 0, y: 8 },
      ]),
    ]

    // First derivation cycle
    const result1 = tracker.matchIdentities(rooms1, 0)
    const match1 = matchRoomAttributes(result1, [])
    let floorAttrs = applyRoomAttributes([], match1)

    // Assign semantic attributes
    floorAttrs = applyRoomAttributes(floorAttrs, new Map([
      [result1.identities[0].faceId, {
        faceId: result1.identities[0].faceId,
        name: 'Computer Laboratory',
        number: 'CL-101',
        category: 'laboratory',
        searchable: true,
      }],
    ]))

    const originalFaceId = result1.identities[0].faceId

    // Move top wall slightly (y: 8 → 8.2)
    const rooms2 = [
      makeRoom('r1', [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 8.2 },
        { x: 0, y: 8.2 },
      ]),
    ]

    // Second derivation cycle
    const result2 = tracker.matchIdentities(rooms2, 0)
    const match2 = matchRoomAttributes(result2, floorAttrs)
    floorAttrs = applyRoomAttributes(floorAttrs, match2)

    // Identity should be preserved
    expect(result2.identities[0].faceId).toBe(originalFaceId)

    // Semantic attributes should still be attached
    const attrs = getRoomByFaceId(floorAttrs, originalFaceId)
    expect(attrs).toBeDefined()
    expect(attrs!.name).toBe('Computer Laboratory')
    expect(attrs!.number).toBe('CL-101')
  })
})

// ── Case 3: Split handling ──

describe('W6B Case 3: Split handling', () => {
  it('assigns room → adds divider → original gets attributes → new half gets "Unassigned"', () => {
    const tracker = new FaceIdentityTracker(0.7)

    // Initial: large rectangle 20×10
    const rooms1 = [
      makeRoom('r1', [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 10 },
        { x: 0, y: 10 },
      ]),
    ]

    const result1 = tracker.matchIdentities(rooms1, 0)
    const match1 = matchRoomAttributes(result1, [])
    let floorAttrs = applyRoomAttributes([], match1)

    floorAttrs = applyRoomAttributes(floorAttrs, new Map([
      [result1.identities[0].faceId, {
        faceId: result1.identities[0].faceId,
        name: 'Computer Laboratory',
        number: 'CL-101',
        category: 'laboratory',
        searchable: true,
      }],
    ]))

    // Split: add divider at x=15
    const rooms2 = [
      makeRoom('r1', [
        { x: 0, y: 0 },
        { x: 15, y: 0 },
        { x: 15, y: 10 },
        { x: 0, y: 10 },
      ]),
      makeRoom('r2', [
        { x: 15, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 10 },
        { x: 15, y: 10 },
      ]),
    ]

    const result2 = tracker.matchIdentities(rooms2, 0)
    const match2 = matchRoomAttributes(result2, floorAttrs)
    floorAttrs = applyRoomAttributes(floorAttrs, match2)

    // Both rooms should have attributes
    expect(match2.size).toBe(2)

    // One should have the original name, one should be "Unassigned"
    const names = Array.from(match2.values()).map((r) => r.name)
    expect(names).toContain('Computer Laboratory')
    expect(names).toContain('Unassigned')

    // The larger room (15×10 = 75% of original) should get the original attributes
    const largerRoom = Array.from(match2.values()).find((r) => r.name === 'Computer Laboratory')
    expect(largerRoom).toBeDefined()
    expect(largerRoom!.number).toBe('CL-101')
  })
})

// ── Case 4: Merge ambiguity ──

describe('W6B Case 4: Merge ambiguity', () => {
  it('two rooms with different names → remove divider → both marked "Needs Review"', () => {
    const tracker = new FaceIdentityTracker(0.7)

    // Initial: two rooms side by side
    const rooms1 = [
      makeRoom('r1', [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ]),
      makeRoom('r2', [
        { x: 10, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 10 },
        { x: 10, y: 10 },
      ]),
    ]

    const result1 = tracker.matchIdentities(rooms1, 0)
    const match1 = matchRoomAttributes(result1, [])
    let floorAttrs = applyRoomAttributes([], match1)

    // Assign different names
    floorAttrs = applyRoomAttributes(floorAttrs, new Map([
      [result1.identities[0].faceId, {
        faceId: result1.identities[0].faceId,
        name: 'Computer Laboratory',
        number: 'CL-101',
        category: 'laboratory',
        searchable: true,
      }],
      [result1.identities[1].faceId, {
        faceId: result1.identities[1].faceId,
        name: 'Physics Lab',
        number: 'PH-201',
        category: 'laboratory',
        searchable: true,
      }],
    ]))

    // Merge: remove divider, one big room
    const rooms2 = [
      makeRoom('r1', [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 10 },
        { x: 0, y: 10 },
      ]),
    ]

    const result2 = tracker.matchIdentities(rooms2, 0)
    expect(result2.ambiguous).toBe(true)

    const match2 = matchRoomAttributes(result2, floorAttrs)
    floorAttrs = applyRoomAttributes(floorAttrs, match2)

    // The merged room should be "Needs Review"
    const mergedRoom = Array.from(match2.values())[0]
    expect(mergedRoom.name).toBe('Needs Review')
    expect(mergedRoom.searchable).toBe(false)
  })
})

// ── Case 5: Save/reload round-trip ──

describe('W6B Case 5: Save/reload round-trip', () => {
  it('assigns room → saves to Floor.roomAttributes → reloads → attributes preserved', () => {
    // Room attributes are stored directly in Floor.roomAttributes[]
    const floorAttrs: RoomAttributes[] = [
      {
        faceId: 'face-0',
        name: 'Computer Laboratory',
        number: 'CL-101',
        category: 'laboratory',
        searchable: true,
      },
      {
        faceId: 'face-1',
        name: 'Faculty Office',
        number: 'FO-305',
        category: 'office',
        searchable: false,
      },
    ]

    // Serialize (just JSON.stringify of the array)
    const serialized = JSON.stringify(floorAttrs)

    // Deserialize (just JSON.parse)
    const reloaded: RoomAttributes[] = JSON.parse(serialized)

    // Verify all attributes survived the round-trip
    const room0 = getRoomByFaceId(reloaded, 'face-0')
    expect(room0).toBeDefined()
    expect(room0!.name).toBe('Computer Laboratory')
    expect(room0!.number).toBe('CL-101')
    expect(room0!.category).toBe('laboratory')
    expect(room0!.searchable).toBe(true)

    const room1 = getRoomByFaceId(reloaded, 'face-1')
    expect(room1).toBeDefined()
    expect(room1!.name).toBe('Faculty Office')
    expect(room1!.number).toBe('FO-305')
    expect(room1!.category).toBe('office')
    expect(room1!.searchable).toBe(false)

    expect(reloaded).toHaveLength(2)
  })
})

// ── Case 6: Backward compatibility ──

describe('W6B Case 6: Backward compatibility', () => {
  it('loads old floor without RoomAttributes → works fine → no crash', () => {
    // Simulate old floor data (no roomAttributes field)
    const oldFloor = {
      id: 'floor-1',
      level: 1,
      walls: [],
      rooms: [],
      // No roomAttributes field
    }

    // Should work — roomAttributes is optional
    const attrs = (oldFloor as any).roomAttributes as RoomAttributes[] | undefined
    expect(attrs).toBeUndefined()

    // getRoomByFaceId should handle empty/undefined gracefully
    const result = getRoomByFaceId(attrs ?? [], 'face-0')
    expect(result).toBeUndefined()
  })

  it('handles empty array gracefully', () => {
    const result = getRoomByFaceId([], 'face-0')
    expect(result).toBeUndefined()

    const searchable = getSearchableRooms([])
    expect(searchable).toHaveLength(0)
  })
})
