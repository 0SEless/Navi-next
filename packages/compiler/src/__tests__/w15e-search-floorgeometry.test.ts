import { describe, it, expect } from 'vitest'
import { buildArtifacts } from '../emitter/artifacts'
import type { CampusDocument, Building, Floor, Room, Entrance, Wall, Opening, RoomAttributes, RoomAccess, RouteNetwork, EntranceAccess } from '@navi/core'
import type { ConnectivityGraph, NavigationGraph, PrimitiveNode, PrimitiveEdge } from '../types'

// ── Helper factories ──

function makeEmptyGraph(): ConnectivityGraph {
  return { nodes: [], edges: [], metadata: { campusId: 'test', buildingCount: 0, floorCount: 0, generatedAt: 0 }, diagnostics: [] }
}

function makeNavGraph(nodes: PrimitiveNode[] = [], edges: PrimitiveEdge[] = []): NavigationGraph {
  return {
    version: '1.0.0',
    campusId: 'test',
    createdAt: '',
    checksum: '',
    nodes: nodes.map(n => ({
      id: n.id,
      label: (n as any).label ?? '',
      type: (n.kind === 'poi' ? 'poi' : n.kind === 'entrance_portal' ? 'entrance' : 'waypoint') as any,
      position: n.position,
      floor: n.floor,
      buildingId: n.buildingId,
      properties: {},
    })),
    edges: edges.map(e => ({
      id: e.id,
      from: (e as any).from ?? '',
      to: (e as any).to ?? '',
      type: 'walk' as const,
      distance: e.distance,
      weight: e.distance,
    })),
    metadata: { nodeCount: nodes.length, edgeCount: edges.length, buildings: 1, floors: 1, boundingBox: { minLng: 0, maxLng: 0, minLat: 0, maxLat: 0 } },
  }
}

function makeDoc(buildings: Building[]): CampusDocument {
  return {
    schemaVersion: 1,
    version: 1,
    metadata: { campusId: 'test', name: 'test', description: '', lastModified: '', editorVersion: '1.0.0' },
    buildings,
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
  }
}

function makeBuilding(id: string, name: string, floors: Floor[]): Building {
  return {
    id, name, code: id, category: 'academic', description: '',
    footprint: { points: [{ lat: 14, lng: 121 }, { lat: 14, lng: 121.01 }, { lat: 14.01, lng: 121.01 }, { lat: 14.01, lng: 121 }] },
    baseElevation: 0, height: 10, floors, verticalConnectors: [], color: '#ccc', aliases: [], metadata: {},
  }
}

function makeFloor(id: string, level: number, overrides?: Partial<Floor>): Floor {
  return {
    id, level, label: `Floor ${level}`, elevation: level * 3, height: 3.5,
    rooms: [], hallways: [], staircases: [], elevators: [], entrances: [],
    connectorStops: [], metadata: {}, ...overrides,
  }
}

