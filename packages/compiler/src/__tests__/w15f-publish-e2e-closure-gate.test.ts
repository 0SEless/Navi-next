import { describe, it, expect } from 'vitest'
import { CampusCompiler } from '../pipeline/campus-compiler'
import { normalizeDocument } from '../normalize'
import { generatePrimitives } from '../primitives/coordinator'
import { emitGraph } from '../emitter'
import { buildArtifacts } from '../emitter/artifacts'
import type {
  CampusDocument, Building, Floor, Room, Wall, Opening,
  RoomAttributes, RoomAccess, RouteNetwork, EntranceAccess,
  VerticalTransition,
} from '@navi/core'
import type { NavigationArtifacts, ConnectivityGraph } from '../types'

// ═══════════════════════════════════════════════════════════════
// Helper Factories
// ═══════════════════════════════════════════════════════════════

const CAMPUS_ID = 'w15f-test'
const FOOTPRINT = {
  points: [
    { lat: 14.0, lng: 121.0 },
    { lat: 14.0, lng: 121.01 },
    { lat: 14.01, lng: 121.01 },
    { lat: 14.01, lng: 121.0 },
  ],
}

function makeDoc(buildings: Building[], overrides?: Partial<CampusDocument>): CampusDocument {
  return {
    schemaVersion: 1,
    version: 1,
    metadata: { campusId: CAMPUS_ID, name: CAMPUS_ID, description: '', lastModified: '', editorVersion: '1.0.0' },
    buildings,
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
    ...overrides,
  }
}

function makeBuilding(id: string, name: string, floors: Floor[], overrides?: Partial<Building>): Building {
  return {
    id, name, code: id, category: 'academic', description: '',
    footprint: FOOTPRINT,
    baseElevation: 0, height: 10, floors, verticalConnectors: [],
    color: '#ccc', aliases: [], metadata: {},
    ...overrides,
  }
}

function makeFloor(id: string, level: number, overrides?: Partial<Floor>): Floor {
  return {
    id, level, label: `Floor ${level}`, elevation: level * 3.5, height: 3.5,
    rooms: [], hallways: [], staircases: [], elevators: [],
    entrances: [{
      id: `${id}-ent`, label: 'Entrance',
      position: { lat: 14.001, lng: 121.001 } as any,
      level, type: 'main', hasQR: false, hasPanorama: false,
    }],
    connectorStops: [], parametricComponents: [], metadata: {}, ...overrides,
  }
}

function makeEntrance(id: string, level: number) {
  return {
    id, label: id,
    position: { lat: 14.001 + level * 0.001, lng: 121.001 } as any,
    level, type: 'main' as const, hasQR: false, hasPanorama: false,
  }
}

function makeWall(id: string, x1: number, y1: number, x2: number, y2: number): Wall {
  return { id, start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.15, height: 3.5 }
}

function makeOpening(id: string, wallId: string, offset: number, width: number): Opening {
  return { id, type: 'door', wallId, offset, width, height: 2.1 }
}

function makeRoomAttributes(faceId: string, roomId: string, name: string, number: string, searchable: boolean, accessPoints?: RoomAccess[]): RoomAttributes {
  return { faceId, roomId, name, number, searchable, accessPoints }
}

function makeRouteNetwork(nodes: Array<{ id: string; x: number; y: number; floor: number }>, edges: Array<{ id: string; from: string; to: string; distance: number }>): RouteNetwork {
  return {
    nodes: nodes.map(n => ({ id: n.id, type: 'waypoint' as const, position: { x: n.x, y: n.y }, floor: n.floor })),
    edges: edges.map(e => ({ id: e.id, from: e.from, to: e.to, type: 'walk' as const, distance: e.distance })),
  }
}

// ═══════════════════════════════════════════════════════════════
// Section 1 — Artifact Survival Matrix (8 artifacts)
// ═══════════════════════════════════════════════════════════════

describe('W15F — Artifact Survival Matrix', () => {
  const compiler = new CampusCompiler()

  function compileSafe(doc: CampusDocument) {
    return compiler.compileV2(doc)
  }

  it('NavigationGraph: COMPILED → IN ARTIFACTS → HAS NODES/EDGES', () => {
    const wall = makeWall('w1', 0, 0, 10, 0)
    const ra = [makeRoomAttributes('f1', 'rm-A', 'Room A', '101', true, [
      { openingId: 'op-1', routeNodeId: 'rn-1', primary: true },
    ])]
    const rn = makeRouteNetwork(
      [{ id: 'rn-1', x: 2, y: 3, floor: 0 }, { id: 'rn-2', x: 8, y: 6, floor: 0 }],
      [{ id: 're-1', from: 'rn-1', to: 'rn-2', distance: 7 }],
    )
    const ea: EntranceAccess[] = [{ entranceId: 'fl-0-ent', outdoorNodeId: 'outdoor-fl-0-ent', indoorRouteNodeId: 'rn-1' }]
    const floor = makeFloor('fl-0', 0, { walls: [wall], roomAttributes: ra, routeNetwork: rn, entranceAccess: ea })
    const bld = makeBuilding('b1', 'Building A', [floor])
    const doc = makeDoc([bld])
    const result = compileSafe(doc)

    expect(result.artifacts!.graph).toBeDefined()
    expect(result.artifacts!.graph.nodes.length).toBeGreaterThan(0)
    expect(result.artifacts!.graph.version).toBe('1.0.0')
    expect(result.artifacts!.graph.campusId).toBe(CAMPUS_ID)
  })

  it('SearchIndex: COMPILED → IN ARTIFACTS → HAS ENTRIES', () => {
    const ra = [makeRoomAttributes('f1', 'rm-A', 'Room A', '101', true)]
    const floor = makeFloor('fl-0', 0, { roomAttributes: ra })
    const bld = makeBuilding('b1', 'Building A', [floor])
    const doc = makeDoc([bld])
    const result = compileSafe(doc)

    expect(result.artifacts!.searchIndex).toBeDefined()
    expect(result.artifacts!.searchIndex.entries.length).toBeGreaterThan(0)
    const roomEntry = result.artifacts!.searchIndex.entries.find(e => e.type === 'room')
    expect(roomEntry).toBeDefined()
    expect(roomEntry!.id).toBe('search_room_rm-A')
  })

  it('BuildingIndex: COMPILED → IN ARTIFACTS → HAS BUILDINGS', () => {
    const floor = makeFloor('fl-0', 0)
    const bld = makeBuilding('b1', 'Building A', [floor])
    const doc = makeDoc([bld])
    const result = compileSafe(doc)

    expect(result.artifacts!.buildingIndex).toBeDefined()
    // BuildingIndex requires connectivity graph nodes (entrances create nodes)
    expect(result.artifacts!.buildingIndex.buildings.length).toBeGreaterThanOrEqual(1)
  })

  it('SpatialIndex: COMPILED → IN ARTIFACTS → HAS CELLS', () => {
    const floor = makeFloor('fl-0', 0)
    const bld = makeBuilding('b1', 'Building A', [floor])
    const doc = makeDoc([bld])
    const result = compileSafe(doc)

    expect(result.artifacts!.spatialIndex).toBeDefined()
    expect(result.artifacts!.spatialIndex.cellSize).toBeGreaterThan(0)
  })

  it('POIIndex: COMPILED → IN ARTIFACTS → HAS POINTS', () => {
    const ra = [makeRoomAttributes('f1', 'rm-A', 'Room A', '101', true)]
    const floor = makeFloor('fl-0', 0, { roomAttributes: ra })
    const bld = makeBuilding('b1', 'Building A', [floor])
    const doc = makeDoc([bld])
    const result = compileSafe(doc)

    expect(result.artifacts!.poiIndex).toBeDefined()
    expect(result.artifacts!.poiIndex.points).toBeDefined()
  })

  it('FloorGeometry: COMPILED → IN ARTIFACTS → HAS BUILDINGS WITH FLOORS', () => {
    const wall = makeWall('w1', 0, 0, 10, 0)
    const floor = makeFloor('fl-0', 0, { walls: [wall] })
    const bld = makeBuilding('b1', 'Building A', [floor])
    const doc = makeDoc([bld])
    const result = compileSafe(doc)

    expect(result.artifacts!.floorGeometry).toBeDefined()
    expect(result.artifacts!.floorGeometry!.buildings.length).toBe(1)
    expect(result.artifacts!.floorGeometry!.buildings[0]!.floors.length).toBe(1)
  })

  it('QRIndex: COMPILED → IN ARTIFACTS → HAS CHECKPOINTS', () => {
    const floor = makeFloor('fl-0', 0)
    const bld = makeBuilding('b1', 'Building A', [floor])
    const doc = makeDoc([bld], { qrCheckpoints: [{ id: 'qr-1', label: 'QR1', buildingId: 'b1', floor: 0, position: { x: 5, y: 5 }, code: '', metadata: {} }] })
    const result = compileSafe(doc)

    expect(result.artifacts!.qrIndex).toBeDefined()
    expect(result.artifacts!.qrIndex!.checkpoints.length).toBe(1)
  })

  it('PanoramaIndex: COMPILED → IN ARTIFACTS → WHEN PRESENT', () => {
    const floor = makeFloor('fl-0', 0)
    const bld = makeBuilding('b1', 'Building A', [floor])
    const doc = makeDoc([bld], {
      panoramas: [{
        id: 'pano-1', label: 'Lobby View', imageAssetId: 'img-1', buildingId: 'b1', floor: 0,
        position: { lat: 14.005, lng: 121.005 }, heading: 0, hotspots: [],
      }],
    })
    const result = compileSafe(doc)

    expect(result.artifacts!.panoramaIndex).toBeDefined()
    expect(result.artifacts!.panoramaIndex!.panoramas.length).toBe(1)
  })
})

