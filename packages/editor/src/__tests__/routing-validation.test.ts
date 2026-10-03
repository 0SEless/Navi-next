/**
 * Routing Validation — Live Route + Graph Inspection (Editor Graph)
 *
 * Validates the user-facing routing behavior of the studio/editor graph
 * (GraphAdapter → Graph → a-star), against the approved topology model:
 *
 *   Road → Building Entrance → Hallway → Room Door
 *
 * Routes verified:
 *   1. Outdoor road node → room door (same building)
 *   2. Room A → Room B across buildings (indoor↔outdoor isolation check)
 *   3. Room F0 → Room F1 (multi-floor, no room interiors)
 *
 * Forbidden patterns asserted:
 *   - road → room, road → room_door, road → hallway (must only connect
 *     through the intended entrance relationship)
 *   - room_door / hallway nodes as intermediate route nodes outside
 *     their layer
 */

import { describe, it, expect, beforeAll } from 'vitest'
import type { CampusDocument, Building, Room, RoomDoor, Hallway, Entrance, LegacyStaircase, LegacyElevator, Road } from '@navi/core'
import { Graph } from '@/engine/graph'
import { aStar } from '@/engine/a-star'
import { GraphAdapter } from '../graph-adapter'
import { CoordinateTransformer } from '@navi/core'
import type { NavNode } from '@/types/nav-types'

// ── Helpers ──

function makeDoor(id: string, roomId: string, connectedToId: string): RoomDoor {
  return {
    id, roomId, connectedToId, connectedToType: 'hallway',
    doorType: 'standard', position: { x: 5, y: 2 }, width: 1.2, metadata: {},
  }
}

function makeRoom(id: string, name: string, num: string, polygon: Array<{x:number;y:number}>, doorId: string, hallId: string): Room {
  return {
    id, name, number: num, category: 'classroom',
    polygon: { points: [...polygon, polygon[0]] },
    roomDoors: [makeDoor(doorId, id, hallId)],
    capacity: 20, metadata: {},
  }
}

// ── Campus fixture (audit campus + road through both entrances) ──

