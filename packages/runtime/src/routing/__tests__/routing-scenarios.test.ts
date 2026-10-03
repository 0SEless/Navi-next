/**
 * Wave 3 — Routing Validation
 *
 * Verifies A* routing correctness across all scenarios:
 *   - Direct path, path with turns, multi-floor via stairs/elevator
 *   - Unreachable paths, same-node start/end, missing nodes
 *   - Instruction types: walk, stairs, elevator, turn_left, turn_right, arrive
 *   - Total distance/duration accuracy
 *   - Cross-building routing, large graph stress test
 */

import { describe, it, expect } from 'vitest'
import { RoutingEngine } from '../routing-engine'
import type { NavigationGraph, NavNode, NavEdge } from '@navi/core'

// ── Helpers ──

function makeGraph(nodes: NavNode[], edges: NavEdge[]): NavigationGraph {
  return {
    version: '1.0.0', campusId: 'test', createdAt: '', checksum: '',
    nodes,
    edges,
    metadata: {
      nodeCount: nodes.length, edgeCount: edges.length,
      buildings: new Set(nodes.map(n => n.buildingId)).size,
      floors: new Set(nodes.map(n => `${n.buildingId}-${n.floor}`)).size,
      boundingBox: { minLng: 0, maxLng: 0, minLat: 0, maxLat: 0 },
    },
  }
}

function node(id: string, label: string, type: NavNode['type'], lng: number, lat: number, floor = 1, buildingId = 'b1'): NavNode {
  return { id, label, type, position: { lng, lat }, floor, buildingId, properties: {} }
}

function edge(id: string, from: string, to: string, type: NavEdge['type'], distance: number, weight: number): NavEdge {
  return { id, from, to, type, distance, weight }
}

// ── Scenario 1: Simple line ──
// a(entrance) —50m— b(hallway) —40m— c(room)
function simpleLineGraph(): NavigationGraph {
  return makeGraph(
    [node('a', 'Entrance', 'transition', 121.0, 14.0),
     node('b', 'Hallway', 'corridor', 121.0005, 14.0),
     node('c', 'Room 101', 'space', 121.001, 14.0)],
    [edge('e1', 'a', 'b', 'walk', 50, 50),
     edge('e2', 'b', 'c', 'walk', 40, 40)],
  )
}

// ── Scenario 2: Path with turn ──
// a(entrance) —50m— b(junction) —50m— c(junction) —50m— d(room)
// Goes east (a→b), then north (b→c), then east (c→d)
// Turn at b: prev bearing east (a→b), curr bearing north (b→c)
function turnPathGraph(): NavigationGraph {
  return makeGraph(
    [node('a', 'Entrance', 'transition', 121.0, 14.0),
     node('b', 'Junction A', 'corridor', 121.0005, 14.0),
     node('c', 'Junction B', 'corridor', 121.0005, 14.0005),
     node('d', 'Room 101', 'space', 121.0010, 14.0005)],
    [edge('e1', 'a', 'b', 'walk', 50, 50),
     edge('e2', 'b', 'c', 'walk', 50, 50),
     edge('e3', 'c', 'd', 'walk', 50, 50)],
  )
}

// ── Scenario 3: Multi-floor via stairs ──
// a(entrance, flr1) — b(hallway, flr1) — c(stairs, flr1)
//                                         |
//                                      stairs
//                                         |
//                                      d(stairs, flr2) — e(room201, flr2)
function multiFloorStairsGraph(): NavigationGraph {
  return makeGraph(
    [node('a', 'Entrance', 'transition', 121.0, 14.0, 1),
     node('b', 'Hallway', 'corridor', 121.0005, 14.0, 1),
     node('c', 'Stairs Bottom', 'transition', 121.0005, 14.0005, 1),
     node('d', 'Stairs Top', 'transition', 121.0005, 14.0005, 2),
     node('e', 'Room 201', 'space', 121.001, 14.0005, 2)],
    [edge('e1', 'a', 'b', 'walk', 50, 50),
     edge('e2', 'b', 'c', 'walk', 40, 40),
     edge('e3', 'c', 'd', 'stairs', 5, 20),
     edge('e4', 'd', 'e', 'walk', 40, 40)],
  )
}

