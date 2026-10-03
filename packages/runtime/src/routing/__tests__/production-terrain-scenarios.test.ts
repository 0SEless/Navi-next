import type { NavEdge, NavNode, NavigationGraph, RoadRouting } from '@navi/core'
import { describe, expect, it } from 'vitest'
import {
  TERRAIN_COST_CONFIGS,
  buildRoadLengthIndex,
  calculateOutdoorTraversalCost,
} from '../../../../../src/engine/__tests__/outdoor-terrain-cost-model.experimental'
import { AStar } from '../astar'
import {
  STANDARD_PEDESTRIAN_ELIGIBILITY_V1,
  isTraversalEligible,
} from '../edge-eligibility'
import {
  STANDARD_TERRAIN_PROFILE_V1,
  buildRoadTerrainContext,
  calculateTraversalCost,
} from '../traversal-cost'

function node(id: string): NavNode {
  return {
    id,
    label: id,
    type: 'outdoor',
    position: { lat: 14.6, lng: 121 },
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
  authored?: RoadRouting,
  sourceRoadId = id,
): NavEdge {
  return {
    id,
    from,
    to,
    type: authored?.feature === 'stairs' ? 'stairs' : 'walk',
    distance,
    weight: distance,
    ...(authored
      ? {
          routing: {
            sourceRoadId,
            authoredOrientation: 'forward' as const,
            authored,
          },
        }
      : {}),
  }
}

function graph(nodes: NavNode[], edges: NavEdge[]): NavigationGraph {
  return {
    version: '1',
    campusId: 'test',
    createdAt: '2026-09-11T00:00:00.000Z',
    checksum: 'test',
    nodes,
    edges,
    metadata: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      buildings: 0,
      floors: 0,
      boundingBox: { minLng: 121, maxLng: 121, minLat: 14.6, maxLat: 14.6 },
    },
  }
}

function providers(candidateGraph: NavigationGraph) {
  const context = buildRoadTerrainContext(candidateGraph)
  return {
    traversalCost: (candidate: NavEdge, fromId: string) => calculateTraversalCost(
      candidate,
      fromId,
      STANDARD_TERRAIN_PROFILE_V1,
      context,
    ),
    traversalEligibility: (candidate: NavEdge, fromId: string) => isTraversalEligible(
      candidate,
      fromId,
      STANDARD_PEDESTRIAN_ELIGIBILITY_V1,
    ),
  }
}

function find(candidateGraph: NavigationGraph, from: string, to: string) {
  return new AStar(candidateGraph, providers(candidateGraph)).findPath(from, to)
}

function productionCost(distance: number, authored?: RoadRouting, reverse = false): number {
  const candidate = edge('road', 'a', 'b', distance, authored)
  const candidateGraph = graph([node('a'), node('b')], [candidate])
  return providers(candidateGraph).traversalCost(candidate, reverse ? candidate.to : candidate.from)
}

