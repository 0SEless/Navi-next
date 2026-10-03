import { describe, expect, it } from 'vitest'

import { aStar } from '../a-star'
import { Graph } from '../graph'
import type { NavEdge, NavNode, TracePath } from '@/types/nav-types'

const makeTrace = (id: string, points: TracePath['points']): TracePath => ({
  id,
  campusId: 'test-campus',
  floor: 0,
  type: 'arterial',
  points,
})

const findTraceNode = (
  graph: Graph,
  traceId: string,
  predicate: (lat: number, lng: number) => boolean,
) => graph.nodes.find(
  (node) => node.metadata?.traceId === traceId && predicate(node.position.lat, node.position.lng),
)

const makeTraceNode = (id: string, traceId: string, position: TracePath['points'][number]): NavNode => ({
  id,
  label: id,
  name: id,
  type: 'intersection',
  campusId: 'test-campus',
  floor: 0,
  buildingId: '',
  position,
  metadata: { traceId },
})

const makeTraceEdge = (id: string, from: string, to: string): NavEdge => ({
  id,
  from,
  to,
  type: 'walk',
  distance: 1,
  weight: 1,
  campusId: 'test-campus',
})

describe('Graph trace intersections', () => {
  it('connects a trace endpoint to an existing trace without emitting a self-loop', () => {
    const graph = new Graph('test-campus')

    graph.addTraceWithCompile(makeTrace('main', [
      { lat: 0, lng: -0.001 },
      { lat: 0, lng: 0.001 },
    ]))
    graph.addTraceWithCompile(makeTrace('branch', [
      { lat: -0.001, lng: 0 },
      { lat: 0, lng: 0 },
    ]))

    const branchStart = findTraceNode(graph, 'branch', (lat) => lat < -0.0005)
    const mainLeft = findTraceNode(graph, 'main', (_, lng) => lng < -0.0005)

    expect(branchStart).toBeDefined()
    expect(mainLeft).toBeDefined()
    expect(graph.edges.some((edge) => edge.from === edge.to)).toBe(false)
    expect(graph.connectedComponentCount).toBe(1)
    expect(aStar(graph.nodes, graph.edges, branchStart!.id, mainLeft!.id)).not.toBeNull()
  })

  it('connects both sides of two traces that cross in their interiors', () => {
    const graph = new Graph('test-campus')

    graph.addTraceWithCompile(makeTrace('horizontal', [
      { lat: 0, lng: -0.001 },
      { lat: 0, lng: 0.001 },
    ]))
    graph.addTraceWithCompile(makeTrace('vertical', [
      { lat: -0.001, lng: 0 },
      { lat: 0.001, lng: 0 },
    ]))

    const horizontalLeft = findTraceNode(graph, 'horizontal', (_, lng) => lng < -0.0005)
    const horizontalRight = findTraceNode(graph, 'horizontal', (_, lng) => lng > 0.0005)
    const verticalBottom = findTraceNode(graph, 'vertical', (lat) => lat < -0.0005)
    const verticalTop = findTraceNode(graph, 'vertical', (lat) => lat > 0.0005)
    const junction = graph.nodes.find(
      (node) => node.metadata?.connectionNode === true &&
        Math.abs(node.position.lat) < 0.00001 && Math.abs(node.position.lng) < 0.00001,
    )

    expect(horizontalLeft).toBeDefined()
    expect(horizontalRight).toBeDefined()
    expect(verticalBottom).toBeDefined()
    expect(verticalTop).toBeDefined()
    expect(junction).toBeDefined()
    expect(graph.edges.filter((edge) => edge.from === junction!.id || edge.to === junction!.id)).toHaveLength(4)
    expect(graph.edges.some((edge) => edge.from === edge.to)).toBe(false)
    expect(graph.connectedComponentCount).toBe(1)
    expect(aStar(graph.nodes, graph.edges, horizontalLeft!.id, horizontalRight!.id)).not.toBeNull()
    expect(aStar(graph.nodes, graph.edges, verticalBottom!.id, verticalTop!.id)).not.toBeNull()
  })

  it('treats the authored final point as an endpoint when compiled endpoints are stored first', () => {
    const graph = new Graph('test-campus')

    graph.addTraceWithCompile(makeTrace('main', [
      { lat: 0, lng: -0.001 },
      { lat: 0, lng: 0.001 },
    ]))
    graph.addTraceWithCompile(makeTrace('branch', [
      { lat: 0, lng: 0.002 },
      { lat: -0.0005, lng: 0.0015 },
      { lat: 0, lng: 0 },
    ]))

    const branchEnd = findTraceNode(graph, 'branch', (lat, lng) =>
      Math.abs(lat) < 0.00001 && Math.abs(lng) < 0.00001,
    )

    expect(branchEnd).toBeDefined()
    expect(branchEnd!.metadata?.connectionNode).toBe(true)
    expect(branchEnd!.metadata?.traceIds).toEqual(expect.arrayContaining(['branch', 'main']))
    expect(graph.edges.some((edge) => edge.from === edge.to)).toBe(false)
    expect(graph.connectedComponentCount).toBe(1)
  })

  it('keeps split-chain segment indexes safe when an earlier direct edge is missing', () => {
    const graph = new Graph('test-campus')
    const main = makeTrace('main', [
      { lat: 0, lng: -0.002 },
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.002 },
    ])
    const branch = makeTrace('branch', [
      { lat: 0, lng: 0.001 },
      { lat: 0.001, lng: 0.001 },
    ])

    graph.addTrace(main)
    graph.addTrace(branch)

    graph.addNode(makeTraceNode('main-0', 'main', main.points[0]))
    graph.addNode(makeTraceNode('main-1', 'main', main.points[1]))
    graph.addNode(makeTraceNode('main-2', 'main', main.points[2]))
    graph.addEdge(makeTraceEdge('main-edge-1', 'main-1', 'main-2'))

    graph.addNode(makeTraceNode('branch-0', 'branch', branch.points[0]))
    graph.addNode(makeTraceNode('branch-1', 'branch', branch.points[1]))
    graph.addEdge(makeTraceEdge('branch-edge-0', 'branch-0', 'branch-1'))

    expect(() => graph.syncTraceIntersections('branch')).not.toThrow()

    const branchStart = graph.getNode('branch-0')
    expect(branchStart?.metadata?.connectionNode).toBe(true)
    expect(branchStart?.metadata?.traceIds).toEqual(expect.arrayContaining(['branch', 'main']))
    expect(graph.edges.some((edge) => edge.from === edge.to)).toBe(false)
  })
})
