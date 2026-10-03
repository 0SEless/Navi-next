import { describe, it, expect } from 'vitest'
import { GraphValidator, buildContext } from '../validator'
import { DuplicateNodeRule } from '../graph/duplicate-nodes'
import { DuplicateEdgeRule } from '../graph/duplicate-edges'
import { MissingNodeRefRule, ZeroWeightRule } from '../graph/edge-integrity'
import { DisconnectedGraphRule } from '../graph/connectivity'
import { UnreachableRoomRule } from '../graph/unreachable-room'
import { MissingEntranceRule } from '../graph/missing-entrance'
import { DuplicateCoordsRule } from '../graph/duplicate-coords'
import type { NavigationGraph, NavNode, NavEdge } from '../../../types'

function makeNode(overrides: Partial<NavNode> & { id: string }): NavNode {
  return {
    label: '',
    type: 'space',
    position: { lat: 0, lng: 0 },
    floor: 0,
    buildingId: 'b-1',
    properties: {},
    ...overrides,
  }
}

function makeEdge(overrides: Partial<NavEdge> & { id: string }): NavEdge {
  return {
    from: '',
    to: '',
    type: 'walk',
    distance: 10,
    weight: 1,
    ...overrides,
  }
}

function makeGraph(overrides: Partial<NavigationGraph>): NavigationGraph {
  return {
    version: '1.0.0',
    campusId: 'test',
    createdAt: '',
    checksum: '',
    nodes: [],
    edges: [],
    metadata: { nodeCount: 0, edgeCount: 0, buildings: 0, floors: 0, boundingBox: { minLng: 0, maxLng: 0, minLat: 0, maxLat: 0 } },
    ...overrides,
  }
}