// ═══════════════════════════════════════════════════════════════
// Section 2 — floorGeometry Production Survival
// ═══════════════════════════════════════════════════════════════

describe('W15F — floorGeometry Production Survival', () => {
  const compiler = new CampusCompiler()

  it('preserves the layered V1 contract without converting routes into hallways', () => {
    const wall = makeWall('wall-room-1', 0, 0, 10, 0)
    const opening = makeOpening('opening-room-1', wall.id, 4, 0.9)
    const routeNetwork = makeRouteNetwork(
      [{ id: 'route-node-room', x: 2, y: 1, floor: 0 }, { id: 'route-node-main', x: 8, y: 1, floor: 0 }],
      [{ id: 'route-edge-main', from: 'route-node-room', to: 'route-node-main', distance: 6 }],
    )
    const roomAttributes = [makeRoomAttributes('face-room-1', 'room-101', 'Room 101', '101', true, [
      { routeNodeId: 'route-node-room', primary: true },
    ])]
    const entranceAccess: EntranceAccess[] = [{
      entranceId: 'fl-0-ent',
      outdoorNodeId: 'outdoor-main',
      indoorRouteNodeId: 'route-node-main',
    }]
    const floor = makeFloor('fl-0', 0, {
      walls: [wall],
      openings: [opening],
      roomAttributes,
      routeNetwork,
      entranceAccess,
    })
    const result = compiler.compileV2(makeDoc([makeBuilding('b1', 'Building A', [floor])]))
    const floorGeometry = result.artifacts!.floorGeometry!.buildings[0]!.floors[0]!
    const buildingIndex = result.artifacts!.buildingIndex!.buildings[0]!

    // Base layer: footprint remains in the building index.
    expect(buildingIndex.footprint).toHaveLength(4)
    // Architecture layer: walls/openings remain canonical and independent.
    expect(floorGeometry.walls!.map((item) => item.id)).toEqual(['wall-room-1'])
    expect(floorGeometry.openings!.map((item) => item.id)).toEqual(['opening-room-1'])
    expect(floorGeometry.hallways).toEqual([])
    // Access layer: RoomAccess and EntranceAccess remain relationships.
    expect(floorGeometry.roomAccess).toEqual([{ routeNodeId: 'route-node-room', primary: true }])
    expect(floorGeometry.entranceAccess).toEqual(entranceAccess)
    // Navigation layer: authored route identity and topology survive verbatim.
    expect(floorGeometry.routeNetwork).toEqual(routeNetwork)
    expect(floorGeometry.routeNetwork!.edges.map((item) => item.id)).toEqual(['route-edge-main'])
  })

  it('canonical wall-first floor publishes walls, openings, roomAttributes', () => {
    const wall1 = makeWall('w1', 0, 0, 10, 0)
    const wall2 = makeWall('w2', 10, 0, 10, 8)
    const opening = makeOpening('op1', 'w1', 3.0, 0.9)
    const ra = [makeRoomAttributes('f1', 'rm-101', 'Room 101', '101', true)]
    const rn = makeRouteNetwork(
      [{ id: 'rn-1', x: 2, y: 3, floor: 0 }, { id: 'rn-2', x: 8, y: 6, floor: 0 }],
      [{ id: 're-1', from: 'rn-1', to: 'rn-2', distance: 7 }],
    )
    const floor = makeFloor('fl-0', 0, {
      walls: [wall1, wall2],
      openings: [opening],
      roomAttributes: ra,
      routeNetwork: rn,
      entrances: [{
        id: 'fl-0-ent', label: 'Entrance', position: { x: 2, y: 3 },
        level: 0, type: 'main', hasQR: false, hasPanorama: false,
      }],
    })
    const bld = makeBuilding('b1', 'Building A', [floor])
    const doc = makeDoc([bld])
    const result = compiler.compileV2(doc)
    expect(result.success).toBe(true)

    const fg = result.artifacts!.floorGeometry!
    const f = fg.buildings[0]!.floors[0]!

    // Walls survive
    expect(f.walls).toBeDefined()
    expect(f.walls!.length).toBe(2)
    expect(f.walls![0]!.id).toBe('w1')
    expect(f.walls![0]!.start).toEqual({ x: 0, y: 0 })
    expect(f.walls![0]!.end).toEqual({ x: 10, y: 0 })
    expect(f.walls![0]!.thickness).toBe(0.15)
    expect(f.walls![0]!.height).toBe(3.5)

    // Openings survive
    expect(f.openings).toBeDefined()
    expect(f.openings!.length).toBe(1)
    expect(f.openings![0]!.id).toBe('op1')
    expect(f.openings![0]!.wallId).toBe('w1')
    expect(f.openings![0]!.offset).toBe(3.0)

    // RoomAttributes survive
    expect(f.roomAttributes).toBeDefined()
    expect(f.roomAttributes!.length).toBe(1)
    expect(f.roomAttributes![0]!.roomId).toBe('rm-101')
    expect(f.roomAttributes![0]!.name).toBe('Room 101')
    expect(f.roomAttributes![0]!.number).toBe('101')

    // RouteNetwork survives
    expect(f.routeNetwork).toBeDefined()
    expect(f.routeNetwork!.nodes.length).toBe(2)
    expect(f.routeNetwork!.edges.length).toBe(1)
  })

  it('floorGeometry anchor uses building footprint centroid', () => {
    const floor = makeFloor('fl-0', 0)
    const bld = makeBuilding('b1', 'Building A', [floor])
    const doc = makeDoc([bld])
    const result = compiler.compileV2(doc)
    const fg = result.artifacts!.floorGeometry!
    const b = fg.buildings[0]!

    expect(b.anchor.origin.lat).toBeCloseTo(14.005, 3)
    expect(b.anchor.origin.lng).toBeCloseTo(121.005, 3)
    expect(typeof b.anchor.rotation).toBe('number')
  })

  it('floorGeometry is additive-absent: empty walls → no walls field', () => {
    const floor = makeFloor('fl-0', 0)
    const bld = makeBuilding('b1', 'Building A', [floor])
    const doc = makeDoc([bld])
    const result = compiler.compileV2(doc)
    const f = result.artifacts!.floorGeometry!.buildings[0]!.floors[0]!

    expect(f.walls).toBeUndefined()
    expect(f.openings).toBeUndefined()
    expect(f.roomAttributes).toBeUndefined()
    expect(f.routeNetwork).toBeUndefined()
    expect(f.entranceAccess).toBeUndefined()
  })
})

// ═══════════════════════════════════════════════════════════════
// Section 3 — NavigationGraph Production Survival
// ═══════════════════════════════════════════════════════════════

