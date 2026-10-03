/**
 * Routing Runtime Validation — Production Pipeline → Public App (RouteTesting)
 *
 * Compiles a 2-building campus with the production compiler
 * (packages/compiler), converts the result exactly like the runtime
 * (src/store/public-store.ts NODE_TYPE_MAP: space→room, corridor→walkway,
 * transition→building_entrance), then runs A* on the converted graph —
 * the same path RouteTesting uses.
 *
 * Answers the key question: do `space` (room) nodes participate in A* as
 * routing nodes, or only as destination metadata?
 */

import { describe, it, expect, beforeAll } from 'vitest'
import type { CampusDocument, Building, Floor, Room, Hallway, Entrance, LegacyStaircase, Road } from '@navi/core'
import type { NavNode as CoreNavNode, NavEdge as CoreNavEdge, NavigationGraph } from '@navi/core'
import { CampusCompiler } from '../../../packages/compiler/src/pipeline/campus-compiler'
import { aStar } from '../a-star'
import type { NavNode, NavEdge } from '../../types/nav-types'

// ── Fixture helpers (mirror compiler-plugin.test.ts, proven geometry) ──

function makeRoom(id: string, name: string, number: string, x: number, y: number): Room {
  return {
    id, name, number, category: 'classroom',
    polygon: {
      points: [
        { x, y }, { x: x + 10, y }, { x: x + 10, y: y + 8 }, { x, y: y + 8 }, { x, y },
      ],
    },
    roomDoors: [], capacity: 30, metadata: {},
  }
}

function makeEntrance(id: string, label: string, lat: number, lng: number): Entrance {
  return { id, label, position: { lat, lng }, level: 0, type: 'main', hasQR: false, hasPanorama: false }
}

function makeHallway(id: string, name: string, pts: Array<{ x: number; y: number }>): Hallway {
  return { id, name, polyline: { points: pts }, width: 3, metadata: {} }
}

function makeStair(id: string, name: string, x: number, y: number): LegacyStaircase {
  return { id, name, position: { x, y }, fromLevel: 0, toLevel: 1, type: 'standard' }
}

function makeFloor(id: string, level: number, opts: { rooms?: Room[]; hallways?: Hallway[]; entrances?: Entrance[]; staircases?: LegacyStaircase[] }): Floor {
  return {
    id, level, label: `F${level}`, elevation: level * 3,
    rooms: opts.rooms ?? [], hallways: opts.hallways ?? [],
    staircases: opts.staircases ?? [], elevators: [],
    entrances: opts.entrances ?? [], connectorStops: [], metadata: {},
  }
}

function makeBuilding(id: string, name: string, baseLat: number, baseLng: number, floors: Floor[]): Building {
  return {
    id, name, code: id.toUpperCase(), category: 'academic', description: '',
    footprint: {
      points: [
        { lat: baseLat, lng: baseLng },
        { lat: baseLat, lng: baseLng + 0.01 },
        { lat: baseLat + 0.01, lng: baseLng + 0.01 },
        { lat: baseLat + 0.01, lng: baseLng },
        { lat: baseLat, lng: baseLng },
      ],
    },
    baseElevation: 0, height: 15, floors, verticalConnectors: [],
    color: '#cccccc', aliases: [], metadata: {},
  }
}

function makeRoad(id: string, pts: Array<{ lat: number; lng: number }>): Road {
  return { id, name: 'Campus Road', polyline: { points: pts }, width: 3, surface: 'paved', type: 'connector', metadata: {} }
}