describe('GraphValidator', () => {
  describe('buildContext', () => {
    it('builds nodeMap, edgeMap, and adjacency from graph', () => {
      const na = makeNode({ id: 'n1' })
      const nb = makeNode({ id: 'n2' })
      const e1 = makeEdge({ id: 'e1', from: 'n1', to: 'n2', distance: 5, weight: 1 })
      const graph = makeGraph({ nodes: [na, nb], edges: [e1] })
      const ctx = buildContext(graph)

      expect(ctx.nodeMap.get('n1')).toBe(na)
      expect(ctx.nodeMap.get('n2')).toBe(nb)
      expect(ctx.edgeMap.get('e1')).toBe(e1)
      expect(ctx.adjacency.get('n1')).toEqual(['n2'])
      expect(ctx.adjacency.get('n2')).toEqual(['n1'])
    })
  })

  describe('DuplicateNodeRule', () => {
    it('passes when all node IDs are unique', () => {
      const graph = makeGraph({
        nodes: [makeNode({ id: 'n1' }), makeNode({ id: 'n2' })],
      })
      const ctx = buildContext(graph)
      expect(DuplicateNodeRule.validate(ctx)).toHaveLength(0)
    })

    it('fails when node IDs are duplicated', () => {
      const graph = makeGraph({
        nodes: [makeNode({ id: 'n1' }), makeNode({ id: 'n1' })],
      })
      const ctx = buildContext(graph)
      const results = DuplicateNodeRule.validate(ctx)
      expect(results).toHaveLength(1)
      expect(results[0].code).toBe('GRAPH_DUPLICATE_NODE')
      expect(results[0].severity).toBe('error')
    })

    it('reports each duplicate once', () => {
      const graph = makeGraph({
        nodes: [
          makeNode({ id: 'n1' }),
          makeNode({ id: 'n1' }),
          makeNode({ id: 'n2' }),
          makeNode({ id: 'n2' }),
        ],
      })
      const ctx = buildContext(graph)
      expect(DuplicateNodeRule.validate(ctx)).toHaveLength(2)
    })
  })

  describe('DuplicateEdgeRule', () => {
    it('passes when all edge IDs are unique', () => {
      const graph = makeGraph({
        edges: [makeEdge({ id: 'e1' }), makeEdge({ id: 'e2' })],
      })
      const ctx = buildContext(graph)
      expect(DuplicateEdgeRule.validate(ctx)).toHaveLength(0)
    })

    it('fails when edge IDs are duplicated', () => {
      const graph = makeGraph({
        edges: [makeEdge({ id: 'e1' }), makeEdge({ id: 'e1' })],
      })
      const ctx = buildContext(graph)
      const results = DuplicateEdgeRule.validate(ctx)
      expect(results).toHaveLength(1)
      expect(results[0].code).toBe('GRAPH_DUPLICATE_EDGE')
    })
  })

  describe('MissingNodeRefRule', () => {
    it('passes when all edge refs are valid', () => {
      const graph = makeGraph({
        nodes: [makeNode({ id: 'n1' }), makeNode({ id: 'n2' })],
        edges: [makeEdge({ id: 'e1', from: 'n1', to: 'n2' })],
      })
      const ctx = buildContext(graph)
      expect(MissingNodeRefRule.validate(ctx)).toHaveLength(0)
    })

    it('fails when edge.from does not exist', () => {
      const graph = makeGraph({
        nodes: [makeNode({ id: 'n2' })],
        edges: [makeEdge({ id: 'e1', from: 'n1', to: 'n2' })],
      })
      const ctx = buildContext(graph)
      const results = MissingNodeRefRule.validate(ctx)
      expect(results).toHaveLength(1)
      expect(results[0].code).toBe('GRAPH_MISSING_NODE_REF')
      expect(results[0].entityId).toBe('e1')
    })

    it('fails when edge.to does not exist', () => {
      const graph = makeGraph({
        nodes: [makeNode({ id: 'n1' })],
        edges: [makeEdge({ id: 'e1', from: 'n1', to: 'n3' })],
      })
      const ctx = buildContext(graph)
      expect(MissingNodeRefRule.validate(ctx)).toHaveLength(1)
    })
  })

  describe('ZeroWeightRule', () => {
    it('passes when all edges have positive weight and non-negative distance', () => {
      const graph = makeGraph({
        nodes: [makeNode({ id: 'n1' }), makeNode({ id: 'n2' })],
        edges: [makeEdge({ id: 'e1', from: 'n1', to: 'n2', weight: 1, distance: 10 })],
      })
      const ctx = buildContext(graph)
      expect(ZeroWeightRule.validate(ctx)).toHaveLength(0)
    })

    it('fails on zero weight', () => {
      const graph = makeGraph({
        edges: [makeEdge({ id: 'e1', weight: 0 })],
      })
      const ctx = buildContext(graph)
      const results = ZeroWeightRule.validate(ctx)
      expect(results).toHaveLength(1)
      expect(results[0].code).toBe('GRAPH_ZERO_WEIGHT')
    })

    it('fails on negative weight', () => {
      const graph = makeGraph({
        edges: [makeEdge({ id: 'e1', weight: -1 })],
      })
      const ctx = buildContext(graph)
      expect(ZeroWeightRule.validate(ctx)).toHaveLength(1)
    })

    it('fails on negative distance', () => {
      const graph = makeGraph({
        edges: [makeEdge({ id: 'e1', weight: 1, distance: -5 })],
      })
      const ctx = buildContext(graph)
      expect(ZeroWeightRule.validate(ctx)).toHaveLength(1)
    })
  })

  describe('DisconnectedGraphRule', () => {
    it('passes when all nodes are connected', () => {
      const graph = makeGraph({
        nodes: [makeNode({ id: 'n1' }), makeNode({ id: 'n2' }), makeNode({ id: 'n3' })],
        edges: [
          makeEdge({ id: 'e1', from: 'n1', to: 'n2' }),
          makeEdge({ id: 'e2', from: 'n2', to: 'n3' }),
        ],
      })
      const ctx = buildContext(graph)
      expect(DisconnectedGraphRule.validate(ctx)).toHaveLength(0)
    })

    it('fails when there are disconnected nodes', () => {
      const graph = makeGraph({
        nodes: [makeNode({ id: 'n1' }), makeNode({ id: 'n2' }), makeNode({ id: 'n3' })],
        edges: [makeEdge({ id: 'e1', from: 'n1', to: 'n2' })],
      })
      const ctx = buildContext(graph)
      const results = DisconnectedGraphRule.validate(ctx)
      expect(results).toHaveLength(1)
      expect(results[0].code).toBe('GRAPH_DISCONNECTED')
    })

    it('passes on empty graph', () => {
      const graph = makeGraph({ nodes: [], edges: [] })
      const ctx = buildContext(graph)
      expect(DisconnectedGraphRule.validate(ctx)).toHaveLength(0)
    })

    it('reports multiple disconnected components', () => {
      const graph = makeGraph({
        nodes: [
          makeNode({ id: 'n1' }), makeNode({ id: 'n2' }),
          makeNode({ id: 'n3' }), makeNode({ id: 'n4' }),
        ],
        edges: [
          makeEdge({ id: 'e1', from: 'n1', to: 'n2' }),
          makeEdge({ id: 'e2', from: 'n3', to: 'n4' }),
        ],
      })
      const ctx = buildContext(graph)
      // n1-n2 is one component, n3-n4 is another
      // BFS from n1 finds n1,n2; n3,n4 are disconnected
      expect(DisconnectedGraphRule.validate(ctx)).toHaveLength(1)
    })
  })

  describe('UnreachableRoomRule', () => {
    it('passes when all rooms are reachable from entrances', () => {
      const entrance = makeNode({ id: 'ent', type: 'transition', properties: { entityType: 'entrance' } })
      const hallway = makeNode({ id: 'hw', type: 'corridor' })
      const room = makeNode({ id: 'rm', type: 'space' })
      const graph = makeGraph({
        nodes: [entrance, hallway, room],
        edges: [
          makeEdge({ id: 'e1', from: 'ent', to: 'hw' }),
          makeEdge({ id: 'e2', from: 'hw', to: 'rm' }),
        ],
      })
      const ctx = buildContext(graph)
      expect(UnreachableRoomRule.validate(ctx)).toHaveLength(0)
    })

    it('fails when a room is in a disconnected island', () => {
      const entrance = makeNode({ id: 'ent', type: 'transition', properties: { entityType: 'entrance' } })
      const room = makeNode({ id: 'rm', type: 'space' })
      const graph = makeGraph({
        nodes: [entrance, room],
        edges: [], // no connections
      })
      const ctx = buildContext(graph)
      const results = UnreachableRoomRule.validate(ctx)
      expect(results).toHaveLength(1)
      expect(results[0].code).toBe('GRAPH_UNREACHABLE_ROOM')
    })

    it('passes when there are no rooms', () => {
      const graph = makeGraph({
        nodes: [makeNode({ id: 'ent', type: 'transition', properties: { entityType: 'entrance' } })],
      })
      const ctx = buildContext(graph)
      expect(UnreachableRoomRule.validate(ctx)).toHaveLength(0)
    })
  })

  describe('MissingEntranceRule', () => {
    it('passes when every building has a transition node', () => {
      const entrance = makeNode({ id: 'ent', type: 'transition', buildingId: 'b-1', properties: { entityType: 'entrance' } })
      const room = makeNode({ id: 'rm', type: 'space', buildingId: 'b-1' })
      const graph = makeGraph({ nodes: [entrance, room] })
      const ctx = buildContext(graph)
      expect(MissingEntranceRule.validate(ctx)).toHaveLength(0)
    })

    it('fails when a building has only space/corridor nodes', () => {
      const room = makeNode({ id: 'rm', type: 'space', buildingId: 'b-1' })
      const hallway = makeNode({ id: 'hw', type: 'corridor', buildingId: 'b-1' })
      const graph = makeGraph({ nodes: [room, hallway] })
      const ctx = buildContext(graph)
      const results = MissingEntranceRule.validate(ctx)
      expect(results).toHaveLength(1)
      expect(results[0].code).toBe('GRAPH_NO_REACHABLE_TRANSITION')
    })

    it('passes when building has staircase or elevator nodes', () => {
      const stairs = makeNode({ id: 'st', type: 'transition', buildingId: 'b-1', properties: { entityType: 'staircase' } })
      const room = makeNode({ id: 'rm', type: 'space', buildingId: 'b-1' })
      const graph = makeGraph({ nodes: [stairs, room] })
      const ctx = buildContext(graph)
      expect(MissingEntranceRule.validate(ctx)).toHaveLength(0)
    })
  })

  describe('DuplicateCoordsRule', () => {
    it('passes when all nodes have distinct coordinates', () => {
      const graph = makeGraph({
        nodes: [
          makeNode({ id: 'n1', position: { lat: 0, lng: 0 } }),
          makeNode({ id: 'n2', position: { lat: 1, lng: 1 } }),
        ],
      })
      const ctx = buildContext(graph)
      expect(DuplicateCoordsRule.validate(ctx)).toHaveLength(0)
    })

    it('warns when two nodes share the same coordinate', () => {
      const graph = makeGraph({
        nodes: [
          makeNode({ id: 'n1', position: { lat: 0, lng: 0 } }),
          makeNode({ id: 'n2', position: { lat: 0, lng: 0 } }),
        ],
      })
      const ctx = buildContext(graph)
      const results = DuplicateCoordsRule.validate(ctx)
      expect(results).toHaveLength(1)
      expect(results[0].severity).toBe('warning')
      expect(results[0].code).toBe('GRAPH_DUPLICATE_COORDINATES')
    })
  })

  describe('GraphValidator integration', () => {
    it('passes on a well-formed graph', () => {
      const entrance = makeNode({ id: 'ent', type: 'transition', buildingId: 'b-1', properties: { entityType: 'entrance' }, position: { lat: 0, lng: 0 } })
      const hallway = makeNode({ id: 'hw', type: 'corridor', buildingId: 'b-1', position: { lat: 0.001, lng: 0.001 } })
      const room = makeNode({ id: 'rm', type: 'space', buildingId: 'b-1', position: { lat: 0.002, lng: 0.002 } })
      const graph = makeGraph({
        nodes: [entrance, hallway, room],
        edges: [
          makeEdge({ id: 'e1', from: 'ent', to: 'hw' }),
          makeEdge({ id: 'e2', from: 'hw', to: 'rm' }),
        ],
      })

      const validator = new GraphValidator()
      validator.registerRules([
        DuplicateNodeRule,
        DuplicateEdgeRule,
        MissingNodeRefRule,
        ZeroWeightRule,
        DisconnectedGraphRule,
        UnreachableRoomRule,
        MissingEntranceRule,
        DuplicateCoordsRule,
      ])

      const report = validator.validate(graph)
      expect(report.passed).toBe(true)
      expect(report.errors).toHaveLength(0)
      expect(report.warnings).toHaveLength(0)
    })

    it('fails on a graph with multiple problems', () => {
      const room = makeNode({ id: 'rm', type: 'space', buildingId: 'b-1' })
      const graph = makeGraph({
        nodes: [
          makeNode({ id: 'rm', type: 'space', buildingId: 'b-1' }),
          makeNode({ id: 'rm', type: 'space', buildingId: 'b-1' }),
        ],
      })

      const validator = new GraphValidator()
      validator.registerRules([DuplicateNodeRule, MissingEntranceRule])
      const report = validator.validate(graph)
      expect(report.passed).toBe(false)
      expect(report.errors.length).toBeGreaterThanOrEqual(2)
    })

    it('populates statistics', () => {
      const n1 = makeNode({ id: 'n1', type: 'space', buildingId: 'b-1' })
      const n2 = makeNode({ id: 'n2', type: 'transition', buildingId: 'b-1', properties: { entityType: 'entrance' } })
      const n3 = makeNode({ id: 'n3', type: 'corridor', buildingId: 'b-1' })
      const graph = makeGraph({
        nodes: [n1, n2, n3],
        edges: [
          makeEdge({ id: 'e1', from: 'n1', to: 'n2', distance: 10, weight: 1 }),
          makeEdge({ id: 'e2', from: 'n2', to: 'n3', distance: 5, weight: 1 }),
        ],
      })

      const validator = new GraphValidator()
      const report = validator.validate(graph)
      expect(report.statistics.nodeCount).toBe(3)
      expect(report.statistics.edgeCount).toBe(2)
      expect(report.statistics.connectedComponents).toBe(1)
      expect(report.statistics.isolatedNodes).toBe(0)
      expect(report.statistics.buildingCount).toBe(1)
      expect(report.statistics.roomCount).toBe(1)
      expect(report.statistics.transitionCount).toBe(1)
      expect(report.statistics.hallwayCount).toBe(1)
      expect(report.statistics.totalRouteLength).toBe(15)
      expect(report.statistics.connectivityScore).toBe(1)
    })

    it('includes compiler and validator version', () => {
      const validator = new GraphValidator()
      const report = validator.validate(makeGraph({}))
      expect(report.compilerVersion).toBe('1.0.0')
      expect(report.validatorVersion).toBe('1.0.0')
    })
  })
})