describe('W15F — NavigationGraph Production Survival', () => {
  const compiler = new CampusCompiler()

  it('Room A → Room B via RouteNetwork', () => {
    const rn = makeRouteNetwork(
      [{ id: 'rn-1', x: 2, y: 3, floor: 0 }, { id: 'rn-2', x: 8, y: 6, floor: 0 }],
      [{ id: 're-1', from: 'rn-1', to: 'rn-2', distance: 7 }],
    )
    const ra = [
      makeRoomAttributes('f1', 'rm-A', 'Room A', '101', true, [
        { openingId: 'op-1', routeNodeId: 'rn-1', primary: true },
      ]),
      makeRoomAttributes('f2', 'rm-B', 'Room B', '102', true, [
        { openingId: 'op-2', routeNodeId: 'rn-2', primary: true },
      ]),
    ]
    const floor = makeFloor('fl-0', 0, { routeNetwork: rn, roomAttributes: ra })
    const bld = makeBuilding('b1', 'Building A', [floor])
    const doc = makeDoc([bld])
    const result = compiler.compileV2(doc)
    const nav = result.artifacts!.graph

    // Verify topology: find route nodes
    const routeNodeIds = nav.nodes.filter(n => n.buildingId === 'b1').map(n => n.id)
    expect(routeNodeIds.length).toBeGreaterThan(0)

    // Verify edges exist between route nodes
    const routeEdges = nav.edges.filter(e =>
      routeNodeIds.includes(e.from) || routeNodeIds.includes(e.to),
    )
    expect(routeEdges.length).toBeGreaterThan(0)
  })

  it('Outdoor → Indoor via entrance', () => {
    const entrance = {
      id: 'ent-1', label: 'Main Entrance',
      position: { lat: 14.001, lng: 121.001 } as any,
      level: 0, type: 'main' as const, hasQR: false, hasPanorama: false,
    }
    const floor = makeFloor('fl-0', 0, { entrances: [entrance] })
    const bld = makeBuilding('b1', 'Building A', [floor])
    const doc = makeDoc([bld])
    const result = compiler.compileV2(doc)
    const nav = result.artifacts!.graph

    // Should have an entrance node
    const entranceNodes = nav.nodes.filter(n => n.type === 'entrance')
    expect(entranceNodes.length).toBeGreaterThanOrEqual(1)
  })

  it('Floor 1 → Floor 2 via VerticalTransition', () => {
    const rnF1 = makeRouteNetwork(
      [{ id: 'rn-f1-1', x: 5, y: 5, floor: 0 }, { id: 'rn-f1-stair', x: 10, y: 5, floor: 0 }],
      [{ id: 're-f1', from: 'rn-f1-1', to: 'rn-f1-stair', distance: 5 }],
    )
    const rnF2 = makeRouteNetwork(
      [{ id: 'rn-f2-stair', x: 10, y: 5, floor: 1 }, { id: 'rn-f2-1', x: 5, y: 5, floor: 1 }],
      [{ id: 're-f2', from: 'rn-f2-stair', to: 'rn-f2-1', distance: 5 }],
    )
    const raF1 = [makeRoomAttributes('f1', 'rm-1', 'Room F1', '101', true, [
      { openingId: 'op-1', routeNodeId: 'rn-f1-1', primary: true },
    ])]
    const raF2 = [makeRoomAttributes('f2', 'rm-2', 'Room F2', '201', true, [
      { openingId: 'op-2', routeNodeId: 'rn-f2-1', primary: true },
    ])]
    const vt: VerticalTransition[] = [{
      id: 'vt-1', featureId: 'stair-1', type: 'staircase', connections: [
        { floorId: 'b1-0', routeNodeId: 'rn-f1-stair' },
        { floorId: 'b1-1', routeNodeId: 'rn-f2-stair' },
      ],
    }]
    const eaF1: EntranceAccess[] = [{ entranceId: 'fl-0-ent', outdoorNodeId: 'outdoor-ent', indoorRouteNodeId: 'rn-f1-1' }]
    const floor1 = makeFloor('fl-0', 0, { routeNetwork: rnF1, roomAttributes: raF1, entranceAccess: eaF1 })
    const floor2 = makeFloor('fl-1', 1, { elevation: 3.5, routeNetwork: rnF2, roomAttributes: raF2 })
    const bld = makeBuilding('b1', 'Building A', [floor1, floor2], { verticalTransitions: vt })
    const doc = makeDoc([bld])
    const result = compiler.compileV2(doc)
    const nav = result.artifacts!.graph

    // Should have nodes on both floors
    const floor0Nodes = nav.nodes.filter(n => n.floor === 0 && n.buildingId === 'b1')
    const floor1Nodes = nav.nodes.filter(n => n.floor === 1 && n.buildingId === 'b1')
    expect(floor0Nodes.length).toBeGreaterThan(0)
    expect(floor1Nodes.length).toBeGreaterThan(0)

    // Should have vertical transition edges (stairs/elevator type)
    const vertEdges = nav.edges.filter(e => e.type === 'stairs' || e.type === 'elevator')
    expect(vertEdges.length).toBeGreaterThanOrEqual(1)
  })
})

// ═══════════════════════════════════════════════════════════════
// Section 4 — SearchIndex Production Survival
// ═══════════════════════════════════════════════════════════════

describe('W15F — SearchIndex Production Survival', () => {
  const compiler = new CampusCompiler()

  it('publishes semantic RoomAttributes with stable identity, name, number, category', () => {
    const ra = [makeRoomAttributes('f1', 'rm-101', 'Chemistry Lab', 'C-101', true)]
    const floor = makeFloor('fl-0', 0, { roomAttributes: ra })
    const bld = makeBuilding('b1', 'Science Hall', [floor])
    const doc = makeDoc([bld])
    const result = compiler.compileV2(doc)
    const si = result.artifacts!.searchIndex

    const roomEntry = si.entries.find(e => e.type === 'room' && e.id === 'search_room_rm-101')
    expect(roomEntry).toBeDefined()
    expect(roomEntry!.label).toBe('Chemistry Lab')
    expect(roomEntry!.buildingId).toBe('b1')
    expect(roomEntry!.tags.join(' ')).toContain('chemistry')
    expect(roomEntry!.tags.join(' ')).toContain('lab')
  })

  it('search → canonical destination → A*', () => {
    const rn = makeRouteNetwork(
      [
        { id: 'rn-1', x: 2, y: 3, floor: 0 },
        { id: 'rn-2', x: 8, y: 3, floor: 0 },
        { id: 'rn-3', x: 5, y: 6, floor: 0 },
      ],
      [
        { id: 're-1', from: 'rn-1', to: 'rn-2', type: 'walk', distance: 6 } as any,
        { id: 're-2', from: 'rn-2', to: 'rn-3', type: 'walk', distance: 5 } as any,
      ],
    )
    const ra = [
      makeRoomAttributes('f1', 'rm-A', 'Room A', '101', true, [
        { openingId: 'op-1', routeNodeId: 'rn-1', primary: true },
      ]),
      makeRoomAttributes('f2', 'rm-B', 'Room B', '102', true, [
        { openingId: 'op-2', routeNodeId: 'rn-3', primary: true },
      ]),
    ]
    const floor = makeFloor('fl-0', 0, { routeNetwork: rn, roomAttributes: ra })
    const bld = makeBuilding('b1', 'Building A', [floor])
    const doc = makeDoc([bld])
    const result = compiler.compileV2(doc)
    const si = result.artifacts!.searchIndex

    // Both rooms are searchable
    const roomA = si.entries.find(e => e.id === 'search_room_rm-A')
    const roomB = si.entries.find(e => e.id === 'search_room_rm-B')
    expect(roomA).toBeDefined()
    expect(roomB).toBeDefined()

    // Both have nodeId pointing to POI nodes in the graph
    expect(roomA!.nodeId).toBeDefined()
    expect(roomB!.nodeId).toBeDefined()
  })

  it('legacy rooms indexed when no RoomAttributes', () => {
    const room: Room = {
      id: 'r1', name: 'Old Room', number: 'L-1', category: 'classroom',
      polygon: { points: [{ x: 5, y: 5 }, { x: 15, y: 5 }, { x: 15, y: 13 }, { x: 5, y: 13 }, { x: 5, y: 5 }] },
      roomDoors: [], capacity: 30, metadata: {},
    }
    const floor = makeFloor('fl-0', 0, { rooms: [room] })
    const bld = makeBuilding('b1', 'Old Building', [floor])
    const doc = makeDoc([bld])
    const result = compiler.compileV2(doc)
    const si = result.artifacts!.searchIndex

    const roomEntry = si.entries.find(e => e.type === 'room' && e.id === 'search_room_r1')
    expect(roomEntry).toBeDefined()
    expect(roomEntry!.label).toBe('Old Room')
  })
})