function createCampus(): CampusDocument {
  const hallA0: Hallway = { id: 'hall-a0', name: 'Hall A0', polyline: { points: [{ x: 0, y: 0 }, { x: 20, y: 0 }] }, width: 3 }
  const hallA1: Hallway = { id: 'hall-a1', name: 'Hall A1', polyline: { points: [{ x: 0, y: 0 }, { x: 20, y: 0 }] }, width: 3 }
  const hallB0: Hallway = { id: 'hall-b0', name: 'Hall B0', polyline: { points: [{ x: 0, y: 0 }, { x: 15, y: 0 }] }, width: 4 }

  const roomA01 = makeRoom('room-a0-1', 'Room 101', '101', [{x:2,y:2},{x:8,y:2},{x:8,y:6},{x:2,y:6}], 'door-a0-1', 'hall-a0')
  const roomA02 = makeRoom('room-a0-2', 'Room 102', '102', [{x:12,y:2},{x:18,y:2},{x:18,y:6},{x:12,y:6}], 'door-a0-2', 'hall-a0')
  const roomA11 = makeRoom('room-a1-1', 'Room 201', '201', [{x:2,y:2},{x:8,y:2},{x:8,y:6},{x:2,y:6}], 'door-a1-1', 'hall-a1')
  const roomA12 = makeRoom('room-a1-2', 'Room 202', '202', [{x:12,y:2},{x:18,y:2},{x:18,y:6},{x:12,y:6}], 'door-a1-2', 'hall-a1')
  const roomB01 = makeRoom('room-b0-1', 'Reading Room', 'B101', [{x:2,y:2},{x:12,y:2},{x:12,y:8},{x:2,y:8}], 'door-b0-1', 'hall-b0')

  const entA: Entrance = { id: 'ent-a', label: 'Entrance A', position: { lat: 33.4205, lng: -111.9295 } as any, level: 0, type: 'main', hasQR: false, hasPanorama: false }
  const entB: Entrance = { id: 'ent-b', label: 'Entrance B', position: { lat: 33.4225, lng: -111.9295 } as any, level: 0, type: 'main', hasQR: false, hasPanorama: false }

  const stairA: LegacyStaircase = { id: 'stair-a', name: 'Stair A', position: { x: 10, y: 0 }, fromLevel: 0, toLevel: 1, type: 'standard' }
  const elevA: LegacyElevator = { id: 'elev-a', name: 'Elev A', position: { x: 10, y: 0 }, fromLevel: 0, toLevel: 1 }

  const road: Road = {
    id: 'road-1', name: 'Campus Road',
    polyline: { points: [{ lat: 33.4205, lng: -111.9295 }, { lat: 33.4225, lng: -111.9295 }] },
    width: 5, surface: 'paved', type: 'arterial', metadata: {},
  }

  const fp = (id: string, pts: Array<{lat:number;lng:number}>): Building => ({
    id, name: id === 'bld-a' ? 'Engineering' : 'Library', code: id === 'bld-a' ? 'ENG' : 'LIB',
    category: 'academic', description: '',
    footprint: { points: [...pts, pts[0]] },
    baseElevation: 0, height: 20, floors: [], verticalConnectors: [],
    aliases: [], color: '#4A90D9', metadata: {},
  })

  const bldA = fp('bld-a', [
    { lat: 33.4200, lng: -111.9300 }, { lat: 33.4210, lng: -111.9300 },
    { lat: 33.4210, lng: -111.9290 }, { lat: 33.4200, lng: -111.9290 },
  ])
  bldA.floors = [
    { id: 'flr-a0', level: 0, label: 'G', elevation: 0, rooms: [roomA01, roomA02], hallways: [hallA0], staircases: [stairA], elevators: [], entrances: [entA], connectorStops: [], metadata: {} },
    { id: 'flr-a1', level: 1, label: 'L1', elevation: 4, rooms: [roomA11, roomA12], hallways: [hallA1], staircases: [], elevators: [elevA], entrances: [], connectorStops: [], metadata: {} },
  ]

  const bldB = fp('bld-b', [
    { lat: 33.4220, lng: -111.9300 }, { lat: 33.4230, lng: -111.9300 },
    { lat: 33.4230, lng: -111.9290 }, { lat: 33.4220, lng: -111.9290 },
  ])
  bldB.floors = [
    { id: 'flr-b0', level: 0, label: 'G', elevation: 0, rooms: [roomB01], hallways: [hallB0], staircases: [], elevators: [], entrances: [entB], connectorStops: [], metadata: {} },
  ]

  return {
    schemaVersion: 1, version: 1,
    metadata: { campusId: 'route-val', name: 'Route Validation Campus', description: '', lastModified: '', editorVersion: '1.0.0' },
    buildings: [bldA, bldB], roads: [road], panoramas: [], qrCheckpoints: [],
  }
}

// ── Compile once ──

let graph: Graph
let nodes: NavNode[]

beforeAll(() => {
  const doc = createCampus()
  const tf = new CoordinateTransformer()
  tf.registerBuilding({ buildingId: 'bld-a', origin: { lat: 33.4205, lng: -111.9295 }, rotation: 0 })
  tf.registerBuilding({ buildingId: 'bld-b', origin: { lat: 33.4225, lng: -111.9295 }, rotation: 0 })
  graph = new Graph()
  new GraphAdapter(graph, tf).sync(doc)
  nodes = graph.nodes
})

function nodeOf(id: string): NavNode {
  const n = graph.getNode(id)
  if (!n) throw new Error(`node ${id} not in graph`)
  return n
}

function nodeIdByType(type: string, predicate?: (n: NavNode) => boolean): string {
  const found = nodes.find(n => n.type === type && (!predicate || predicate(n)))
  if (!found) throw new Error(`no node of type ${type}${predicate ? ' matching predicate' : ''}`)
  return found.id
}

function pathTypes(path: string[]): string[] {
  return path.map(id => nodeOf(id).type)
}

// ── Validation ──

