import { describe, it, expect, beforeEach } from 'vitest'
import { Graph } from '../graph'
import type { NavNode, NavEdge, Building, Component, TracePath } from '@/types/nav-types'

const nodeA: NavNode = {
  id: 'N001', label: 'Node A', name: 'Node A', type: 'intersection',
  buildingId: 'BLD01', campusId: 'asu-ibajay', floor: 0, position: { lat: 11.8195, lng: 122.0922 },
}
const nodeB: NavNode = {
  id: 'N002', label: 'Node B', name: 'Node B', type: 'intersection',
  buildingId: 'BLD01', campusId: 'asu-ibajay', floor: 0, position: { lat: 11.8196, lng: 122.0923 },
}
const nodeC: NavNode = {
  id: 'N003', label: 'Node C', name: 'Node C', type: 'room',
  buildingId: 'BLD01', campusId: 'asu-ibajay', floor: 1, position: { lat: 11.8197, lng: 122.0924 },
}

const edgeAB: NavEdge = {
  id: 'E001', from: 'N001', to: 'N002', type: 'walkway', distance: 20, weight: 20, campusId: 'asu-ibajay',
}

const building: Building = {
  id: 'BLD01', name: 'Admin', description: 'Admin building',
  campusId: 'asu-ibajay', center: { lat: 11.8195, lng: 122.0922 },
  floors: [0, 1, 2], footprint: [{ lat: 11.8195, lng: 122.0922 }], baseElevation: 0, height: 10,
}

describe('Graph', () => {
  let graph: Graph

  beforeEach(() => {
    graph = new Graph()
  })

  it('starts empty', () => {
    expect(graph.nodes).toHaveLength(0)
    expect(graph.edges).toHaveLength(0)
    expect(graph.buildings).toHaveLength(0)
    expect(graph.components).toHaveLength(0)
  })

  it('adds and retrieves nodes', () => {
    graph.addNode(nodeA)
    expect(graph.nodes).toHaveLength(1)
    expect(graph.getNode('N001')).toEqual(nodeA)
  })

  it('adds and retrieves edges', () => {
    graph.addNode(nodeA)
    graph.addNode(nodeB)
    graph.addEdge(edgeAB)
    expect(graph.edges).toHaveLength(1)
    expect(graph.getEdge('E001')).toEqual(edgeAB)
  })

  it('removes node and cascading edges', () => {
    graph.addNode(nodeA)
    graph.addNode(nodeB)
    graph.addEdge(edgeAB)
    graph.removeNode('N001')
    expect(graph.getNode('N001')).toBeUndefined()
    expect(graph.edges).toHaveLength(0)
  })

  it('finds path via A*', () => {
    graph.addNode(nodeA)
    graph.addNode(nodeB)
    graph.addEdge(edgeAB)
    const result = graph.findPath('N001', 'N002')
    expect(result).not.toBeNull()
    expect(result!.path).toEqual(['N001', 'N002'])
  })

  it('finds nearest node within max distance', () => {
    graph.addNode(nodeA)
    graph.addNode(nodeB)
    const near = graph.getNearestNode({ lat: 11.81952, lng: 122.09222 }, 50)
    expect(near?.id).toBe('N001')
  })

  it('returns null when no node is near enough', () => {
    graph.addNode(nodeA)
    const far = graph.getNearestNode({ lat: 12.0, lng: 122.0 }, 50)
    expect(far).toBeNull()
  })

  it('filters nodes by building', () => {
    graph.addNode({ ...nodeA, buildingId: 'BLD01' })
    graph.addNode({ ...nodeB, buildingId: 'BLD02' })
    expect(graph.getNodesByBuilding('BLD01')).toHaveLength(1)
  })

  it('filters nodes by floor', () => {
    graph.addNode({ ...nodeA, buildingId: 'BLD01', floor: 0 })
    graph.addNode({ ...nodeC, buildingId: 'BLD01', floor: 1 })
    expect(graph.getNodesByFloor('BLD01', 0)).toHaveLength(1)
    expect(graph.getNodesByFloor('BLD01', 1)).toHaveLength(1)
  })

  it('serializes and deserializes via JSON', () => {
    graph.addBuilding(building)
    graph.addNode(nodeA)
    graph.addNode(nodeB)
    graph.addEdge(edgeAB)
    const json = graph.toJSON()
    const restored = Graph.fromJSON(json)
    expect(restored.buildings).toHaveLength(1)
    expect(restored.nodes).toHaveLength(2)
    expect(restored.edges).toHaveLength(1)
    expect(restored.getNode('N001')?.label).toBe('Node A')
  })

  it('validates graph', () => {
    graph.addNode(nodeA)
    graph.addNode(nodeB)
    graph.addEdge(edgeAB)
    const results = graph.validate()
    expect(results.length).toBeGreaterThan(0)
  })

  it('builds directory from buildings', () => {
    graph.addBuilding(building)
    graph.addNode({ ...nodeA, buildingId: 'BLD01', type: 'building_entrance' })
    const dir = graph.getDirectory()
    expect(dir).toHaveLength(1)
    expect(dir[0].label).toBe('Admin')
  })

  it('adds and removes components', () => {
    const component: Component = {
      id: 'C001', type: 'room', name: 'Room 101',
      buildingId: 'BLD01', floor: 1, position: { lat: 11.8195, lng: 122.0922 },
    }
    graph.addComponent(component)
    expect(graph.components).toHaveLength(1)
    graph.removeComponent('C001')
    expect(graph.components).toHaveLength(0)
  })
})

describe('Graph trace operations', () => {
  let graph: Graph

  beforeEach(() => {
    graph = new Graph()
  })

  it('adds and retrieves traces', () => {
    const trace: TracePath = {
      id: 'T001', floor: 0,
      points: [{ lat: 11.8195, lng: 122.0922 }, { lat: 11.8196, lng: 122.0923 }],
      type: 'arterial',
    }
    graph.addTrace(trace)
    expect(graph.traces).toHaveLength(1)
    expect(graph.getTrace('T001')?.id).toBe('T001')
  })

  it('removes trace and its generated nodes/edges', () => {
    const trace: TracePath = {
      id: 'T001', floor: 0,
      points: [{ lat: 11.8195, lng: 122.0922 }, { lat: 11.8196, lng: 122.0923 }],
      type: 'arterial',
    }
    graph.addTraceWithCompile(trace)
    expect(graph.traces).toHaveLength(1)
    const nodeCount = graph.nodes.length
    graph.removeTrace('T001')
    expect(graph.traces).toHaveLength(0)
    expect(graph.nodes.length).toBeLessThan(nodeCount)
  })

  it('sets edges with new edge types', () => {
    graph.addNode({ id: 'N001', label: 'A', name: 'A', type: 'intersection', buildingId: 'BLD01', campusId: 'asu-ibajay', floor: 0, position: { lat: 0, lng: 0 } })
    graph.addNode({ id: 'N002', label: 'B', name: 'B', type: 'intersection', buildingId: 'BLD01', campusId: 'asu-ibajay', floor: 0, position: { lat: 0, lng: 1 } })
    graph.addEdge({ id: 'E001', from: 'N001', to: 'N002', type: 'walk', distance: 100, weight: 100, campusId: 'asu-ibajay' })
    const edge = graph.getEdge('E001')
    expect(edge?.type).toBe('walk')
  })
})
