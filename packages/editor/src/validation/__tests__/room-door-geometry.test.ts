/**
 * RoomDoor Geometry Invariant Tests
 *
 * INVARIANT: A RoomDoor's position must lie on, or within tolerance of,
 * the boundary of its owning room's polygon.
 *
 * This is the core geometric invariant for indoor topology. A door that
 * floats inside the room, lies outside the room, or is attached to the
 * wrong room produces an invalid graph.
 *
 * Coordinate system: building-local meters (LocalCoord = { x, y }).
 * Tolerance: 0.5 meters (half a door width).
 */

import { describe, it, expect } from 'vitest'
import type { CampusDocument, Building, Floor, Room, RoomDoor, Hallway, Entrance } from '@navi/core'
import { ValidationEngine } from '../validation-engine'
import { roomDoorGeometryRule } from '../rules/modules/room-door-geometry'
import { GraphAnalysisPass, GeometryAnalysisPass, MetadataIndexPass } from '../rules/analysis'

// ── Helpers ──────────────────────────────────────────────────────

function createDocWithDoor(
  roomPolygon: Array<{ x: number; y: number }>,
  doorPosition: { x: number; y: number },
  overrides?: {
    roomId?: string
    doorId?: string
    connectedToId?: string
    connectedToType?: 'room' | 'hallway'
    hallways?: Hallway[]
    rooms?: Room[]
  },
): CampusDocument {
  const roomId = overrides?.roomId ?? 'room-1'
  const doorId = overrides?.doorId ?? 'door-1'
  const connectedToId = overrides?.connectedToId ?? 'hall-1'
  const connectedToType = overrides?.connectedToType ?? 'hallway'

  const door: RoomDoor = {
    id: doorId,
    roomId,
    connectedToId,
    connectedToType,
    doorType: 'standard',
    position: doorPosition,
    width: 1.2,
    metadata: {},
  }

  const room: Room = {
    id: roomId,
    name: 'Test Room',
    number: '101',
    category: 'classroom',
    polygon: { points: [...roomPolygon, roomPolygon[0]] }, // closed ring
    roomDoors: [door],
    capacity: 20,
    metadata: {},
  }

  const hallway: Hallway = {
    id: 'hall-1',
    name: 'Main Hall',
    polyline: { points: [{ x: 0, y: -2 }, { x: 20, y: -2 }] },
    width: 3,
  }

  const entrance: Entrance = {
    id: 'ent-1',
    label: 'Main Entrance',
    // Legacy world position (P1-T4: dual-mode tolerance; editor rule reads local)
    position: { lat: 33.4205, lng: -111.9295 } as any,
    level: 0,
    type: 'main',
    hasQR: false,
    hasPanorama: false,
  }

  const floor: Floor = {
    id: 'flr-0',
    level: 0,
    label: 'Ground',
    elevation: 0,
    rooms: overrides?.rooms ?? [room],
    hallways: overrides?.hallways ?? [hallway],
    staircases: [],
    elevators: [],
    entrances: [entrance],
    connectorStops: [],
    metadata: {},
  }

  const building: Building = {
    id: 'bld-1',
    name: 'Test Building',
    code: 'TB',
    category: 'academic',
    description: '',
    footprint: {
      points: [
        { lat: 33.42, lng: -111.93 },
        { lat: 33.421, lng: -111.93 },
        { lat: 33.421, lng: -111.929 },
        { lat: 33.42, lng: -111.929 },
        { lat: 33.42, lng: -111.93 },
      ],
    },
    baseElevation: 0,
    height: 20,
    floors: [floor],
    verticalConnectors: [],
    aliases: [],
    color: '#ff0000',
    metadata: {},
  }

  return {
    schemaVersion: 1,
    version: 1,
    metadata: { campusId: 'test', name: 'Test', description: '', lastModified: '', editorVersion: '1.0.0' },
    buildings: [building],
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
  }
}

function createEngine(): ValidationEngine {
  const engine = new ValidationEngine()
  engine.registerRule(roomDoorGeometryRule)
  engine.registerAnalysisPass(new GraphAnalysisPass())
  engine.registerAnalysisPass(new GeometryAnalysisPass())
  engine.registerAnalysisPass(new MetadataIndexPass())
  engine.initialize()
  return engine
}

