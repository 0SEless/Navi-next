import { haversine } from '@navi/core'
import type {
  NavEdge,
  NavNode,
  NavigationGraph,
  RoadDirection,
  RoadRoutingFeature,
  RoadSlope,
} from '@navi/core'
import { describe, expect, it } from 'vitest'
import { AStar, type AStarOptions } from '../astar'
import {
  STANDARD_PEDESTRIAN_ELIGIBILITY_V1,
  isTraversalEligible,
} from '../edge-eligibility'
import {
  STANDARD_TERRAIN_PROFILE_V1,
  buildRoadTerrainContext,
  calculateTraversalCost,
} from '../traversal-cost'

function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function node(id: string, lat: number, lng: number): NavNode {
  return {
    id,
    label: id,
    type: 'outdoor',
    position: { lat, lng },
    floor: 0,
    buildingId: '',
    properties: {},
  }
}

const FEATURES: readonly RoadRoutingFeature[] = ['normal', 'stairs', 'ramp', 'bridge']
const SLOPES: readonly (RoadSlope | undefined)[] = [undefined, 'level', 'gentle', 'moderate', 'steep']
const DIRECTIONS: readonly RoadDirection[] = ['both', 'forward', 'reverse']

function createRandomGraph(random: () => number, graphIndex: number): NavigationGraph {
  const nodes = Array.from({ length: 18 }, (_, index) => node(
    `g${graphIndex}-n${index}`,
    14.5 + random() * 0.002,
    121 + random() * 0.002,
  ))
  const edges: NavEdge[] = []

  const addRandomEdge = (fromIndex: number, toIndex: number, backbone: boolean): void => {
    const from = nodes[fromIndex]
    const to = nodes[toIndex]
    const physicalLowerBound = haversine(from.position, to.position)
    const distance = physicalLowerBound * (1 + random() * 0.4) + 0.01
    const startElevationMeters = 10 + random() * 30
    const signedGrade = random() * 0.24 - 0.12
    const id = `g${graphIndex}-e${edges.length}`
    edges.push({
      id,
      from: from.id,
      to: to.id,
      type: 'walk',
      distance,
      weight: distance,
      routing: {
        sourceRoadId: id,
        authoredOrientation: 'forward',
        authored: {
          feature: FEATURES[Math.floor(random() * FEATURES.length)],
          slope: SLOPES[Math.floor(random() * SLOPES.length)],
          direction: backbone ? 'both' : DIRECTIONS[Math.floor(random() * DIRECTIONS.length)],
          walkable: backbone ? true : random() >= 0.1,
          startElevationMeters,
          endElevationMeters: startElevationMeters + distance * signedGrade,
          wheelchairAccessible: random() >= 0.5,
        },
      },
    })
  }

  for (let index = 0; index < nodes.length - 1; index += 1) {
    addRandomEdge(index, index + 1, true)
  }
  for (let index = 0; index < 40; index += 1) {
    const fromIndex = Math.floor(random() * nodes.length)
    let toIndex = Math.floor(random() * nodes.length)
    if (toIndex === fromIndex) toIndex = (toIndex + 1) % nodes.length
    addRandomEdge(fromIndex, toIndex, false)
  }

  return {
    version: '1',
    campusId: `campus-${graphIndex}`,
    createdAt: '2026-09-11T00:00:00.000Z',
    checksum: `graph-${graphIndex}`,
    nodes,
    edges,
    metadata: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      buildings: 0,
      floors: 0,
      boundingBox: {
        minLng: Math.min(...nodes.map((entry) => entry.position.lng)),
        maxLng: Math.max(...nodes.map((entry) => entry.position.lng)),
        minLat: Math.min(...nodes.map((entry) => entry.position.lat)),
        maxLat: Math.max(...nodes.map((entry) => entry.position.lat)),
      },
    },
  }
}

function productionProviders(graph: NavigationGraph): Required<AStarOptions> {
  const context = buildRoadTerrainContext(graph)
  return {
    traversalCost: (edge, fromNodeId) => calculateTraversalCost(
      edge,
      fromNodeId,
      STANDARD_TERRAIN_PROFILE_V1,
      context,
    ),
    traversalEligibility: (edge, fromNodeId) => isTraversalEligible(
      edge,
      fromNodeId,
      STANDARD_PEDESTRIAN_ELIGIBILITY_V1,
    ),
    heuristic: (candidate, goal) => haversine(candidate.position, goal.position),
  }
}

function dijkstra(
  graph: NavigationGraph,
  fromId: string,
  toId: string,
  providers: Required<AStarOptions>,
): number | null {
  const nodeIds = new Set(graph.nodes.map((entry) => entry.id))
  if (!nodeIds.has(fromId) || !nodeIds.has(toId)) return null

  const adjacency = new Map<string, Array<{ edge: NavEdge; nextId: string }>>()
  for (const edge of graph.edges) {
    const from = adjacency.get(edge.from) ?? []
    from.push({ edge, nextId: edge.to })
    adjacency.set(edge.from, from)
    const to = adjacency.get(edge.to) ?? []
    to.push({ edge, nextId: edge.from })
    adjacency.set(edge.to, to)
  }

  const unsettled = new Set(nodeIds)
  const costs = new Map<string, number>([[fromId, 0]])
  while (unsettled.size > 0) {
    let current: string | undefined
    let currentCost = Number.POSITIVE_INFINITY
    for (const candidateId of unsettled) {
      const candidateCost = costs.get(candidateId) ?? Number.POSITIVE_INFINITY
      if (candidateCost < currentCost) {
        current = candidateId
        currentCost = candidateCost
      }
    }
    if (current === undefined || !Number.isFinite(currentCost)) return null
    if (current === toId) return currentCost
    unsettled.delete(current)

    for (const { edge, nextId } of adjacency.get(current) ?? []) {
      if (!unsettled.has(nextId) || !providers.traversalEligibility(edge, current)) continue
      const candidateCost = currentCost + providers.traversalCost(edge, current)
      if (candidateCost < (costs.get(nextId) ?? Number.POSITIVE_INFINITY)) {
        costs.set(nextId, candidateCost)
      }
    }
  }
  return null
}