/** F0-only, 2 buildings + road (mirrors multiBuildingDoc). Compiles today. */
function createCampus(): CampusDocument {
  const roomA = makeRoom('r-a', 'Room 101', '101', 0, 0)
  const hwA0 = makeHallway('hw-a0', 'Hallway A0', [{ x: 0, y: -3 }, { x: 15, y: -3 }])
  const entA = makeEntrance('e-a', 'Entrance A', 0.00405, 0.00405)
  const bldA = makeBuilding('b-a', 'Building A', 0, 0, [
    makeFloor('flr-a0', 0, { rooms: [roomA], hallways: [hwA0], entrances: [entA] }),
  ])

  const roomB = makeRoom('r-b', 'Room B101', 'B101', 0, 0)
  const hwB = makeHallway('hw-b', 'Hallway B', [{ x: 0, y: -3 }, { x: 15, y: -3 }])
  const entB = makeEntrance('e-b', 'Entrance B', 0.01405, 0.01405)
  const bldB = makeBuilding('b-b', 'Building B', 0.01, 0.01, [
    makeFloor('flr-b0', 0, { rooms: [roomB], hallways: [hwB], entrances: [entB] }),
  ])

  const road = makeRoad('road-1', [{ lat: 0.005, lng: 0.005 }, { lat: 0.015, lng: 0.015 }])
  return {
    schemaVersion: 1, version: 1,
    metadata: { campusId: 'runtime-val', name: 'Runtime Validation', description: '', lastModified: '', editorVersion: '1.0.0' },
    buildings: [bldA, bldB], roads: [road], panoramas: [], qrCheckpoints: [],
  }
}

/** Same campus + F1 floor in Building A (stair spans 0→1). */
function createCampusWithF1(): CampusDocument {
  const doc = createCampus()
  const roomC = makeRoom('r-c', 'Room 201', '201', 0, 0)
  const hwA1 = makeHallway('hw-a1', 'Hallway A1', [{ x: 0, y: -3 }, { x: 15, y: -3 }])
  const stairA = makeStair('st-a', 'Stair A', 7.5, -1)
  const bldA = doc.buildings.find(b => b.id === 'b-a')!
  bldA.floors = [
    bldA.floors[0],
    makeFloor('flr-a1', 1, { rooms: [roomC], hallways: [hwA1], staircases: [stairA] }),
  ]
  return doc
}

// ── Compile + convert once ──

let raw: NavigationGraph
let nodes: NavNode[]
let edges: NavEdge[]
let f1Result: { success: boolean; graph: NavigationGraph; errors: { code: string; message: string }[] }

/** Mirrors src/store/public-store.ts NODE_TYPE_MAP (runtime conversion). */
function toRuntimeType(rawType: string): NavNode['type'] {
  switch (rawType) {
    case 'space': return 'room'
    case 'corridor': return 'walkway'
    case 'transition': return 'building_entrance'
    case 'intersection': return 'intersection'
    default: return 'walkway'
  }
}

function convert(graph: NavigationGraph): { nodes: NavNode[]; edges: NavEdge[] } {
  const campusId = graph.campusId || 'campus'
  const nodes: NavNode[] = graph.nodes.map(n => ({
    id: n.id, label: n.label || n.id, name: n.label || undefined,
    position: n.position, floor: n.floor, buildingId: n.buildingId || '',
    campusId, type: toRuntimeType(n.type),
  }))
  const edges: NavEdge[] = graph.edges.map(e => ({
    id: e.id, from: e.from, to: e.to, distance: e.distance, weight: e.weight,
    type: 'walk', campusId,
  }))
  return { nodes, edges }
}

beforeAll(() => {
  const compiler = new CampusCompiler()
  const result = compiler.compile(createCampus())
  expect(result.success).toBe(true)
  raw = result.graph!
  const converted = convert(raw)
  nodes = converted.nodes
  edges = converted.edges

  const f1 = compiler.compile(createCampusWithF1())
  f1Result = {
    success: f1.success,
    graph: f1.graph!,
    errors: (f1 as unknown as { errors?: { code: string; message: string }[] }).errors ?? [],
  }
})

function rawNode(id: string): CoreNavNode {
  const n = raw.nodes.find(nn => nn.id === id)
  if (!n) throw new Error(`raw node ${id} missing`)
  return n
}

function nodeId(name: string): string {
  const n = nodes.find(nn => nn.name === name)
  if (!n) throw new Error(`no runtime node named ${name}`)
  return n.id
}

function rawEdgesOf(id: string): CoreNavEdge[] {
  return raw.edges.filter(e => e.from === id || e.to === id)
}

// ── Validation ──