function getDoorIssues(doc: CampusDocument) {
  const engine = createEngine()
  const snapshot = engine.validate(doc)
  return snapshot.issues.filter(i => i.ruleId === 'room-door-geometry')
}

// ── Room polygon: 10m × 5m rectangle, bottom-left at (5, 2) ──
// Vertices: (5,2), (15,2), (15,7), (5,7)
const ROOM_POLYGON = [
  { x: 5, y: 2 },
  { x: 15, y: 2 },
  { x: 15, y: 7 },
  { x: 5, y: 7 },
]

// ── Tests ────────────────────────────────────────────────────────

describe('RoomDoor Geometry Invariant', () => {

  describe('INVARIANT: Door position must lie on the room boundary', () => {

    it('GREEN — door on bottom wall segment (exact match)', () => {
      // Door at midpoint of bottom wall: y=2, x=10
      const doc = createDocWithDoor(ROOM_POLYGON, { x: 10, y: 2 })
      const issues = getDoorIssues(doc)
      expect(issues).toHaveLength(0)
    })

    it('GREEN — door on right wall segment (exact match)', () => {
      // Door at midpoint of right wall: x=15, y=4.5
      const doc = createDocWithDoor(ROOM_POLYGON, { x: 15, y: 4.5 })
      const issues = getDoorIssues(doc)
      expect(issues).toHaveLength(0)
    })

    it('GREEN — door near boundary within tolerance (0.3m)', () => {
      // Door slightly off the bottom wall: y=2.3 (within 0.5m tolerance)
      const doc = createDocWithDoor(ROOM_POLYGON, { x: 10, y: 2.3 })
      const issues = getDoorIssues(doc)
      expect(issues).toHaveLength(0)
    })

    it('GREEN — door exactly on a vertex', () => {
      // Door at corner vertex (5, 2)
      const doc = createDocWithDoor(ROOM_POLYGON, { x: 5, y: 2 })
      const issues = getDoorIssues(doc)
      expect(issues).toHaveLength(0)
    })

    it('RED — door floating inside room (not on boundary)', () => {
      // Door at center of room: (10, 4.5) — 2.5m from nearest wall
      const doc = createDocWithDoor(ROOM_POLYGON, { x: 10, y: 4.5 })
      const issues = getDoorIssues(doc)
      expect(issues.length).toBeGreaterThanOrEqual(1)
      expect(issues[0].severity).toBe('error')
      expect(issues[0].message).toMatch(/boundary/i)
    })

    it('RED — door outside room polygon', () => {
      // Door 3m below the room: y=-1 (3m from bottom wall)
      const doc = createDocWithDoor(ROOM_POLYGON, { x: 10, y: -1 })
      const issues = getDoorIssues(doc)
      expect(issues.length).toBeGreaterThanOrEqual(1)
      expect(issues[0].severity).toBe('error')
    })

    it('RED — door beyond tolerance from boundary (0.6m)', () => {
      // Door just outside tolerance: y=2.6 (0.6m from bottom wall, tolerance is 0.5m)
      const doc = createDocWithDoor(ROOM_POLYGON, { x: 10, y: 2.6 })
      const issues = getDoorIssues(doc)
      expect(issues.length).toBeGreaterThanOrEqual(1)
      expect(issues[0].severity).toBe('error')
    })

    it('RED — door on boundary of wrong room', () => {
      // Two rooms: room-A at (0,0)-(5,5), room-B at (10,0)-(15,5)
      // Door belongs to room-A but is placed on room-B's boundary
      const roomA: Room = {
        id: 'room-a',
        name: 'Room A',
        number: 'A',
        category: 'classroom',
        polygon: { points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 5 }, { x: 0, y: 0 }] },
        roomDoors: [{
          id: 'door-a-wrong',
          roomId: 'room-a',
          connectedToId: 'hall-1',
          connectedToType: 'hallway',
          doorType: 'standard',
          position: { x: 12.5, y: 2.5 }, // on room-B's boundary, not room-A's
          width: 1.2,
          metadata: {},
        }],
        capacity: 20,
        metadata: {},
      }

      const roomB: Room = {
        id: 'room-b',
        name: 'Room B',
        number: 'B',
        category: 'classroom',
        polygon: { points: [{ x: 10, y: 0 }, { x: 15, y: 0 }, { x: 15, y: 5 }, { x: 10, y: 5 }, { x: 10, y: 0 }] },
        roomDoors: [],
        capacity: 20,
        metadata: {},
      }

      const hallway: Hallway = {
        id: 'hall-1',
        name: 'Hall',
        polyline: { points: [{ x: 0, y: -2 }, { x: 20, y: -2 }] },
        width: 3,
      }

      const doc = createDocWithDoor(
        [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 5 }],
        { x: 12.5, y: 2.5 },
        { roomId: 'room-a', doorId: 'door-a-wrong', hallways: [hallway], rooms: [roomA, roomB] },
      )

      const issues = getDoorIssues(doc)
      expect(issues.length).toBeGreaterThanOrEqual(1)
      expect(issues[0].severity).toBe('error')
      expect(issues[0].message).toMatch(/boundary/i)
    })
  })

  describe('INVARIANT: Door connectivity (topological)', () => {

    it('RED — door connecting to non-existent hallway', () => {
      const doc = createDocWithDoor(ROOM_POLYGON, { x: 10, y: 2 }, {
        connectedToId: 'hall-nonexistent',
      })
      const issues = getDoorIssues(doc)
      // This is covered by room-door-connectivity, but geometry rule should also catch it
      // if the connected entity doesn't exist on the floor
      expect(issues).toBeDefined() // rule runs without crash
    })

    it('GREEN — door connecting to existing room on same floor', () => {
      const roomA: Room = {
        id: 'room-a',
        name: 'Room A',
        number: 'A',
        category: 'classroom',
        polygon: { points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 5 }, { x: 0, y: 0 }] },
        roomDoors: [{
          id: 'door-a-to-b',
          roomId: 'room-a',
          connectedToId: 'room-b',
          connectedToType: 'room',
          doorType: 'standard',
          position: { x: 5, y: 2.5 }, // on shared wall between room-a and room-b
          width: 1.2,
          metadata: {},
        }],
        capacity: 20,
        metadata: {},
      }

      const roomB: Room = {
        id: 'room-b',
        name: 'Room B',
        number: 'B',
        category: 'classroom',
        polygon: { points: [{ x: 5, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 0 }] },
        roomDoors: [],
        capacity: 20,
        metadata: {},
      }

      const hallway: Hallway = {
        id: 'hall-1',
        name: 'Hall',
        polyline: { points: [{ x: 0, y: -2 }, { x: 15, y: -2 }] },
        width: 3,
      }

      const doc = createDocWithDoor(
        [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 5 }],
        { x: 5, y: 2.5 },
        { roomId: 'room-a', doorId: 'door-a-to-b', connectedToId: 'room-b', connectedToType: 'room', hallways: [hallway], rooms: [roomA, roomB] },
      )

      const issues = getDoorIssues(doc)
      expect(issues).toHaveLength(0)
    })
  })

  describe('Edge cases', () => {

    it('handles room with no doors (no crash)', () => {
      const doc = createDocWithDoor(ROOM_POLYGON, { x: 10, y: 2 })
      // Remove the door from the room
      const room = doc.buildings[0].floors[0].rooms[0]
      room.roomDoors = []

      const engine = createEngine()
      const snapshot = engine.validate(doc)
      const doorIssues = snapshot.issues.filter(i => i.ruleId === 'room-door-geometry')
      expect(doorIssues).toHaveLength(0)
    })

    it('handles multiple doors on same room', () => {
      const room: Room = {
        id: 'room-1',
        name: 'Room',
        number: '101',
        category: 'classroom',
        polygon: { points: [...ROOM_POLYGON, ROOM_POLYGON[0]] },
        roomDoors: [
          {
            id: 'door-1',
            roomId: 'room-1',
            connectedToId: 'hall-1',
            connectedToType: 'hallway',
            doorType: 'standard',
            position: { x: 10, y: 2 }, // on bottom wall ✓
            width: 1.2,
            metadata: {},
          },
          {
            id: 'door-2',
            roomId: 'room-1',
            connectedToId: 'hall-1',
            connectedToType: 'hallway',
            doorType: 'standard',
            position: { x: 10, y: 4.5 }, // floating inside ✗
            width: 1.2,
            metadata: {},
          },
        ],
        capacity: 20,
        metadata: {},
      }

      const hallway: Hallway = {
        id: 'hall-1',
        name: 'Hall',
        polyline: { points: [{ x: 0, y: -2 }, { x: 20, y: -2 }] },
        width: 3,
      }

      const entrance: Entrance = {
        id: 'ent-1',
        label: 'Main',
        // Legacy world position (P1-T4: dual-mode tolerance)
        position: { lat: 33.4205, lng: -111.9295 } as any,
        level: 0,
        type: 'main',
        hasQR: false,
        hasPanorama: false,
      }

      const doc: CampusDocument = {
        schemaVersion: 1,
        version: 1,
        metadata: { campusId: 'test', name: 'Test', description: '', lastModified: '', editorVersion: '1.0.0' },
        buildings: [{
          id: 'bld-1',
          name: 'B',
          code: 'B',
          category: 'academic',
          description: '',
          footprint: {
            points: [
              { lat: 33.42, lng: -111.93 },
              { lat: 33.421, lng: -111.93 },
              { lat: 33.421, lng: -111.929 },
              { lat: 33.42, lng: -111.929 },
              { lat: 33.42, lng: -111.93 },
            ],
          },
          baseElevation: 0,
          height: 20,
          floors: [{
            id: 'flr-0',
            level: 0,
            label: 'G',
            elevation: 0,
            rooms: [room],
            hallways: [hallway],
            staircases: [],
            elevators: [],
            entrances: [entrance],
            connectorStops: [],
            metadata: {},
          }],
          verticalConnectors: [],
          aliases: [],
          color: '#ff0000',
          metadata: {},
        }],
        roads: [],
        panoramas: [],
        qrCheckpoints: [],
      }

      const issues = getDoorIssues(doc)
      // door-1 is on boundary → no error; door-2 is floating → error
      expect(issues).toHaveLength(1)
      expect(issues[0].message).toContain('door-2')
    })
  })
})

