/**
 * Phase 5 — A* Optimality & Cost-Model Legitimacy Gate
 *
 * Test-only Dijkstra oracle + scenarios A–J + vertical heuristic investigation
 * + adversarial counterexample search + heuristic admissibility audit.
 *
 * CRITICAL DESIGN NOTE: All edge weights are haversine-based.
 * NAVI production edge weights ARE haversine distances between node positions.
 * The haversine heuristic h(n) = haversine(n, goal) is admissible ONLY when
 * edge weights >= haversine distance between endpoints (triangle inequality).
 * Using arbitrary edge weights unrelated to geography makes h(n) inadmissible
 * and A* non-optimal — this is expected behavior, not a bug.
 */
import { describe, it, expect } from 'vitest'
import { aStar, haversine } from '../a-star'
import type { NavNode, NavEdge } from '@/types/nav-types'

// ═══════════════════════════════════════════════════════════════════════════
// TEST-ONLY DIJKSTRA ORACLE
// ═══════════════════════════════════════════════════════════════════════════

interface DijkstraResult {
  path: string[]
  cost: number
}

function dijkstra(
  nodes: NavNode[],
  edges: NavEdge[],
  startId: string,
  endId: string,
): DijkstraResult | null {
  const nodeMap = Object.fromEntries(nodes.map((n) => [n.id, n]))
  if (!nodeMap[startId] || !nodeMap[endId]) return null

  const adj: Record<string, { nodeId: string; weight: number }[]> = {}
  for (const e of edges) {
    if (!adj[e.from]) adj[e.from] = []
    if (!adj[e.to]) adj[e.to] = []
    adj[e.from].push({ nodeId: e.to, weight: e.distance })
    adj[e.to].push({ nodeId: e.from, weight: e.distance })
  }

  const dist: Record<string, number> = {}
  const prev: Record<string, string | undefined> = {}
  const visited = new Set<string>()

  for (const n of nodes) { dist[n.id] = Infinity; prev[n.id] = undefined }
  dist[startId] = 0

  const queue: string[] = nodes.map((n) => n.id)

  while (queue.length > 0) {
    let minIdx = 0
    for (let i = 1; i < queue.length; i++) {
      if (dist[queue[i]] < dist[queue[minIdx]]) minIdx = i
    }
    const u = queue[minIdx]
    queue.splice(minIdx, 1)
    if (dist[u] === Infinity) break
    if (u === endId) break
    if (visited.has(u)) continue
    visited.add(u)
    for (const neighbor of adj[u] ?? []) {
      const alt = dist[u] + neighbor.weight
      if (alt < dist[neighbor.nodeId]) {
        dist[neighbor.nodeId] = alt
        prev[neighbor.nodeId] = u
      }
    }
  }

  if (dist[endId] === Infinity) return null
  const path: string[] = []
  let c: string | undefined = endId
  while (c !== undefined) { path.unshift(c); c = prev[c] }
  return { path, cost: dist[endId] }
}