describe('production terrain A* optimality and heuristic gate', () => {
  it('matches Dijkstra on four deterministic terrain and direction traversals', () => {
    const nodes = [
      node('a', 14.5, 121),
      node('b', 14.5002, 121.0004),
      node('c', 14.5, 121.0008),
    ]
    const makeGraph = (
      directAuthored: NonNullable<NavEdge['routing']>['authored'],
    ): NavigationGraph => ({
      version: '1',
      campusId: 'deterministic',
      createdAt: '2026-09-11T00:00:00.000Z',
      checksum: 'deterministic',
      nodes,
      edges: [
        {
          id: 'direct', from: 'a', to: 'c', type: 'walk', distance: 100, weight: 100,
          routing: {
            sourceRoadId: 'direct-road',
            authoredOrientation: 'forward',
            authored: directAuthored,
          },
        },
        { id: 'alt-a', from: 'a', to: 'b', type: 'walk', distance: 60, weight: 60 },
        { id: 'alt-b', from: 'b', to: 'c', type: 'walk', distance: 60, weight: 60 },
      ],
      metadata: {
        nodeCount: 3,
        edgeCount: 3,
        buildings: 0,
        floors: 0,
        boundingBox: { minLng: 121, maxLng: 121.0008, minLat: 14.5, maxLat: 14.5002 },
      },
    })
    const cases = [
      { graph: makeGraph({ slope: 'steep' }), from: 'a', to: 'c' },
      { graph: makeGraph({ slope: 'steep' }), from: 'c', to: 'a' },
      { graph: makeGraph({ direction: 'forward' }), from: 'a', to: 'c' },
      { graph: makeGraph({ direction: 'forward' }), from: 'c', to: 'a' },
    ]

    for (const candidate of cases) {
      const providers = productionProviders(candidate.graph)
      const actual = new AStar(candidate.graph, providers).findPath(candidate.from, candidate.to)
      const optimal = dijkstra(candidate.graph, candidate.from, candidate.to, providers)
      expect(actual?.cost).toBeCloseTo(optimal!, 8)
    }
    expect(cases).toHaveLength(4)
  })

  it('matches Dijkstra for 640 seeded directed/blocked terrain routes', () => {
    const random = seededRandom(0x5eedc0de)
    let comparisons = 0

    for (let graphIndex = 0; graphIndex < 32; graphIndex += 1) {
      const graph = createRandomGraph(random, graphIndex)
      const providers = productionProviders(graph)
      const astar = new AStar(graph, providers)

      for (let pairIndex = 0; pairIndex < 20; pairIndex += 1) {
        const fromIndex = Math.floor(random() * graph.nodes.length)
        let toIndex = Math.floor(random() * graph.nodes.length)
        if (toIndex === fromIndex) toIndex = (toIndex + 1) % graph.nodes.length
        const fromId = graph.nodes[fromIndex].id
        const toId = graph.nodes[toIndex].id
        const actual = astar.findPath(fromId, toId)
        const optimal = dijkstra(graph, fromId, toId, providers)

        expect(actual).not.toBeNull()
        expect(optimal).not.toBeNull()
        expect(actual!.cost).toBeCloseTo(optimal!, 8)
        expect(actual!.distance).toBe(actual!.cost)
        comparisons += 1
      }
    }

    expect(comparisons).toBe(640)
  })

  it('passes 10,944 production lower-bound and consistency checks', () => {
    const random = seededRandom(0x51a7c0de)
    let checks = 0

    for (let graphIndex = 0; graphIndex < 32; graphIndex += 1) {
      const graph = createRandomGraph(random, graphIndex)
      const providers = productionProviders(graph)
      const nodesById = new Map(graph.nodes.map((entry) => [entry.id, entry]))
      const goal = graph.nodes[graph.nodes.length - 1]

      for (const edge of graph.edges) {
        const from = nodesById.get(edge.from)!
        const to = nodesById.get(edge.to)!
        const endpointDistance = haversine(from.position, to.position)

        for (const [origin, destination] of [[from, to], [to, from]] as const) {
          const traversalCost = providers.traversalCost(edge, origin.id)
          const originHeuristic = haversine(origin.position, goal.position)
          const destinationHeuristic = haversine(destination.position, goal.position)

          expect(traversalCost).toBeGreaterThanOrEqual(edge.distance)
          checks += 1
          expect(edge.distance + 1e-9).toBeGreaterThanOrEqual(endpointDistance)
          checks += 1
          expect(originHeuristic).toBeLessThanOrEqual(traversalCost + destinationHeuristic + 1e-8)
          checks += 1
        }
      }
    }

    expect(checks).toBe(10_944)
  })
})
