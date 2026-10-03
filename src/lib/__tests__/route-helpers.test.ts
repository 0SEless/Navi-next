import { describe, it, expect } from 'vitest'
import { buildNavRoute, computeRouteProgress, computeSegments } from '../nav-route-helpers'
import { findNavRoute } from '../findRoute'
import type { NavNode, NavEdge, PathResult } from '../../types/nav-types'
import type { NavRoute } from '../../types/route-types'

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeNode(overrides: Partial<NavNode> & { id: string }): NavNode {
  return {
    label: overrides.id,
    name: overrides.id,
    position: { lat: 11.82, lng: 122.168 },
    floor: 0,
    buildingId: 'b1',
    campusId: 'test',
    type: 'walkway',
    ...overrides,
  }
}

function makeEdge(from: string, to: string, type: NavEdge['type'] = 'walkway'): NavEdge {
  return { id: `${from}-${to}`, from, to, distance: 50, type }
}

const nodes: NavNode[] = [
  makeNode({ id: 'A', type: 'outdoor', position: { lat: 11.82, lng: 122.168 }, buildingId: '' }),
  makeNode({ id: 'B', type: 'entrance', position: { lat: 11.821, lng: 122.168 }, floor: 0 }),
  makeNode({ id: 'C', type: 'stair', position: { lat: 11.822, lng: 122.168 }, floor: 0 }),
  makeNode({ id: 'D', type: 'room', position: { lat: 11.823, lng: 122.168 }, floor: 1 }),
]

const edges: NavEdge[] = [
  makeEdge('A', 'B', 'walkway'),
  makeEdge('B', 'C', 'walkway'),
  makeEdge('C', 'D', 'stair'),
]

const pathResult: PathResult = {
  path: ['A', 'B', 'C', 'D'],
  cost: 300,
  steps: [
    { nodeId: 'A', instruction: 'Start', distance: 100 },
    { nodeId: 'B', instruction: 'Enter building', distance: 100 },
    { nodeId: 'C', instruction: 'Take stairs up', distance: 50 },
    { nodeId: 'D', instruction: 'Destination reached', distance: 50 },
  ],
}

// ---------------------------------------------------------------------------
// buildNavRoute
// ---------------------------------------------------------------------------

describe('buildNavRoute', () => {
  it('returns null for empty path', () => {
    const result = buildNavRoute({ path: [], cost: 0, steps: [] }, [], [])
    expect(result).toBeNull()
  })

  it('returns null when start/end nodes missing', () => {
    const result = buildNavRoute(pathResult, [nodes[1], nodes[2]], edges)
    expect(result).toBeNull()
  })

  it('enriches steps with floor/position/type from node map', () => {
    const route = buildNavRoute(pathResult, nodes, edges)!
    expect(route).not.toBeNull()
    expect(route.steps).toHaveLength(4)

    expect(route.steps[0]).toMatchObject({
      nodeId: 'A',
      label: 'A',
      position: { lat: 11.82, lng: 122.168 },
      floor: 0,
      type: 'walk',
    })

    expect(route.steps[1]).toMatchObject({
      nodeId: 'B',
      type: 'entrance',
    })

    expect(route.steps[2]).toMatchObject({
      nodeId: 'C',
      type: 'stairs',
    })

    expect(route.steps[3]).toMatchObject({
      nodeId: 'D',
      type: 'walk',
      floor: 1,
    })
  })

  it('detects door step type from incoming edge', () => {
    const roomNodes = [
      makeNode({ id: 'A', type: 'room', position: { lat: 11.82, lng: 122.168 }, buildingId: 'b1' }),
      makeNode({ id: 'B', type: 'room', position: { lat: 11.821, lng: 122.168 }, buildingId: 'b1' }),
    ]
    const doorEdges = [makeEdge('A', 'B', 'door')]
    const route = buildNavRoute(
      { path: ['A', 'B'], cost: 10, steps: [{ nodeId: 'A', instruction: 'Go', distance: 5 }, { nodeId: 'B', instruction: 'Arrive', distance: 5 }] },
      roomNodes,
      doorEdges,
    )!
    expect(route.steps[1].type).toBe('door')
  })

  it('types instructions from node/edge types', () => {
    const route = buildNavRoute(pathResult, nodes, edges)!
    expect(route.instructions[0].type).toBe('walk')     // A → walk
    expect(route.instructions[1].type).toBe('walk')      // B → entrance, but instruction type = walk
    expect(route.instructions[2].type).toBe('stairs')    // C → stair
    expect(route.instructions[3].type).toBe('arrive')    // D → last = arrive
  })

  it('computes nodeFloors as distinct floors, numeric descending', () => {
    const route = buildNavRoute(pathResult, nodes, edges)!
    expect(route.nodeFloors).toEqual([1, 0]) // descending
  })

  it('computes arrival with destination node info', () => {
    const route = buildNavRoute(pathResult, nodes, edges)!
    expect(route.arrival).toMatchObject({
      nodeId: 'D',
      label: 'D',
      position: { lat: 11.823, lng: 122.168 },
      remainingDistance: 0,
    })
  })

  it('preserves legacy path array', () => {
    const route = buildNavRoute(pathResult, nodes, edges)!
    expect(route.path).toEqual(['A', 'B', 'C', 'D'])
  })

  it('sets fromLabel/toLabel from start/end nodes', () => {
    const route = buildNavRoute(pathResult, nodes, edges)!
    expect(route.fromLabel).toBe('A')
    expect(route.toLabel).toBe('D')
  })

  it('keeps the selected edge type when a blocked parallel door appears later', () => {
    const routeNodes = [
      makeNode({ id: 'P1', type: 'outdoor', buildingId: '' }),
      makeNode({ id: 'P2', type: 'walkway', buildingId: '' }),
      makeNode({ id: 'P3', type: 'outdoor', buildingId: '' }),
    ]
    const routeEdges: NavEdge[] = [
      { id: 'selected-walk', from: 'P1', to: 'P2', distance: 20, weight: 20, type: 'walkway' },
      { id: 'blocked-door', from: 'P1', to: 'P2', distance: 5, weight: 5, type: 'door',
        routing: {
          sourceRoadId: 'blocked-door-road',
          authoredOrientation: 'forward',
          authored: { walkable: false },
        } },
      { id: 'finish', from: 'P2', to: 'P3', distance: 10, weight: 10, type: 'walkway' },
    ]

    const route = findNavRoute(routeNodes, routeEdges, 'P1', 'P3')!

    expect(route.totalDistance).toBe(30)
    expect(route.steps[1].type).toBe('walk')
    expect(route.instructions[1].type).toBe('walk')
  })
})

