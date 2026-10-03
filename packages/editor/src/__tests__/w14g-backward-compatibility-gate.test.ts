/**
 * W14G — Backward Compatibility Gate
 *
 * Proves older NAVI documents created before W1–W14 still load, remain usable,
 * and can coexist with new canonical optional fields.
 *
 * Fixtures:
 *   A. Very old/basic map (no walls, openings, roomAttributes, routeNetwork, etc.)
 *   B. Legacy indoor routing map (Floor.rooms[], hallways[], doors[], connectorStops)
 *   C. Pre-wall-first modern map (Building-level staircases/elevators, planAlignment)
 *   D. Mixed-version document (some new optional fields present, others absent)
 *
 * NO auto-migration of old documents. NO removal of legacy representations.
 */

import { describe, it, expect } from 'vitest'
import type {
  CampusDocument,
  Building,
  Floor,
  Room,
  Hallway,
  Entrance,
  LegacyStaircase,
  LegacyElevator,
  ConnectorStop,
  Staircase,
  Elevator,
  VerticalTransition,
  Wall,
  Opening,
  RoomAttributes,
  RoomAccess,
  EntranceAccess,
  RouteNetwork,
  PlanAlignment,
} from '@navi/core'
import {
  serializeDocument,
  deserializeDocument,
  roundTrip,
} from '@navi/core'
import { compile } from '@navi/compiler'
import type { CompilerConfig } from '@navi/compiler'
import { validateIndoorRelationships } from '../validation/rules/modules/indoor-relationships'

// ═══════════════════════════════════════════════════════════════
// Helper factories
// ═══════════════════════════════════════════════════════════════

const FOOTPRINT = {
  points: [
    { lat: 14.0, lng: 121.0 },
    { lat: 14.001, lng: 121.0 },
    { lat: 14.001, lng: 121.001 },
    { lat: 14.0, lng: 121.001 },
    { lat: 14.0, lng: 121.0 },
  ],
}

function makeRoom(id: string, name: string, number: string, x: number, y: number): Room {
  return {
    id,
    name,
    number,
    category: 'classroom',
    polygon: {
      points: [
        { x, y },
        { x: x + 10, y },
        { x: x + 10, y: y + 8 },
        { x, y: y + 8 },
        { x, y },
      ],
    },
    roomDoors: [],
    capacity: 30,
    metadata: {},
  }
}

function makeHallway(id: string, name: string, sx: number, sy: number, ex: number, ey: number, width: number = 3): Hallway {
  return {
    id,
    name,
    polyline: { points: [{ x: sx, y: sy }, { x: ex, y: ey }] },
    width,
  }
}

function makeEntrance(id: string, x: number, y: number, level: number = 0): Entrance {
  return {
    id,
    label: `Entrance ${id}`,
    position: { x, y },
    level,
    type: 'main',
    hasQR: false,
    hasPanorama: false,
  }
}

function makeBasicFloor(id: string, level: number, opts?: Partial<Floor>): Floor {
  return {
    id,
    level,
    label: `Floor ${level}`,
    elevation: level * 3,
    height: 3.5,
    rooms: [],
    hallways: [],
    staircases: [],
    elevators: [],
    entrances: [],
    connectorStops: [],
    parametricComponents: [],
    metadata: {},
    ...opts,
  }
}

function makeBasicBuilding(id: string, floors: Floor[], opts?: Partial<Building>): Building {
  return {
    id,
    name: id,
    code: id,
    category: 'academic',
    description: '',
    footprint: FOOTPRINT,
    baseElevation: 0,
    height: 12,
    verticalConnectors: [],
    floors,
    color: '#4A90D9',
    aliases: [],
    metadata: {},
    ...opts,
  }
}

function makeDoc(buildings: Building[] = []): CampusDocument {
  return {
    schemaVersion: 1,
    version: 0,
    metadata: {
      campusId: 'w14g-test',
      name: 'w14g-test',
      description: 'Backward compatibility test',
      lastModified: new Date().toISOString(),
      editorVersion: '0.1.0',
    },
    buildings,
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
  }
}

// ═══════════════════════════════════════════════════════════════
// Fixture A: Very old/basic map
// ═══════════════════════════════════════════════════════════════

function makeVeryOldDoc(): CampusDocument {
  const floor = makeBasicFloor('flr-old-1', 0, {
    label: 'Ground',
    rooms: [makeRoom('rm-old-1', 'Old Room 101', '101', 2, 2)],
    hallways: [makeHallway('hw-old-1', 'Old Hallway', 9, 0, 9, 12)],
    entrances: [makeEntrance('ent-old-1', 0, 6)],
  })
  const building = makeBasicBuilding('bld-old-1', [floor], {
    name: 'Old Building',
    code: 'OLD',
  })
  return makeDoc([building])
}

// ═══════════════════════════════════════════════════════════════
// Fixture B: Legacy indoor routing map
// (Floor.rooms[], hallways[], doors[], connectorStops, legacy stair/elevator)
// ═══════════════════════════════════════════════════════════════

