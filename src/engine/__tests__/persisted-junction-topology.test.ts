import { describe, expect, it } from 'vitest'
import type { CampusDocument, Road, RoadJunction, SeparatedCrossing } from '@navi/core'
import { Graph } from '../graph'
import { aStar } from '../a-star'
import { GraphAdapter } from '../../../packages/editor/src/graph-adapter'
import { createDocument } from '../../../packages/editor/src/context/create-editor-context'

const ROAD_A: Road = {
  id: 'road-a',
  name: 'Road A',
  polyline: {
    points: [
      { lat: 0, lng: -0.001 },
      { lat: 0, lng: 0.001 },
    ],
  },
  width: 8,
  surface: 'paved',
  type: 'arterial',
  metadata: {},
}

const ROAD_B: Road = {
  id: 'road-b',
  name: 'Road B',
  polyline: {
    points: [
      { lat: 0, lng: 0 },
      { lat: 0.001, lng: 0 },
    ],
  },
  width: 8,
  surface: 'paved',
  type: 'arterial',
  metadata: {},
}

const PERSISTED_JUNCTION: RoadJunction = {
  id: 'j-persisted',
  position: { lat: 0, lng: 0 },
  roadIds: ['road-a', 'road-b'],
  source: 'authored',
}

function makeDocument(
  roads: Road[] = [ROAD_A, ROAD_B],
  roadJunctions: RoadJunction[] = [PERSISTED_JUNCTION],
  separatedCrossings?: SeparatedCrossing[],
): CampusDocument {
  return {
    schemaVersion: 1,
    version: 0,
    metadata: {
      campusId: 'test-campus',
      name: 'Test Campus',
      description: '',
      lastModified: '',
      editorVersion: 'test',
    },
    buildings: [],
    roads,
    panoramas: [],
    qrCheckpoints: [],
    roadJunctions: roadJunctions.map(junction => ({ ...junction, roadIds: [...junction.roadIds] })),
    separatedCrossings,
  }
}

function syncDocument(document: CampusDocument): Graph {
  const graph = new Graph('test-campus')
  new GraphAdapter(graph).sync(document)
  return graph
}

function syncThroughReload(document: CampusDocument): { graph: Graph; reloadedDocument: CampusDocument } {
  const graph = syncDocument(document)

  const serialized = JSON.parse(JSON.stringify(graph.toJSON()))
  const restoredGraph = Graph.fromJSON(serialized)
  const reloadedDocument = createDocument(restoredGraph)

  const reloadedGraph = new Graph('test-campus')
  new GraphAdapter(reloadedGraph).sync(reloadedDocument)
  return { graph: reloadedGraph, reloadedDocument }
}

function nodesForTrace(graph: Graph, traceId: string) {
  return graph.nodes.filter(node => node.metadata?.traceId === traceId)
}

function hasUndirectedEdge(graph: Graph, nodeA: string, nodeB: string): boolean {
  return graph.edges.some(edge =>
    (edge.from === nodeA && edge.to === nodeB) ||
    (edge.from === nodeB && edge.to === nodeA)
  )
}

function degree(graph: Graph, nodeId: string): number {
  return graph.edges.filter(edge => edge.from === nodeId || edge.to === nodeId).length
}

function makeRoad(id: string, points: Array<{ lat: number; lng: number }>): Road {
  return {
    id,
    name: id,
    polyline: { points },
    width: 8,
    surface: 'paved',
    type: 'arterial',
    metadata: {},
  }
}

function makeJunction(id: string, position: { lat: number; lng: number }, roadIds: string[]): RoadJunction {
  return { id, position, roadIds, source: 'authored' }
}

function nodeAt(graph: Graph, traceId: string, position: { lat: number; lng: number }) {
  return nodesForTrace(graph, traceId).find(node =>
    Math.abs(node.position.lat - position.lat) < 0.00001 &&
    Math.abs(node.position.lng - position.lng) < 0.00001
  )
}

function edgeBetween(graph: Graph, nodeA: string, nodeB: string) {
  return graph.edges.find(edge =>
    (edge.from === nodeA && edge.to === nodeB) ||
    (edge.from === nodeB && edge.to === nodeA)
  )
}

