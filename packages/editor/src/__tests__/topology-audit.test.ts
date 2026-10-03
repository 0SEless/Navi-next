/**
 * Topology Audit — Full Invariant Verification
 *
 * Compiles representative campus structures through GraphAdapter
 * and verifies every graph invariant. Establishes the frozen topology
 * contract before rendering work.
 *
 * Campus: 2 buildings, 3 floors, 5 rooms, 3 hallways, 2 entrances,
 *          1 staircase, 1 elevator, 5 room doors.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import type { CampusDocument, Building, Room, RoomDoor, Hallway, Entrance, LegacyStaircase, LegacyElevator } from '@navi/core'
import { Graph } from '@/engine/graph'
import { GraphAdapter } from '../graph-adapter'
import { CoordinateTransformer } from '@navi/core'

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

// ── Campus fixture ──

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
    metadata: { campusId: 'audit', name: 'Audit Campus', description: '', lastModified: '', editorVersion: '1.0.0' },
    buildings: [bldA, bldB], roads: [], panoramas: [], qrCheckpoints: [],
  }
}

// ── Compile once ──

let graph: Graph

beforeAll(() => {
  const doc = createCampus()
  const tf = new CoordinateTransformer()
  tf.registerBuilding({ buildingId: 'bld-a', origin: { lat: 33.4205, lng: -111.9295 }, rotation: 0 })
  tf.registerBuilding({ buildingId: 'bld-b', origin: { lat: 33.4225, lng: -111.9295 }, rotation: 0 })
  graph = new Graph()
  new GraphAdapter(graph, tf).sync(doc)
})

// ── Graph Structure Invariants ──

describe('Audit: Graph Structure', () => {

  it('INV-1: no orphan nodes', () => {
    const ids = new Set(graph.nodes.map(n => n.id))
    const refd = new Set<string>()
    for (const e of graph.edges) { refd.add(e.from); refd.add(e.to) }
    const orphans = [...ids].filter(id => !refd.has(id))
    expect(orphans).toEqual([])
  })

  it('INV-2: no duplicate edge IDs', () => {
    const ids = graph.edges.map(e => e.id)
    expect(ids.length).toBe(new Set(ids).size)
  })

  it('INV-2b: node IDs are globally unique (genId collision regression)', () => {
    // Regression: trace-compiler had its own id counter; its N0001… nodes
    // silently overwrote compiled hallway nodes in the graph Map.
    const ids = graph.nodes.map(n => n.id)
    expect(ids.length).toBe(new Set(ids).size)
    // node count === unique node ID count (nothing overwritten in the Map)
    expect(graph.nodeCount).toBe(new Set(ids).size)
  })

  it('INV-3: no self-edges', () => {
    expect(graph.edges.filter(e => e.from === e.to)).toEqual([])
  })

  it('INV-4: door edges go room_door → hallway', () => {
    const doors = graph.edges.filter(e => e.type === 'door')
    expect(doors.length).toBeGreaterThanOrEqual(5) // 5 rooms × 1 door each
    for (const d of doors) {
      expect(graph.getNode(d.from)!.type).toBe('room_door')
      expect(graph.getNode(d.to)!.type).toBe('hallway')
    }
  })

  it('INV-5: every room door has door edges', () => {
    const roomDoors = graph.nodes.filter(n => n.type === 'room_door')
    for (const r of roomDoors) {
      const doors = graph.edges.filter(e => e.type === 'door' && (e.from === r.id || e.to === r.id))
      expect(doors.length).toBeGreaterThanOrEqual(1)
    }
  })

  it('INV-6: entrances have connecting edges', () => {
    const entrances = graph.nodes.filter(n => n.type === 'building_entrance')
    expect(entrances.length).toBe(2) // ent-a + ent-b
    for (const ent of entrances) {
      const edges = graph.edges.filter(e => e.from === ent.id || e.to === ent.id)
      expect(edges.length).toBeGreaterThanOrEqual(1)
    }
  })

  it('INV-7: stair edges cross floors', () => {
    const stairs = graph.edges.filter(e => e.type === 'stair')
    for (const s of stairs) {
      expect(graph.getNode(s.from)!.floor).not.toBe(graph.getNode(s.to)!.floor)
    }
  })

  it('INV-8: node type coverage', () => {
    const types = new Set(graph.nodes.map(n => n.type))
    expect(types.has('room_door')).toBe(true)
    expect(types.has('hallway')).toBe(true)
    expect(types.has('building_entrance')).toBe(true)
    // Room interiors and corners must NOT be routing nodes (routing whitelist)
    expect(types.has('room')).toBe(false)
    expect(types.has('corner')).toBe(false)
  })

  it('INV-9: walkway/corridor/door edges have non-negative distance', () => {
    const walk = graph.edges.filter(e => e.type === 'walkway' || e.type === 'corridor' || e.type === 'door')
    for (const e of walk) {
      expect(e.distance).toBeGreaterThanOrEqual(0)
    }
    // At least some should have positive distance (not all zero)
    const positiveDistance = walk.filter(e => e.distance > 0)
    expect(positiveDistance.length).toBeGreaterThan(0)
  })

  it('INV-10: connected component count is finite and small', () => {
    const cc = graph.connectedComponentCount
    expect(cc).toBeGreaterThanOrEqual(1)
    expect(cc).toBeLessThanOrEqual(5)
  })
})

// ── Graph Size Sanity ──

describe('Audit: Graph Size', () => {
  it('has ≥10 nodes for 2-building campus', () => {
    // 5 room_door + 3 hallway + 2 entrance + 1 stair + 1 elevator + connectors
    expect(graph.nodes.length).toBeGreaterThanOrEqual(10)
  })

  it('has ≥15 edges for 2-building campus', () => {
    expect(graph.edges.length).toBeGreaterThanOrEqual(15)
  })

  it('reports counts correctly', () => {
    expect(graph.nodeCount).toBe(graph.nodes.length)
    expect(graph.edgeCount).toBe(graph.edges.length)
  })
})