// ── Scenario 4: Multi-floor via elevator ──
function multiFloorElevatorGraph(): NavigationGraph {
  return makeGraph(
    [node('a', 'Entrance', 'transition', 121.0, 14.0, 1),
     node('b', 'Elevator G', 'transition', 121.0005, 14.0003, 1),
     node('c', 'Elevator 2F', 'transition', 121.0005, 14.0003, 2),
     node('d', 'Room 201', 'space', 121.001, 14.0005, 2)],
    [edge('e1', 'a', 'b', 'walk', 60, 60),
     edge('e2', 'b', 'c', 'elevator', 0, 10),
     edge('e3', 'c', 'd', 'walk', 40, 40)],
  )
}

// ── Scenario 5: Disconnected subgraph ──
// a—b—c  (connected)
// d—e    (connected, no path to a/b/c)
function disconnectedGraph(): NavigationGraph {
  return makeGraph(
    [node('a', 'Entrance', 'transition', 121.0, 14.0),
     node('b', 'Hallway', 'corridor', 121.0005, 14.0),
     node('c', 'Room 101', 'space', 121.001, 14.0),
     node('d', 'Alone A', 'space', 120.0, 13.0),
     node('e', 'Alone B', 'space', 120.0005, 13.0)],
    [edge('e1', 'a', 'b', 'walk', 50, 50),
     edge('e2', 'b', 'c', 'walk', 40, 40),
     edge('e3', 'd', 'e', 'walk', 30, 30)],
  )
}

// ── Scenario 6: Cross-building ──
// bld1: a—b—c   road: b—d   bld2: d—e
function crossBuildingGraph(): NavigationGraph {
  return makeGraph(
    [node('a', 'Bld1 Entrance', 'transition', 121.0, 14.0, 0, 'bld1'),
     node('b', 'Bld1 Corridor', 'corridor', 121.0005, 14.0, 0, 'bld1'),
     node('c', 'Room 101', 'space', 121.001, 14.0, 0, 'bld1'),
     node('d', 'Road Connector', 'corridor', 121.003, 14.0, 0, ''),
     node('e', 'Bld2 Entrance', 'transition', 121.005, 14.0, 0, 'bld2'),
     node('f', 'Room 201', 'space', 121.006, 14.0, 0, 'bld2')],
    [edge('e1', 'a', 'b', 'walk', 50, 50),
     edge('e2', 'b', 'c', 'walk', 40, 40),
     edge('e3', 'b', 'd', 'walk', 200, 200),
     edge('e4', 'd', 'e', 'walk', 150, 150),
     edge('e5', 'e', 'f', 'walk', 50, 50)],
  )
}

// ── Scenario 7: Hub-and-spoke (many nodes, 1 central hub) ──
// 10 nodes connected to a central hub, plus hub-to-hub-2 connection
function largeGraph(): NavigationGraph {
  const nodes: NavNode[] = [node('hub', 'Central Hub', 'corridor', 121.0, 14.0)]
  const edges: NavEdge[] = []
  for (let i = 0; i < 10; i++) {
    const id = `spoke-${i}`
    const lng = 121.0 + (i - 5) * 0.001
    const lat = 14.0 + (i % 2 === 0 ? 0.001 : -0.001)
    nodes.push(node(id, `Spoke ${i}`, 'space', lng, lat))
    edges.push(edge(`e-hub-${i}`, 'hub', id, 'walk', 100 + i * 10, 100 + i * 10))
  }
  // Add a second line from hub to far node through a chain
  nodes.push(node('far1', 'Far 1', 'corridor', 121.003, 14.0))
  nodes.push(node('far2', 'Far 2', 'space', 121.006, 14.0))
  edges.push(edge('e-chain1', 'hub', 'far1', 'walk', 300, 300))
  edges.push(edge('e-chain2', 'far1', 'far2', 'walk', 250, 250))
  return makeGraph(nodes, edges)
}

// ── Tests ──

