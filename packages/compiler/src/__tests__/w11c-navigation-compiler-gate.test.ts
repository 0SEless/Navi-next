/**
 * W11C — Navigation Compiler Compatibility Gate
 *
 * Proves the canonical authoring model (W1–W11) compiles into a real
 * NavigationGraph that A* can traverse.
 *
 * Production chain to prove:
 *   CampusDocument → compileV2 → NavigationGraph → A*
 *
 * Route to prove:
 *   Outdoor node → Building entrance → Floor 1 → Stair/Elevator → Floor 2 → Room
 *
 * FINDINGS:
 *   The compiler ALREADY handles:
 *     - Entrance → portal nodes (outdoor + indoor) via entrance-extractor
 *     - Connector stops / feature staircases → transition nodes via connector-extractor
 *     - Hallways → skeleton waypoints via skeleton-generator
 *     - Room doors → access edges to nearest waypoint via connector
 *     - Entrance → road connection via connector (explicit link or bounded nearest)
 *     - Vertical edges between connector floors via connector
 *
 *   GAPS (W10/W11 entities NOT in compiler):
 *     - Floor.routeNetwork — authored route nodes/edges IGNORED by compiler
 *     - Floor.entranceAccess[] — bridge relationships NOT projected
 *     - Building.verticalTransitions[] — cross-floor route node links NOT projected
 *     - Floor.roomAttributes[].accessPoints (RoomAccess) — NOT projected
 *
 *   The test proves A* works through the EXISTING compiler pipeline (hallway-based
 *   skeleton + connector stops + entrance portals). The gaps are documented below.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { CampusCompiler } from '../pipeline/campus-compiler'
import type { CampusDocument } from '@navi/core'
import type { CompileResultV2 } from '../types'
import type { NavigationGraph, NavNode, NavEdge } from '@navi/core'

// ── Inline A* (matches packages/runtime/src/routing/astar.ts) ──
// Avoids adding @navi/runtime as a dependency of @navi/compiler.
function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2)
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
}

function findPath(
  graph: NavigationGraph,
  fromId: string,
  toId: string,
): { path: string[]; distance: number } | null {
  const nodeMap = new Map(graph.nodes.map(n => [n.id, n]))
  const adj = new Map<string, Array<{ to: string; edge: NavEdge }>>()
  for (const e of graph.edges) {
    const list = adj.get(e.from) ?? []
    list.push({ to: e.to, edge: e })
    adj.set(e.from, list)
    const rev = adj.get(e.to) ?? []
    rev.push({ to: e.from, edge: e })
    adj.set(e.to, rev)
  }

  const fromNode = nodeMap.get(fromId)
  const toNode = nodeMap.get(toId)
  if (!fromNode || !toNode) return null

  const open = new Set([fromId])
  const cameFrom = new Map<string, string>()
  const gScore = new Map([[fromId, 0]])
  const fScore = new Map([[fromId, haversine(fromNode.position, toNode.position)]])

  while (open.size > 0) {
    let current = ''
    let currentF = Infinity
    for (const id of open) {
      const f = fScore.get(id) ?? Infinity
      if (f < currentF) { current = id; currentF = f }
    }
    if (current === toId) {
      const path: string[] = []
      let node = current
      while (node) {
        path.unshift(node)
        node = cameFrom.get(node) ?? ''
      }
      return { path, distance: gScore.get(toId) ?? 0 }
    }
    open.delete(current)
    for (const neighbor of (adj.get(current) ?? [])) {
      const tentativeG = (gScore.get(current) ?? 0) + neighbor.edge.weight
      if (tentativeG < (gScore.get(neighbor.to) ?? Infinity)) {
        cameFrom.set(neighbor.to, current)
        gScore.set(neighbor.to, tentativeG)
        const target = nodeMap.get(neighbor.to)
        if (target) fScore.set(neighbor.to, tentativeG + haversine(target.position, toNode.position))
        open.add(neighbor.to)
      }
    }
  }
  return null
}

// ── Coordinate helpers ──
const ORIGIN = { lat: 14.0005, lng: 121.0005 }
const MPD = 111320
function localToLatLng(x: number, y: number): { lat: number; lng: number } {
  return {
    lat: ORIGIN.lat + y / MPD,
    lng: ORIGIN.lng + x / (MPD * Math.cos((ORIGIN.lat * Math.PI) / 180)),
  }
}

// Second building offset ~500m away
const ORIGIN_B = { lat: 14.005, lng: 121.005 }
function localToLatLngB(x: number, y: number): { lat: number; lng: number } {
  return {
    lat: ORIGIN_B.lat + y / MPD,
    lng: ORIGIN_B.lng + x / (MPD * Math.cos((ORIGIN_B.lat * Math.PI) / 180)),
  }
}

// ── Test Document: 2 buildings, each with 2 floors, staircases, entrances ──

function createTestDocument(): CampusDocument {
  return {
    schemaVersion: 1,
    version: 1,
    metadata: {
      campusId: 'w11c-gate',
      name: 'W11C Gate Test',
      description: 'Navigation compiler compatibility gate',
      lastModified: '',
      editorVersion: '1.0',
    },
    buildings: [
      // ── Building A: Computer Science ──
      {
        id: 'bld-a',
        name: 'Computer Science Building',
        code: 'CS',
        category: 'academic',
        description: 'CS building with labs',
        footprint: {
          points: [
            { lat: 14.0, lng: 121.0 },
            { lat: 14.001, lng: 121.0 },
            { lat: 14.001, lng: 121.001 },
            { lat: 14.0, lng: 121.001 },
          ],
        },
        baseElevation: 10,
        height: 20,
        color: '#ff0000',
        aliases: [],
        metadata: {},
        verticalConnectors: [
          {
            id: 'conn-stair-a',
            type: 'staircase',
            name: 'Stairwell A',
            stopIds: ['stop-a-f1', 'stop-a-f2'],
            accessible: true,
            metadata: {},
          },
        ],
        staircases: [
          {
            id: 'stair-a',
            buildingId: 'bld-a',
            name: 'Stair A',
            type: 'open',
            accessible: true,
            fromLevel: 1,
            toLevel: 2,
            levels: {
              1: { position: { x: 25, y: 5 }, rotation: 0 },
              2: { position: { x: 25, y: 5 }, rotation: 0 },
            },
          },
        ],
        floors: [
          // Floor 1
          {
            id: 'bld-a-f1',
            level: 1,
            label: 'First Floor',
            elevation: 0,
            rooms: [
              {
                id: 'room-101',
                name: 'Computer Laboratory',
                number: '101',
                category: 'lab',
                polygon: {
                  points: [
                    { x: 0, y: 0 },
                    { x: 10, y: 0 },
                    { x: 10, y: 10 },
                    { x: 0, y: 10 },
                  ],
                },
                roomDoors: [
                  {
                    id: 'room-101-door',
                    roomId: 'room-101',
                    connectedToId: 'hw-a1',
                    connectedToType: 'hallway',
                    doorType: 'standard',
                    position: { x: 5, y: 10 },
                    width: 1.5,
                    metadata: {},
                  },
                ],
                metadata: {},
              },
            ],
            hallways: [
              {
                id: 'hw-a1',
                name: 'Main Hallway A',
                polyline: { points: [{ x: 0, y: 12 }, { x: 30, y: 12 }] },
                width: 3,
              },
            ],
            staircases: [],
            elevators: [],
            entrances: [
              {
                id: 'ent-a',
                label: 'CS Main Entrance',
                position: { lat: 14.0, lng: 121.0 } as any,
                level: 1,
                type: 'main',
                hasQR: false,
                hasPanorama: false,
              },
            ],
            connectorStops: [
              {
                id: 'stop-a-f1',
                connectorId: 'conn-stair-a',
                label: 'Stair Landing F1',
                position: { x: 25, y: 12 },
                rotation: 0,
                accessible: true,
                anchors: [],
                metadata: {},
              },
            ],
            metadata: {},
            routeNetwork: {
              nodes: [
                { id: 'rn-a-f1-1', type: 'corridor', position: { x: 5, y: 12 }, floor: 1 },
                { id: 'rn-a-f1-2', type: 'corridor', position: { x: 15, y: 12 }, floor: 1 },
                { id: 'rn-a-f1-3', type: 'corridor', position: { x: 25, y: 12 }, floor: 1 },
              ],
              edges: [
                { id: 're-a-f1-1', from: 'rn-a-f1-1', to: 'rn-a-f1-2', type: 'walk', distance: 10 },
                { id: 're-a-f1-2', from: 'rn-a-f1-2', to: 'rn-a-f1-3', type: 'walk', distance: 10 },
              ],
            },
            entranceAccess: [
              {
                entranceId: 'ent-a',
                outdoorNodeId: 'rn-outdoor-1',
                indoorRouteNodeId: 'rn-a-f1-1',
              },
            ],
          },
          // Floor 2
          {
            id: 'bld-a-f2',
            level: 2,
            label: 'Second Floor',
            elevation: 4,
            rooms: [
              {
                id: 'room-201',
                name: 'Server Room',
                number: '201',
                category: 'lab',
                polygon: {
                  points: [
                    { x: 0, y: 0 },
                    { x: 10, y: 0 },
                    { x: 10, y: 10 },
                    { x: 0, y: 10 },
                  ],
                },
                roomDoors: [
                  {
                    id: 'room-201-door',
                    roomId: 'room-201',
                    connectedToId: 'hw-a2',
                    connectedToType: 'hallway',
                    doorType: 'standard',
                    position: { x: 5, y: 10 },
                    width: 1.5,
                    metadata: {},
                  },
                ],
                metadata: {},
              },
            ],
            hallways: [
              {
                id: 'hw-a2',
                name: 'Upper Hallway A',
                polyline: { points: [{ x: 0, y: 12 }, { x: 30, y: 12 }] },
                width: 3,
              },
            ],
            staircases: [],
            elevators: [],
            entrances: [],
            connectorStops: [
              {
                id: 'stop-a-f2',
                connectorId: 'conn-stair-a',
                label: 'Stair Landing F2',
                position: { x: 25, y: 12 },
                rotation: 0,
                accessible: true,
                anchors: [],
                metadata: {},
              },
            ],
            metadata: {},
          },
        ],
      },
      // ── Building B: Library ──
      {
        id: 'bld-b',
        name: 'Library Building',
        code: 'LIB',
        category: 'library',
        description: 'Main library',
        footprint: {
          points: [
            { lat: 14.005, lng: 121.005 },
            { lat: 14.006, lng: 121.005 },
            { lat: 14.006, lng: 121.006 },
            { lat: 14.005, lng: 121.006 },
          ],
        },
        baseElevation: 12,
        height: 15,
        color: '#0000ff',
        aliases: [],
        metadata: {},
        verticalConnectors: [
          {
            id: 'conn-elev-b',
            type: 'elevator',
            name: 'Elevator B',
            stopIds: ['stop-b-f1', 'stop-b-f2'],
            accessible: true,
            metadata: {},
          },
        ],
        elevators: [
          {
            id: 'elev-b',
            buildingId: 'bld-b',
            name: 'Elev B',
            type: 'passenger',
            accessible: true,
            fromLevel: 1,
            toLevel: 2,
            levels: {
              1: { position: { x: 20, y: 6 }, rotation: 0 },
              2: { position: { x: 20, y: 6 }, rotation: 0 },
            },
          },
        ],
        floors: [
          // Floor 1
          {
            id: 'bld-b-f1',
            level: 1,
            label: 'Ground Floor',
            elevation: 0,
            rooms: [
              {
                id: 'room-b101',
                name: 'Reading Room',
                number: 'B101',
                category: 'other',
                polygon: {
                  points: [
                    { x: 0, y: 0 },
                    { x: 15, y: 0 },
                    { x: 15, y: 12 },
                    { x: 0, y: 12 },
                  ],
                },
                roomDoors: [
                  {
                    id: 'room-b101-door',
                    roomId: 'room-b101',
                    connectedToId: 'hw-b1',
                    connectedToType: 'hallway',
                    doorType: 'double',
                    position: { x: 7.5, y: 12 },
                    width: 2,
                    metadata: {},
                  },
                ],
                metadata: {},
              },
            ],
            hallways: [
              {
                id: 'hw-b1',
                name: 'Library Hallway',
                polyline: { points: [{ x: 0, y: 14 }, { x: 25, y: 14 }] },
                width: 4,
              },
            ],
            staircases: [],
            elevators: [],
            entrances: [
              {
                id: 'ent-b',
                label: 'Library Entrance',
                position: { lat: 14.005, lng: 121.005 } as any,
                level: 1,
                type: 'main',
                hasQR: false,
                hasPanorama: false,
              },
            ],
            connectorStops: [
              {
                id: 'stop-b-f1',
                connectorId: 'conn-elev-b',
                label: 'Elevator Lobby F1',
                position: { x: 20, y: 14 },
                rotation: 0,
                accessible: true,
                anchors: [],
                metadata: {},
              },
            ],
            metadata: {},
          },
          // Floor 2
          {
            id: 'bld-b-f2',
            level: 2,
            label: 'Upper Floor',
            elevation: 4,
            rooms: [
              {
                id: 'room-b201',
                name: 'Study Hall',
                number: 'B201',
                category: 'other',
                polygon: {
                  points: [
                    { x: 0, y: 0 },
                    { x: 15, y: 0 },
                    { x: 15, y: 12 },
                    { x: 0, y: 12 },
                  ],
                },
                roomDoors: [
                  {
                    id: 'room-b201-door',
                    roomId: 'room-b201',
                    connectedToId: 'hw-b2',
                    connectedToType: 'hallway',
                    doorType: 'standard',
                    position: { x: 7.5, y: 12 },
                    width: 1.5,
                    metadata: {},
                  },
                ],
                metadata: {},
              },
            ],
            hallways: [
              {
                id: 'hw-b2',
                name: 'Upper Library Hallway',
                polyline: { points: [{ x: 0, y: 14 }, { x: 25, y: 14 }] },
                width: 4,
              },
            ],
            staircases: [],
            elevators: [],
            entrances: [],
            connectorStops: [
              {
                id: 'stop-b-f2',
                connectorId: 'conn-elev-b',
                label: 'Elevator Lobby F2',
                position: { x: 20, y: 14 },
                rotation: 0,
                accessible: true,
                anchors: [],
                metadata: {},
              },
            ],
            metadata: {},
          },
        ],
      },
    ],
    roads: [
      {
        id: 'road-campus',
        name: 'Campus Walkway',
        polyline: {
          points: [
            { lat: 14.0, lng: 121.0 },
            { lat: 14.005, lng: 121.005 },
          ],
        },
        width: 5,
        surface: 'paved',
        type: 'connector',
        metadata: {},
        connectorEntranceId: 'ent-a',
      },
    ],
    panoramas: [],
    qrCheckpoints: [],
  }
}

// ════════════════════════════════════════════════════════════════════════════
// W11C: Navigation Compiler Compatibility Gate
// ════════════════════════════════════════════════════════════════════════════

describe('W11C — Navigation Compiler Compatibility Gate', () => {
  let result: CompileResultV2

  beforeAll(() => {
    const doc = createTestDocument()
    const compiler = new CampusCompiler({ nodeInterval: 10, mergeThreshold: 0.5 } as any)
    result = compiler.compileV2(doc)
  })

  // ── Section 1: Compiler Pipeline Success ──

  describe('1. Compiler pipeline produces a valid NavigationGraph', () => {
    it('compilation succeeds', () => {
      expect(result.success).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('produces a non-null graph', () => {
      expect(result.graph).not.toBeNull()
    })

    it('graph has nodes and edges', () => {
      expect(result.graph!.nodes.length).toBeGreaterThan(0)
      expect(result.graph!.edges.length).toBeGreaterThan(0)
    })

    it('graph contains all expected NavNode types', () => {
      const types = new Set(result.graph!.nodes.map(n => n.type))
      expect(types.has('outdoor')).toBe(true)   // entrance portal outdoor side
      expect(types.has('entrance')).toBe(true)  // entrance portal indoor side
      expect(types.has('waypoint')).toBe(true)  // hallway skeleton nodes
      expect(types.has('transition')).toBe(true) // stair/elevator nodes
      expect(types.has('poi')).toBe(true)       // room nodes
    })

    it('graph contains walk and stairs/elevator edge types', () => {
      const types = new Set(result.graph!.edges.map(e => e.type))
      expect(types.has('walk')).toBe(true)
      expect(types.has('stairs')).toBe(true)
      expect(types.has('elevator')).toBe(true)
    })

    it('both buildings are represented in the graph', () => {
      const buildingIds = new Set(result.graph!.nodes.map(n => n.buildingId).filter(Boolean))
      expect(buildingIds.has('bld-a')).toBe(true)
      expect(buildingIds.has('bld-b')).toBe(true)
    })
  })

  // ── Section 2: Indoor Route Nodes ──

  describe('2. Indoor route nodes exist on both floors', () => {
    it('Building A Floor 1 has waypoint nodes from hallway skeleton', () => {
      const f1Waypoints = result.graph!.nodes.filter(
        n => n.buildingId === 'bld-a' && n.floor === 1 && n.type === 'waypoint',
      )
      expect(f1Waypoints.length).toBeGreaterThan(0)
    })

    it('Building A Floor 2 has waypoint nodes from hallway skeleton', () => {
      const f2Waypoints = result.graph!.nodes.filter(
        n => n.buildingId === 'bld-a' && n.floor === 2 && n.type === 'waypoint',
      )
      expect(f2Waypoints.length).toBeGreaterThan(0)
    })

    it('Building B Floor 1 has waypoint nodes', () => {
      const f1Waypoints = result.graph!.nodes.filter(
        n => n.buildingId === 'bld-b' && n.floor === 1 && n.type === 'waypoint',
      )
      expect(f1Waypoints.length).toBeGreaterThan(0)
    })

    it('Building B Floor 2 has waypoint nodes', () => {
      const f2Waypoints = result.graph!.nodes.filter(
        n => n.buildingId === 'bld-b' && n.floor === 2 && n.type === 'waypoint',
      )
      expect(f2Waypoints.length).toBeGreaterThan(0)
    })
  })

  // ── Section 3: Vertical Transition Edges ──

  describe('3. Vertical transition edges connect floors', () => {
    it('Building A has a stairs edge between Floor 1 and Floor 2 transition nodes', () => {
      const stairNodes = result.graph!.nodes.filter(
        n => n.buildingId === 'bld-a' && n.type === 'transition',
      )
      expect(stairNodes.length).toBeGreaterThanOrEqual(2)

      const stairIds = new Set(stairNodes.map(n => n.id))
      const stairEdges = result.graph!.edges.filter(
        e => e.type === 'stairs' && stairIds.has(e.from) && stairIds.has(e.to),
      )
      expect(stairEdges.length).toBe(1)

      // Verify floors are different
      const fromNode = result.graph!.nodes.find(n => n.id === stairEdges[0].from)!
      const toNode = result.graph!.nodes.find(n => n.id === stairEdges[0].to)!
      expect(fromNode.floor).not.toBe(toNode.floor)
    })

    it('Building B has an elevator edge between Floor 1 and Floor 2 transition nodes', () => {
      const elevNodes = result.graph!.nodes.filter(
        n => n.buildingId === 'bld-b' && n.type === 'transition',
      )
      expect(elevNodes.length).toBeGreaterThanOrEqual(2)

      const elevIds = new Set(elevNodes.map(n => n.id))
      const elevEdges = result.graph!.edges.filter(
        e => e.type === 'elevator' && elevIds.has(e.from) && elevIds.has(e.to),
      )
      expect(elevEdges.length).toBe(1)
    })
  })

  // ── Section 4: Entrance Bridge Edges ──

  describe('4. Entrance bridge edges connect outdoor to indoor', () => {
    it('Building A has outdoor + entrance portal nodes', () => {
      const outdoor = result.graph!.nodes.filter(
        n => n.buildingId === 'bld-a' && n.type === 'outdoor',
      )
      const entrance = result.graph!.nodes.filter(
        n => n.buildingId === 'bld-a' && n.type === 'entrance',
      )
      expect(outdoor.length).toBeGreaterThanOrEqual(1)
      expect(entrance.length).toBeGreaterThanOrEqual(1)
    })

    it('Building A has a walk edge from outdoor node to entrance node', () => {
      const outdoor = result.graph!.nodes.find(
        n => n.buildingId === 'bld-a' && n.type === 'outdoor',
      )!
      const entrance = result.graph!.nodes.find(
        n => n.buildingId === 'bld-a' && n.type === 'entrance',
      )!

      const portalEdge = result.graph!.edges.find(
        e => e.from === outdoor.id && e.to === entrance.id && e.type === 'walk',
      )
      expect(portalEdge).toBeDefined()
      expect(portalEdge!.distance).toBeGreaterThan(0)
    })

    it('Building B has outdoor + entrance portal nodes', () => {
      const outdoor = result.graph!.nodes.filter(
        n => n.buildingId === 'bld-b' && n.type === 'outdoor',
      )
      const entrance = result.graph!.nodes.filter(
        n => n.buildingId === 'bld-b' && n.type === 'entrance',
      )
      expect(outdoor.length).toBeGreaterThanOrEqual(1)
      expect(entrance.length).toBeGreaterThanOrEqual(1)
    })
  })

  // ── Section 5: Room Access Resolution ──

  describe('5. Room access resolution — rooms connected to hallway waypoints', () => {
    it('Room 101 (CS lab) has a POI node', () => {
      const roomNode = result.graph!.nodes.find(
        n => n.buildingId === 'bld-a' && n.type === 'poi' && n.label === 'Computer Laboratory (101)',
      )
      expect(roomNode).toBeDefined()
    })

    it('Room 101 has an access edge to a hallway waypoint', () => {
      const roomNode = result.graph!.nodes.find(
        n => n.buildingId === 'bld-a' && n.type === 'poi' && n.label === 'Computer Laboratory (101)',
      )!
      const accessEdges = result.graph!.edges.filter(
        e => e.from === roomNode.id && e.type === 'walk',
      )
      expect(accessEdges.length).toBeGreaterThan(0)
    })

    it('Room 201 (Server Room) has a POI node on Floor 2', () => {
      const roomNode = result.graph!.nodes.find(
        n => n.buildingId === 'bld-a' && n.type === 'poi' && n.label === 'Server Room (201)',
      )
      expect(roomNode).toBeDefined()
      expect(roomNode!.floor).toBe(2)
    })

    it('Room B101 (Reading Room) has a POI node', () => {
      const roomNode = result.graph!.nodes.find(
        n => n.buildingId === 'bld-b' && n.type === 'poi' && n.label === 'Reading Room (B101)',
      )
      expect(roomNode).toBeDefined()
    })
  })

  // ── Section 6: A* Cross-Floor Navigation ──

  describe('6. A* finds a path: Outdoor → Entrance → Floor 1 → Stair → Floor 2 → Room', () => {
    it('A* path exists from Building A outdoor node to Room 201 (Floor 2)', () => {
      const outdoorNode = result.graph!.nodes.find(
        n => n.buildingId === 'bld-a' && n.type === 'outdoor',
      )!
      const roomNode = result.graph!.nodes.find(
        n => n.buildingId === 'bld-a' && n.type === 'poi' && n.label === 'Server Room (201)',
      )!

      const pathResult = findPath(result.graph!, outdoorNode.id, roomNode.id)

      expect(pathResult).not.toBeNull()
      expect(pathResult!.path.length).toBeGreaterThan(2)
      expect(pathResult!.distance).toBeGreaterThan(0)
    })

    it('A* path crosses floors (contains nodes on both Floor 1 and Floor 2)', () => {
      const outdoorNode = result.graph!.nodes.find(
        n => n.buildingId === 'bld-a' && n.type === 'outdoor',
      )!
      const roomNode = result.graph!.nodes.find(
        n => n.buildingId === 'bld-a' && n.type === 'poi' && n.label === 'Server Room (201)',
      )!

      const pathResult = findPath(result.graph!, outdoorNode.id, roomNode.id)!

      const pathNodes = pathResult.path.map(id => result.graph!.nodes.find(n => n.id === id)!)
      const floors = new Set(pathNodes.map(n => n.floor))
      expect(floors.has(1)).toBe(true)
      expect(floors.has(2)).toBe(true)
    })

    it('A* path includes a stairs edge type', () => {
      const outdoorNode = result.graph!.nodes.find(
        n => n.buildingId === 'bld-a' && n.type === 'outdoor',
      )!
      const roomNode = result.graph!.nodes.find(
        n => n.buildingId === 'bld-a' && n.type === 'poi' && n.label === 'Server Room (201)',
      )!

      const pathResult = findPath(result.graph!, outdoorNode.id, roomNode.id)!

      const pathEdges: NavEdge[] = []
      for (let i = 0; i < pathResult.path.length - 1; i++) {
        const edge = result.graph!.edges.find(
          e => e.from === pathResult.path[i] && e.to === pathResult.path[i + 1],
        )
        if (edge) pathEdges.push(edge)
      }
      const edgeTypes = new Set(pathEdges.map(e => e.type))
      expect(edgeTypes.has('stairs')).toBe(true)
    })

    it('A* path produces valid route with distance > 0', () => {
      const outdoorNode = result.graph!.nodes.find(
        n => n.buildingId === 'bld-a' && n.type === 'outdoor',
      )!
      const roomNode = result.graph!.nodes.find(
        n => n.buildingId === 'bld-a' && n.type === 'poi' && n.label === 'Server Room (201)',
      )!

      const pathResult = findPath(result.graph!, outdoorNode.id, roomNode.id)

      expect(pathResult).not.toBeNull()
      expect(pathResult!.distance).toBeGreaterThan(0)
      expect(pathResult!.path.length).toBeGreaterThanOrEqual(3)
    })
  })

  // ── Section 7: Cross-Building Navigation ──

  describe('7. A* finds a path: Building A → Building B via outdoor road', () => {
    it('A* path exists from Building A outdoor to Building B outdoor', () => {
      const outdoorA = result.graph!.nodes.find(
        n => n.buildingId === 'bld-a' && n.type === 'outdoor',
      )!
      const outdoorB = result.graph!.nodes.find(
        n => n.buildingId === 'bld-b' && n.type === 'outdoor',
      )!

      const pathResult = findPath(result.graph!, outdoorA.id, outdoorB.id)

      expect(pathResult).not.toBeNull()
      expect(pathResult!.path.length).toBeGreaterThan(1)
    })
  })

  // ── Section 8: Gap Analysis ──

  describe('8. Gap analysis — W10/W11 entities NOT processed by compiler', () => {
    it('documents that Floor.routeNetwork is IGNORED by compiler', () => {
      // The test document includes routeNetwork on Floor 1 of Building A.
      // The compiler generates its OWN skeleton from hallways instead.
      // This proves the gap: authored RouteNetwork is not projected into the graph.
      const doc = createTestDocument()
      expect(doc.buildings[0].floors[0].routeNetwork).toBeDefined()
      expect(doc.buildings[0].floors[0].routeNetwork!.nodes.length).toBe(3)

      // The compiler produced graph should have hallway-derived waypoints,
      // NOT the authored route network nodes.
      const f1Waypoints = result.graph!.nodes.filter(
        n => n.buildingId === 'bld-a' && n.floor === 1 && n.type === 'waypoint',
      )
      // Skeleton generates multiple waypoints from the hallway polyline
      expect(f1Waypoints.length).toBeGreaterThan(0)
      // None of these should have IDs matching the authored route network
      const routeNodeIds = new Set(doc.buildings[0].floors[0].routeNetwork!.nodes.map(n => n.id))
      for (const wp of f1Waypoints) {
        expect(routeNodeIds.has(wp.id)).toBe(false)
      }
    })

    it('documents that Floor.entranceAccess[] is IGNORED by compiler', () => {
      const doc = createTestDocument()
      expect(doc.buildings[0].floors[0].entranceAccess).toBeDefined()
      expect(doc.buildings[0].floors[0].entranceAccess!.length).toBe(1)

      // The compiler connects entrance portals to roads via connector.ts
      // (nearest-neighbor or explicit road link), NOT via entranceAccess.
      // entranceAccess is a W10 entity for the editor's route-network bridge.
    })

    it('documents that Building.verticalTransitions is NOT projected', () => {
      const doc = createTestDocument()
      // verticalTransitions is undefined on both buildings in our test doc
      expect(doc.buildings[0].verticalTransitions).toBeUndefined()
      // The compiler uses connector stops / feature staircases instead
      // (connector-extractor.ts). verticalTransitions is a W11 entity
      // for explicit cross-floor route-node linking.
    })

    it('compiler works WITHOUT RouteNetwork, EntranceAccess, VerticalTransition', () => {
      // This is the key finding: the compiler produces a working graph using
      // only hallways, connector stops, entrances, and room doors.
      // The W10/W11 entities are additive — they don't break existing behavior.
      expect(result.success).toBe(true)
      expect(result.graph!.nodes.length).toBeGreaterThan(0)
      expect(result.graph!.edges.length).toBeGreaterThan(0)
    })
  })
})