describe('production MEDIUM terrain scenarios', () => {
  it('matches the approved eight-scenario cost table', () => {
    expect(productionCost(100, { feature: 'normal', slope: 'level' })).toBe(100)
    expect(productionCost(100, { feature: 'normal', slope: 'steep' })).toBe(120)
    expect(productionCost(120, {
      feature: 'normal',
      slope: 'steep',
      startElevationMeters: 0,
      endElevationMeters: 12,
    })).toBe(144)
    expect(productionCost(100, {
      feature: 'stairs',
      startElevationMeters: 0,
      endElevationMeters: 10,
    })).toBe(120)
    expect(productionCost(100, {
      startElevationMeters: 20,
      endElevationMeters: 30,
    })).toBeCloseTo(115, 10)
    expect(productionCost(100, {
      startElevationMeters: 20,
      endElevationMeters: 30,
    }, true)).toBeCloseTo(105, 10)
    expect(productionCost(100, { feature: 'ramp', slope: 'gentle' })).toBe(104)
    expect(productionCost(100, { feature: 'bridge', slope: 'level' })).toBe(100)
    expect(productionCost(100, { feature: 'normal', slope: 'level' })).toBe(100)
    expect(productionCost(100)).toBe(100)
  })

  it('matches the independent Phase 5 MEDIUM oracle', () => {
    const rows: RoadRouting[] = [
      { feature: 'normal', slope: 'level' },
      { feature: 'normal', slope: 'steep' },
      { feature: 'stairs', slope: 'steep' },
      { feature: 'stairs', startElevationMeters: 0, endElevationMeters: 10 },
      { feature: 'ramp', slope: 'gentle' },
      { feature: 'bridge', slope: 'level' },
      { startElevationMeters: 20, endElevationMeters: 30 },
    ]

    for (const authored of rows) {
      const candidate = edge('oracle-road', 'a', 'b', 100, authored)
      const lengthIndex = buildRoadLengthIndex([candidate])
      const candidateGraph = graph([node('a'), node('b')], [candidate])
      const context = buildRoadTerrainContext(candidateGraph)
      for (const fromId of [candidate.from, candidate.to]) {
        const experimental = calculateOutdoorTraversalCost(
          candidate,
          fromId,
          TERRAIN_COST_CONFIGS.medium,
          { roadLengthsBySourceRoadId: lengthIndex },
        )
        const production = calculateTraversalCost(
          candidate,
          fromId,
          STANDARD_TERRAIN_PROFILE_V1,
          context,
        )
        expect(production).toBeCloseTo(experimental, 10)
      }
    }
  })

  it('selects the approved alternatives by generalized cost', () => {
    const nodes = [node('a'), node('b'), node('c')]
    const route = (direct: NavEdge, alternativeDistance: number) => {
      const candidateGraph = graph(nodes, [
        direct,
        edge('alt-a', 'a', 'b', alternativeDistance / 2),
        edge('alt-b', 'b', 'c', alternativeDistance / 2),
      ])
      return find(candidateGraph, 'a', 'c')
    }

    expect(route(edge('steep-100', 'a', 'c', 100, { slope: 'steep' }), 100)?.path)
      .toEqual(['a', 'b', 'c'])
    expect(route(edge('steep-120', 'a', 'c', 120, { slope: 'steep' }), 150)?.path)
      .toEqual(['a', 'c'])
    expect(route(edge('stairs-100', 'a', 'c', 100, { feature: 'stairs' }), 130)?.path)
      .toEqual(['a', 'c'])
    expect(route(edge('ramp-100', 'a', 'c', 100, { feature: 'ramp', slope: 'gentle' }), 110)?.path)
      .toEqual(['a', 'c'])
  })

  it('uses max composition for stairs plus manual or numerical slope', () => {
    expect(productionCost(100, { feature: 'stairs', slope: 'steep' })).toBe(120)
    expect(productionCost(100, {
      feature: 'stairs',
      startElevationMeters: 0,
      endElevationMeters: 16.666666666666668,
    })).toBeCloseTo(125, 10)
  })
})

describe('production direction and walkability scenarios', () => {
  it.each([
    ['both', true, true],
    ['forward', true, false],
    ['reverse', false, true],
  ] as const)('routes direction=%s correctly', (direction, forwardExists, reverseExists) => {
    const authored = { direction }
    const candidateGraph = graph(
      [node('a'), node('b'), node('c')],
      [
        edge('road-0', 'a', 'b', 50, authored, 'road'),
        edge('road-1', 'b', 'c', 50, authored, 'road'),
      ],
    )
    expect(find(candidateGraph, 'a', 'c') !== null).toBe(forwardExists)
    expect(find(candidateGraph, 'c', 'a') !== null).toBe(reverseExists)
  })

  it('reversing authored geometry reverses forward semantics without using IDs', () => {
    const authored = { direction: 'forward' as const }
    const candidateGraph = graph(
      [node('a'), node('b'), node('c')],
      [
        edge('reverse-order-0', 'c', 'b', 50, authored, 'road'),
        edge('reverse-order-1', 'b', 'a', 50, authored, 'road'),
      ],
    )
    expect(find(candidateGraph, 'c', 'a')?.path).toEqual(['c', 'b', 'a'])
    expect(find(candidateGraph, 'a', 'c')).toBeNull()
  })

  it('avoids an unwalkable shortcut and reports no route without an alternative', () => {
    const nodes = [node('a'), node('b'), node('c')]
    const blocked = edge('blocked', 'a', 'c', 10, { walkable: false })
    const withAlternative = graph(nodes, [
      blocked,
      edge('alt-a', 'a', 'b', 10),
      edge('alt-b', 'b', 'c', 10),
    ])
    expect(find(withAlternative, 'a', 'c')?.path).toEqual(['a', 'b', 'c'])
    expect(find(graph(nodes, [blocked]), 'a', 'c')).toBeNull()
  })
})