// ---------------------------------------------------------------------------
// computeRouteProgress
// ---------------------------------------------------------------------------

describe('computeRouteProgress', () => {
  const route = buildNavRoute(pathResult, nodes, edges)!

  it('returns zero index for empty route', () => {
    const emptyRoute: NavRoute = {
      path: [], steps: [], instructions: [], totalDistance: 0, totalDuration: 0,
      fromLabel: '', toLabel: '', arrival: { nodeId: '', label: '', position: { lat: 0, lng: 0 }, remainingDistance: 0 },
      nodeFloors: [],
    }
    const result = computeRouteProgress(emptyRoute, { lat: 11.82, lng: 122.168 })
    expect(result.index).toBe(0)
    expect(result.currentSegment).toBe('outdoor')
  })

  it('snaps position to nearest point on route polyline', () => {
    // Position directly between A (11.82) and B (11.821)
    const pos = { lat: 11.8205, lng: 122.168 }
    const result = computeRouteProgress(route, pos)
    expect(result.snappedPosition.lat).toBeCloseTo(11.8205, 4)
    expect(result.index).toBe(0) // between step 0 and step 1
  })

  it('computes remaining distance from snapped position', () => {
    // Position at node B (11.821)
    const pos = { lat: 11.821, lng: 122.168 }
    const result = computeRouteProgress(route, pos)
    expect(result.remainingDistance).toBeGreaterThan(0)
    expect(result.remainingDistance).toBeLessThan(route.totalDistance)
  })

  it('returns near-zero remaining distance at destination', () => {
    const pos = { lat: 11.823, lng: 122.168 } // node D
    const result = computeRouteProgress(route, pos)
    expect(result.remainingDistance).toBeLessThan(1) // < 1 meter
  })

  it('derives segment type from the current step', () => {
    // Position at entrance node B
    const pos = { lat: 11.821, lng: 122.168 }
    const result = computeRouteProgress(route, pos)
    expect(result.currentSegment).toBe('entrance')
  })

  it('returns floor-transition segment near stair node', () => {
    // Position at stair node C
    const pos = { lat: 11.822, lng: 122.168 }
    const result = computeRouteProgress(route, pos)
    expect(result.currentSegment).toBe('floor-transition')
  })

  it('handles position past the end of the route', () => {
    const pos = { lat: 11.825, lng: 122.168 } // beyond D
    const result = computeRouteProgress(route, pos)
    expect(result.index).toBe(3) // last step
    expect(result.remainingDistance).toBeLessThan(500) // some small distance
  })
})

// ---------------------------------------------------------------------------
// computeSegments
// ---------------------------------------------------------------------------