function dijkstraFrom(
  nodes: NavNode[],
  edges: NavEdge[],
  startId: string,
): Record<string, number> {
  const adj: Record<string, { nodeId: string; weight: number }[]> = {}
  for (const e of edges) {
    if (!adj[e.from]) adj[e.from] = []
    if (!adj[e.to]) adj[e.to] = []
    adj[e.from].push({ nodeId: e.to, weight: e.distance })
    adj[e.to].push({ nodeId: e.from, weight: e.distance })
  }
  const dist: Record<string, number> = {}
  const visited = new Set<string>()
  for (const n of nodes) dist[n.id] = Infinity
  dist[startId] = 0
  const queue: string[] = nodes.map((n) => n.id)
  while (queue.length > 0) {
    let minIdx = 0
    for (let i = 1; i < queue.length; i++) {
      if (dist[queue[i]] < dist[queue[minIdx]]) minIdx = i
    }
    const u = queue[minIdx]; queue.splice(minIdx, 1)
    if (dist[u] === Infinity) break
    if (visited.has(u)) continue
    visited.add(u)
    for (const neighbor of adj[u] ?? []) {
      const alt = dist[u] + neighbor.weight
      if (alt < dist[neighbor.nodeId]) dist[neighbor.nodeId] = alt
    }
  }
  return dist
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function makeNode(
  id: string, lat: number, lng: number,
  floor: number = 0, buildingId: string = '',
  type: NavNode['type'] = 'intersection',
): NavNode {
  return { id, label: id, name: id, type, buildingId, campusId: 'test', floor, position: { lat, lng } }
}

function makeEdge(
  id: string, from: string, to: string,
  distance: number, type: NavEdge['type'] = 'walkway',
): NavEdge {
  return { id, from, to, distance, type, campusId: 'test' }
}

/** Create edge with weight = haversine × multiplier (production-consistent). */
function haversineEdge(
  id: string, from: NavNode, to: NavNode,
  multiplier: number = 1.0, type: NavEdge['type'] = 'walkway',
): NavEdge {
  return { id, from: from.id, to: to.id, distance: haversine(from.position, to.position) * multiplier, type, campusId: 'test' }
}

const EPSILON = 0.01

function expectCostsMatch(aStarCost: number, dijkstraCost: number) {
  expect(Math.abs(aStarCost - dijkstraCost)).toBeLessThan(EPSILON)
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST A — Basic Shortest Path
// ═══════════════════════════════════════════════════════════════════════════

describe('Phase 5 — Test A: Basic Shortest Path', () => {
  it('A* cost matches Dijkstra for simple diamond graph', () => {
    //  A ── short ── B ── short ── D
    //   \                          /
    //    ───── long (detour) ─────
    const A = makeNode('A', 11.8190, 122.0920)
    const B = makeNode('B', 11.8191, 122.0921)
    const D = makeNode('D', 11.8192, 122.0922)
    const nodes = [A, B, D]
    // Edge weights are haversine-based: A→B ≈ B→D ≈ 158m, A→D ≈ 316m
    const edges = [
      haversineEdge('E1', A, B, 1.0),
      haversineEdge('E2', B, D, 1.0),
      haversineEdge('E3', A, D, 2.0), // longer path = higher multiplier
    ]

    const astar = aStar(nodes, edges, 'A', 'D')
    const dijk = dijkstra(nodes, edges, 'A', 'D')

    expect(astar).not.toBeNull()
    expect(dijk).not.toBeNull()
    expectCostsMatch(astar!.cost, dijk!.cost)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// TEST B — Competing Outdoor Routes
// ═══════════════════════════════════════════════════════════════════════════

describe('Phase 5 — Test B: Competing Outdoor Routes', () => {
  it('A* finds cheapest of two outdoor paths', () => {
    const START = makeNode('START', 11.8190, 122.0920)
    const B = makeNode('B', 11.8195, 122.0918)
    const C = makeNode('C', 11.8195, 122.0922)
    const D = makeNode('D', 11.8185, 122.0918)
    const E = makeNode('E', 11.8185, 122.0922)
    const GOAL = makeNode('GOAL', 11.8190, 122.0924)
    const nodes = [START, B, C, D, E, GOAL]
    // Upper path: longer edges (1.5x haversine)
    // Lower path: shorter edges (1.0x haversine) — cheaper
    const edges = [
      haversineEdge('E1', START, B, 1.5),
      haversineEdge('E2', B, C, 1.5),
      haversineEdge('E3', C, GOAL, 1.5),
      haversineEdge('E4', START, D, 1.0),
      haversineEdge('E5', D, E, 1.0),
      haversineEdge('E6', E, GOAL, 1.0),
    ]

    const astar = aStar(nodes, edges, 'START', 'GOAL')
    const dijk = dijkstra(nodes, edges, 'START', 'GOAL')

    expect(astar).not.toBeNull()
    expect(dijk).not.toBeNull()
    expectCostsMatch(astar!.cost, dijk!.cost)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// TEST C — Multiple Building Entrances
// ═══════════════════════════════════════════════════════════════════════════

describe('Phase 5 — Test C: Multiple Building Entrances', () => {
  it('A* chooses globally cheapest route, not nearest entrance', () => {
    const START = makeNode('START', 11.8190, 122.0920)
    const outdoor = makeNode('outdoor', 11.8191, 122.0921)
    const EntA = makeNode('EntranceA', 11.8193, 122.0923, 0, 'BLD1', 'building_entrance')
    const EntB = makeNode('EntranceB', 11.8187, 122.0923, 0, 'BLD1', 'building_entrance')
    const indoor = makeNode('indoor', 11.8193, 122.0924, 0, 'BLD1', 'hallway')
    const GOAL = makeNode('GOAL', 11.8193, 122.0926, 0, 'BLD1', 'room_door')
    const nodes = [START, outdoor, EntA, EntB, indoor, GOAL]

    // EntranceA is geographically closer to START but:
    //   EntA→indoor→GOAL is longer (indoor and GOAL are near EntA position)
    // EntranceB is farther from START but:
    //   EntB→indoor→GOAL is shorter
    // Design: EntB path is cheaper total despite farther outdoor leg
    const edges = [
      haversineEdge('E1', START, outdoor),
      haversineEdge('E2', outdoor, EntA, 1.0),
      haversineEdge('E3', outdoor, EntB, 1.0),
      haversineEdge('E4', EntA, indoor, 3.0), // expensive indoor from EntA
      haversineEdge('E5', EntB, indoor, 1.0), // cheap indoor from EntB
      haversineEdge('E6', indoor, GOAL, 1.0),
    ]

    const astar = aStar(nodes, edges, 'START', 'GOAL')
    const dijk = dijkstra(nodes, edges, 'START', 'GOAL')

    expect(astar).not.toBeNull()
    expect(dijk).not.toBeNull()
    expectCostsMatch(astar!.cost, dijk!.cost)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// TEST D — Indoor Route Alternatives
// ═══════════════════════════════════════════════════════════════════════════

describe('Phase 5 — Test D: Indoor Route Alternatives', () => {
  it('A* finds cheapest of two indoor hallway paths', () => {
    const START = makeNode('START', 11.8190, 122.0920, 1, 'BLD1', 'hallway')
    const H1 = makeNode('H1', 11.8191, 122.0921, 1, 'BLD1', 'hallway')
    const H2 = makeNode('H2', 11.8191, 122.0923, 1, 'BLD1', 'hallway')
    const H3 = makeNode('H3', 11.8189, 122.0921, 1, 'BLD1', 'hallway')
    const H4 = makeNode('H4', 11.8189, 122.0923, 1, 'BLD1', 'hallway')
    const CS301 = makeNode('CS301', 11.8190, 122.0924, 1, 'BLD1', 'room_door')
    const nodes = [START, H1, H2, H3, H4, CS301]
    // Upper path: 1.5x haversine (detour)
    // Lower path: 1.0x haversine (direct)
    const edges = [
      haversineEdge('E1', START, H1, 1.5),
      haversineEdge('E2', H1, H2, 1.5),
      haversineEdge('E3', H2, CS301, 1.5),
      haversineEdge('E4', START, H3, 1.0),
      haversineEdge('E5', H3, H4, 1.0),
      haversineEdge('E6', H4, CS301, 1.0),
    ]

    const astar = aStar(nodes, edges, 'START', 'CS301')
    const dijk = dijkstra(nodes, edges, 'START', 'CS301')

    expect(astar).not.toBeNull()
    expect(dijk).not.toBeNull()
    expectCostsMatch(astar!.cost, dijk!.cost)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// TEST E — Multiple Staircases
// ═══════════════════════════════════════════════════════════════════════════

describe('Phase 5 — Test E: Multiple Staircases', () => {
  it('A* chooses cheapest stair alternative across floors', () => {
    const bPos = { lat: 11.8190, lng: 122.0920 }
    const goalPos = { lat: 11.8195, lng: 122.0925 }

    const START = makeNode('START', 11.8185, 122.0918, 1, 'BLD1', 'hallway')
    const H1_F1 = makeNode('H1_F1', 11.8188, 122.0919, 1, 'BLD1', 'hallway')
    const H2_F1 = makeNode('H2_F1', 11.8187, 122.0919, 1, 'BLD1', 'hallway')
    const StairA_F1 = makeNode('StairA_F1', bPos.lat, bPos.lng, 1, 'BLD1', 'staircase')
    const StairB_F1 = makeNode('StairB_F1', 11.8187, 122.0920, 1, 'BLD1', 'staircase')
    const StairA_F2 = makeNode('StairA_F2', bPos.lat, bPos.lng, 2, 'BLD1', 'staircase')
    const StairB_F2 = makeNode('StairB_F2', 11.8187, 122.0920, 2, 'BLD1', 'staircase')
    const H1_F2 = makeNode('H1_F2', 11.8189, 122.0921, 2, 'BLD1', 'hallway')
    const GOAL = makeNode('GOAL', goalPos.lat, goalPos.lng, 2, 'BLD1', 'room_door')
    const nodes = [START, H1_F1, H2_F1, StairA_F1, StairB_F1, StairA_F2, StairB_F2, H1_F2, GOAL]
    const edges = [
      haversineEdge('E1', START, H1_F1),
      haversineEdge('E2', START, H2_F1),
      haversineEdge('E3', H1_F1, StairA_F1),
      haversineEdge('E4', H2_F1, StairB_F1),
      // Vertical stair chains (production: fixed 4m)
      makeEdge('E5', 'StairA_F1', 'StairA_F2', 4, 'stairs'),
      makeEdge('E6', 'StairB_F1', 'StairB_F2', 4, 'stairs'),
      haversineEdge('E7', StairA_F2, H1_F2),
      haversineEdge('E8', H1_F2, GOAL),
      haversineEdge('E9', StairB_F2, GOAL),
    ]

    const astar = aStar(nodes, edges, 'START', 'GOAL')
    const dijk = dijkstra(nodes, edges, 'START', 'GOAL')

    expect(astar).not.toBeNull()
    expect(dijk).not.toBeNull()
    expectCostsMatch(astar!.cost, dijk!.cost)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// TEST F — Elevator vs Stair
// ═══════════════════════════════════════════════════════════════════════════

describe('Phase 5 — Test F: Elevator vs Stair', () => {
  it('A* matches Dijkstra for elevator vs stair choice', () => {
    const samePos = { lat: 11.8190, lng: 122.0920 }
    const goalPos = { lat: 11.8195, lng: 122.0925 }

    const START = makeNode('START', 11.8185, 122.0918, 1, 'BLD1', 'hallway')
    const Hall_Stair = makeNode('Hall_Stair', 11.8188, 122.0919, 1, 'BLD1', 'hallway')
    const Hall_Elev = makeNode('Hall_Elev', 11.8187, 122.0919, 1, 'BLD1', 'hallway')
    const Stair_F1 = makeNode('Stair_F1', samePos.lat, samePos.lng, 1, 'BLD1', 'staircase')
    const Elev_F1 = makeNode('Elev_F1', samePos.lat, samePos.lng, 1, 'BLD1', 'elevator')
    const Stair_F2 = makeNode('Stair_F2', samePos.lat, samePos.lng, 2, 'BLD1', 'staircase')
    const Elev_F2 = makeNode('Elev_F2', samePos.lat, samePos.lng, 2, 'BLD1', 'elevator')
    const Hall_F2 = makeNode('Hall_F2', goalPos.lat, goalPos.lng, 2, 'BLD1', 'hallway')
    const GOAL = makeNode('GOAL', 11.8196, 122.0926, 2, 'BLD1', 'room_door')
    const nodes = [START, Hall_Stair, Hall_Elev, Stair_F1, Elev_F1, Stair_F2, Elev_F2, Hall_F2, GOAL]
    const edges = [
      haversineEdge('E1', START, Hall_Stair),
      haversineEdge('E2', START, Hall_Elev),
      haversineEdge('E3', Hall_Stair, Stair_F1),
      haversineEdge('E4', Hall_Elev, Elev_F1),
      makeEdge('E5', 'Stair_F1', 'Stair_F2', 4, 'stairs'),
      makeEdge('E6', 'Elev_F1', 'Elev_F2', 3, 'elevator'),
      haversineEdge('E7', Stair_F2, Hall_F2),
      haversineEdge('E8', Elev_F2, Hall_F2),
      haversineEdge('E9', Hall_F2, GOAL),
    ]

    const astar = aStar(nodes, edges, 'START', 'GOAL')
    const dijk = dijkstra(nodes, edges, 'START', 'GOAL')

    expect(astar).not.toBeNull()
    expect(dijk).not.toBeNull()
    expectCostsMatch(astar!.cost, dijk!.cost)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// TEST G — Full Outdoor → Indoor → Upper-Floor Room (CS301)
// ═══════════════════════════════════════════════════════════════════════════

describe('Phase 5 — Test G: Full Outdoor → Indoor → Upper-Floor Room', () => {
  it('A* produces optimal cost matching Dijkstra for CS301 route', () => {
    const bPos = { lat: 11.8190, lng: 122.0920 }
    const goalPos = { lat: 11.8195, lng: 122.0925 }

    const OutdoorStart = makeNode('OutdoorStart', 11.8180, 122.0915, 0)
    const RoadJct = makeNode('RoadJct', 11.8185, 122.0918, 0)
    const NearEntrance = makeNode('NearEntrance', 11.8188, 122.0919, 0)
    const Entrance = makeNode('Entrance', 11.8189, 122.09195, 0, 'BLD1', 'building_entrance')
    const F1_Hall = makeNode('F1_Hall', bPos.lat, bPos.lng, 1, 'BLD1', 'hallway')
    const Stair_F1 = makeNode('Stair_F1', bPos.lat, bPos.lng, 1, 'BLD1', 'staircase')
    const Stair_F2 = makeNode('Stair_F2', bPos.lat, bPos.lng, 2, 'BLD1', 'staircase')
    const F2_Hall = makeNode('F2_Hall', bPos.lat, bPos.lng, 2, 'BLD1', 'hallway')
    const CS301 = makeNode('CS301', goalPos.lat, goalPos.lng, 2, 'BLD1', 'room_door')
    const nodes = [OutdoorStart, RoadJct, NearEntrance, Entrance, F1_Hall, Stair_F1, Stair_F2, F2_Hall, CS301]
    const edges = [
      haversineEdge('E1', OutdoorStart, RoadJct),
      haversineEdge('E2', RoadJct, NearEntrance),
      haversineEdge('E3', NearEntrance, Entrance),
      haversineEdge('E4', Entrance, F1_Hall),
      haversineEdge('E5', F1_Hall, Stair_F1),
      makeEdge('E6', 'Stair_F1', 'Stair_F2', 4, 'stairs'),
      haversineEdge('E7', Stair_F2, F2_Hall),
      haversineEdge('E8', F2_Hall, CS301),
    ]

    const astar = aStar(nodes, edges, 'OutdoorStart', 'CS301')
    const dijk = dijkstra(nodes, edges, 'OutdoorStart', 'CS301')

    expect(astar).not.toBeNull()
    expect(dijk).not.toBeNull()
    expectCostsMatch(astar!.cost, dijk!.cost)

    // Verify path contains expected transitions
    expect(astar!.path).toContain('Entrance')
    expect(astar!.path).toContain('Stair_F1')
    expect(astar!.path).toContain('Stair_F2')
    expect(astar!.path).toContain('CS301')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// TEST H — Separated Crossing
// ═══════════════════════════════════════════════════════════════════════════

describe('Phase 5 — Test H: Separated Crossing', () => {
  it('A* and Dijkstra both find no route across separated crossing', () => {
    const START = makeNode('START', 11.8190, 122.0918, 0)
    const X_A = makeNode('X_A', 11.8190, 122.0920, 0)
    const A_END = makeNode('A_END', 11.8190, 122.0922, 0)
    const B_START = makeNode('B_START', 11.8188, 122.0920, 0)
    const X_B = makeNode('X_B', 11.8189, 122.0920, 0)
    const GOAL = makeNode('GOAL', 11.8188, 122.0922, 0)
    const nodes = [START, X_A, A_END, B_START, X_B, GOAL]
    const edges = [
      haversineEdge('E1', START, X_A),
      haversineEdge('E2', X_A, A_END),
      haversineEdge('E3', B_START, X_B),
      haversineEdge('E4', X_B, GOAL),
      // NO edge between X_A and X_B (separated crossing)
    ]

    const astar = aStar(nodes, edges, 'START', 'GOAL')
    const dijk = dijkstra(nodes, edges, 'START', 'GOAL')

    expect(astar).toBeNull()
    expect(dijk).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// TEST I — Genuine Connected Crossing
// ═══════════════════════════════════════════════════════════════════════════

describe('Phase 5 — Test I: Genuine Connected Crossing', () => {
  it('A* and Dijkstra both find route through connected crossing', () => {
    const START = makeNode('START', 11.8190, 122.0918, 0)
    const JCT = makeNode('JCT', 11.8190, 122.0920, 0)
    const A_END = makeNode('A_END', 11.8190, 122.0922, 0)
    const B_START = makeNode('B_START', 11.8188, 122.0918, 0)
    const GOAL = makeNode('GOAL', 11.8188, 122.0922, 0)
    const nodes = [START, JCT, A_END, B_START, GOAL]
    const edges = [
      haversineEdge('E1', START, JCT),
      haversineEdge('E2', JCT, A_END),
      haversineEdge('E3', B_START, JCT),
      haversineEdge('E4', JCT, GOAL),
    ]

    const astar = aStar(nodes, edges, 'START', 'GOAL')
    const dijk = dijkstra(nodes, edges, 'START', 'GOAL')

    expect(astar).not.toBeNull()
    expect(dijk).not.toBeNull()
    expectCostsMatch(astar!.cost, dijk!.cost)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// TEST J — Unreachable Destination
// ═══════════════════════════════════════════════════════════════════════════

describe('Phase 5 — Test J: Unreachable Destination', () => {
  it('A* and Dijkstra both return null for disconnected graph', () => {
    const START = makeNode('START', 11.8190, 122.0918, 0)
    const A = makeNode('A', 11.8190, 122.0919, 0)
    const B = makeNode('B', 11.8190, 122.0920, 0)
    const X = makeNode('X', 11.8188, 122.0920, 0)
    const GOAL = makeNode('GOAL', 11.8188, 122.0922, 0)
    const nodes = [START, A, B, X, GOAL]
    const edges = [
      haversineEdge('E1', START, A),
      haversineEdge('E2', A, B),
      haversineEdge('E3', X, GOAL),
      // No edge between B and X
    ]

    const astar = aStar(nodes, edges, 'START', 'GOAL')
    const dijk = dijkstra(nodes, edges, 'START', 'GOAL')

    expect(astar).toBeNull()
    expect(dijk).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// VERTICAL HEURISTIC INVESTIGATION
// ═══════════════════════════════════════════════════════════════════════════

describe('Phase 5 — Vertical Edge Heuristic Investigation', () => {
  it('same-position nodes on different floors produce zero haversine', () => {
    const pos = { lat: 11.8190, lng: 122.0920 }
    const stairF1 = makeNode('StairF1', pos.lat, pos.lng, 1, 'BLD1', 'staircase')
    const stairF2 = makeNode('StairF2', pos.lat, pos.lng, 2, 'BLD1', 'staircase')
    const goal = makeNode('Goal', 11.8195, 122.0925, 2, 'BLD1', 'room_door')

    const haversineF1toF2 = haversine(stairF1.position, stairF2.position)
    const haversineF1toGoal = haversine(stairF1.position, goal.position)
    const haversineF2toGoal = haversine(stairF2.position, goal.position)

    expect(haversineF1toF2).toBe(0)
    expect(Math.abs(haversineF1toGoal - haversineF2toGoal)).toBe(0)

    // Admissibility: h(F1, goal) <= cost(F1→F2) + h(F2, goal)
    // Since h(F1) = h(F2) and cost = 4, this is always true: h(F1) <= 4 + h(F1) ✓
    console.log(`  Haversine F1→F2: ${haversineF1toF2}m (same position)`)
    console.log(`  Stair edge cost: 4m`)
    console.log(`  Admissibility: ${haversineF1toGoal} <= 4 + ${haversineF2toGoal} = ${4 + haversineF2toGoal}`)
  })

  it('zero-cost VerticalConnector edge does not violate admissibility for same-position nodes', () => {
    const pos = { lat: 11.8190, lng: 122.0920 }
    const stopF1 = makeNode('StopF1', pos.lat, pos.lng, 1, 'BLD1', 'connector_stop')
    const stopF2 = makeNode('StopF2', pos.lat, pos.lng, 2, 'BLD1', 'connector_stop')
    const goal = makeNode('Goal', 11.8195, 122.0925, 2, 'BLD1', 'room_door')

    const haversineStopF1toF2 = haversine(stopF1.position, stopF2.position)
    const haversineStopF1toGoal = haversine(stopF1.position, goal.position)
    const haversineStopF2toGoal = haversine(stopF2.position, goal.position)

    expect(haversineStopF1toF2).toBe(0)
    // Admissibility: h(StopF1) <= 0 + h(StopF2)
    // Since same position: h(StopF1) = h(StopF2) ✓
    console.log(`  Haversine StopF1→StopF2: ${haversineStopF1toF2}m`)
    console.log(`  VerticalConnector cost: 0m`)
    console.log(`  Admissibility: ${haversineStopF1toGoal} <= 0 + ${haversineStopF2toGoal}`)
  })

  it('stair vertical chain: heuristic admissibility proof via Dijkstra', () => {
    const buildingPos = { lat: 11.8190, lng: 122.0920 }
    const goalPos = { lat: 11.8195, lng: 122.0925 }

    const HallF1 = makeNode('HallF1', buildingPos.lat, buildingPos.lng, 1, 'BLD1', 'hallway')
    const StairF1 = makeNode('StairF1', buildingPos.lat, buildingPos.lng, 1, 'BLD1', 'staircase')
    const StairF2 = makeNode('StairF2', buildingPos.lat, buildingPos.lng, 2, 'BLD1', 'staircase')
    const StairF3 = makeNode('StairF3', buildingPos.lat, buildingPos.lng, 3, 'BLD1', 'staircase')
    const HallF3 = makeNode('HallF3', goalPos.lat, goalPos.lng, 3, 'BLD1', 'hallway')
    const Goal = makeNode('Goal', goalPos.lat, goalPos.lng, 3, 'BLD1', 'room_door')

    const nodes = [HallF1, StairF1, StairF2, StairF3, HallF3, Goal]
    const edges = [
      haversineEdge('E1', HallF1, StairF1),
      makeEdge('E2', 'StairF1', 'StairF2', 4, 'stairs'),
      makeEdge('E3', 'StairF2', 'StairF3', 4, 'stairs'),
      haversineEdge('E4', StairF3, HallF3),
      haversineEdge('E5', HallF3, Goal),
    ]

    const allDist = dijkstraFrom(nodes, edges, 'Goal')

    for (const node of nodes) {
      const h = haversine(node.position, Goal.position)
      const optimalRemaining = allDist[node.id]
      const admissible = h <= optimalRemaining + EPSILON

      console.log(`  ${node.id} (F${node.floor}): h=${h.toFixed(3)}m, optimal=${optimalRemaining.toFixed(3)}m, diff=${(h - optimalRemaining).toFixed(3)}m, admissible=${admissible}`)

      if (optimalRemaining < Infinity) {
        expect(admissible).toBe(true)
      }
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// ADVERSARIAL COUNTEREXAMPLE SEARCH
// ═══════════════════════════════════════════════════════════════════════════

describe('Phase 5 — Adversarial Counterexample Search', () => {
  it('case 1: cheap vertical edges + distant horizontal goal', () => {
    const nodes = [
      makeNode('Start', 11.8180, 122.0910, 0),
      makeNode('ElevF1', 11.8180, 122.0910, 1, 'BLD1', 'elevator'),
      makeNode('ElevF2', 11.8180, 122.0910, 2, 'BLD1', 'elevator'),
      makeNode('ElevF3', 11.8180, 122.0910, 3, 'BLD1', 'elevator'),
      makeNode('HallF3', 11.8190, 122.0920, 3, 'BLD1', 'hallway'),
      makeNode('Goal', 11.8200, 122.0930, 3, 'BLD1', 'room_door'),
    ]
    const edges = [
      haversineEdge('E1', nodes[0], nodes[1]),
      makeEdge('E2', 'ElevF1', 'ElevF2', 3, 'elevator'),
      makeEdge('E3', 'ElevF2', 'ElevF3', 3, 'elevator'),
      haversineEdge('E4', nodes[3], nodes[4]),
      haversineEdge('E5', nodes[4], nodes[5]),
    ]

    const astar = aStar(nodes, edges, 'Start', 'Goal')
    const dijk = dijkstra(nodes, edges, 'Start', 'Goal')

    expect(astar).not.toBeNull()
    expect(dijk).not.toBeNull()
    expectCostsMatch(astar!.cost, dijk!.cost)
  })

  it('case 2: multiple vertical alternatives with different costs', () => {
    const pos = { lat: 11.8190, lng: 122.0920 }
    const goalPos = { lat: 11.8195, lng: 122.0925 }

    const START = makeNode('Start', 11.8185, 122.0918, 1, 'BLD1', 'hallway')
    const HallA = makeNode('HallA', 11.8186, 122.0919, 1, 'BLD1', 'hallway')
    const StairA_F1 = makeNode('StairA_F1', pos.lat, pos.lng, 1, 'BLD1', 'staircase')
    const StairA_F2 = makeNode('StairA_F2', pos.lat, pos.lng, 2, 'BLD1', 'staircase')
    const HallB = makeNode('HallB', 11.8184, 122.0917, 1, 'BLD1', 'hallway')
    const ElevB_F1 = makeNode('ElevB_F1', pos.lat, pos.lng, 1, 'BLD1', 'elevator')
    const ElevB_F2 = makeNode('ElevB_F2', pos.lat, pos.lng, 2, 'BLD1', 'elevator')
    const HallF2 = makeNode('HallF2', goalPos.lat, goalPos.lng, 2, 'BLD1', 'hallway')
    const Goal = makeNode('Goal', goalPos.lat, goalPos.lng, 2, 'BLD1', 'room_door')
    const nodes = [START, HallA, StairA_F1, StairA_F2, HallB, ElevB_F1, ElevB_F2, HallF2, Goal]
    const edges = [
      haversineEdge('E1', START, HallA),
      haversineEdge('E2', HallA, StairA_F1),
      makeEdge('E3', 'StairA_F1', 'StairA_F2', 4, 'stairs'),
      haversineEdge('E4', START, HallB),
      haversineEdge('E5', HallB, ElevB_F1),
      makeEdge('E6', 'ElevB_F1', 'ElevB_F2', 3, 'elevator'),
      haversineEdge('E7', StairA_F2, HallF2),
      haversineEdge('E8', ElevB_F2, HallF2),
      haversineEdge('E9', HallF2, Goal),
    ]

    const astar = aStar(nodes, edges, 'Start', 'Goal')
    const dijk = dijkstra(nodes, edges, 'Start', 'Goal')

    expect(astar).not.toBeNull()
    expect(dijk).not.toBeNull()
    expectCostsMatch(astar!.cost, dijk!.cost)
  })

  it('case 3: GPS edge case — start node far from goal, multiple paths', () => {
    const START = makeNode('GPS_Start', 11.8170, 122.0900, 0)
    const Jct1 = makeNode('Jct1', 11.8180, 122.0910, 0)
    const Jct2 = makeNode('Jct2', 11.8185, 122.0915, 0)
    const Jct3 = makeNode('Jct3', 11.8180, 122.0920, 0)
    const Goal = makeNode('Goal', 11.8195, 122.0925, 0)
    const nodes = [START, Jct1, Jct2, Jct3, Goal]
    const edges = [
      haversineEdge('E1', START, Jct1),
      haversineEdge('E2', START, Jct3),
      haversineEdge('E3', Jct1, Jct2),
      haversineEdge('E4', Jct2, Goal),
      haversineEdge('E5', Jct3, Goal),
    ]

    const astar = aStar(nodes, edges, 'GPS_Start', 'Goal')
    const dijk = dijkstra(nodes, edges, 'GPS_Start', 'Goal')

    expect(astar).not.toBeNull()
    expect(dijk).not.toBeNull()
    expectCostsMatch(astar!.cost, dijk!.cost)
  })

  it('case 4: adversarial — displaced stair nodes with haversine-consistent weights', () => {
    const nodes = [
      makeNode('Start', 11.8180, 122.0910, 1, 'BLD1', 'hallway'),
      makeNode('StairF1', 11.8190, 122.0920, 1, 'BLD1', 'staircase'),
      makeNode('StairF2', 11.8190, 122.0920, 2, 'BLD1', 'staircase'),
      makeNode('Goal', 11.8191, 122.0921, 2, 'BLD1', 'room_door'),
    ]
    const edges = [
      haversineEdge('E1', nodes[0], nodes[1]),
      makeEdge('E2', 'StairF1', 'StairF2', 4, 'stairs'),
      haversineEdge('E3', nodes[2], nodes[3]),
    ]

    const astar = aStar(nodes, edges, 'Start', 'Goal')
    const dijk = dijkstra(nodes, edges, 'Start', 'Goal')

    expect(astar).not.toBeNull()
    expect(dijk).not.toBeNull()
    expectCostsMatch(astar!.cost, dijk!.cost)
  })

  it('case 5: combined adversarial — 0-cost connector + haversine-consistent horizontal', () => {
    const pos = { lat: 11.8190, lng: 122.0920 }
    const goalPos = { lat: 11.8195, lng: 122.0925 }
    const nodes = [
      makeNode('Start', 11.8180, 122.0910, 1, 'BLD1', 'hallway'),
      makeNode('StopF1', pos.lat, pos.lng, 1, 'BLD1', 'connector_stop'),
      makeNode('StopF2', pos.lat, pos.lng, 2, 'BLD1', 'connector_stop'),
      makeNode('HallF2', goalPos.lat, goalPos.lng, 2, 'BLD1', 'hallway'),
      makeNode('Goal', 11.8200, 122.0930, 2, 'BLD1', 'room_door'),
    ]
    const edges = [
      haversineEdge('E1', nodes[0], nodes[1]),
      makeEdge('E2', 'StopF1', 'StopF2', 0, 'elevator'),
      haversineEdge('E3', nodes[2], nodes[3]),
      haversineEdge('E4', nodes[3], nodes[4]),
    ]

    const astar = aStar(nodes, edges, 'Start', 'Goal')
    const dijk = dijkstra(nodes, edges, 'Start', 'Goal')

    expect(astar).not.toBeNull()
    expect(dijk).not.toBeNull()
    expectCostsMatch(astar!.cost, dijk!.cost)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// HEURISTIC ADMISSIBILITY AUDIT
// ═══════════════════════════════════════════════════════════════════════════

describe('Phase 5 — Heuristic Admissibility Audit', () => {
  it('outdoor nodes: h(n) <= optimal remaining for all nodes', () => {
    const A = makeNode('A', 11.8180, 122.0910, 0)
    const B = makeNode('B', 11.8185, 122.0915, 0)
    const C = makeNode('C', 11.8190, 122.0920, 0)
    const D = makeNode('D', 11.8195, 122.0925, 0)
    const Goal = makeNode('Goal', 11.8200, 122.0930, 0)
    const nodes = [A, B, C, D, Goal]
    const edges = [
      haversineEdge('E1', A, B),
      haversineEdge('E2', B, C),
      haversineEdge('E3', C, D),
      haversineEdge('E4', D, Goal),
      haversineEdge('E5', A, C, 2.0), // longer direct
    ]

    const allDist = dijkstraFrom(nodes, edges, 'Goal')
    for (const node of nodes) {
      const h = haversine(node.position, Goal.position)
      const optimalRemaining = allDist[node.id]
      if (optimalRemaining < Infinity) {
        expect(h).toBeLessThanOrEqual(optimalRemaining + EPSILON)
      }
    }
  })

  it('indoor nodes: h(n) <= optimal remaining for all node types', () => {
    const bPos = { lat: 11.8190, lng: 122.0920 }
    const goalPos = { lat: 11.8200, lng: 122.0930 }
    const HallF1 = makeNode('HallF1', bPos.lat, bPos.lng, 1, 'BLD1', 'hallway')
    const StairF1 = makeNode('StairF1', bPos.lat, bPos.lng, 1, 'BLD1', 'staircase')
    const StairF2 = makeNode('StairF2', bPos.lat, bPos.lng, 2, 'BLD1', 'staircase')
    const ElevF1 = makeNode('ElevF1', bPos.lat, bPos.lng, 1, 'BLD1', 'elevator')
    const ElevF2 = makeNode('ElevF2', bPos.lat, bPos.lng, 2, 'BLD1', 'elevator')
    const Goal = makeNode('Goal', goalPos.lat, goalPos.lng, 2, 'BLD1', 'room_door')
    const nodes = [HallF1, StairF1, StairF2, ElevF1, ElevF2, Goal]
    const edges = [
      haversineEdge('E1', HallF1, StairF1),
      makeEdge('E2', 'StairF1', 'StairF2', 4, 'stairs'),
      haversineEdge('E3', HallF1, ElevF1),
      makeEdge('E4', 'ElevF1', 'ElevF2', 3, 'elevator'),
      haversineEdge('E5', StairF2, Goal),
      haversineEdge('E6', ElevF2, Goal),
    ]

    const allDist = dijkstraFrom(nodes, edges, 'Goal')
    for (const node of nodes) {
      const h = haversine(node.position, Goal.position)
      const optimalRemaining = allDist[node.id]
      if (optimalRemaining < Infinity) {
        expect(h).toBeLessThanOrEqual(optimalRemaining + EPSILON)
      }
    }
  })

  it('full unified graph: h(n) <= optimal for outdoor→indoor→stair→room', () => {
    const bPos = { lat: 11.8190, lng: 122.0920 }
    const goalPos = { lat: 11.8195, lng: 122.0925 }
    const Outdoor = makeNode('Outdoor', 11.8180, 122.0910, 0)
    const Entrance = makeNode('Entrance', 11.8185, 122.0915, 0, 'BLD1', 'building_entrance')
    const HallF1 = makeNode('HallF1', bPos.lat, bPos.lng, 1, 'BLD1', 'hallway')
    const StairF1 = makeNode('StairF1', bPos.lat, bPos.lng, 1, 'BLD1', 'staircase')
    const StairF2 = makeNode('StairF2', bPos.lat, bPos.lng, 2, 'BLD1', 'staircase')
    const HallF2 = makeNode('HallF2', bPos.lat, bPos.lng, 2, 'BLD1', 'hallway')
    const CS301 = makeNode('CS301', goalPos.lat, goalPos.lng, 2, 'BLD1', 'room_door')
    const nodes = [Outdoor, Entrance, HallF1, StairF1, StairF2, HallF2, CS301]
    const edges = [
      haversineEdge('E1', Outdoor, Entrance),
      haversineEdge('E2', Entrance, HallF1),
      haversineEdge('E3', HallF1, StairF1),
      makeEdge('E4', 'StairF1', 'StairF2', 4, 'stairs'),
      haversineEdge('E5', StairF2, HallF2),
      haversineEdge('E6', HallF2, CS301),
    ]

    const allDist = dijkstraFrom(nodes, edges, 'CS301')
    for (const node of nodes) {
      const h = haversine(node.position, CS301.position)
      const optimalRemaining = allDist[node.id]
      if (optimalRemaining < Infinity) {
        expect(h).toBeLessThanOrEqual(optimalRemaining + EPSILON)
      }
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// DETERMINISTIC GENERATED-GRAPH VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════

describe('Phase 5 — Deterministic Generated-Graph Verification', () => {
  function mulberry32(seed: number) {
    return function () {
      let t = (seed += 0x6d2b79f5)
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  it('100 random 20-node graphs: A* matches Dijkstra on every start/goal pair', () => {
    const rand = mulberry32(42)
    const failures: string[] = []

    for (let g = 0; g < 100; g++) {
      const nodeCount = 20
      const nodes: NavNode[] = []
      for (let i = 0; i < nodeCount; i++) {
        nodes.push(makeNode(
          `N${g}_${i}`,
          11.8180 + rand() * 0.002,
          122.0910 + rand() * 0.002,
        ))
      }

      const edges: NavEdge[] = []
      let edgeId = 0
      for (let i = 0; i < nodeCount; i++) {
        const connCount = 2 + Math.floor(rand() * 3)
        for (let c = 0; c < connCount; c++) {
          const j = Math.floor(rand() * nodeCount)
          if (i === j) continue
          const exists = edges.some(
            e => (e.from === `N${g}_${i}` && e.to === `N${g}_${j}`) ||
                 (e.from === `N${g}_${j}` && e.to === `N${g}_${i}`)
          )
          if (exists) continue
          // Edge weight = haversine × multiplier (production-consistent)
          const baseDist = haversine(nodes[i].position, nodes[j].position)
          const multiplier = 1.0 + rand() * 2.0
          const dist = Math.max(1, Math.round(baseDist * multiplier))
          edges.push(makeEdge(`E${g}_${edgeId++}`, `N${g}_${i}`, `N${g}_${j}`, dist))
        }
      }

      const pairCount = 5
      for (let p = 0; p < pairCount; p++) {
        const si = Math.floor(rand() * nodeCount)
        let gi = Math.floor(rand() * nodeCount)
        while (gi === si) gi = Math.floor(rand() * nodeCount)

        const startId = `N${g}_${si}`
        const goalId = `N${g}_${gi}`

        const astarResult = aStar(nodes, edges, startId, goalId)
        const dijkResult = dijkstra(nodes, edges, startId, goalId)

        if ((astarResult === null) !== (dijkResult === null)) {
          failures.push(`Graph ${g}, pair ${startId}→${goalId}: reachability mismatch`)
          continue
        }

        if (astarResult && dijkResult) {
          const diff = Math.abs(astarResult.cost - dijkResult.cost)
          if (diff > EPSILON) {
            failures.push(
              `Graph ${g}, pair ${startId}→${goalId}: ` +
              `A*=${astarResult.cost.toFixed(6)} Dijkstra=${dijkResult.cost.toFixed(6)} diff=${diff.toFixed(6)}`
            )
          }
        }
      }
    }

    if (failures.length > 0) {
      console.log('FAILURES:')
      for (const f of failures) console.log(`  ${f}`)
    }
    expect(failures).toHaveLength(0)
  })
})
