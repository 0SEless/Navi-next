import { describe, expect, it } from 'vitest'
import { haversine } from '@navi/core'
import type {
  NavEdge,
  NavNode,
  RoadRouting,
  RoadRoutingFeature,
  RoadSlope,
} from '@navi/core'
import {
  TERRAIN_COST_CONFIGS,
  buildRoadLengthIndex,
  calculateOutdoorTraversalCost,
} from './outdoor-terrain-cost-model.experimental'
import {
  dijkstraOracle,
  experimentalAStar,
  type ExperimentalTraversalCost,
} from './outdoor-terrain-search.experimental'

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

function edge(
  id: string,
  from: string,
  to: string,
  distance: number,
  authored: RoadRouting,
): NavEdge {
  return {
    id,
    from,
    to,
    type: 'walk',
    distance,
    weight: distance,
    routing: {
      sourceRoadId: id,
      authoredOrientation: 'forward',
      authored,
    },
  }
}

function terrainResolver(edges: readonly NavEdge[]): ExperimentalTraversalCost {
  const roadLengthsBySourceRoadId = buildRoadLengthIndex(edges)
  return (candidate, traversalFromNodeId) =>
    calculateOutdoorTraversalCost(
      candidate,
      traversalFromNodeId,
      TERRAIN_COST_CONFIGS.medium,
      { roadLengthsBySourceRoadId },
    )
}

function expectSameOptimalCost(
  nodes: readonly NavNode[],
  edges: readonly NavEdge[],
  fromId: string,
  toId: string,
): void {
  const resolver = terrainResolver(edges)
  const aStar = experimentalAStar(nodes, edges, fromId, toId, resolver)
  const dijkstra = dijkstraOracle(nodes, edges, fromId, toId, resolver)

  expect(aStar).not.toBeNull()
  expect(dijkstra).not.toBeNull()
  expect(aStar!.totalCost).toBeCloseTo(dijkstra!.totalCost, 8)
}

describe('Phase 5 deterministic A* versus Dijkstra proof', () => {
  it('chooses the 144-cost steep route over the 150-cost level detour', () => {
    const nodes = [
      node('start', 14.5, 121),
      node('flat-mid', 14.5003, 121.0005),
      node('goal', 14.5, 121.001),
    ]
    const edges = [
      edge('steep-direct', 'start', 'goal', 120, {
        slope: 'steep',
        startElevationMeters: 0,
        endElevationMeters: 12,
      }),
      edge('flat-a', 'start', 'flat-mid', 75, { slope: 'level' }),
      edge('flat-b', 'flat-mid', 'goal', 75, { slope: 'level' }),
    ]
    const resolver = terrainResolver(edges)
    const result = experimentalAStar(nodes, edges, 'start', 'goal', resolver)

    expect(result?.totalCost).toBeCloseTo(144, 10)
    expectSameOptimalCost(nodes, edges, 'start', 'goal')
  })

  it('proves direction-aware cost can change the route without a downhill bonus', () => {
    const nodes = [
      node('low', 14.5, 121),
      node('detour', 14.5003, 121.00036),
      node('high', 14.5, 121.00072),
    ]
    const edges = [
      edge('slope', 'low', 'high', 100, {
        startElevationMeters: 20,
        endElevationMeters: 30,
      }),
      edge('detour-a', 'low', 'detour', 56, { slope: 'level' }),
      edge('detour-b', 'detour', 'high', 56, { slope: 'level' }),
    ]
    const resolver = terrainResolver(edges)

    const uphill = experimentalAStar(nodes, edges, 'low', 'high', resolver)
    const downhill = experimentalAStar(nodes, edges, 'high', 'low', resolver)

    expect(uphill?.totalCost).toBeCloseTo(112, 10)
    expect(downhill?.totalCost).toBeCloseTo(105, 10)
    expectSameOptimalCost(nodes, edges, 'low', 'high')
    expectSameOptimalCost(nodes, edges, 'high', 'low')
  })
})

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