describe('Wave 3 | Routing Validation', () => {

  describe('Basic pathfinding', () => {
    it('finds a direct path between connected nodes', () => {
      const engine = new RoutingEngine(simpleLineGraph())
      const route = engine.findRoute('a', 'c')
      expect(route).not.toBeNull()
      expect(route!.path.map(s => s.nodeId)).toEqual(['a', 'b', 'c'])
    })

    it('returns null for unreachable nodes (no path exists)', () => {
      const engine = new RoutingEngine(disconnectedGraph())
      const route = engine.findRoute('a', 'd')
      expect(route).toBeNull()
    })

    it('returns null when start node does not exist', () => {
      const engine = new RoutingEngine(simpleLineGraph())
      expect(engine.findRoute('nonexistent', 'c')).toBeNull()
    })

    it('returns null when end node does not exist', () => {
      const engine = new RoutingEngine(simpleLineGraph())
      expect(engine.findRoute('a', 'nonexistent')).toBeNull()
    })

    it('returns a path with single node when start equals end', () => {
      const engine = new RoutingEngine(simpleLineGraph())
      const route = engine.findRoute('a', 'a')
      expect(route).not.toBeNull()
      expect(route!.path).toHaveLength(1)
      expect(route!.path[0].nodeId).toBe('a')
      expect(route!.totalDistance).toBe(0)
    })
  })

  describe('Multi-floor routing', () => {
    it('routes through stairs between floors', () => {
      const engine = new RoutingEngine(multiFloorStairsGraph())
      const route = engine.findRoute('a', 'e')
      expect(route).not.toBeNull()
      expect(route!.path.map(s => s.nodeId)).toEqual(['a', 'b', 'c', 'd', 'e'])
      // Path should include stairs instruction
      const stairsInst = route!.instructions.find(i => i.type === 'stairs')
      expect(stairsInst).toBeDefined()
      expect(stairsInst!.text).toContain('stairs')
    })

    it('routes through elevator between floors', () => {
      const engine = new RoutingEngine(multiFloorElevatorGraph())
      const route = engine.findRoute('a', 'd')
      expect(route).not.toBeNull()
      expect(route!.path.map(s => s.nodeId)).toEqual(['a', 'b', 'c', 'd'])
      const elevInst = route!.instructions.find(i => i.type === 'elevator')
      expect(elevInst).toBeDefined()
    })

    it('preserves floor and buildingId on each path step', () => {
      const engine = new RoutingEngine(multiFloorStairsGraph())
      const route = engine.findRoute('a', 'e')
      expect(route!.path[0].floor).toBe(1)  // Entrance on floor 1
      expect(route!.path[3].floor).toBe(2)  // After stairs on floor 2
      expect(route!.path[4].floor).toBe(2)  // Room on floor 2
    })
  })

  describe('Turn instructions', () => {
    it('generates turn instructions when bearing changes significantly', () => {
      const engine = new RoutingEngine(turnPathGraph())
      const route = engine.findRoute('a', 'd')
      // Path: a→b→c→d
      // a→b is east, b→c is north → 90° turn left at b
      // c→d is east → no turn at c (same direction as b→c? no, b→c is north, c→d is east)
      // Actually c→d is east, so at c the bearing goes from north to east = 90° turn right
      // Expected: at least one turn instruction
      const hasTurn = route!.instructions.some(i => i.type === 'turn_left' || i.type === 'turn_right')
      expect(hasTurn).toBe(true)
    })

    it('does not generate false turns on a straight line', () => {
      const engine = new RoutingEngine(simpleLineGraph())
      const route = engine.findRoute('a', 'c')
      const turns = route!.instructions.filter(i => i.type === 'turn_left' || i.type === 'turn_right')
      expect(turns).toHaveLength(0)
    })
  })

  describe('Instructions correctness', () => {
    it('last instruction is always "arrive"', () => {
      const engine = new RoutingEngine(simpleLineGraph())
      const route = engine.findRoute('a', 'c')!
      expect(route.instructions[route.instructions.length - 1].type).toBe('arrive')
      expect(route.instructions[route.instructions.length - 1].text).toBe('You have arrived')
    })

    it('first instruction is a walk type', () => {
      const engine = new RoutingEngine(simpleLineGraph())
      const route = engine.findRoute('a', 'c')!
      expect(route.instructions[0].type).toBe('walk')
    })

    it('every instruction has non-empty text', () => {
      const engine = new RoutingEngine(simpleLineGraph())
      const route = engine.findRoute('a', 'c')!
      for (const inst of route.instructions) {
        expect(inst.text).toBeTruthy()
        expect(typeof inst.text).toBe('string')
      }
    })

    it('every instruction has valid fromNode and toNode', () => {
      const engine = new RoutingEngine(simpleLineGraph())
      const route = engine.findRoute('a', 'c')!
      for (const inst of route.instructions) {
        expect(inst.fromNode).toBeTruthy()
        expect(inst.toNode).toBeTruthy()
      }
    })

    it('distance on each instruction is non-negative', () => {
      const engine = new RoutingEngine(multiFloorStairsGraph())
      const route = engine.findRoute('a', 'e')!
      for (const inst of route.instructions) {
        expect(inst.distance).toBeGreaterThanOrEqual(0)
      }
    })
  })

  describe('Distance and duration', () => {
    it('total distance equals sum of instruction distances', () => {
      const engine = new RoutingEngine(simpleLineGraph())
      const route = engine.findRoute('a', 'c')!
      const sumInstructionDist = route.instructions.reduce((s, i) => s + i.distance, 0)
      expect(route.totalDistance).toBe(sumInstructionDist)
    })

    it('total distance is positive for non-trivial paths', () => {
      const engine = new RoutingEngine(simpleLineGraph())
      const route = engine.findRoute('a', 'c')!
      expect(route.totalDistance).toBeGreaterThan(0)
    })

    it('total duration = totalDistance / 1.4 (walking speed)', () => {
      const engine = new RoutingEngine(simpleLineGraph())
      const route = engine.findRoute('a', 'c')!
      expect(route.totalDuration).toBeCloseTo(route.totalDistance / 1.4, 5)
    })

    it('path has correct fromLabel and toLabel', () => {
      const engine = new RoutingEngine(simpleLineGraph())
      const route = engine.findRoute('a', 'c')!
      expect(route.fromLabel).toBe('Entrance')
      expect(route.toLabel).toBe('Room 101')
    })
  })

  describe('Cross-building routing', () => {
    it('routes from one building to another through road connector', () => {
      const engine = new RoutingEngine(crossBuildingGraph())
      const route = engine.findRoute('c', 'f')
      expect(route).not.toBeNull()
      // Path: c(Room 101, bld1)→b→a→... wait
      // Graph: a—b—c(bld1), b—d(road), d—e(bld2), e—f
      // Route from c to f: c → b → d → e → f
      expect(route!.path.length).toBeGreaterThanOrEqual(4)
      // Check both building IDs appear in path
      const buildingIds = new Set(route!.path.map(s => s.buildingId))
      expect(buildingIds.has('bld1')).toBe(true)
      expect(buildingIds.has('bld2')).toBe(true)
    })
  })

  describe('Large graph', () => {
    it('routes through a 12-node hub graph efficiently', () => {
      const engine = new RoutingEngine(largeGraph())
      const route = engine.findRoute('spoke-0', 'far2')
      expect(route).not.toBeNull()
      // Path should go through the hub: spoke-0 → hub → far1 → far2
      expect(route!.path[0].nodeId).toBe('spoke-0')
      expect(route!.path.some(s => s.nodeId === 'hub')).toBe(true)
      expect(route!.path[route!.path.length - 1].nodeId).toBe('far2')
    })

    it('finds all spoke-to-hub paths correctly', () => {
      const engine = new RoutingEngine(largeGraph())
      for (let i = 0; i < 10; i++) {
        const route = engine.findRoute(`spoke-${i}`, 'hub')
        expect(route).not.toBeNull()
        expect(route!.path).toHaveLength(2)  // spoke-i → hub
      }
    })
  })

  describe('Edge cases', () => {
    it('handles empty graph (no nodes)', () => {
      const engine = new RoutingEngine(makeGraph([], []))
      expect(engine.findRoute('a', 'b')).toBeNull()
    })

    it('handles single-node graph', () => {
      const engine = new RoutingEngine(makeGraph(
        [node('a', 'Solo', 'space', 121.0, 14.0)], [],
      ))
      const route = engine.findRoute('a', 'a')
      expect(route).not.toBeNull()
      expect(route!.path).toHaveLength(1)
    })

    it('returns the shortest path when multiple paths exist', () => {
      // Triangle: a—b (50), a—c (200), b—c (40)
      // Path a→c through b is 90 (50+40), direct is 200
      const graph = makeGraph(
        [node('a', 'A', 'space', 121.0, 14.0),
         node('b', 'B', 'space', 121.0005, 14.0),
         node('c', 'C', 'space', 121.001, 14.0)],
        [edge('e1', 'a', 'b', 'walk', 50, 50),
         edge('e2', 'a', 'c', 'walk', 200, 200),
         edge('e3', 'b', 'c', 'walk', 40, 40)],
      )
      const engine = new RoutingEngine(graph)
      const route = engine.findRoute('a', 'c')
      expect(route).not.toBeNull()
      // Shortest path: a→b→c (50+40=90) vs a→c (200)
      expect(route!.path.map(s => s.nodeId)).toEqual(['a', 'b', 'c'])
      expect(route!.totalDistance).toBe(90)
    })

    it('all path steps have unique node IDs (no cycles)', () => {
      const engine = new RoutingEngine(multiFloorStairsGraph())
      const route = engine.findRoute('a', 'e')!
      const ids = route.path.map(s => s.nodeId)
      expect(new Set(ids).size).toBe(ids.length)
    })
  })
})