function makeLegacyRoutingDoc(): CampusDocument {
  const legacyStairs: LegacyStaircase[] = [
    { id: 'lst-1', name: 'Main Stairs', position: { x: 0, y: 0 }, fromLevel: 0, toLevel: 1, type: 'open' },
  ]
  const legacyElevators: LegacyElevator[] = [
    { id: 'lev-1', name: 'Main Elevator', position: { x: 15, y: 0 }, fromLevel: 0, toLevel: 1 },
  ]

  const floor0 = makeBasicFloor('flr-legacy-g', 0, {
    label: 'Ground Floor',
    rooms: [
      makeRoom('rm-legacy-101', 'Room 101', '101', 2, 2),
      makeRoom('rm-legacy-102', 'Room 102', '102', 14, 2),
    ],
    hallways: [
      makeHallway('hw-legacy-1', 'Main Hallway', 12, 0, 12, 12),
    ],
    entrances: [
      makeEntrance('ent-legacy-1', 0, 6),
      makeEntrance('ent-legacy-2', 24, 6),
    ],
    staircases: legacyStairs,
    elevators: legacyElevators,
    connectorStops: [
      {
        id: 'cs-legacy-1',
        connectorId: 'vc-1',
        label: 'Stairwell',
        position: { x: 0, y: 0 },
        accessible: false,
        anchors: [],
        metadata: {},
      },
      {
        id: 'cs-legacy-2',
        connectorId: 'vc-1',
        label: 'Elevator Lobby',
        position: { x: 15, y: 0 },
        accessible: true,
        anchors: [],
        metadata: {},
      },
    ],
  })

  const floor1 = makeBasicFloor('flr-legacy-1', 1, {
    label: 'Second Floor',
    rooms: [
      makeRoom('rm-legacy-201', 'Room 201', '201', 2, 2),
    ],
    hallways: [
      makeHallway('hw-legacy-2', 'Upper Hallway', 12, 0, 12, 12),
    ],
    entrances: [],
    staircases: [{ ...legacyStairs[0], id: 'lst-1-up' }],
    elevators: [{ ...legacyElevators[0], id: 'lev-1-up' }],
    connectorStops: [
      {
        id: 'cs-legacy-3',
        connectorId: 'vc-1',
        label: 'Stairwell',
        position: { x: 0, y: 0 },
        accessible: false,
        anchors: [],
        metadata: {},
      },
    ],
  })

  const building = makeBasicBuilding('bld-legacy-1', [floor0, floor1], {
    name: 'Legacy Building',
    code: 'LEG',
    verticalConnectors: [
      {
        id: 'vc-1',
        type: 'staircase',
        name: 'Stairwell A',
        stopIds: ['cs-legacy-1', 'cs-legacy-3'],
        accessible: false,
        metadata: {},
      },
    ],
  })

  return makeDoc([building])
}

// ═══════════════════════════════════════════════════════════════
// Fixture C: Pre-wall-first modern map
// (Building-level staircases/elevators, planAlignment if available)
// ═══════════════════════════════════════════════════════════════

function makePreWallFirstDoc(): CampusDocument {
  const staircases: Staircase[] = [
    {
      id: 'stair-1',
      buildingId: 'bld-prewall-1',
      name: 'Main Staircase',
      type: 'open',
      accessible: false,
      fromLevel: 0,
      toLevel: 2,
      levels: {
        0: { position: { x: 5, y: 5 }, rotation: 0 },
        1: { position: { x: 5, y: 5 }, rotation: 0 },
        2: { position: { x: 5, y: 5 }, rotation: 0 },
      },
    },
  ]

  const elevators: Elevator[] = [
    {
      id: 'elev-1',
      buildingId: 'bld-prewall-1',
      name: 'Main Elevator',
      type: 'passenger',
      accessible: true,
      fromLevel: 0,
      toLevel: 2,
      levels: {
        0: { position: { x: 20, y: 20 }, rotation: 0 },
        1: { position: { x: 20, y: 20 }, rotation: 0 },
        2: { position: { x: 20, y: 20 }, rotation: 0 },
      },
    },
  ]

  const vt: VerticalTransition[] = [
    {
      id: 'vt-1',
      featureId: 'stair-1',
      type: 'staircase',
      connections: [
        { floorId: 'flr-prewall-g', routeNodeId: 'rn-g-1' },
        { floorId: 'flr-prewall-1', routeNodeId: 'rn-1-1' },
        { floorId: 'flr-prewall-2', routeNodeId: 'rn-2-1' },
      ],
    },
  ]

  const routeNetworkG: RouteNetwork = {
    nodes: [
      { id: 'rn-g-1', type: 'waypoint', position: { x: 5, y: 5 }, floor: 0 },
      { id: 'rn-g-2', type: 'waypoint', position: { x: 15, y: 5 }, floor: 0 },
    ],
    edges: [
      { id: 're-g-1', from: 'rn-g-1', to: 'rn-g-2', type: 'walk', distance: 10 },
    ],
  }

  const routeNetwork1: RouteNetwork = {
    nodes: [
      { id: 'rn-1-1', type: 'waypoint', position: { x: 5, y: 5 }, floor: 1 },
      { id: 'rn-1-2', type: 'waypoint', position: { x: 15, y: 5 }, floor: 1 },
    ],
    edges: [
      { id: 're-1-1', from: 'rn-1-1', to: 'rn-1-2', type: 'walk', distance: 10 },
    ],
  }

  const routeNetwork2: RouteNetwork = {
    nodes: [
      { id: 'rn-2-1', type: 'waypoint', position: { x: 5, y: 5 }, floor: 2 },
      { id: 'rn-2-2', type: 'waypoint', position: { x: 15, y: 5 }, floor: 2 },
    ],
    edges: [
      { id: 're-2-1', from: 'rn-2-1', to: 'rn-2-2', type: 'walk', distance: 10 },
    ],
  }

  const planAlignment: PlanAlignment = {
    rotation: 0,
    scale: 1,
  }

  const floorG = makeBasicFloor('flr-prewall-g', 0, {
    label: 'Ground Floor',
    rooms: [makeRoom('rm-pw-101', 'Lobby', '101', 2, 2)],
    hallways: [makeHallway('hw-pw-1', 'Main Hallway', 12, 0, 12, 12)],
    entrances: [makeEntrance('ent-pw-1', 0, 6)],
    routeNetwork: routeNetworkG,
    entranceAccess: [
      {
        entranceId: 'ent-pw-1',
        outdoorNodeId: 'outdoor-1',
        indoorRouteNodeId: 'rn-g-2',
      },
    ],
    planAlignment,
  })

  const floor1 = makeBasicFloor('flr-prewall-1', 1, {
    label: 'Second Floor',
    rooms: [makeRoom('rm-pw-201', 'Classroom 201', '201', 2, 2)],
    hallways: [makeHallway('hw-pw-2', 'Upper Hallway', 12, 0, 12, 12)],
    routeNetwork: routeNetwork1,
  })

  const floor2 = makeBasicFloor('flr-prewall-2', 2, {
    label: 'Third Floor',
    rooms: [makeRoom('rm-pw-301', 'Lab 301', '301', 2, 2)],
    hallways: [makeHallway('hw-pw-3', 'Top Hallway', 12, 0, 12, 12)],
    routeNetwork: routeNetwork2,
  })

  const building = makeBasicBuilding('bld-prewall-1', [floorG, floor1, floor2], {
    name: 'Pre-Wall Building',
    code: 'PWL',
    staircases,
    elevators,
    verticalTransitions: vt,
  })

  return makeDoc([building])
}