const FEATURES: readonly RoadRoutingFeature[] = [
  'normal',
  'stairs',
  'ramp',
  'bridge',
]

const SLOPES: readonly (RoadSlope | undefined)[] = [
  undefined,
  'level',
  'gentle',
  'moderate',
  'steep',
]

function createRandomGraph(random: () => number, graphIndex: number): {
  nodes: NavNode[]
  edges: NavEdge[]
} {
  const nodes = Array.from({ length: 18 }, (_, index) =>
    node(
      `g${graphIndex}-n${index}`,
      14.5 + random() * 0.002,
      121 + random() * 0.002,
    ),
  )
  const edges: NavEdge[] = []

  const addRandomEdge = (fromIndex: number, toIndex: number): void => {
    const from = nodes[fromIndex]
    const to = nodes[toIndex]
    const lowerBound = haversine(from.position, to.position)
    const distance = lowerBound * (1 + random() * 0.4) + 0.01
    const startElevationMeters = 10 + random() * 30
    const signedGrade = random() * 0.24 - 0.12
    const id = `g${graphIndex}-e${edges.length}`
    edges.push(
      edge(id, from.id, to.id, distance, {
        feature: FEATURES[Math.floor(random() * FEATURES.length)],
        slope: SLOPES[Math.floor(random() * SLOPES.length)],
        startElevationMeters,
        endElevationMeters: startElevationMeters + distance * signedGrade,
      }),
    )
  }

  for (let index = 0; index < nodes.length - 1; index += 1) {
    addRandomEdge(index, index + 1)
  }

  for (let index = 0; index < 40; index += 1) {
    const fromIndex = Math.floor(random() * nodes.length)
    let toIndex = Math.floor(random() * nodes.length)
    if (toIndex === fromIndex) toIndex = (toIndex + 1) % nodes.length
    addRandomEdge(fromIndex, toIndex)
  }

  return { nodes, edges }
}

describe('Phase 5 seeded randomized optimality experiment', () => {
  it('matches Dijkstra and verifies the haversine consistency inequality', () => {
    const random = seededRandom(0x5eedc0de)
    let comparisons = 0
    let directedConsistencyChecks = 0

    for (let graphIndex = 0; graphIndex < 32; graphIndex += 1) {
      const { nodes, edges } = createRandomGraph(random, graphIndex)
      const resolver = terrainResolver(edges)

      for (const candidate of edges) {
        const from = nodes.find((entry) => entry.id === candidate.from)!
        const to = nodes.find((entry) => entry.id === candidate.to)!
        const physicalLowerBound = haversine(from.position, to.position)
        expect(candidate.distance).toBeGreaterThanOrEqual(physicalLowerBound)
        expect(resolver(candidate, candidate.from)).toBeGreaterThanOrEqual(
          physicalLowerBound,
        )
        expect(resolver(candidate, candidate.to)).toBeGreaterThanOrEqual(
          physicalLowerBound,
        )

        for (let goalIndex = 0; goalIndex < 3; goalIndex += 1) {
          const goal = nodes[goalIndex]
          const fromHeuristic = haversine(from.position, goal.position)
          const toHeuristic = haversine(to.position, goal.position)

          expect(fromHeuristic).toBeLessThanOrEqual(
            resolver(candidate, candidate.from) + toHeuristic + 1e-8,
          )
          expect(toHeuristic).toBeLessThanOrEqual(
            resolver(candidate, candidate.to) + fromHeuristic + 1e-8,
          )
          directedConsistencyChecks += 2
        }
      }

      for (let pairIndex = 0; pairIndex < 20; pairIndex += 1) {
        const from = nodes[Math.floor(random() * nodes.length)]
        let to = nodes[Math.floor(random() * nodes.length)]
        if (to.id === from.id) {
          to = nodes[(nodes.indexOf(to) + 1) % nodes.length]
        }
        expectSameOptimalCost(nodes, edges, from.id, to.id)
        comparisons += 1
      }
    }

    expect(comparisons).toBe(640)
    expect(directedConsistencyChecks).toBe(10_944)
  })
})