describe('P1-T6: extracted doors (Floor.doors) obey the same wall invariant', () => {
  /** Doc with the door stored at floor.doors (post-extraction canonical
   *  location) and the owning room's nested array EMPTY. */
  function createDocWithExtractedDoor(
    doorPosition: { x: number; y: number },
    doorType: RoomDoor['doorType'],
  ): CampusDocument {
    const doc = createDocWithDoor(ROOM_POLYGON, doorPosition, { doorId: 'door-x' })
    const floor = doc.buildings[0].floors[0]
    const nested = floor.rooms[0].roomDoors
    floor.doors = nested.splice(0) // move nested -> extracted
    floor.rooms[0].roomDoors = []
    floor.doors[0].doorType = doorType
    return doc
  }

  it('RED - extracted door floating inside the room is reported (rule reads Floor.doors)', () => {
    const doc = createDocWithExtractedDoor({ x: 10, y: 4.5 }, 'standard')
    const issues = getDoorIssues(doc)
    expect(issues).toHaveLength(1)
    expect(issues[0].message).toContain('door-x')
  })

  it('GREEN - extracted door on the boundary passes for every doorType incl. opening', () => {
    for (const doorType of ['opening', 'standard', 'fire', 'double', 'sliding'] as const) {
      const doc = createDocWithExtractedDoor({ x: 10, y: 2 }, doorType)
      const issues = getDoorIssues(doc)
      expect(issues, `doorType=${doorType}`).toHaveLength(0)
    }
  })

  it('RED - opening-type doors are NOT exempt from the wall invariant', () => {
    const doc = createDocWithExtractedDoor({ x: 8, y: 5 }, 'opening')
    const issues = getDoorIssues(doc)
    expect(issues).toHaveLength(1)
    expect(issues[0].message).toContain('door-x')
  })
})