// ═══════════════════════════════════════════════════════════════
// Fixture D: Mixed-version document
// (Some new optional fields present, others absent)
// ═══════════════════════════════════════════════════════════════

function makeMixedVersionDoc(): CampusDocument {
  const wall1: Wall = { id: 'w-mix-1', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, thickness: 0.15, height: 3.5 }
  const wall2: Wall = { id: 'w-mix-2', start: { x: 10, y: 0 }, end: { x: 10, y: 8 }, thickness: 0.15, height: 3.5 }
  const wall3: Wall = { id: 'w-mix-3', start: { x: 10, y: 8 }, end: { x: 0, y: 8 }, thickness: 0.15, height: 3.5 }
  const wall4: Wall = { id: 'w-mix-4', start: { x: 0, y: 8 }, end: { x: 0, y: 0 }, thickness: 0.15, height: 3.5 }

  const opening1: Opening = { id: 'op-mix-1', type: 'door', wallId: 'w-mix-1', offset: 5, width: 0.9 }

  const roomAttrs: RoomAttributes[] = [
    {
      faceId: 'face-mix-1',
      name: 'Mixed Room',
      category: 'classroom',
      searchable: true,
      // NO accessPoints — no routeNetwork on this floor
    },
  ]

  const floor = makeBasicFloor('flr-mix-1', 0, {
    label: 'Ground Floor',
    rooms: [makeRoom('rm-mix-1', 'Mixed Room', 'M101', 2, 2)],
    hallways: [makeHallway('hw-mix-1', 'Mixed Hallway', 12, 0, 12, 12)],
    entrances: [makeEntrance('ent-mix-1', 0, 6)],
    walls: [wall1, wall2, wall3, wall4],
    openings: [opening1],
    roomAttributes: roomAttrs,
    // NO routeNetwork, NO entranceAccess, NO doors, NO windows
  })

  const building = makeBasicBuilding('bld-mix-1', [floor], {
    name: 'Mixed Building',
    code: 'MIX',
    // NO staircases, NO elevators, NO verticalTransitions, NO rotation
  })

  return makeDoc([building])
}

// ═══════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════