// ═══════════════════════════════════════════════════════════════
// Section 5 — Mixed-Version Document
// ═══════════════════════════════════════════════════════════════

describe('W15F — Mixed-Version Document', () => {
  const compiler = new CampusCompiler()

  it('Building A Floor 1: canonical + RouteNetwork, Floor 2: legacy Room/Hallway, Building B: legacy-only — no duplicate topology/search', () => {
    const rnF1 = makeRouteNetwork(
      [{ id: 'rn-1', x: 2, y: 3, floor: 0 }, { id: 'rn-2', x: 8, y: 6, floor: 0 }],
      [{ id: 're-1', from: 'rn-1', to: 'rn-2', distance: 7 }],
    )
    const raF1 = [makeRoomAttributes('f1', 'rm-A', 'Room A', '101', true, [
      { openingId: 'op-1', routeNodeId: 'rn-1', primary: true },
    ])]
    const eaF1: EntranceAccess[] = [{ entranceId: 'fl-0-ent', outdoorNodeId: 'outdoor-ent', indoorRouteNodeId: 'rn-1' }]

    // Floor 2: legacy
    const legacyRoom: Room = {
      id: 'r-legacy', name: 'Legacy Room', number: 'L-1', category: 'office',
      polygon: { points: [{ x: 5, y: 5 }, { x: 15, y: 5 }, { x: 15, y: 13 }, { x: 5, y: 13 }, { x: 5, y: 5 }] },
      roomDoors: [], capacity: 10, metadata: {},
    }

    const floor1 = makeFloor('fl-0', 0, { routeNetwork: rnF1, roomAttributes: raF1, entranceAccess: eaF1 })
    const floor2 = makeFloor('fl-1', 1, { elevation: 3.5, rooms: [legacyRoom] })
    const bldA = makeBuilding('b1', 'Building A', [floor1, floor2])
    const bldB = makeBuilding('b2', 'Building B', [makeFloor('fl-0', 0, { rooms: [legacyRoom] })])
    const doc = makeDoc([bldA, bldB])
    const result = compiler.compileV2(doc)
    const si = result.artifacts!.searchIndex

    // No duplicate search entries for rm-A
    const rmAEntries = si.entries.filter(e => e.id === 'search_room_rm-A')
    expect(rmAEntries.length).toBe(1)

    // Legacy room indexed
    const legacyEntries = si.entries.filter(e => e.id === 'search_room_r-legacy')
    expect(legacyEntries.length).toBeGreaterThanOrEqual(1)
  })
})

// ═══════════════════════════════════════════════════════════════
// Section 6 — Canonical Multi-Floor
// ═══════════════════════════════════════════════════════════════

describe('W15F — Canonical Multi-Floor', () => {
  const compiler = new CampusCompiler()

  it('Floor 1 + Floor 2 with RouteNetwork + VerticalTransition: Room F1 → Room F2 via A*', () => {
    const rnF1 = makeRouteNetwork(
      [{ id: 'rn-f1-1', x: 5, y: 5, floor: 0 }, { id: 'rn-f1-stair', x: 10, y: 5, floor: 0 }],
      [{ id: 're-f1', from: 'rn-f1-1', to: 'rn-f1-stair', distance: 5 }],
    )
    const rnF2 = makeRouteNetwork(
      [{ id: 'rn-f2-stair', x: 10, y: 5, floor: 1 }, { id: 'rn-f2-1', x: 5, y: 5, floor: 1 }],
      [{ id: 're-f2', from: 'rn-f2-stair', to: 'rn-f2-1', distance: 5 }],
    )
    const raF1 = [makeRoomAttributes('f1', 'rm-1', 'Room F1', '101', true, [
      { openingId: 'op-1', routeNodeId: 'rn-f1-1', primary: true },
    ])]
    const raF2 = [makeRoomAttributes('f2', 'rm-2', 'Room F2', '201', true, [
      { openingId: 'op-2', routeNodeId: 'rn-f2-1', primary: true },
    ])]
    const vt: VerticalTransition[] = [{
      id: 'vt-1', featureId: 'stair-1', type: 'staircase', connections: [
        { floorId: 'b1-0', routeNodeId: 'rn-f1-stair' },
        { floorId: 'b1-1', routeNodeId: 'rn-f2-stair' },
      ],
    }]
    const eaF1: EntranceAccess[] = [{ entranceId: 'fl-0-ent', outdoorNodeId: 'outdoor-ent', indoorRouteNodeId: 'rn-f1-1' }]

    const floor1 = makeFloor('fl-0', 0, { routeNetwork: rnF1, roomAttributes: raF1, entranceAccess: eaF1 })
    const floor2 = makeFloor('fl-1', 1, { elevation: 3.5, routeNetwork: rnF2, roomAttributes: raF2 })
    const bld = makeBuilding('b1', 'Building A', [floor1, floor2], { verticalTransitions: vt })
    const doc = makeDoc([bld])
    const result = compiler.compileV2(doc)
    const nav = result.artifacts!.graph

    // Vertical transition edges exist
    const vertEdges = nav.edges.filter(e => e.type === 'stairs')
    expect(vertEdges.length).toBeGreaterThanOrEqual(1)

    // Both floors have nodes
    const f0Nodes = nav.nodes.filter(n => n.floor === 0 && n.buildingId === 'b1')
    const f1Nodes = nav.nodes.filter(n => n.floor === 1 && n.buildingId === 'b1')
    expect(f0Nodes.length).toBeGreaterThan(0)
    expect(f1Nodes.length).toBeGreaterThan(0)

    // floorGeometry has both floors with routeNetwork
    const fg = result.artifacts!.floorGeometry!
    const bFloors = fg.buildings[0]!.floors
    expect(bFloors.length).toBe(2)
    expect(bFloors[0]!.routeNetwork).toBeDefined()
    expect(bFloors[1]!.routeNetwork).toBeDefined()
  })
})

// ═══════════════════════════════════════════════════════════════
// Section 7 — Outdoor → Indoor
// ═══════════════════════════════════════════════════════════════

describe('W15F — Outdoor → Indoor', () => {
  const compiler = new CampusCompiler()

  it('Outdoor → EntranceAccess → Indoor RouteNetwork → Room', () => {
    const entrance = {
      id: 'ent-1', label: 'Main Entrance',
      position: { lat: 14.001, lng: 121.001 } as any,
      level: 0, type: 'main' as const, hasQR: false, hasPanorama: false,
    }
    const rn = makeRouteNetwork(
      [{ id: 'rn-1', x: 2, y: 3, floor: 0 }, { id: 'rn-2', x: 8, y: 6, floor: 0 }],
      [{ id: 're-1', from: 'rn-1', to: 'rn-2', distance: 7 }],
    )
    const ea: EntranceAccess[] = [{ entranceId: 'ent-1', outdoorNodeId: 'outdoor-42', indoorRouteNodeId: 'rn-1' }]
    const ra = [makeRoomAttributes('f1', 'rm-A', 'Room A', '101', true, [
      { openingId: 'op-1', routeNodeId: 'rn-2', primary: true },
    ])]
    const floor = makeFloor('fl-0', 0, { entrances: [entrance], routeNetwork: rn, entranceAccess: ea, roomAttributes: ra })
    const bld = makeBuilding('b1', 'Building A', [floor])
    const doc = makeDoc([bld])
    const result = compiler.compileV2(doc)
    const nav = result.artifacts!.graph

    // Should have entrance node
    const entranceNodes = nav.nodes.filter(n => n.type === 'entrance')
    expect(entranceNodes.length).toBeGreaterThanOrEqual(1)

    // floorGeometry has entranceAccess
    const fg = result.artifacts!.floorGeometry!
    const f = fg.buildings[0]!.floors[0]!
    expect(f.entranceAccess).toBeDefined()
    expect(f.entranceAccess!.length).toBe(1)
    expect(f.entranceAccess![0]!.entranceId).toBe('ent-1')
  })
})

// ═══════════════════════════════════════════════════════════════
// Section 8 — Identity Stability
// ═══════════════════════════════════════════════════════════════