describe('computeSegments', () => {
  it('returns empty array for empty route', () => {
    const emptyRoute: NavRoute = {
      path: [], steps: [], instructions: [], totalDistance: 0, totalDuration: 0,
      fromLabel: '', toLabel: '', arrival: { nodeId: '', label: '', position: { lat: 0, lng: 0 }, remainingDistance: 0 },
      nodeFloors: [],
    }
    expect(computeSegments(emptyRoute)).toEqual([])
  })

  it('groups steps into segments by type and floor', () => {
    const route = buildNavRoute(pathResult, nodes, edges)!
    const segments = computeSegments(route)

    // A(walk) B(entrance) C(stairs, floor-transition) D(walk, floor 1, indoor)
    expect(segments.length).toBeGreaterThanOrEqual(2)

    // First segment: outdoor/walk (A)
    expect(segments[0].type).toBe('indoor') // walk = indoor
    expect(segments[0].startIndex).toBe(0)

    // Entrance segment (B)
    const entranceSeg = segments.find(s => s.type === 'entrance')
    expect(entranceSeg).toBeDefined()

    // Floor-transition segment (C)
    const transitionSeg = segments.find(s => s.type === 'floor-transition')
    expect(transitionSeg).toBeDefined()

    // Indoor segment on floor 1 (D)
    const indoorSeg = segments.find(s => s.type === 'indoor' && s.floor === 1)
    expect(indoorSeg).toBeDefined()
  })

  it('breaks segment on floor change', () => {
    const multiFloorNodes: NavNode[] = [
      makeNode({ id: 'X', type: 'room', floor: 0, position: { lat: 11.82, lng: 122.168 } }),
      makeNode({ id: 'Y', type: 'room', floor: 1, position: { lat: 11.821, lng: 122.168 } }),
    ]
    const multiFloorEdges = [makeEdge('X', 'Y')]
    const multiFloorResult: PathResult = {
      path: ['X', 'Y'],
      cost: 100,
      steps: [
        { nodeId: 'X', instruction: 'Go', distance: 50 },
        { nodeId: 'Y', instruction: 'Arrive', distance: 50 },
      ],
    }
    const route = buildNavRoute(multiFloorResult, multiFloorNodes, multiFloorEdges)!
    const segments = computeSegments(route)

    // Two indoor segments (different floors)
    expect(segments).toHaveLength(2)
    expect(segments[0].floor).toBe(0)
    expect(segments[1].floor).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// findNavRoute — end-to-end (aStar → buildNavRoute)
// ---------------------------------------------------------------------------

describe('findNavRoute (end-to-end)', () => {
  const e2eNodes: NavNode[] = [
    makeNode({ id: 'A', type: 'building_entrance', position: { lat: 11.82, lng: 122.168 }, floor: 0 }),
    makeNode({ id: 'B', type: 'intersection', position: { lat: 11.821, lng: 122.168 }, floor: 0 }),
    makeNode({ id: 'C', type: 'stair', position: { lat: 11.822, lng: 122.168 }, floor: 0 }),
    makeNode({ id: 'D', type: 'room', position: { lat: 11.823, lng: 122.168 }, floor: 1 }),
  ]
  const e2eEdges: NavEdge[] = [
    makeEdge('A', 'B', 'walkway'),
    makeEdge('B', 'C', 'walkway'),
    makeEdge('C', 'D', 'stair'),
  ]

  it('returns NavRoute with enriched steps from real aStar output', () => {
    const route = findNavRoute(e2eNodes, e2eEdges, 'A', 'D')
    expect(route).not.toBeNull()
    expect(route!.path).toEqual(['A', 'B', 'C', 'D'])
    expect(route!.steps).toHaveLength(4)

    // Steps carry floor/position/type from the node map
    expect(route!.steps[0]).toMatchObject({ nodeId: 'A', floor: 0, type: 'entrance' })
    expect(route!.steps[2]).toMatchObject({ nodeId: 'C', floor: 0, type: 'stairs' })
    expect(route!.steps[3]).toMatchObject({ nodeId: 'D', floor: 1, type: 'walk' })
  })

  it('computes nodeFloors from real route', () => {
    const route = findNavRoute(e2eNodes, e2eEdges, 'A', 'D')!
    expect(route.nodeFloors).toEqual([1, 0]) // descending
  })

  it('returns null for disconnected nodes', () => {
    const route = findNavRoute(e2eNodes, [], 'A', 'D')
    expect(route).toBeNull()
  })

  it('returns null when start/end missing', () => {
    const route = findNavRoute(e2eNodes, e2eEdges, 'X', 'D')
    expect(route).toBeNull()
  })
})