describe('P1 | space nodes are destination metadata, not routing nodes', () => {

  it('P1.1: every space (room) node has degree exactly 1 (leaf — can never be an intermediate)', () => {
    const spaceNodes = raw.nodes.filter(n => n.type === 'space')
    expect(spaceNodes.length).toBeGreaterThanOrEqual(2)
    for (const sn of spaceNodes) {
      const degree = raw.edges.filter(e => e.from === sn.id || e.to === sn.id).length
      expect(degree).toBe(1)
    }
  })

  it('P1.2: room nodes connect ONLY to hallways (never roads/entrances/rooms)', () => {
    for (const sn of raw.nodes.filter(n => n.type === 'space')) {
      for (const e of rawEdgesOf(sn.id)) {
        const other = rawNode(e.from === sn.id ? e.to : e.from)
        expect(other.type).toBe('corridor')
        expect(other.properties?.entityType).toBe('hallway')
      }
    }
  })

  it('P1.3: A* never routes THROUGH a room node (rooms appear only at start/end)', () => {
    const start = nodeId('Room 101')
    const end = nodeId('Room B101')
    const result = aStar(nodes, edges, start, end)
    expect(result).not.toBeNull()
    const roomPositions = result!.path.map((id, i) => ({ i, type: nodes.find(n => n.id === id)!.type }))
      .filter(x => x.type === 'room')
    expect(roomPositions.length).toBe(2) // only start + end
    expect(roomPositions[0]!.i).toBe(0)
    expect(roomPositions[1]!.i).toBe(result!.path.length - 1)
  })
})

describe('P2 | Room → Another Building (cross-building, F0)', () => {

  it('P2.1: route Room 101 → Room B101 bridges via both entrances and the road', () => {
    const start = nodeId('Room 101')
    const end = nodeId('Room B101')
    const result = aStar(nodes, edges, start, end)
    expect(result).not.toBeNull()

    const pathTypes = result!.path.map(id => nodes.find(n => n.id === id)!.type)
    // Room → walkway → entrance → road → entrance → walkway → room
    expect(pathTypes[0]).toBe('room')
    expect(pathTypes[pathTypes.length - 1]).toBe('room')
    const entrances = pathTypes.filter(t => t === 'building_entrance')
    expect(entrances.length).toBe(2)
    // The segment between the two entrances must contain a road corridor node
    const e1 = pathTypes.indexOf('building_entrance')
    const e2 = pathTypes.lastIndexOf('building_entrance')
    const between = result!.path.slice(e1 + 1, e2).map(id => rawNode(id))
    expect(between.some(n => n.type === 'corridor' && n.properties?.entityType === 'road')).toBe(true)
  })
})

describe('P3 | Multi-floor campus (vertical connectivity — currently BROKEN)', () => {

  it('P3.0: multi-floor campus compiles (currently RED — GRAPH_UNREACHABLE_ROOM)', () => {
    // Today the pipeline rejects any campus whose upper floors cannot be
    // reached: the single stair node at floor 0 never links the F1 hallway,
    // so Room 201 is unreachable from any entrance.
    expect(f1Result.success).toBe(true)
  })

  it('P3.1: the F1 room is reachable (currently RED — the disconnect is reported)', () => {
    expect(f1Result.errors.filter(e => e.code === 'GRAPH_UNREACHABLE_ROOM')).toEqual([])
  })

  it('P3.2: stairs get per-floor nodes (currently RED — single node at floor 0)', () => {
    // The editor compiler emits one node per floor; the production compiler
    // emits ONE stair node with hardcoded floor 0. Assert the correct model.
    const stairNodes = f1Result.graph.nodes.filter(n => n.properties?.entityType === 'staircase')
    expect(stairNodes.length).toBe(2) // F0 + F1
    const floors = new Set(stairNodes.map(n => n.floor))
    expect(floors.has(0)).toBe(true)
    expect(floors.has(1)).toBe(true)
  })

  it('P3.3: stair/elevator nodes do NOT link directly to roads (currently RED)', () => {
    // Transitions (entrances, stairs, elevators) are treated identically by
    // build-edges-stage, so a stair within 200m of a road gets a road edge —
    // only entrances should bridge indoor↔outdoor.
    const stairRaw = f1Result.graph.nodes.find(n => n.properties?.entityType === 'staircase')
    expect(stairRaw).toBeDefined()
    for (const e of f1Result.graph.edges.filter(ee => ee.from === stairRaw!.id || ee.to === stairRaw!.id)) {
      const other = f1Result.graph.nodes.find(n => n.id === (e.from === stairRaw!.id ? e.to : e.from))!
      expect(other.properties?.entityType).not.toBe('road')
    }
  })
})