describe('persisted junction topology', () => {
  it('routes through a persisted junction after reload', () => {
    const document = makeDocument()
    const { graph, reloadedDocument } = syncThroughReload(document)
    const junction = graph.getNode('j-persisted')
    const roadANodes = nodesForTrace(graph, 'road-a')
    const roadBNodes = nodesForTrace(graph, 'road-b')
    const roadAStart = roadANodes.find(node => node.position.lng < -0.0005)
    const roadAEnd = roadANodes.find(node => node.position.lng > 0.0005)
    const roadBStart = roadBNodes.find(node => Math.abs(node.position.lat) < 0.00001)
    const roadBEnd = roadBNodes.find(node => node.position.lat > 0.0005)

    expect(junction).toBeDefined()
    expect(junction!.metadata?.traceIds).toEqual(expect.arrayContaining(['road-a', 'road-b']))
    expect(roadBStart).toBeDefined()
    expect(hasUndirectedEdge(graph, roadBStart!.id, junction!.id)).toBe(true)
    expect(roadAStart).toBeDefined()
    expect(roadAEnd).toBeDefined()
    expect(hasUndirectedEdge(graph, roadAStart!.id, junction!.id)).toBe(true)
    expect(hasUndirectedEdge(graph, junction!.id, roadAEnd!.id)).toBe(true)
    expect(hasUndirectedEdge(graph, roadAStart!.id, roadAEnd!.id)).toBe(false)
    expect(degree(graph, junction!.id)).toBeGreaterThanOrEqual(3)
    expect(graph.connectedComponentCount).toBe(1)
    expect(roadBEnd).toBeDefined()
    expect(roadAStart).toBeDefined()
    expect(aStar(graph.nodes, graph.edges, roadBEnd!.id, roadAStart!.id)).not.toBeNull()
    expect(aStar(graph.nodes, graph.edges, roadAStart!.id, roadAEnd!.id)).not.toBeNull()
    expect(aStar(graph.nodes, graph.edges, roadBStart!.id, roadBEnd!.id)).not.toBeNull()
    expect(reloadedDocument.roadJunctions).toEqual([
      expect.objectContaining({ id: 'j-persisted', roadIds: expect.arrayContaining(['road-a', 'road-b']) }),
    ])
    expect(reloadedDocument.roads.map(road => road.polyline.points)).toEqual([
      ROAD_A.polyline.points,
      ROAD_B.polyline.points,
    ])
  })

  it('attaches three roads to one persisted T junction', () => {
    const junctionPosition = { lat: 0, lng: 0 }
    const roadA = makeRoad('road-a', [
      { lat: 0, lng: -0.002 },
      { lat: 0, lng: 0.002 },
    ])
    const roadB = makeRoad('road-b', [
      junctionPosition,
      { lat: 0.002, lng: 0 },
    ])
    const roadC = makeRoad('road-c', [
      junctionPosition,
      { lat: -0.002, lng: 0 },
    ])
    const { graph, reloadedDocument } = syncThroughReload(makeDocument(
      [roadA, roadB, roadC],
      [makeJunction('j-t', junctionPosition, ['road-a', 'road-b', 'road-c'])],
    ))

    const junction = graph.getNode('j-t')
    const aStart = nodeAt(graph, 'road-a', { lat: 0, lng: -0.002 })
    const bEnd = nodeAt(graph, 'road-b', { lat: 0.002, lng: 0 })
    const cEnd = nodeAt(graph, 'road-c', { lat: -0.002, lng: 0 })

    expect(junction).toBeDefined()
    expect(junction!.metadata?.traceIds).toEqual(expect.arrayContaining(['road-a', 'road-b', 'road-c']))
    expect(degree(graph, 'j-t')).toBeGreaterThanOrEqual(4)
    expect(graph.connectedComponentCount).toBe(1)
    expect(aStart).toBeDefined()
    expect(bEnd).toBeDefined()
    expect(cEnd).toBeDefined()
    expect(aStar(graph.nodes, graph.edges, bEnd!.id, aStart!.id)).not.toBeNull()
    expect(aStar(graph.nodes, graph.edges, bEnd!.id, cEnd!.id)).not.toBeNull()
    expect(reloadedDocument.roadJunctions).toEqual([
      expect.objectContaining({ id: 'j-t', roadIds: expect.arrayContaining(['road-a', 'road-b', 'road-c']) }),
    ])
  })

  it('splits both interior arms of a persisted X junction without duplicating its ID', () => {
    const junctionPosition = { lat: 0, lng: 0 }
    const horizontal = makeRoad('horizontal', [
      { lat: 0, lng: -0.002 },
      { lat: 0, lng: 0.002 },
    ])
    const vertical = makeRoad('vertical', [
      { lat: -0.002, lng: 0 },
      { lat: 0.002, lng: 0 },
    ])
    const { graph } = syncThroughReload(makeDocument(
      [horizontal, vertical],
      [makeJunction('j-x', junctionPosition, ['horizontal', 'vertical'])],
    ))

    const horizontalStart = nodeAt(graph, 'horizontal', { lat: 0, lng: -0.002 })
    const horizontalEnd = nodeAt(graph, 'horizontal', { lat: 0, lng: 0.002 })
    const verticalStart = nodeAt(graph, 'vertical', { lat: -0.002, lng: 0 })
    const verticalEnd = nodeAt(graph, 'vertical', { lat: 0.002, lng: 0 })
    const sharedNodes = graph.nodes.filter(node =>
      node.metadata?.connectionNode === true &&
      (node.metadata?.traceIds as string[] | undefined)?.includes('horizontal') &&
      (node.metadata?.traceIds as string[] | undefined)?.includes('vertical')
    )

    expect(sharedNodes).toHaveLength(1)
    expect(sharedNodes[0].id).toBe('j-x')
    expect(degree(graph, 'j-x')).toBeGreaterThanOrEqual(4)
    expect(graph.connectedComponentCount).toBe(1)
    expect(horizontalStart).toBeDefined()
    expect(horizontalEnd).toBeDefined()
    expect(verticalStart).toBeDefined()
    expect(verticalEnd).toBeDefined()
    expect(edgeBetween(graph, horizontalStart!.id, 'j-x')).toBeDefined()
    expect(edgeBetween(graph, 'j-x', horizontalEnd!.id)).toBeDefined()
    expect(edgeBetween(graph, verticalStart!.id, 'j-x')).toBeDefined()
    expect(edgeBetween(graph, 'j-x', verticalEnd!.id)).toBeDefined()
    expect(aStar(graph.nodes, graph.edges, horizontalStart!.id, verticalEnd!.id)).not.toBeNull()
  })

  it('orders multiple persisted junctions along one road independent of road order', () => {
    const j1Position = { lat: 0, lng: -0.001 }
    const j2Position = { lat: 0, lng: 0.001 }
    const roadA = makeRoad('road-a', [
      { lat: 0, lng: -0.003 },
      { lat: 0, lng: 0.003 },
    ])
    const roadC = makeRoad('road-c', [
      j1Position,
      { lat: 0.002, lng: -0.001 },
    ])
    const roadD = makeRoad('road-d', [
      j2Position,
      { lat: 0.002, lng: 0.001 },
    ])
    const junctions = [
      makeJunction('j-1', j1Position, ['road-a', 'road-c']),
      makeJunction('j-2', j2Position, ['road-a', 'road-d']),
    ]

    const first = syncThroughReload(makeDocument([roadA, roadC, roadD], junctions)).graph
    const reversed = syncThroughReload(makeDocument([roadD, roadC, roadA], junctions)).graph

    for (const graph of [first, reversed]) {
      const aStart = nodeAt(graph, 'road-a', { lat: 0, lng: -0.003 })
      const aEnd = nodeAt(graph, 'road-a', { lat: 0, lng: 0.003 })
      const cEnd = nodeAt(graph, 'road-c', { lat: 0.002, lng: -0.001 })
      const dEnd = nodeAt(graph, 'road-d', { lat: 0.002, lng: 0.001 })

      expect(aStart).toBeDefined()
      expect(aEnd).toBeDefined()
      expect(cEnd).toBeDefined()
      expect(dEnd).toBeDefined()
      expect(edgeBetween(graph, aStart!.id, 'j-1')).toBeDefined()
      expect(edgeBetween(graph, 'j-1', 'j-2')).toBeDefined()
      expect(edgeBetween(graph, 'j-2', aEnd!.id)).toBeDefined()
      expect(edgeBetween(graph, aStart!.id, 'j-2')).toBeUndefined()
      expect(edgeBetween(graph, 'j-1', aEnd!.id)).toBeUndefined()
      expect(aStar(graph.nodes, graph.edges, cEnd!.id, dEnd!.id)).not.toBeNull()
      expect(graph.connectedComponentCount).toBe(1)
    }
  })

  it('keeps a persisted Keep Separate crossing disconnected', () => {
    const horizontal = makeRoad('horizontal', [
      { lat: 0, lng: -0.002 },
      { lat: 0, lng: 0.002 },
    ])
    const vertical = makeRoad('vertical', [
      { lat: -0.002, lng: 0 },
      { lat: 0.002, lng: 0 },
    ])
    const graph = syncDocument({
      ...makeDocument([horizontal, vertical], []),
      separatedCrossings: [{
        id: 'sc-crossing',
        roadIds: ['horizontal', 'vertical'],
        position: { lat: 0, lng: 0 },
      }],
    })
    const horizontalStart = nodeAt(graph, 'horizontal', { lat: 0, lng: -0.002 })
    const verticalEnd = nodeAt(graph, 'vertical', { lat: 0.002, lng: 0 })

    expect(graph.nodes.find(node => node.id === 'sc-crossing')).toBeUndefined()
    expect(graph.connectedComponentCount).toBe(2)
    expect(horizontalStart).toBeDefined()
    expect(verticalEnd).toBeDefined()
    expect(aStar(graph.nodes, graph.edges, horizontalStart!.id, verticalEnd!.id)).toBeNull()
  })
})