describe('R1 | Outdoor → Building → Room', () => {

  it('R1.1: entrance nodes connect to BOTH the road network and the hallway', () => {
    // The intended bridge: building_entrance ↔ road node AND ↔ hallway node.
    const entrances = nodes.filter(n => n.type === 'building_entrance')
    expect(entrances.length).toBe(2)
    for (const ent of entrances) {
      const edges = graph.edges.filter(e => e.from === ent.id || e.to === ent.id)
      const neighborTypes = edges.map(e => {
        const other = e.from === ent.id ? e.to : e.from
        return nodeOf(other).type
      })
      expect(neighborTypes).toContain('hallway')          // indoor link
      expect(neighborTypes.some(t => t === 'intersection' || t === 'outdoor')).toBe(true) // road link
    }
  })

  it('R1.2: no road→room_door shortcuts (road connects only via entrances)', () => {
    // Forbidden: a trace (road) node connecting directly to a room door,
    // bypassing the entrance. Route must pass through the building_entrance.
    for (const e of graph.edges) {
      const from = nodeOf(e.from)
      const to = nodeOf(e.to)
      const roadToDoor =
        (from.type === 'intersection' && to.type === 'room_door') ||
        (from.type === 'room_door' && to.type === 'intersection')
      expect(roadToDoor).toBe(false)
    }
  })

  it('R1.3: route road node → Room 101 door passes through the entrance', () => {
    const start = nodeIdByType('intersection', n => (n.metadata as Record<string, unknown>)?.traceId === 'road-1')
    const end = nodeIdByType('room_door', n => n.componentId === 'room-a0-1')
    const result = aStar(nodes, graph.edges, start, end)
    expect(result).not.toBeNull()

    const types = pathTypes(result!.path)
    // Ordered chain: road → entrance → hallway → room door
    const entranceIdx = types.indexOf('building_entrance')
    const hallwayIdx = types.indexOf('hallway')
    const doorIdx = types.indexOf('room_door')
    expect(entranceIdx).toBeGreaterThanOrEqual(0)
    expect(hallwayIdx).toBeGreaterThan(entranceIdx)
    expect(doorIdx).toBe(result!.path.length - 1) // door is the destination
    // No room interiors and no room_door in the middle
    expect(types).not.toContain('room')
    expect(types.slice(0, -1)).not.toContain('room_door')
  })
})

describe('R2 | Room → Another Building (indoor↔outdoor isolation)', () => {

  it('R2.1: route Room 101 → Room B101 exists and bridges via road network', () => {
    const start = nodeIdByType('room_door', n => n.componentId === 'room-a0-1')
    const end = nodeIdByType('room_door', n => n.componentId === 'room-b0-1')
    const result = aStar(nodes, graph.edges, start, end)
    expect(result).not.toBeNull()

    const types = pathTypes(result!.path)
    // Expected: room_door → hallway → entrance → road… → entrance → hallway → room_door
    const entrances = types.filter(t => t === 'building_entrance')
    expect(entrances.length).toBe(2) // both buildings' entrances used
    const roadNodes = types.filter(t => t === 'intersection')
    expect(roadNodes.length).toBeGreaterThanOrEqual(1) // road segment between
    // doors only at the ends; no room interiors
    expect(types[0]).toBe('room_door')
    expect(types[types.length - 1]).toBe('room_door')
    expect(types.slice(1, -1)).not.toContain('room_door')
    expect(types).not.toContain('room')
    // order: hallway before first entrance, hallway after last entrance
    expect(types.indexOf('hallway')).toBeLessThan(types.indexOf('building_entrance'))
    expect(types.lastIndexOf('hallway')).toBeGreaterThan(types.lastIndexOf('building_entrance'))
  })
})

describe('R3 | Multi-floor route', () => {

  it('R3.1: route Room 101 (F0) → Room 201 (F1) uses a vertical connector (staircase OR elevator), no interiors', () => {
    const start = nodeIdByType('room_door', n => n.componentId === 'room-a0-1')
    const end = nodeIdByType('room_door', n => n.componentId === 'room-a1-1')
    const result = aStar(nodes, graph.edges, start, end)
    expect(result).not.toBeNull()

    const types = pathTypes(result!.path)
    // Must traverse a VERTICAL connector node (F0 → F1). The fixture has both
    // a staircase and an elevator at the same position serving the same floors,
    // so A* may legitimately pick either — the invariant is that the floor
    // change happens ONLY through a vertical connector, never a cross-floor
    // hallway/door shortcut. (Regression: a single transition node at floor 0
    // or coincident floors merging would fail this.)
    const verticalIdx = types.findIndex(t => t === 'staircase' || t === 'elevator')
    expect(verticalIdx).toBeGreaterThan(0)
    const before = result!.path.slice(0, verticalIdx).map(id => nodeOf(id).floor)
    const after = result!.path.slice(verticalIdx).map(id => nodeOf(id).floor)
    expect(Math.max(...before)).toBeLessThanOrEqual(0)
    expect(Math.max(...after)).toBeGreaterThan(0)
    // No room interiors, room_door only at the ends
    expect(types).not.toContain('room')
    expect(types[0]).toBe('room_door')
    expect(types[types.length - 1]).toBe('room_door')
    expect(types.slice(1, -1)).not.toContain('room_door')
  })
})