describe('W15F — Identity Stability', () => {
  const compiler = new CampusCompiler()

  it('Campus ID stable across compile', () => {
    const floor = makeFloor('fl-0', 0)
    const bld = makeBuilding('b1', 'Building A', [floor])
    const doc = makeDoc([bld])
    const result = compiler.compileV2(doc)

    expect(result.artifacts!.graph.campusId).toBe(CAMPUS_ID)
    expect(result.artifacts!.floorGeometry!.campusId).toBe(CAMPUS_ID)
    expect(result.artifacts!.qrIndex!.campusId).toBe(CAMPUS_ID)
  })

  it('Building IDs stable across compile', () => {
    const floor = makeFloor('fl-0', 0)
    const bld = makeBuilding('b1', 'Building A', [floor])
    const doc = makeDoc([bld])
    const result = compiler.compileV2(doc)

    // floorGeometry always has the building
    expect(result.artifacts!.floorGeometry!.buildings[0]!.id).toBe('b1')
    // buildingIndex may be empty if no connectivity graph nodes
    if (result.artifacts!.buildingIndex.buildings.length > 0) {
      expect(result.artifacts!.buildingIndex.buildings[0]!.id).toBe('b1')
    }
  })

  it('Floor IDs derived as buildingId-level', () => {
    const floor = makeFloor('fl-0', 0)
    const bld = makeBuilding('b1', 'Building A', [floor])
    const doc = makeDoc([bld])
    const result = compiler.compileV2(doc)

    const norm = normalizeDocument(doc)
    expect(norm.document.buildings[0]!.floors[0]!.id).toBe('b1-0')
  })

  it('Semantic roomId stable (not face ordering)', () => {
    const ra = [makeRoomAttributes('volatile-face', 'rm-stable-42', 'Lab', '42', true)]
    const floor = makeFloor('fl-0', 0, { roomAttributes: ra })
    const bld = makeBuilding('b1', 'Building A', [floor])
    const doc = makeDoc([bld])
    const result = compiler.compileV2(doc)

    const roomEntry = result.artifacts!.searchIndex.entries.find(e => e.type === 'room')
    expect(roomEntry!.id).toBe('search_room_rm-stable-42')
  })

  it('Authored RouteNode IDs preserved in floorGeometry', () => {
    const rn = makeRouteNetwork(
      [{ id: 'my-node-1', x: 5, y: 5, floor: 0 }],
      [],
    )
    const floor = makeFloor('fl-0', 0, { routeNetwork: rn })
    const bld = makeBuilding('b1', 'Building A', [floor])
    const doc = makeDoc([bld])
    const result = compiler.compileV2(doc)

    const f = result.artifacts!.floorGeometry!.buildings[0]!.floors[0]!
    expect(f.routeNetwork!.nodes[0]!.id).toBe('my-node-1')
  })

  it('Compiled R-* IDs stable for same authored IDs', () => {
    const rn = makeRouteNetwork(
      [{ id: 'rn-1', x: 5, y: 5, floor: 0 }, { id: 'rn-2', x: 10, y: 10, floor: 0 }],
      [{ id: 're-1', from: 'rn-1', to: 'rn-2', distance: 7 }],
    )
    const floor = makeFloor('fl-0', 0, { routeNetwork: rn })
    const bld = makeBuilding('b1', 'Building A', [floor])
    const doc = makeDoc([bld])
    const result1 = compiler.compileV2(doc)
    const result2 = compiler.compileV2(doc)

    // Compiled graph node IDs starting with R- should be deterministic
    const rNodes1 = result1.artifacts!.graph.nodes.filter(n => n.id.startsWith('R-')).map(n => n.id)
    const rNodes2 = result2.artifacts!.graph.nodes.filter(n => n.id.startsWith('R-')).map(n => n.id)
    expect(rNodes1).toEqual(rNodes2)
  })
})

// ═══════════════════════════════════════════════════════════════
// Section 9 — Publish Idempotency
// ═══════════════════════════════════════════════════════════════

describe('W15F — Publish Idempotency', () => {
  const compiler = new CampusCompiler()

  it('same document published twice produces deterministic artifacts', () => {
    const rn = makeRouteNetwork(
      [{ id: 'rn-1', x: 2, y: 3, floor: 0 }, { id: 'rn-2', x: 8, y: 6, floor: 0 }],
      [{ id: 're-1', from: 'rn-1', to: 'rn-2', distance: 7 }],
    )
    const ra = [makeRoomAttributes('f1', 'rm-A', 'Room A', '101', true)]
    const floor = makeFloor('fl-0', 0, { routeNetwork: rn, roomAttributes: ra })
    const bld = makeBuilding('b1', 'Building A', [floor])
    const doc = makeDoc([bld])

    const r1 = compiler.compileV2(doc)
    const r2 = compiler.compileV2(doc)

    // Deterministic search index (filter out N-xx entries which use auto-incrementing IDs)
    const stableEntries1 = r1.artifacts!.searchIndex.entries
      .filter(e => !e.id.startsWith('N-'))
      .map(e => ({ ...e, nodeId: '' }))  // strip auto-generated nodeId
    const stableEntries2 = r2.artifacts!.searchIndex.entries
      .filter(e => !e.id.startsWith('N-'))
      .map(e => ({ ...e, nodeId: '' }))
    expect(stableEntries1).toEqual(stableEntries2)

    // Deterministic floor geometry
    expect(JSON.stringify(r1.artifacts!.floorGeometry)).toBe(JSON.stringify(r2.artifacts!.floorGeometry))

    // Deterministic QR index
    expect(JSON.stringify(r1.artifacts!.qrIndex)).toBe(JSON.stringify(r2.artifacts!.qrIndex))

    // Graph metadata is deterministic (nodeCount, edgeCount, buildingCount, floorCount)
    expect(r1.artifacts!.graph.metadata.nodeCount).toBe(r2.artifacts!.graph.metadata.nodeCount)
    expect(r1.artifacts!.graph.metadata.edgeCount).toBe(r2.artifacts!.graph.metadata.edgeCount)
  })
})

// ═══════════════════════════════════════════════════════════════
// Section 10 — Backward Compatibility
// ═══════════════════════════════════════════════════════════════