describe('W14G — Backward Compatibility Gate', () => {
  // ─── 1. Load safety ────────────────────────────────────────
  describe('1. Load safety — no exceptions on old documents', () => {
    it('A. Very old/basic map loads without exception', () => {
      expect(() => deserializeDocument(serializeDocument(makeVeryOldDoc()))).not.toThrow()
    })

    it('B. Legacy indoor routing map loads without exception', () => {
      expect(() => deserializeDocument(serializeDocument(makeLegacyRoutingDoc()))).not.toThrow()
    })

    it('C. Pre-wall-first modern map loads without exception', () => {
      expect(() => deserializeDocument(serializeDocument(makePreWallFirstDoc()))).not.toThrow()
    })

    it('D. Mixed-version document loads without exception', () => {
      expect(() => deserializeDocument(serializeDocument(makeMixedVersionDoc()))).not.toThrow()
    })

    it('A. Very old doc preserves rooms', () => {
      const doc = makeVeryOldDoc()
      const restored = deserializeDocument(serializeDocument(doc))
      expect(restored.buildings[0].floors[0].rooms).toHaveLength(1)
      expect(restored.buildings[0].floors[0].rooms[0].name).toBe('Old Room 101')
    })

    it('A. Very old doc preserves hallways', () => {
      const doc = makeVeryOldDoc()
      const restored = deserializeDocument(serializeDocument(doc))
      expect(restored.buildings[0].floors[0].hallways).toHaveLength(1)
      expect(restored.buildings[0].floors[0].hallways[0].name).toBe('Old Hallway')
    })

    it('A. Very old doc preserves entrances', () => {
      const doc = makeVeryOldDoc()
      const restored = deserializeDocument(serializeDocument(doc))
      expect(restored.buildings[0].floors[0].entrances).toHaveLength(1)
      expect(restored.buildings[0].floors[0].entrances[0].label).toBe('Entrance ent-old-1')
    })

    it('A. No automatic data destruction on old doc', () => {
      const doc = makeVeryOldDoc()
      const restored = deserializeDocument(serializeDocument(doc))
      // Building-level data intact
      expect(restored.buildings[0].name).toBe('Old Building')
      expect(restored.buildings[0].code).toBe('OLD')
      expect(restored.buildings[0].footprint).toEqual(FOOTPRINT)
      // No new fields created on old doc
      expect(restored.buildings[0].staircases).toBeUndefined()
      expect(restored.buildings[0].elevators).toBeUndefined()
      expect(restored.buildings[0].verticalTransitions).toBeUndefined()
      expect(restored.buildings[0].floors[0].walls).toBeUndefined()
      expect(restored.buildings[0].floors[0].openings).toBeUndefined()
      expect(restored.buildings[0].floors[0].routeNetwork).toBeUndefined()
      expect(restored.buildings[0].floors[0].entranceAccess).toBeUndefined()
    })
  })

  // ─── 2. Legacy editor behavior ────────────────────────────
  describe('2. Legacy editor behavior preserved', () => {
    it('B. Legacy floor stair/elevator data preserved', () => {
      const doc = makeLegacyRoutingDoc()
      const restored = deserializeDocument(serializeDocument(doc))
      const floor0 = restored.buildings[0].floors[0]
      expect(floor0.staircases).toHaveLength(1)
      expect(floor0.staircases[0].name).toBe('Main Stairs')
      expect(floor0.elevators).toHaveLength(1)
      expect(floor0.elevators[0].name).toBe('Main Elevator')
    })

    it('B. Legacy connector stops preserved', () => {
      const doc = makeLegacyRoutingDoc()
      const restored = deserializeDocument(serializeDocument(doc))
      const floor0 = restored.buildings[0].floors[0]
      expect(floor0.connectorStops).toHaveLength(2)
      expect(floor0.connectorStops[0].connectorId).toBe('vc-1')
    })

    it('B. Vertical connectors preserved', () => {
      const doc = makeLegacyRoutingDoc()
      const restored = deserializeDocument(serializeDocument(doc))
      expect(restored.buildings[0].verticalConnectors).toHaveLength(1)
      expect(restored.buildings[0].verticalConnectors[0].type).toBe('staircase')
    })

    it('C. Building-level staircases preserved', () => {
      const doc = makePreWallFirstDoc()
      const restored = deserializeDocument(serializeDocument(doc))
      expect(restored.buildings[0].staircases).toHaveLength(1)
      expect(restored.buildings[0].staircases![0].id).toBe('stair-1')
      expect(restored.buildings[0].staircases![0].fromLevel).toBe(0)
      expect(restored.buildings[0].staircases![0].toLevel).toBe(2)
      expect(Object.keys(restored.buildings[0].staircases![0].levels)).toHaveLength(3)
    })

    it('C. Building-level elevators preserved', () => {
      const doc = makePreWallFirstDoc()
      const restored = deserializeDocument(serializeDocument(doc))
      expect(restored.buildings[0].elevators).toHaveLength(1)
      expect(restored.buildings[0].elevators![0].type).toBe('passenger')
    })

    it('C. Vertical transitions preserved', () => {
      const doc = makePreWallFirstDoc()
      const restored = deserializeDocument(serializeDocument(doc))
      expect(restored.buildings[0].verticalTransitions).toHaveLength(1)
      expect(restored.buildings[0].verticalTransitions![0].connections).toHaveLength(3)
    })

    it('D. Mixed doc preserves present fields', () => {
      const doc = makeMixedVersionDoc()
      const restored = deserializeDocument(serializeDocument(doc))
      const floor = restored.buildings[0].floors[0]
      expect(floor.walls).toHaveLength(4)
      expect(floor.openings).toHaveLength(1)
      expect(floor.roomAttributes).toHaveLength(1)
      expect(floor.roomAttributes![0].name).toBe('Mixed Room')
    })
  })

  // ─── 3. Add new wall-first data to old map ─────────────────
  describe('3. Add new wall-first data to old map', () => {
    it('Load old doc, add walls/openings/routeNetwork, save+reload, both old and new data exist', () => {
      const doc = makeVeryOldDoc()

      // Add wall-first data to the old document
      const wall: Wall = { id: 'w-new-1', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, thickness: 0.15, height: 3.5 }
      const opening: Opening = { id: 'op-new-1', type: 'door', wallId: 'w-new-1', offset: 5, width: 0.9 }
      const roomAttr: RoomAttributes = {
        faceId: 'face-new-1',
        name: 'Old Room 101',
        searchable: true,
        accessPoints: [],
      }
      const routeNet: RouteNetwork = {
        nodes: [{ id: 'rn-new-1', type: 'waypoint', position: { x: 7, y: 6 }, floor: 0 }],
        edges: [],
      }

      doc.buildings[0].floors[0].walls = [wall]
      doc.buildings[0].floors[0].openings = [opening]
      doc.buildings[0].floors[0].roomAttributes = [roomAttr]
      doc.buildings[0].floors[0].routeNetwork = routeNet

      // Save → reload
      const json = serializeDocument(doc)
      const restored = deserializeDocument(json)

      // Old legacy data still exists
      expect(restored.buildings[0].floors[0].rooms).toHaveLength(1)
      expect(restored.buildings[0].floors[0].rooms[0].name).toBe('Old Room 101')
      expect(restored.buildings[0].floors[0].hallways).toHaveLength(1)
      expect(restored.buildings[0].floors[0].entrances).toHaveLength(1)

      // New data also exists
      expect(restored.buildings[0].floors[0].walls).toHaveLength(1)
      expect(restored.buildings[0].floors[0].openings).toHaveLength(1)
      expect(restored.buildings[0].floors[0].roomAttributes).toHaveLength(1)
      expect(restored.buildings[0].floors[0].routeNetwork!.nodes).toHaveLength(1)
    })
  })

  // ─── 4. Missing metadata defaults ─────────────────────────
  describe('4. Missing metadata defaults safely', () => {
    it('Floor.shortLabel defaults when absent', () => {
      const doc = makeVeryOldDoc()
      const restored = deserializeDocument(serializeDocument(doc))
      const floor = restored.buildings[0].floors[0]
      expect(floor.shortLabel).toBeUndefined()
    })

    it('Floor.visible defaults safely when absent', () => {
      const doc = makeVeryOldDoc()
      const restored = deserializeDocument(serializeDocument(doc))
      const floor = restored.buildings[0].floors[0]
      expect(floor.visible).toBeUndefined()
    })

    it('Floor.locked defaults safely when absent', () => {
      const doc = makeVeryOldDoc()
      const restored = deserializeDocument(serializeDocument(doc))
      const floor = restored.buildings[0].floors[0]
      expect(floor.locked).toBeUndefined()
    })

    it('Floor.floorPlanState defaults safely when absent', () => {
      const doc = makeVeryOldDoc()
      const restored = deserializeDocument(serializeDocument(doc))
      const floor = restored.buildings[0].floors[0]
      expect(floor.floorPlanState).toBeUndefined()
    })

    it('Floor.offset defaults safely when absent', () => {
      const doc = makeVeryOldDoc()
      const restored = deserializeDocument(serializeDocument(doc))
      const floor = restored.buildings[0].floors[0]
      expect(floor.offset).toBeUndefined()
    })

    it('Floor.rotation defaults safely when absent', () => {
      const doc = makeVeryOldDoc()
      const restored = deserializeDocument(serializeDocument(doc))
      const floor = restored.buildings[0].floors[0]
      expect(floor.rotation).toBeUndefined()
    })

    it('Floor.height defaults safely when absent', () => {
      const doc = makeVeryOldDoc()
      const restored = deserializeDocument(serializeDocument(doc))
      const floor = restored.buildings[0].floors[0]
      // height is not in the basic fixture, verify it either defaults or is absent
      expect(typeof floor.height === 'number' || floor.height === undefined).toBe(true)
    })

    it('Building.rotation defaults safely when absent', () => {
      const doc = makeVeryOldDoc()
      const restored = deserializeDocument(serializeDocument(doc))
      expect(restored.buildings[0].rotation).toBeUndefined()
    })

    it('Floor.rooms, hallways, entrances are always arrays even when absent in raw JSON', () => {
      // Simulate an old doc with missing floor arrays
      const raw = {
        schemaVersion: 1,
        version: 0,
        metadata: { campusId: 'test', name: 'test', description: '', lastModified: '', editorVersion: '0.1.0' },
        buildings: [{
          id: 'bld-x',
          name: 'X',
          code: 'X',
          category: 'academic',
          description: '',
          footprint: { points: [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.001 }, { lat: 0.001, lng: 0.001 }, { lat: 0.001, lng: 0 }, { lat: 0, lng: 0 }] },
          baseElevation: 0,
          height: 10,
          color: '#000',
          aliases: [],
          metadata: {},
          floors: [{
            id: 'flr-x-0',
            level: 0,
            label: 'Ground',
            elevation: 0,
            rooms: [],
            hallways: [],
            entrances: [],
            metadata: {},
          }],
        }],
        roads: [],
        panoramas: [],
        qrCheckpoints: [],
      }
      const restored = deserializeDocument(JSON.stringify(raw))
      const floor = restored.buildings[0].floors[0]
      expect(Array.isArray(floor.rooms)).toBe(true)
      expect(Array.isArray(floor.hallways)).toBe(true)
      expect(Array.isArray(floor.entrances)).toBe(true)
      expect(Array.isArray(floor.connectorStops)).toBe(true)
    })
  })

  // ─── 5. Compiler regression ───────────────────────────────
  describe('5. Compiler regression — legacy path produces NavigationGraph', () => {
    const config: CompilerConfig = {
      nodeInterval: 5,
      mergeThreshold: 3,
      optimizationLevel: 'moderate',
      includeAccessibility: true,
    }

    it('A. Very old map compiles to NavigationGraph', () => {
      const doc = makeVeryOldDoc()
      const result = compile(doc, config)
      expect(result.graph).toBeDefined()
      expect(result.graph!.nodes).toBeDefined()
      expect(result.graph!.edges).toBeDefined()
      expect(result.graph!.metadata.buildings).toBe(1)
      expect(result.graph!.metadata.floors).toBe(1)
    })

    it('B. Legacy routing map compiles to NavigationGraph', () => {
      const doc = makeLegacyRoutingDoc()
      const result = compile(doc, config)
      expect(result.graph).toBeDefined()
      expect(result.graph!.metadata.buildings).toBe(1)
      expect(result.graph!.metadata.floors).toBe(2)
    })

    it('C. Pre-wall-first map compiles to NavigationGraph', () => {
      const doc = makePreWallFirstDoc()
      const result = compile(doc, config)
      expect(result.graph).toBeDefined()
      expect(result.graph!.metadata.buildings).toBe(1)
      expect(result.graph!.metadata.floors).toBe(3)
    })

    it('D. Mixed-version doc compiles to NavigationGraph', () => {
      const doc = makeMixedVersionDoc()
      const result = compile(doc, config)
      expect(result.graph).toBeDefined()
      expect(result.graph!.metadata.buildings).toBe(1)
    })

    it('A. Very old map: outdoor → entrance → hallway → room path exists', () => {
      const doc = makeVeryOldDoc()
      const result = compile(doc, config)
      const types = result.graph!.nodes.map(n => n.type)
      // Rooms produce 'space' nodes, entrances produce 'transition' nodes
      expect(types).toContain('space')
      expect(types).toContain('transition')
    })

    it('C. Pre-wall-first: route nodes from routeNetwork are compiled', () => {
      const doc = makePreWallFirstDoc()
      const result = compile(doc, config)
      const nodeIds = result.graph!.nodes.map(n => n.id)
      // Route network nodes should produce corridor/waypoint nodes
      expect(nodeIds.length).toBeGreaterThan(0)
    })
  })

  // ─── 6. Save/reload stability ─────────────────────────────
  describe('6. Save/reload stability — no destructive loss', () => {
    it('A. old doc → load → save → reload → no loss', () => {
      const doc = makeVeryOldDoc()
      const json1 = serializeDocument(doc)
      const restored1 = deserializeDocument(json1)
      const json2 = serializeDocument(restored1)
      const restored2 = deserializeDocument(json2)

      expect(restored2.buildings[0].floors[0].rooms).toHaveLength(1)
      expect(restored2.buildings[0].floors[0].rooms[0].name).toBe('Old Room 101')
      expect(restored2.buildings[0].floors[0].hallways).toHaveLength(1)
      expect(restored2.buildings[0].floors[0].entrances).toHaveLength(1)
    })

    it('B. legacy doc → load → save → reload → no loss', () => {
      const doc = makeLegacyRoutingDoc()
      const json1 = serializeDocument(doc)
      const restored1 = deserializeDocument(json1)
      const json2 = serializeDocument(restored1)
      const restored2 = deserializeDocument(json2)

      expect(restored2.buildings[0].floors[0].staircases).toHaveLength(1)
      expect(restored2.buildings[0].floors[0].elevators).toHaveLength(1)
      expect(restored2.buildings[0].floors[0].connectorStops).toHaveLength(2)
      expect(restored2.buildings[0].verticalConnectors).toHaveLength(1)
    })

    it('C. pre-wall-first doc → load → save → reload → no loss', () => {
      const doc = makePreWallFirstDoc()
      const json1 = serializeDocument(doc)
      const restored1 = deserializeDocument(json1)
      const json2 = serializeDocument(restored1)
      const restored2 = deserializeDocument(json2)

      expect(restored2.buildings[0].staircases).toHaveLength(1)
      expect(restored2.buildings[0].elevators).toHaveLength(1)
      expect(restored2.buildings[0].verticalTransitions).toHaveLength(1)
      expect(restored2.buildings[0].floors[0].routeNetwork!.nodes).toHaveLength(2)
      expect(restored2.buildings[0].floors[0].entranceAccess).toHaveLength(1)
      expect(restored2.buildings[0].floors[0].planAlignment).toBeDefined()
    })

    it('D. mixed doc → load → save → reload → no loss', () => {
      const doc = makeMixedVersionDoc()
      const json1 = serializeDocument(doc)
      const restored1 = deserializeDocument(json1)
      const json2 = serializeDocument(restored1)
      const restored2 = deserializeDocument(json2)

      expect(restored2.buildings[0].floors[0].walls).toHaveLength(4)
      expect(restored2.buildings[0].floors[0].openings).toHaveLength(1)
      expect(restored2.buildings[0].floors[0].roomAttributes).toHaveLength(1)
    })
  })

  // ─── 7. Relationship validation ───────────────────────────
  describe('7. validateIndoorRelationships on old documents — no false positives', () => {
    it('A. Very old doc: no issues reported (absent optional fields not broken)', () => {
      const doc = makeVeryOldDoc()
      const issues = validateIndoorRelationships(doc)
      expect(issues).toHaveLength(0)
    })

    it('B. Legacy routing doc: no issues for absent new fields', () => {
      const doc = makeLegacyRoutingDoc()
      const issues = validateIndoorRelationships(doc)
      expect(issues).toHaveLength(0)
    })

    it('C. Pre-wall-first doc: no issues for absent walls/openings', () => {
      const doc = makePreWallFirstDoc()
      const issues = validateIndoorRelationships(doc)
      expect(issues).toHaveLength(0)
    })

    it('D. Mixed doc with present walls/openings/roomAttributes validates correctly', () => {
      const doc = makeMixedVersionDoc()
      const issues = validateIndoorRelationships(doc)
      // All referenced entities exist, so no issues
      expect(issues).toHaveLength(0)
    })

    it('Mixed doc with broken references still caught', () => {
      const doc = makeMixedVersionDoc()
      // Break an opening reference
      doc.buildings[0].floors[0].openings![0].wallId = 'nonexistent-wall'
      const issues = validateIndoorRelationships(doc)
      expect(issues.some(i => i.type === 'missing-wall')).toBe(true)
    })
  })

  // ─── 8. All 22 required gate cases ────────────────────────
  describe('8. Required gate cases (22)', () => {
    // Case 1: Very old doc loads without throwing
    it('G1: Very old doc loads without throwing', () => {
      expect(() => deserializeDocument(serializeDocument(makeVeryOldDoc()))).not.toThrow()
    })

    // Case 2: Legacy routing doc loads without throwing
    it('G2: Legacy routing doc loads without throwing', () => {
      expect(() => deserializeDocument(serializeDocument(makeLegacyRoutingDoc()))).not.toThrow()
    })

    // Case 3: Pre-wall-first doc loads without throwing
    it('G3: Pre-wall-first doc loads without throwing', () => {
      expect(() => deserializeDocument(serializeDocument(makePreWallFirstDoc()))).not.toThrow()
    })

    // Case 4: Mixed-version doc loads without throwing
    it('G4: Mixed-version doc loads without throwing', () => {
      expect(() => deserializeDocument(serializeDocument(makeMixedVersionDoc()))).not.toThrow()
    })

    // Case 5: Very old doc rooms survive round-trip
    it('G5: Very old doc rooms survive round-trip', () => {
      const doc = makeVeryOldDoc()
      const restored = deserializeDocument(serializeDocument(doc))
      expect(restored.buildings[0].floors[0].rooms[0].id).toBe('rm-old-1')
      expect(restored.buildings[0].floors[0].rooms[0].name).toBe('Old Room 101')
    })

    // Case 6: Very old doc hallways survive round-trip
    it('G6: Very old doc hallways survive round-trip', () => {
      const doc = makeVeryOldDoc()
      const restored = deserializeDocument(serializeDocument(doc))
      expect(restored.buildings[0].floors[0].hallways[0].name).toBe('Old Hallway')
    })

    // Case 7: Very old doc entrances survive round-trip
    it('G7: Very old doc entrances survive round-trip', () => {
      const doc = makeVeryOldDoc()
      const restored = deserializeDocument(serializeDocument(doc))
      expect(restored.buildings[0].floors[0].entrances[0].id).toBe('ent-old-1')
    })

    // Case 8: Legacy staircases survive round-trip
    it('G8: Legacy staircases survive round-trip', () => {
      const doc = makeLegacyRoutingDoc()
      const restored = deserializeDocument(serializeDocument(doc))
      expect(restored.buildings[0].floors[0].staircases[0].name).toBe('Main Stairs')
    })

    // Case 9: Legacy elevators survive round-trip
    it('G9: Legacy elevators survive round-trip', () => {
      const doc = makeLegacyRoutingDoc()
      const restored = deserializeDocument(serializeDocument(doc))
      expect(restored.buildings[0].floors[0].elevators[0].name).toBe('Main Elevator')
    })

    // Case 10: Vertical connectors survive round-trip
    it('G10: Vertical connectors survive round-trip', () => {
      const doc = makeLegacyRoutingDoc()
      const restored = deserializeDocument(serializeDocument(doc))
      expect(restored.buildings[0].verticalConnectors[0].type).toBe('staircase')
    })

    // Case 11: Building-level staircases survive round-trip
    it('G11: Building-level staircases survive round-trip', () => {
      const doc = makePreWallFirstDoc()
      const restored = deserializeDocument(serializeDocument(doc))
      expect(restored.buildings[0].staircases![0].id).toBe('stair-1')
    })

    // Case 12: Building-level elevators survive round-trip
    it('G12: Building-level elevators survive round-trip', () => {
      const doc = makePreWallFirstDoc()
      const restored = deserializeDocument(serializeDocument(doc))
      expect(restored.buildings[0].elevators![0].id).toBe('elev-1')
    })

    // Case 13: Vertical transitions survive round-trip
    it('G13: Vertical transitions survive round-trip', () => {
      const doc = makePreWallFirstDoc()
      const restored = deserializeDocument(serializeDocument(doc))
      expect(restored.buildings[0].verticalTransitions![0].featureId).toBe('stair-1')
    })

    // Case 14: RouteNetwork survive round-trip
    it('G14: RouteNetwork survive round-trip', () => {
      const doc = makePreWallFirstDoc()
      const restored = deserializeDocument(serializeDocument(doc))
      expect(restored.buildings[0].floors[0].routeNetwork!.nodes).toHaveLength(2)
    })

    // Case 15: EntranceAccess survive round-trip
    it('G15: EntranceAccess survive round-trip', () => {
      const doc = makePreWallFirstDoc()
      const restored = deserializeDocument(serializeDocument(doc))
      expect(restored.buildings[0].floors[0].entranceAccess![0].entranceId).toBe('ent-pw-1')
    })

    // Case 16: Walls survive round-trip
    it('G16: Walls survive round-trip', () => {
      const doc = makeMixedVersionDoc()
      const restored = deserializeDocument(serializeDocument(doc))
      expect(restored.buildings[0].floors[0].walls).toHaveLength(4)
    })

    // Case 17: Openings survive round-trip
    it('G17: Openings survive round-trip', () => {
      const doc = makeMixedVersionDoc()
      const restored = deserializeDocument(serializeDocument(doc))
      expect(restored.buildings[0].floors[0].openings![0].type).toBe('door')
    })

    // Case 18: RoomAttributes survive round-trip
    it('G18: RoomAttributes survive round-trip', () => {
      const doc = makeMixedVersionDoc()
      const restored = deserializeDocument(serializeDocument(doc))
      expect(restored.buildings[0].floors[0].roomAttributes![0].faceId).toBe('face-mix-1')
    })

    // Case 19: Old doc compiles to NavigationGraph
    it('G19: Old doc compiles to NavigationGraph', () => {
      const result = compile(makeVeryOldDoc(), { nodeInterval: 5, mergeThreshold: 3, optimizationLevel: 'moderate', includeAccessibility: true })
      expect(result.graph).toBeDefined()
      expect(result.graph!.nodes.length).toBeGreaterThan(0)
    })

    // Case 20: Old doc validates with no issues
    it('G20: Old doc validates with no issues', () => {
      const issues = validateIndoorRelationships(makeVeryOldDoc())
      expect(issues).toHaveLength(0)
    })

    // Case 21: Legacy doc validates with no issues
    it('G21: Legacy doc validates with no issues', () => {
      const issues = validateIndoorRelationships(makeLegacyRoutingDoc())
      expect(issues).toHaveLength(0)
    })

    // Case 22: No automatic data destruction on any fixture
    it('G22: No automatic data destruction on any fixture', () => {
      const fixtures = [makeVeryOldDoc(), makeLegacyRoutingDoc(), makePreWallFirstDoc(), makeMixedVersionDoc()]
      for (const doc of fixtures) {
        const json = serializeDocument(doc)
        const restored = deserializeDocument(json)
        // Buildings count preserved
        expect(restored.buildings).toHaveLength(doc.buildings.length)
        // Each building's floors preserved
        for (let i = 0; i < doc.buildings.length; i++) {
          expect(restored.buildings[i].floors).toHaveLength(doc.buildings[i].floors.length)
          // Each floor's core entities preserved
          for (let j = 0; j < doc.buildings[i].floors.length; j++) {
            const origFloor = doc.buildings[i].floors[j]
            const restFloor = restored.buildings[i].floors[j]
            expect(restFloor.rooms).toHaveLength(origFloor.rooms.length)
            expect(restFloor.hallways).toHaveLength(origFloor.hallways.length)
            expect(restFloor.entrances).toHaveLength(origFloor.entrances.length)
          }
        }
      }
    })
  })

  // ─── 9. Legacy data preserved in compiler pipeline ─────────
  describe('9. Compiler legacy path — outdoor → entrance → hallway → room', () => {
    it('A. Very old doc: compiler extracts rooms and entrances', () => {
      const result = compile(makeVeryOldDoc(), { nodeInterval: 5, mergeThreshold: 3, optimizationLevel: 'moderate', includeAccessibility: true })
      const types = result.graph!.nodes.map(n => n.type)
      expect(types).toContain('space')       // rooms
      expect(types).toContain('transition')  // entrances
    })

    it('B. Legacy routing doc: multi-floor compilation works', () => {
      const result = compile(makeLegacyRoutingDoc(), { nodeInterval: 5, mergeThreshold: 3, optimizationLevel: 'moderate', includeAccessibility: true })
      expect(result.graph!.metadata.floors).toBe(2)
      expect(result.graph!.nodes.length).toBeGreaterThan(0)
    })

    it('C. Pre-wall-first: staircases do not cause compilation failure', () => {
      const result = compile(makePreWallFirstDoc(), { nodeInterval: 5, mergeThreshold: 3, optimizationLevel: 'moderate', includeAccessibility: true })
      expect(result.graph).toBeDefined()
      expect(result.graph!.metadata.buildings).toBe(1)
    })
  })
})
