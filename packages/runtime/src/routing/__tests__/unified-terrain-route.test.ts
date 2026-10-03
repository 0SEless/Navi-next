import type { NavEdge, NavNode, NavigationGraph } from '@navi/core'
import { describe, expect, it } from 'vitest'
import { AStar } from '../astar'
import {
  STANDARD_PEDESTRIAN_ELIGIBILITY_V1,
  isTraversalEligible,
} from '../edge-eligibility'
import { RoutingEngine } from '../routing-engine'
import {
  STANDARD_TERRAIN_PROFILE_V1,
  buildRoadTerrainContext,
  calculateTraversalCost,
} from '../traversal-cost'

function n(id: string, type: NavNode['type'], buildingId = ''): NavNode {
  return {
    id,
    label: id,
    type,
    position: { lat: 14.6, lng: 121 },
    floor: 0,
    buildingId,
    properties: {},
  }
}

function unifiedGraph(): NavigationGraph {
  const nodes = [
    n('outdoor-start', 'outdoor'),
    n('outdoor-access', 'outdoor'),
    n('entrance', 'entrance', 'building-1'),
    n('hall', 'corridor', 'building-1'),
    n('room', 'space', 'building-1'),
  ]
  const edges: NavEdge[] = [
    {
      id: 'outdoor-stairs-road',
      from: 'outdoor-start',
      to: 'outdoor-access',
      type: 'walk',
      distance: 100,
      weight: 100,
      routing: {
        sourceRoadId: 'outdoor-stairs-road',
        authoredOrientation: 'forward',
        authored: { feature: 'stairs', slope: 'steep', direction: 'both' },
      },
    },
    { id: 'entrance-access', from: 'outdoor-access', to: 'entrance', type: 'transition', distance: 2, weight: 3 },
    { id: 'indoor-hall', from: 'entrance', to: 'hall', type: 'walk', distance: 10, weight: 17 },
    { id: 'room-access', from: 'hall', to: 'room', type: 'walk', distance: 5, weight: 5 },
  ]
  return {
    version: '1',
    campusId: 'unified-campus',
    createdAt: '2026-09-11T00:00:00.000Z',
    checksum: 'unified',
    nodes,
    edges,
    metadata: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      buildings: 1,
      floors: 1,
      boundingBox: { minLng: 121, maxLng: 121, minLat: 14.6, maxLat: 14.6 },
    },
  }
}

describe('unified outdoor terrain and indoor routing', () => {
  it.each([
    [
      'outdoor-start',
      'room',
      ['outdoor-start', 'outdoor-access', 'entrance', 'hall', 'room'],
      ['outdoor-stairs-road', 'entrance-access', 'indoor-hall', 'room-access'],
    ],
    [
      'room',
      'outdoor-start',
      ['room', 'hall', 'entrance', 'outdoor-access', 'outdoor-start'],
      ['room-access', 'indoor-hall', 'entrance-access', 'outdoor-stairs-road'],
    ],
  ] as const)('routes %s to %s with terrain and legacy costs separated', (from, to, path, edgeIds) => {
    const graph = unifiedGraph()
    const context = buildRoadTerrainContext(graph)
    const astar = new AStar(graph, {
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
    })

    expect(astar.findPath(from, to)).toEqual({
      path: [...path],
      edgeIds: [...edgeIds],
      cost: 145,
      distance: 145,
    })
    const route = new RoutingEngine(graph).findRoute(from, to)!
    expect(route.path.map((step) => step.nodeId)).toEqual([...path])
    expect(route.totalDistance).toBe(117)
  })

  it('keeps outdoor stairs a Road-derived walk edge and indoor weights unchanged', () => {
    const graph = unifiedGraph()
    const context = buildRoadTerrainContext(graph)
    const outdoor = graph.edges[0]
    const indoor = graph.edges[2]

    expect(outdoor.type).toBe('walk')
    expect(calculateTraversalCost(outdoor, outdoor.from, STANDARD_TERRAIN_PROFILE_V1, context)).toBe(120)
    expect(calculateTraversalCost(indoor, indoor.from, STANDARD_TERRAIN_PROFILE_V1, context)).toBe(17)
    expect(indoor.distance).toBe(10)
    expect(indoor.weight).toBe(17)
  })
})