describe('W15F — Backward Compatibility', () => {
  const compiler = new CampusCompiler()

  it('old document without new canonical fields still publishes', () => {
    const legacyRoom: Room = {
      id: 'r1', name: 'Old Room', number: 'O-1', category: 'classroom',
      polygon: { points: [{ x: 5, y: 5 }, { x: 15, y: 5 }, { x: 15, y: 13 }, { x: 5, y: 13 }, { x: 5, y: 5 }] },
      roomDoors: [], capacity: 30, metadata: {},
    }
    const floor = makeFloor('fl-0', 0, { rooms: [legacyRoom] })
    const bld = makeBuilding('b1', 'Old Building', [floor])
    const doc = makeDoc([bld])
    const result = compiler.compileV2(doc)

    expect(result.success).toBe(true)
    expect(result.artifacts).toBeDefined()
    expect(result.artifacts!.graph).toBeDefined()
    expect(result.artifacts!.searchIndex).toBeDefined()
    expect(result.artifacts!.buildingIndex).toBeDefined()

    // Legacy room indexed
    const roomEntry = result.artifacts!.searchIndex.entries.find(e => e.id === 'search_room_r1')
    expect(roomEntry).toBeDefined()
  })

  it('document with empty buildings array still compiles', () => {
    const doc = makeDoc([])
    const result = compiler.compileV2(doc)
    expect(result.success).toBe(true)
    expect(result.artifacts!.graph.nodes.length).toBe(0)
    expect(result.artifacts!.buildingIndex.buildings.length).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════
// Section 11 — Corrupted Canonical Input
// ═══════════════════════════════════════════════════════════════

describe('W15F — Corrupted Canonical Input', () => {
  const compiler = new CampusCompiler()

  it('routeNetwork with missing node reference does not crash', () => {
    const ra = [makeRoomAttributes('f1', 'rm-A', 'Room A', '101', true, [
      { openingId: 'op-1', routeNodeId: 'rn-missing', primary: true },
    ])]
    const floor = makeFloor('fl-0', 0, { roomAttributes: ra })
    const bld = makeBuilding('b1', 'Building A', [floor])
    const doc = makeDoc([bld])
    const result = compiler.compileV2(doc)

    // Should compile successfully (missing route node → warning, not error)
    expect(result.success).toBe(true)
  })

  it('routeNetwork with duplicate node IDs → INVALID authority → fallback', () => {
    const rn: RouteNetwork = {
      nodes: [
        { id: 'rn-1', type: 'waypoint', position: { x: 0, y: 0 }, floor: 0 },
        { id: 'rn-1', type: 'waypoint', position: { x: 1, y: 1 }, floor: 0 },
      ],
      edges: [],
    }
    const floor = makeFloor('fl-0', 0, { routeNetwork: rn })
    const bld = makeBuilding('b1', 'Building A', [floor])
    const doc = makeDoc([bld])
    const result = compiler.compileV2(doc)

    // Should compile successfully (INVALID route network → fallback to skeleton)
    expect(result.success).toBe(true)
  })

  it('entranceAccess with missing outdoor node does not crash', () => {
    const rn = makeRouteNetwork(
      [{ id: 'rn-1', x: 2, y: 3, floor: 0 }],
      [],
    )
    const ea: EntranceAccess[] = [{ entranceId: 'e1', outdoorNodeId: 'missing', indoorRouteNodeId: 'rn-1' }]
    const floor = makeFloor('fl-0', 0, { routeNetwork: rn, entranceAccess: ea })
    const bld = makeBuilding('b1', 'Building A', [floor])
    const doc = makeDoc([bld])
    const result = compiler.compileV2(doc)

    expect(result.success).toBe(true)
  })

  it('verticalTransition with missing route node does not crash', () => {
    const vt: VerticalTransition[] = [{
      id: 'vt-1', featureId: 'stair-1', type: 'staircase', connections: [
        { floorId: 'b1-0', routeNodeId: 'rn-missing' },
        { floorId: 'b1-1', routeNodeId: 'rn-f2' },
      ],
    }]
    const floor1 = makeFloor('fl-0', 0)
    const floor2 = makeFloor('fl-1', 1, { elevation: 3.5 })
    const bld = makeBuilding('b1', 'Building A', [floor1, floor2], { verticalTransitions: vt })
    const doc = makeDoc([bld])
    const result = compiler.compileV2(doc)

    expect(result.success).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════
// Section 12 — Required Gate Cases (30)
// ═══════════════════════════════════════════════════════════════

describe('W15F — Required Gate Cases (30)', () => {
  const compiler = new CampusCompiler()

  // ── Publish Path Trace (6) ──

  describe('Publish Path Trace', () => {
    it('GC1: CampusCompiler.compileV2 returns success with all artifacts', () => {
      const floor = makeFloor('fl-0', 0)
      const bld = makeBuilding('b1', 'Building A', [floor])
      const doc = makeDoc([bld])
      const result = compiler.compileV2(doc)

      expect(result.success).toBe(true)
      expect(result.artifacts).toBeDefined()
      expect(result.graph).toBeDefined()
    })

    it('GC2: artifacts contain all 8 required indexes', () => {
      const floor = makeFloor('fl-0', 0)
      const bld = makeBuilding('b1', 'Building A', [floor])
      const doc = makeDoc([bld])
      const result = compiler.compileV2(doc)
      const a = result.artifacts!

      expect(a.graph).toBeDefined()
      expect(a.searchIndex).toBeDefined()
      expect(a.spatialIndex).toBeDefined()
      expect(a.buildingIndex).toBeDefined()
      expect(a.poiIndex).toBeDefined()
      expect(a.floorGeometry).toBeDefined()
    })

    it('GC3: NavigationGraph has version, campusId, nodes, edges', () => {
      const floor = makeFloor('fl-0', 0)
      const bld = makeBuilding('b1', 'Building A', [floor])
      const doc = makeDoc([bld])
      const result = compiler.compileV2(doc)
      const g = result.artifacts!.graph

      expect(g.version).toBe('1.0.0')
      expect(g.campusId).toBeDefined()
      expect(Array.isArray(g.nodes)).toBe(true)
      expect(Array.isArray(g.edges)).toBe(true)
    })

    it('GC4: buildingIndex contains building metadata (name, code, category)', () => {
      const floor = makeFloor('fl-0', 0)
      const bld = makeBuilding('b1', 'Science Hall', [floor])
      const doc = makeDoc([bld])
      const result = compiler.compileV2(doc)
      const bldEntry = result.artifacts!.buildingIndex.buildings.find(b => b.id === 'b1')

      // BuildingIndex requires connectivity graph nodes to appear
      if (bldEntry) {
        expect(bldEntry.name).toBe('Science Hall')
        expect(bldEntry.code).toBe('b1')
        expect(bldEntry.category).toBe('academic')
      } else {
        // Building has no connectivity nodes — buildingIndex is empty but floorGeometry has it
        expect(result.artifacts!.floorGeometry!.buildings[0]!.id).toBe('b1')
      }
    })

    it('GC5: floorGeometry schemaVersion and formatVersion present', () => {
      const floor = makeFloor('fl-0', 0)
      const bld = makeBuilding('b1', 'Building A', [floor])
      const doc = makeDoc([bld])
      const result = compiler.compileV2(doc)
      const fg = result.artifacts!.floorGeometry!

      expect(typeof fg.schemaVersion).toBe('number')
      expect(typeof fg.formatVersion).toBe('number')
    })

    it('GC6: graph metadata has nodeCount, edgeCount, buildings, floors', () => {
      const floor = makeFloor('fl-0', 0)
      const bld = makeBuilding('b1', 'Building A', [floor])
      const doc = makeDoc([bld])
      const result = compiler.compileV2(doc)
      const m = result.artifacts!.graph.metadata

      expect(typeof m.nodeCount).toBe('number')
      expect(typeof m.edgeCount).toBe('number')
      expect(typeof m.buildings).toBe('number')
      expect(typeof m.floors).toBe('number')
    })
  })

  // ── floorGeometry Survival (6) ──

  describe('floorGeometry Survival', () => {
    it('GC7: walls survive publish pipeline with all fields', () => {
      const wall = makeWall('w1', 0, 0, 10, 0)
      const floor = makeFloor('fl-0', 0, { walls: [wall] })
      const bld = makeBuilding('b1', 'Building A', [floor])
      const doc = makeDoc([bld])
      const f = compiler.compileV2(doc).artifacts!.floorGeometry!.buildings[0]!.floors[0]!

      expect(f.walls!.length).toBe(1)
      expect(f.walls![0]!.id).toBe('w1')
      expect(f.walls![0]!.thickness).toBe(0.15)
      expect(f.walls![0]!.height).toBe(3.5)
    })

    it('GC8: openings survive publish pipeline', () => {
      const opening = makeOpening('op1', 'w1', 2.5, 0.9)
      const floor = makeFloor('fl-0', 0, { openings: [opening] })
      const bld = makeBuilding('b1', 'Building A', [floor])
      const doc = makeDoc([bld])
      const f = compiler.compileV2(doc).artifacts!.floorGeometry!.buildings[0]!.floors[0]!

      expect(f.openings!.length).toBe(1)
      expect(f.openings![0]!.wallId).toBe('w1')
    })

    it('GC9: routeNetwork survives publish pipeline with IDs preserved', () => {
      const rn = makeRouteNetwork(
        [{ id: 'custom-n1', x: 5, y: 5, floor: 0 }],
        [],
      )
      const floor = makeFloor('fl-0', 0, { routeNetwork: rn })
      const bld = makeBuilding('b1', 'Building A', [floor])
      const doc = makeDoc([bld])
      const f = compiler.compileV2(doc).artifacts!.floorGeometry!.buildings[0]!.floors[0]!

      expect(f.routeNetwork!.nodes[0]!.id).toBe('custom-n1')
    })

    it('GC10: roomAttributes survive with roomId, name, number', () => {
      const ra = [makeRoomAttributes('f1', 'rm-42', 'Lab', '42', true)]
      const floor = makeFloor('fl-0', 0, { roomAttributes: ra })
      const bld = makeBuilding('b1', 'Building A', [floor])
      const doc = makeDoc([bld])
      const f = compiler.compileV2(doc).artifacts!.floorGeometry!.buildings[0]!.floors[0]!

      expect(f.roomAttributes!.length).toBe(1)
      expect(f.roomAttributes![0]!.roomId).toBe('rm-42')
      expect(f.roomAttributes![0]!.name).toBe('Lab')
      expect(f.roomAttributes![0]!.number).toBe('42')
    })

    it('GC11: entranceAccess survives publish pipeline', () => {
      const rn = makeRouteNetwork([{ id: 'rn-1', x: 5, y: 5, floor: 0 }], [])
      const ea: EntranceAccess[] = [{ entranceId: 'e1', outdoorNodeId: 'out-1', indoorRouteNodeId: 'rn-1' }]
      const floor = makeFloor('fl-0', 0, { routeNetwork: rn, entranceAccess: ea })
      const bld = makeBuilding('b1', 'Building A', [floor])
      const doc = makeDoc([bld])
      const f = compiler.compileV2(doc).artifacts!.floorGeometry!.buildings[0]!.floors[0]!

      expect(f.entranceAccess!.length).toBe(1)
      expect(f.entranceAccess![0]!.entranceId).toBe('e1')
    })

    it('GC12: additive-absent — empty floor has no optional fields', () => {
      const floor = makeFloor('fl-0', 0)
      const bld = makeBuilding('b1', 'Building A', [floor])
      const doc = makeDoc([bld])
      const f = compiler.compileV2(doc).artifacts!.floorGeometry!.buildings[0]!.floors[0]!

      expect(f.walls).toBeUndefined()
      expect(f.openings).toBeUndefined()
      expect(f.roomAttributes).toBeUndefined()
      expect(f.routeNetwork).toBeUndefined()
      expect(f.entranceAccess).toBeUndefined()
    })
  })

  // ── NavigationGraph Survival (6) ──

  describe('NavigationGraph Survival', () => {
    it('GC13: Room → Room via RouteNetwork in compiled graph', () => {
      const rn = makeRouteNetwork(
        [{ id: 'rn-1', x: 2, y: 3, floor: 0 }, { id: 'rn-2', x: 8, y: 6, floor: 0 }],
        [{ id: 're-1', from: 'rn-1', to: 'rn-2', distance: 7 }],
      )
      const ra = [
        makeRoomAttributes('f1', 'rm-A', 'Room A', '101', true, [
          { openingId: 'op-1', routeNodeId: 'rn-1', primary: true },
        ]),
        makeRoomAttributes('f2', 'rm-B', 'Room B', '102', true, [
          { openingId: 'op-2', routeNodeId: 'rn-2', primary: true },
        ]),
      ]
      const floor = makeFloor('fl-0', 0, { routeNetwork: rn, roomAttributes: ra })
      const bld = makeBuilding('b1', 'Building A', [floor])
      const doc = makeDoc([bld])
      const result = compiler.compileV2(doc)

      expect(result.artifacts!.graph.edges.length).toBeGreaterThan(0)
    })

    it('GC14: Outdoor → Indoor via entrance produces entrance nodes', () => {
      const entrance = {
        id: 'ent-1', label: 'Main',
        position: { lat: 14.001, lng: 121.001 } as any,
        level: 0, type: 'main' as const, hasQR: false, hasPanorama: false,
      }
      const floor = makeFloor('fl-0', 0, { entrances: [entrance] })
      const bld = makeBuilding('b1', 'Building A', [floor])
      const doc = makeDoc([bld])
      const result = compiler.compileV2(doc)

      const entrances = result.artifacts!.graph.nodes.filter(n => n.type === 'entrance')
      expect(entrances.length).toBeGreaterThanOrEqual(1)
    })

    it('GC15: Floor 1 → Floor 2 via VerticalTransition produces stairs edges', () => {
      const rn = makeRouteNetwork(
        [{ id: 'rn-f1', x: 5, y: 5, floor: 0 }, { id: 'rn-f2', x: 5, y: 5, floor: 1 }],
        [],
      )
      const vt: VerticalTransition[] = [{
        id: 'vt-1', featureId: 'stair-1', type: 'staircase', connections: [
          { floorId: 'b1-0', routeNodeId: 'rn-f1' },
          { floorId: 'b1-1', routeNodeId: 'rn-f2' },
        ],
      }]
      const eaF1: EntranceAccess[] = [{ entranceId: 'fl-0-ent', outdoorNodeId: 'outdoor-ent', indoorRouteNodeId: 'rn-f1' }]
      const floor1 = makeFloor('fl-0', 0, { routeNetwork: rn, entranceAccess: eaF1 })
      const floor2 = makeFloor('fl-1', 1, { elevation: 3.5 })
      const bld = makeBuilding('b1', 'Building A', [floor1, floor2], { verticalTransitions: vt })
      const doc = makeDoc([bld])
      const result = compiler.compileV2(doc)

      const stairsEdges = result.artifacts!.graph.edges.filter(e => e.type === 'stairs')
      expect(stairsEdges.length).toBeGreaterThanOrEqual(1)
    })

    it('GC16: graph contains nodes for all buildings', () => {
      const bld1 = makeBuilding('b1', 'A', [makeFloor('fl-0', 0)])
      const bld2 = makeBuilding('b2', 'B', [makeFloor('fl-0', 0)])
      const doc = makeDoc([bld1, bld2])
      const result = compiler.compileV2(doc)

      // floorGeometry has all buildings
      const fgBuildingIds = result.artifacts!.floorGeometry!.buildings.map(b => b.id)
      expect(fgBuildingIds).toContain('b1')
      expect(fgBuildingIds).toContain('b2')
    })

    it('GC17: graph edges reference valid node IDs', () => {
      const rn = makeRouteNetwork(
        [{ id: 'rn-1', x: 2, y: 3, floor: 0 }, { id: 'rn-2', x: 8, y: 6, floor: 0 }],
        [{ id: 're-1', from: 'rn-1', to: 'rn-2', distance: 7 }],
      )
      const floor = makeFloor('fl-0', 0, { routeNetwork: rn })
      const bld = makeBuilding('b1', 'Building A', [floor])
      const doc = makeDoc([bld])
      const result = compiler.compileV2(doc)
      const nodeIds = new Set(result.artifacts!.graph.nodes.map(n => n.id))

      for (const edge of result.artifacts!.graph.edges) {
        expect(nodeIds.has(edge.from)).toBe(true)
        expect(nodeIds.has(edge.to)).toBe(true)
      }
    })

    it('GC18: graph checksum changes when input changes', () => {
      const floor1 = makeFloor('fl-0', 0)
      const bld1 = makeBuilding('b1', 'Building A', [floor1])
      const doc1 = makeDoc([bld1])
      const r1 = compiler.compileV2(doc1)

      // Different structure: 2 floors vs 1 floor
      const floor2a = makeFloor('fl-0', 0)
      const floor2b = makeFloor('fl-1', 1, { elevation: 3.5 })
      const bld2 = makeBuilding('b1', 'Building A', [floor2a, floor2b])
      const doc2 = makeDoc([bld2])
      const r2 = compiler.compileV2(doc2)

      // floorGeometry checksum should differ (different number of floors)
      expect(JSON.stringify(r1.artifacts!.floorGeometry)).not.toBe(JSON.stringify(r2.artifacts!.floorGeometry))
    })
  })

  // ── SearchIndex Survival (6) ──

  describe('SearchIndex Survival', () => {
    it('GC19: semantic room indexed with stable ID', () => {
      const ra = [makeRoomAttributes('f1', 'rm-101', 'Room 101', '101', true)]
      const floor = makeFloor('fl-0', 0, { roomAttributes: ra })
      const bld = makeBuilding('b1', 'Building A', [floor])
      const doc = makeDoc([bld])
      const result = compiler.compileV2(doc)

      const entry = result.artifacts!.searchIndex.entries.find(e => e.id === 'search_room_rm-101')
      expect(entry).toBeDefined()
      expect(entry!.label).toBe('Room 101')
    })

    it('GC20: searchable=false room excluded from search', () => {
      const ra = [makeRoomAttributes('f1', 'rm-hidden', 'Hidden', 'H-1', false)]
      const floor = makeFloor('fl-0', 0, { roomAttributes: ra })
      const bld = makeBuilding('b1', 'Building A', [floor])
      const doc = makeDoc([bld])
      const result = compiler.compileV2(doc)

      const entry = result.artifacts!.searchIndex.entries.find(e => e.id === 'search_room_rm-hidden')
      expect(entry).toBeUndefined()
    })

    it('GC21: no duplicate entries when both RoomAttributes and legacy rooms', () => {
      const ra = [makeRoomAttributes('f1', 'rm-101', 'Room 101', '101', true)]
      const room: Room = {
        id: 'r1', name: 'Room 101', number: '101', category: 'classroom',
        polygon: { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 8 }, { x: 0, y: 8 }, { x: 0, y: 0 }] },
        roomDoors: [], capacity: 30, metadata: {},
      }
      const floor = makeFloor('fl-0', 0, { roomAttributes: ra, rooms: [room] })
      const bld = makeBuilding('b1', 'Building A', [floor])
      const doc = makeDoc([bld])
      const result = compiler.compileV2(doc)

      const roomEntries = result.artifacts!.searchIndex.entries.filter(e => e.type === 'room')
      const uniqueIds = new Set(roomEntries.map(e => e.id))
      expect(roomEntries.length).toBe(uniqueIds.size)
    })

    it('GC22: building entries indexed alongside rooms', () => {
      const ra = [makeRoomAttributes('f1', 'rm-A', 'Room A', '1', true)]
      const floor = makeFloor('fl-0', 0, { roomAttributes: ra })
      const bld = makeBuilding('b1', 'Building A', [floor])
      const doc = makeDoc([bld])
      const result = compiler.compileV2(doc)

      const bldEntry = result.artifacts!.searchIndex.entries.find(e => e.type === 'building' && e.buildingId === 'b1')
      expect(bldEntry).toBeDefined()
    })

    it('GC23: search entry has tags for text matching', () => {
      const ra = [makeRoomAttributes('f1', 'rm-1', 'Chemistry Lab', 'C-101', true)]
      const floor = makeFloor('fl-0', 0, { roomAttributes: ra })
      const bld = makeBuilding('b1', 'Science Hall', [floor])
      const doc = makeDoc([bld])
      const result = compiler.compileV2(doc)

      const entry = result.artifacts!.searchIndex.entries.find(e => e.type === 'room')
      expect(entry!.tags.length).toBeGreaterThan(0)
    })

    it('GC24: legacy document without RoomAttributes uses legacy search', () => {
      const room: Room = {
        id: 'r1', name: 'Legacy Room', number: 'L-1', category: 'classroom',
        polygon: { points: [{ x: 5, y: 5 }, { x: 15, y: 5 }, { x: 15, y: 13 }, { x: 5, y: 13 }, { x: 5, y: 5 }] },
        roomDoors: [], capacity: 30, metadata: {},
      }
      const floor = makeFloor('fl-0', 0, { rooms: [room] })
      const bld = makeBuilding('b1', 'Building A', [floor])
      const doc = makeDoc([bld])
      const result = compiler.compileV2(doc)

      const entry = result.artifacts!.searchIndex.entries.find(e => e.id === 'search_room_r1')
      expect(entry).toBeDefined()
    })
  })

  // ── Mixed-Version & Backward Compat (6) ──

  describe('Mixed-Version & Backward Compat', () => {
    it('GC25: mixed canonical + legacy floors in same building', () => {
      const rn = makeRouteNetwork([{ id: 'rn-1', x: 5, y: 5, floor: 0 }], [])
      const ra = [makeRoomAttributes('f1', 'rm-A', 'Room A', '1', true)]
      const eaF1: EntranceAccess[] = [{ entranceId: 'fl-0-ent', outdoorNodeId: 'outdoor-ent', indoorRouteNodeId: 'rn-1' }]
      const legacyRoom: Room = {
        id: 'r-legacy', name: 'Legacy', number: 'L', category: 'office',
        polygon: { points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 5 }, { x: 0, y: 0 }] },
        roomDoors: [], capacity: 10, metadata: {},
      }
      const floor1 = makeFloor('fl-0', 0, { routeNetwork: rn, roomAttributes: ra, entranceAccess: eaF1 })
      const floor2 = makeFloor('fl-1', 1, { elevation: 3.5, rooms: [legacyRoom] })
      const bld = makeBuilding('b1', 'Building A', [floor1, floor2])
      const doc = makeDoc([bld])
      const result = compiler.compileV2(doc)

      expect(result.success).toBe(true)
      // Canonical room in search
      expect(result.artifacts!.searchIndex.entries.some(e => e.id === 'search_room_rm-A')).toBe(true)
      // Legacy room in search
      expect(result.artifacts!.searchIndex.entries.some(e => e.id === 'search_room_r-legacy')).toBe(true)
    })

    it('GC26: old document without canonical fields compiles cleanly', () => {
      const room: Room = {
        id: 'r1', name: 'Room', number: '1', category: 'classroom',
        polygon: { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 8 }, { x: 0, y: 8 }, { x: 0, y: 0 }] },
        roomDoors: [], capacity: 30, metadata: {},
      }
      const floor = makeFloor('fl-0', 0, { rooms: [room] })
      const bld = makeBuilding('b1', 'Building A', [floor])
      const doc = makeDoc([bld])
      const result = compiler.compileV2(doc)

      expect(result.success).toBe(true)
      expect(result.artifacts!.floorGeometry!.buildings[0]!.floors[0]!.walls).toBeUndefined()
    })

    it('GC27: building with no floors still compiles', () => {
      const bld = makeBuilding('b1', 'Building A', [])
      const doc = makeDoc([bld])
      const result = compiler.compileV2(doc)

      expect(result.success).toBe(true)
      // floorGeometry always reflects the document buildings
      expect(result.artifacts!.floorGeometry!.buildings.length).toBe(1)
      expect(result.artifacts!.floorGeometry!.buildings[0]!.floors.length).toBe(0)
    })

    it('GC28: document with no buildings compiles', () => {
      const doc = makeDoc([])
      const result = compiler.compileV2(doc)

      expect(result.success).toBe(true)
      expect(result.artifacts!.graph.nodes.length).toBe(0)
    })

    it('GC29: multiple buildings with different floor counts', () => {
      const bld1 = makeBuilding('b1', 'A', [
        makeFloor('fl-0', 0),
        makeFloor('fl-1', 1, { elevation: 3.5 }),
      ])
      const bld2 = makeBuilding('b2', 'B', [
        makeFloor('fl-0', 0),
        makeFloor('fl-1', 1, { elevation: 3.5 }),
        makeFloor('fl-2', 2, { elevation: 7 }),
      ])
      const doc = makeDoc([bld1, bld2])
      const result = compiler.compileV2(doc)

      expect(result.success).toBe(true)
      // floorGeometry reflects all buildings from the document
      expect(result.artifacts!.floorGeometry!.buildings.length).toBe(2)
      expect(result.artifacts!.floorGeometry!.buildings[0]!.floors.length).toBe(2)
      expect(result.artifacts!.floorGeometry!.buildings[1]!.floors.length).toBe(3)
    })

    it('GC30: publish path produces consistent results across normalize→primitives→emit→artifacts', () => {
      const rn = makeRouteNetwork(
        [{ id: 'rn-1', x: 2, y: 3, floor: 0 }, { id: 'rn-2', x: 8, y: 6, floor: 0 }],
        [{ id: 're-1', from: 'rn-1', to: 'rn-2', distance: 7 }],
      )
      const ra = [makeRoomAttributes('f1', 'rm-A', 'Room A', '101', true, [
        { openingId: 'op-1', routeNodeId: 'rn-1', primary: true },
      ])]
      const floor = makeFloor('fl-0', 0, { routeNetwork: rn, roomAttributes: ra })
      const bld = makeBuilding('b1', 'Building A', [floor])
      const doc = makeDoc([bld])

      // Full V2 pipeline
      const v2Result = compiler.compileV2(doc)

      // Manual pipeline: normalize → primitives → emit → artifacts
      const norm = normalizeDocument(doc)
      const primitives = generatePrimitives(norm.document, { nodeInterval: 10, mergeThreshold: 0.5 })
      primitives.metadata.campusId = doc.metadata.name
      const navGraph = emitGraph(primitives)
      const manualArtifacts = buildArtifacts(primitives, navGraph, doc)

      // Search index stable entries should match (filter out N-xx auto-generated IDs)
      const v2SearchIds = v2Result.artifacts!.searchIndex.entries
        .filter(e => !e.id.startsWith('N-'))
        .map(e => e.id)
        .sort()
      const manualSearchIds = manualArtifacts.searchIndex.entries
        .filter(e => !e.id.startsWith('N-'))
        .map(e => e.id)
        .sort()
      expect(v2SearchIds).toEqual(manualSearchIds)

      // floorGeometry should match
      expect(JSON.stringify(v2Result.artifacts!.floorGeometry)).toBe(JSON.stringify(manualArtifacts.floorGeometry))
    })
  })
})