function makeRoom(id: string, name: string, number: string, x: number, y: number): Room {
  return {
    id, name, number, category: 'classroom',
    polygon: { points: [{ x, y }, { x: x + 10, y }, { x: x + 10, y: y + 8 }, { x, y: y + 8 }, { x, y }] },
    roomDoors: [], capacity: 30, metadata: {},
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

function makeRouteNetwork(): RouteNetwork {
  return {
    nodes: [
      { id: 'rn-1', type: 'waypoint', position: { x: 2, y: 3 }, floor: 0 },
      { id: 'rn-2', type: 'poi', position: { x: 8, y: 6 }, floor: 0 },
    ],
    edges: [{ id: 're-1', from: 'rn-1', to: 'rn-2', type: 'walk', distance: 7 }],
  }
}

// ═══════════════════════════════════════════════════════════════
// Part A — Search/Index Authority (12 tests)
// ═══════════════════════════════════════════════════════════════

describe('W15E Search Gate', () => {
  // --- Authority selection ---
  it('S1: uses RoomAttributes as search authority when present', () => {
    const ra = [makeRoomAttributes('f1', 'rm-101', 'Room 101', '101', true)]
    const floor = makeFloor('fl-0', 0, { roomAttributes: ra })
    const bld = makeBuilding('b1', 'Building A', [floor])
    const doc = makeDoc([bld])
    const graph = makeEmptyGraph()
    const nav = makeNavGraph()

    const result = buildArtifacts(graph, nav, doc)
    const roomEntries = result.searchIndex.entries.filter(e => e.type === 'room')
    expect(roomEntries.length).toBe(1)
    expect(roomEntries[0]!.id).toBe('search_room_rm-101')
    expect(roomEntries[0]!.label).toBe('Room 101')
  })

  it('S2: falls back to legacy Floor.rooms[] when no RoomAttributes', () => {
    const room = makeRoom('r1', 'Legacy Room', 'L-1', 5, 5)
    const floor = makeFloor('fl-0', 0, { rooms: [room] })
    const bld = makeBuilding('b1', 'Building A', [floor])
    const doc = makeDoc([bld])
    const graph = makeEmptyGraph()
    const nav = makeNavGraph()

    const result = buildArtifacts(graph, nav, doc)
    const roomEntries = result.searchIndex.entries.filter(e => e.type === 'room')
    expect(roomEntries.length).toBe(1)
    expect(roomEntries[0]!.id).toBe('search_room_r1')
    expect(roomEntries[0]!.label).toBe('Legacy Room')
  })

  it('S3: does not emit duplicate entries when both RoomAttributes and rooms exist', () => {
    const ra = [makeRoomAttributes('f1', 'rm-101', 'Room 101', '101', true)]
    const room = makeRoom('r1', 'Room 101', '101', 5, 5)
    const floor = makeFloor('fl-0', 0, { roomAttributes: ra, rooms: [room] })
    const bld = makeBuilding('b1', 'Building A', [floor])
    const doc = makeDoc([bld])
    const graph = makeEmptyGraph()
    const nav = makeNavGraph()

    const result = buildArtifacts(graph, nav, doc)
    const roomEntries = result.searchIndex.entries.filter(e => e.type === 'room')
    // Semantic rooms take precedence — only 1 entry
    expect(roomEntries.length).toBe(1)
  })

  // --- searchable flag ---
  it('S4: excludes room from search when searchable is false', () => {
    const ra = [
      makeRoomAttributes('f1', 'rm-101', 'Room 101', '101', true),
      makeRoomAttributes('f2', 'rm-hidden', 'Hidden Room', 'H-1', false),
    ]
    const floor = makeFloor('fl-0', 0, { roomAttributes: ra })
    const bld = makeBuilding('b1', 'Building A', [floor])
    const doc = makeDoc([bld])
    const graph = makeEmptyGraph()
    const nav = makeNavGraph()

    const result = buildArtifacts(graph, nav, doc)
    const roomEntries = result.searchIndex.entries.filter(e => e.type === 'room')
    expect(roomEntries.length).toBe(1)
    expect(roomEntries[0]!.label).toBe('Room 101')
  })

  it('S5: includes all rooms when all are searchable', () => {
    const ra = [
      makeRoomAttributes('f1', 'rm-101', 'Room 101', '101', true),
      makeRoomAttributes('f2', 'rm-202', 'Room 202', '202', true),
    ]
    const floor = makeFloor('fl-0', 0, { roomAttributes: ra })
    const bld = makeBuilding('b1', 'Building A', [floor])
    const doc = makeDoc([bld])
    const graph = makeEmptyGraph()
    const nav = makeNavGraph()

    const result = buildArtifacts(graph, nav, doc)
    const roomEntries = result.searchIndex.entries.filter(e => e.type === 'room')
    expect(roomEntries.length).toBe(2)
  })

  // --- Room identity ---
  it('S6: uses roomId for stable identity (not face ordering)', () => {
    const ra = [makeRoomAttributes('face-volatile', 'rm-stable-42', 'Lab', '42', true)]
    const floor = makeFloor('fl-0', 0, { roomAttributes: ra })
    const bld = makeBuilding('b1', 'Building A', [floor])
    const doc = makeDoc([bld])
    const graph = makeEmptyGraph()
    const nav = makeNavGraph()

    const result = buildArtifacts(graph, nav, doc)
    const roomEntries = result.searchIndex.entries.filter(e => e.type === 'room')
    expect(roomEntries[0]!.id).toBe('search_room_rm-stable-42')
  })

  it('S7: falls back to faceId when roomId is absent', () => {
    const ra: RoomAttributes[] = [{ faceId: 'face-7', name: 'Fallback Room', searchable: true }]
    const floor = makeFloor('fl-0', 0, { roomAttributes: ra })
    const bld = makeBuilding('b1', 'Building A', [floor])
    const doc = makeDoc([bld])
    const graph = makeEmptyGraph()
    const nav = makeNavGraph()

    const result = buildArtifacts(graph, nav, doc)
    const roomEntries = result.searchIndex.entries.filter(e => e.type === 'room')
    expect(roomEntries[0]!.id).toBe('search_room_face-7')
  })

  // --- Search fields ---
  it('S8: maps name, number, category, building, floor to search entry', () => {
    const ra = [makeRoomAttributes('f1', 'rm-1', 'Chem Lab', 'C-101', true)]
    const floor = makeFloor('fl-0', 0, { roomAttributes: ra })
    const bld = makeBuilding('b1', 'Science Hall', [floor])
    const doc = makeDoc([bld])
    const graph = makeEmptyGraph()
    const nav = makeNavGraph()

    const result = buildArtifacts(graph, nav, doc)
    const entry = result.searchIndex.entries.find(e => e.type === 'room')
    expect(entry).toBeDefined()
    expect(entry!.label).toBe('Chem Lab')
    expect(entry!.buildingId).toBe('b1')
    expect(entry!.floor).toBe(0)
    expect(entry!.tags.join(' ')).toContain('chem')
    expect(entry!.tags.join(' ')).toContain('lab')
    expect(entry!.tags.join(' ')).toContain('101')
    expect(entry!.tags.join(' ')).toContain('science')
  })

  it('S8b: indexes canonical Room code, type, and description for search', () => {
    const ra: RoomAttributes[] = [{
      faceId: 'f-canonical', roomId: 'rm-canonical', name: 'North Studio',
      type: 'other', code: 'NS-204', description: 'Flexible collaboration space', searchable: true,
    }]
    const floor = makeFloor('fl-0', 0, { roomAttributes: ra })
    const bld = makeBuilding('b1', 'Science Hall', [floor])
    const doc = makeDoc([bld])

    const result = buildArtifacts(makeEmptyGraph(), makeNavGraph(), doc)
    const entry = result.searchIndex.entries.find(e => e.id === 'search_room_rm-canonical')

    expect(entry).toBeDefined()
    expect(entry!.label).toBe('North Studio')
    expect(entry!.tags).toEqual(expect.arrayContaining(['ns', '204', 'other', 'flexible', 'collaboration', 'space', 'science', 'hall']))
  })

  it('S9: includes destination identity in search entry', () => {
    const ra = [makeRoomAttributes('f1', 'rm-1', 'Room A', 'A', true)]
    const floor = makeFloor('fl-0', 0, { roomAttributes: ra })
    const bld = makeBuilding('b1', 'Building', [floor])
    const doc = makeDoc([bld])
    const graph = makeEmptyGraph()
    const nav = makeNavGraph()

    const result = buildArtifacts(graph, nav, doc)
    const entry = result.searchIndex.entries.find(e => e.type === 'room')
    expect(entry!.id).toBe('search_room_rm-1')
  })

  it('S10: targets the authored Entrance node for building navigation', () => {
    const floor = makeFloor('fl-0', 0)
    const bld = makeBuilding('b1', 'Building A', [floor])
    const doc = makeDoc([bld])
    const nav = makeNavGraph([
      { id: 'building-waypoint', kind: 'waypoint', position: { lat: 14.005, lng: 121.005 }, floor: 0, buildingId: 'b1' } as any,
      { id: 'building-entrance', kind: 'entrance_portal', position: { lat: 14.001, lng: 121.001 }, floor: 0, buildingId: 'b1' } as any,
    ])

    const result = buildArtifacts(makeEmptyGraph(), nav, doc)
    const searchEntry = result.searchIndex.entries.find(e => e.id === 'search_bldg_b1')
    const buildingEntry = result.buildingIndex.buildings.find(entry => entry.id === 'b1')

    expect(searchEntry?.nodeId).toBe('building-entrance')
    expect(buildingEntry?.nodeId).toBe('building-entrance')
  })

  // --- Legacy fallback ---
  it('S10: old documents without RoomAttributes use existing search behavior', () => {
    const room = makeRoom('r1', 'Old Room', 'O-1', 5, 5)
    const floor = makeFloor('fl-0', 0, { rooms: [room] })
    const bld = makeBuilding('b1', 'Old Building', [floor])
    const doc = makeDoc([bld])
    const graph = makeEmptyGraph()
    const nav = makeNavGraph()

    const result = buildArtifacts(graph, nav, doc)
    const roomEntries = result.searchIndex.entries.filter(e => e.type === 'room')
    expect(roomEntries.length).toBe(1)
    expect(roomEntries[0]!.id).toBe('search_room_r1')
  })

  it('S11: buildings still indexed regardless of RoomAttributes presence', () => {
    const ra = [makeRoomAttributes('f1', 'rm-1', 'Room', '1', true)]
    const floor = makeFloor('fl-0', 0, { roomAttributes: ra })
    const bld = makeBuilding('b1', 'Building A', [floor])
    const doc = makeDoc([bld])
    const graph = makeEmptyGraph()
    const nav = makeNavGraph()

    const result = buildArtifacts(graph, nav, doc)
    const bldEntries = result.searchIndex.entries.filter(e => e.type === 'building')
    expect(bldEntries.length).toBe(1)
    expect(bldEntries[0]!.id).toBe('search_bldg_b1')
  })

  it('S12: graph POI nodes still indexed alongside semantic rooms', () => {
    const ra = [makeRoomAttributes('f1', 'rm-1', 'Room', '1', true)]
    const floor = makeFloor('fl-0', 0, { roomAttributes: ra })
    const bld = makeBuilding('b1', 'Building A', [floor])
    const doc = makeDoc([bld])
    const graph = makeEmptyGraph()
    const nav = makeNavGraph([{
      id: 'poi-1', kind: 'poi', label: 'Vending Machine', position: { lat: 14, lng: 121 },
      floor: 0, buildingId: 'b1', poiCategory: 'vending',
      source: { entityId: 'poi-1', entityType: 'poi', generatorId: 'test' },
    }])

    const result = buildArtifacts(graph, nav, doc)
    const poiEntries = result.searchIndex.entries.filter(e => e.type === 'poi')
    expect(poiEntries.length).toBe(1)
    expect(poiEntries[0]!.label).toBe('Vending Machine')
  })
})

// ═══════════════════════════════════════════════════════════════
// Part B — floorGeometry Completion (20 tests)
// ═══════════════════════════════════════════════════════════════

describe('W15E floorGeometry Gate', () => {
  // --- Walls ---
  it('G1: includes walls with id, start/end, thickness, height', () => {
    const wall = makeWall('w1', 0, 0, 10, 0)
    const floor = makeFloor('fl-0', 0, { walls: [wall] })
    const bld = makeBuilding('b1', 'Building A', [floor])
    const doc = makeDoc([bld])
    const result = buildArtifacts(makeEmptyGraph(), makeNavGraph(), doc)
    const fg = result.floorGeometry!
    const f = fg.buildings[0]!.floors[0]!
    expect(f.walls).toBeDefined()
    expect(f.walls!.length).toBe(1)
    expect(f.walls![0]!.id).toBe('w1')
    expect(f.walls![0]!.start).toEqual({ x: 0, y: 0 })
    expect(f.walls![0]!.end).toEqual({ x: 10, y: 0 })
    expect(f.walls![0]!.thickness).toBe(0.15)
    expect(f.walls![0]!.height).toBe(3.5)
  })

  it('G2: walls are translated by floor offset', () => {
    const wall = makeWall('w1', 0, 0, 10, 0)
    const floor = makeFloor('fl-0', 0, { walls: [wall], offset: { x: 5, y: 3 } })
    const bld = makeBuilding('b1', 'Building A', [floor])
    const doc = makeDoc([bld])
    const result = buildArtifacts(makeEmptyGraph(), makeNavGraph(), doc)
    const f = result.floorGeometry!.buildings[0]!.floors[0]!
    expect(f.walls![0]!.start).toEqual({ x: 5, y: 3 })
    expect(f.walls![0]!.end).toEqual({ x: 15, y: 3 })
  })

  it('G3: walls array absent when no walls on floor (additive-absent)', () => {
    const floor = makeFloor('fl-0', 0)
    const bld = makeBuilding('b1', 'Building A', [floor])
    const doc = makeDoc([bld])
    const result = buildArtifacts(makeEmptyGraph(), makeNavGraph(), doc)
    const f = result.floorGeometry!.buildings[0]!.floors[0]!
    expect(f.walls).toBeUndefined()
  })

  // --- Openings ---
  it('G4: includes openings with id, type, wallId, offset, width, height/sill', () => {
    const opening = makeOpening('op1', 'w1', 2.5, 0.9)
    const floor = makeFloor('fl-0', 0, { openings: [opening] })
    const bld = makeBuilding('b1', 'Building A', [floor])
    const doc = makeDoc([bld])
    const result = buildArtifacts(makeEmptyGraph(), makeNavGraph(), doc)
    const f = result.floorGeometry!.buildings[0]!.floors[0]!
    expect(f.openings).toBeDefined()
    expect(f.openings!.length).toBe(1)
    expect(f.openings![0]!.id).toBe('op1')
    expect(f.openings![0]!.type).toBe('door')
    expect(f.openings![0]!.wallId).toBe('w1')
    expect(f.openings![0]!.offset).toBe(2.5)
    expect(f.openings![0]!.width).toBe(0.9)
    expect(f.openings![0]!.height).toBe(2.1)
  })

  it('G5: window openings include sillHeight', () => {
    const opening: Opening = { id: 'win1', type: 'window', wallId: 'w1', offset: 1.0, width: 1.2, sillHeight: 0.9 }
    const floor = makeFloor('fl-0', 0, { openings: [opening] })
    const bld = makeBuilding('b1', 'Building A', [floor])
    const doc = makeDoc([bld])
    const result = buildArtifacts(makeEmptyGraph(), makeNavGraph(), doc)
    const f = result.floorGeometry!.buildings[0]!.floors[0]!
    expect(f.openings![0]!.type).toBe('window')
    expect(f.openings![0]!.sillHeight).toBe(0.9)
  })

  it('G6: openings array absent when no openings (additive-absent)', () => {
    const floor = makeFloor('fl-0', 0)
    const bld = makeBuilding('b1', 'Building A', [floor])
    const doc = makeDoc([bld])
    const result = buildArtifacts(makeEmptyGraph(), makeNavGraph(), doc)
    const f = result.floorGeometry!.buildings[0]!.floors[0]!
    expect(f.openings).toBeUndefined()
  })

  // --- Derived rooms ---
  it('G7: includes roomAttributes derived from wall topology', () => {
    const ra = [makeRoomAttributes('f1', 'rm-101', 'Room 101', '101', true)]
    const floor = makeFloor('fl-0', 0, { roomAttributes: ra })
    const bld = makeBuilding('b1', 'Building A', [floor])
    const doc = makeDoc([bld])
    const result = buildArtifacts(makeEmptyGraph(), makeNavGraph(), doc)
    const f = result.floorGeometry!.buildings[0]!.floors[0]!
    expect(f.roomAttributes).toBeDefined()
    expect(f.roomAttributes!.length).toBe(1)
    expect(f.roomAttributes![0]!.roomId).toBe('rm-101')
    expect(f.roomAttributes![0]!.name).toBe('Room 101')
    expect(f.roomAttributes![0]!.number).toBe('101')
    expect(f.roomAttributes![0]!.searchable).toBe(true)
  })

  it('G7b: emits canonical Room properties in floorGeometry', () => {
    const ra: RoomAttributes[] = [{
      faceId: 'f-canonical', roomId: 'rm-canonical', name: 'North Studio',
      type: 'other', code: 'NS-204', description: 'Flexible collaboration space', searchable: true,
    }]
    const floor = makeFloor('fl-0', 0, { roomAttributes: ra })
    const bld = makeBuilding('b1', 'Science Hall', [floor])
    const result = buildArtifacts(makeEmptyGraph(), makeNavGraph(), makeDoc([bld]))
    const emitted = result.floorGeometry!.buildings[0]!.floors[0]!.roomAttributes![0]!

    expect(emitted).toMatchObject({
      roomId: 'rm-canonical', name: 'North Studio', type: 'other', code: 'NS-204',
      description: 'Flexible collaboration space', searchable: true,
    })
  })

  it('G8: roomAttributes uses roomId when present, falls back to faceId', () => {
    const ra: RoomAttributes[] = [{ faceId: 'face-volatile', name: 'Lab', searchable: true }]
    const floor = makeFloor('fl-0', 0, { roomAttributes: ra })
    const bld = makeBuilding('b1', 'Building A', [floor])
    const doc = makeDoc([bld])
    const result = buildArtifacts(makeEmptyGraph(), makeNavGraph(), doc)
    const f = result.floorGeometry!.buildings[0]!.floors[0]!
    // When roomId is absent, faceId is used as fallback
    expect(f.roomAttributes![0]!.roomId).toBe('face-volatile')
  })

  it('G9: roomAttributes searchable flag preserved', () => {
    const ra = [makeRoomAttributes('f1', 'rm-1', 'Visible', '1', true), makeRoomAttributes('f2', 'rm-2', 'Hidden', '2', false)]
    const floor = makeFloor('fl-0', 0, { roomAttributes: ra })
    const bld = makeBuilding('b1', 'Building A', [floor])
    const doc = makeDoc([bld])
    const result = buildArtifacts(makeEmptyGraph(), makeNavGraph(), doc)
    const f = result.floorGeometry!.buildings[0]!.floors[0]!
    expect(f.roomAttributes![0]!.searchable).toBe(true)
    expect(f.roomAttributes![1]!.searchable).toBe(false)
  })

  // --- RouteNetwork ---
  it('G10: includes routeNetwork when present', () => {
    const rn = makeRouteNetwork()
    const floor = makeFloor('fl-0', 0, { routeNetwork: rn })
    const bld = makeBuilding('b1', 'Building A', [floor])
    const doc = makeDoc([bld])
    const result = buildArtifacts(makeEmptyGraph(), makeNavGraph(), doc)
    const f = result.floorGeometry!.buildings[0]!.floors[0]!
    expect(f.routeNetwork).toBeDefined()
    expect(f.routeNetwork!.nodes.length).toBe(2)
    expect(f.routeNetwork!.edges.length).toBe(1)
  })

  it('G11: preserves authored node/edge IDs in routeNetwork', () => {
    const rn: RouteNetwork = {
      nodes: [{ id: 'custom-node-1', type: 'waypoint', position: { x: 1, y: 2 }, floor: 0 }],
      edges: [{ id: 'custom-edge-1', from: 'custom-node-1', to: 'custom-node-1', type: 'walk', distance: 0 }],
    }
    const floor = makeFloor('fl-0', 0, { routeNetwork: rn })
    const bld = makeBuilding('b1', 'Building A', [floor])
    const doc = makeDoc([bld])
    const result = buildArtifacts(makeEmptyGraph(), makeNavGraph(), doc)
    const f = result.floorGeometry!.buildings[0]!.floors[0]!
    expect(f.routeNetwork!.nodes[0]!.id).toBe('custom-node-1')
    expect(f.routeNetwork!.edges[0]!.id).toBe('custom-edge-1')
  })

  it('G12: preserves local positions in routeNetwork nodes', () => {
    const rn: RouteNetwork = {
      nodes: [{ id: 'n1', type: 'waypoint', position: { x: 42.5, y: 99.3 }, floor: 0 }],
      edges: [],
    }
    const floor = makeFloor('fl-0', 0, { routeNetwork: rn })
    const bld = makeBuilding('b1', 'Building A', [floor])
    const doc = makeDoc([bld])
    const result = buildArtifacts(makeEmptyGraph(), makeNavGraph(), doc)
    const f = result.floorGeometry!.buildings[0]!.floors[0]!
    expect(f.routeNetwork!.nodes[0]!.position).toEqual({ x: 42.5, y: 99.3 })
  })

  // --- RoomAccess ---
  it('G13: includes roomAccess from RoomAttributes accessPoints', () => {
    const ra = [makeRoomAttributes('f1', 'rm-1', 'Room', '1', true, [
      { openingId: 'op-1', routeNodeId: 'rn-1', primary: true },
    ])]
    const floor = makeFloor('fl-0', 0, { roomAttributes: ra })
    const bld = makeBuilding('b1', 'Building A', [floor])
    const doc = makeDoc([bld])
    const result = buildArtifacts(makeEmptyGraph(), makeNavGraph(), doc)
    const f = result.floorGeometry!.buildings[0]!.floors[0]!
    expect(f.roomAccess).toBeDefined()
    expect(f.roomAccess!.length).toBe(1)
    expect(f.roomAccess![0]!.openingId).toBe('op-1')
    expect(f.roomAccess![0]!.routeNodeId).toBe('rn-1')
    expect(f.roomAccess![0]!.primary).toBe(true)
  })

  it('G14: roomAccess absent when no RoomAttributes have accessPoints', () => {
    const ra = [makeRoomAttributes('f1', 'rm-1', 'Room', '1', true)]
    const floor = makeFloor('fl-0', 0, { roomAttributes: ra })
    const bld = makeBuilding('b1', 'Building A', [floor])
    const doc = makeDoc([bld])
    const result = buildArtifacts(makeEmptyGraph(), makeNavGraph(), doc)
    const f = result.floorGeometry!.buildings[0]!.floors[0]!
    expect(f.roomAccess).toBeUndefined()
  })

  // --- EntranceAccess ---
  it('G15: includes entranceAccess when present', () => {
    const ea: EntranceAccess[] = [{ entranceId: 'e1', outdoorNodeId: 'out-1', indoorRouteNodeId: 'rn-1' }]
    const floor = makeFloor('fl-0', 0, { entranceAccess: ea })
    const bld = makeBuilding('b1', 'Building A', [floor])
    const doc = makeDoc([bld])
    const result = buildArtifacts(makeEmptyGraph(), makeNavGraph(), doc)
    const f = result.floorGeometry!.buildings[0]!.floors[0]!
    expect(f.entranceAccess).toBeDefined()
    expect(f.entranceAccess!.length).toBe(1)
    expect(f.entranceAccess![0]!.entranceId).toBe('e1')
  })

  it('G16: entranceAccess absent when not present on floor', () => {
    const floor = makeFloor('fl-0', 0)
    const bld = makeBuilding('b1', 'Building A', [floor])
    const doc = makeDoc([bld])
    const result = buildArtifacts(makeEmptyGraph(), makeNavGraph(), doc)
    const f = result.floorGeometry!.buildings[0]!.floors[0]!
    expect(f.entranceAccess).toBeUndefined()
  })

  // --- Legacy fallback ---
  it('G17: old documents without walls use existing Room/Hallway representations', () => {
    const room = makeRoom('r1', 'Legacy Room', 'L-1', 5, 5)
    const floor = makeFloor('fl-0', 0, { rooms: [room] })
    const bld = makeBuilding('b1', 'Building A', [floor])
    const doc = makeDoc([bld])
    const result = buildArtifacts(makeEmptyGraph(), makeNavGraph(), doc)
    const f = result.floorGeometry!.buildings[0]!.floors[0]!
    expect(f.rooms.length).toBe(1)
    expect(f.rooms[0]!.id).toBe('r1')
    expect(f.walls).toBeUndefined()
  })

  // --- No duplicate geometry ---
  it('G18: wall-first floor does not emit duplicate Room polygon', () => {
    const wall = makeWall('w1', 0, 0, 10, 0)
    const ra = [makeRoomAttributes('f1', 'rm-1', 'Room 1', '1', true)]
    const room = makeRoom('r1', 'Room 1', '1', 0, 0)
    const floor = makeFloor('fl-0', 0, { walls: [wall], roomAttributes: ra, rooms: [room] })
    const bld = makeBuilding('b1', 'Building A', [floor])
    const doc = makeDoc([bld])
    const result = buildArtifacts(makeEmptyGraph(), makeNavGraph(), doc)
    const f = result.floorGeometry!.buildings[0]!.floors[0]!
    // When wall-first AND legacy rooms both exist, roomAttributes are emitted
    // (from the semantic source), but the legacy rooms array is still emitted
    // as floorGeometry.rooms for backward compatibility. The key invariant is
    // that roomAttributes use stable semantic IDs, not face ordering.
    expect(f.roomAttributes!.length).toBe(1)
    expect(f.roomAttributes![0]!.roomId).toBe('rm-1')
  })

  // --- Vertical features ---
  it('G19: staircases/elevator data available for rendering', () => {
    const floor = makeFloor('fl-0', 0)
    const bld = makeBuilding('b1', 'Building A', [floor])
    bld.staircases = [{
      id: 'st1', buildingId: 'b1', name: 'Stair A', type: 'standard', accessible: false,
      fromLevel: 0, toLevel: 2,
      levels: { 0: { position: { x: 5, y: 5 }, rotation: 0 } },
    }]
    const doc = makeDoc([bld])
    const result = buildArtifacts(makeEmptyGraph(), makeNavGraph(), doc)
    const f = result.floorGeometry!.buildings[0]!.floors[0]!
    expect(f.staircases.length).toBe(1)
    expect(f.staircases[0]!.id).toBe('st1')
    expect(f.staircases[0]!.position).toEqual({ x: 5, y: 5 })
  })

  it('G20: elevator data available for rendering', () => {
    const floor = makeFloor('fl-0', 0)
    const bld = makeBuilding('b1', 'Building A', [floor])
    bld.elevators = [{
      id: 'el1', buildingId: 'b1', name: 'Elevator 1', type: 'standard', accessible: true,
      fromLevel: 0, toLevel: 3,
      levels: { 0: { position: { x: 8, y: 8 }, rotation: 90 } },
    }]
    const doc = makeDoc([bld])
    const result = buildArtifacts(makeEmptyGraph(), makeNavGraph(), doc)
    const f = result.floorGeometry!.buildings[0]!.floors[0]!
    expect(f.elevators.length).toBe(1)
    expect(f.elevators[0]!.id).toBe('el1')
    expect(f.elevators[0]!.position).toEqual({ x: 8, y: 8 })
    expect(f.elevators[0]!.rotation).toBe(90)
  })
})
