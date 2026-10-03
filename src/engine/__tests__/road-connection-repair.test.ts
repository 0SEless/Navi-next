/**
 * Road connectivity repair — integration tests (Fix 1 + persistence).
 *
 * Covers: derived graph shared topology, A* traversal, save → reload → sync
 * persistence of authored junctions, and SeparatedCrossing serialization.
 */
import { describe, expect, it } from 'vitest'
import type { CampusDocument, Road, RoadJunction } from '@navi/core'
import { Graph } from '../graph'
import { GraphAdapter, reconcileAuthoredJunctions } from '../../../packages/editor/src/graph-adapter'
import { createDocument } from '../../../packages/editor/src/context/create-editor-context'
import { serializeSnapshot } from '../../services/graph-snapshot-serializer'
import { roadCreateHandler } from '../../../packages/editor/src/commands/road-handlers'
import { findCanonicalRoutePath } from '../canonical-routing-adapter'
import type { NavNode, NavEdge } from '@/types/nav-types'

function docWithRoads(roads: Road[], junctions?: RoadJunction[]): CampusDocument {
  return {
    schemaVersion: 1,
    version: 0,
    metadata: { campusId: 'test', name: 'test', description: '', lastModified: '', editorVersion: '0.1.0' },
    buildings: [],
    roads,
    panoramas: [],
    qrCheckpoints: [],
    roadJunctions: junctions,
  }
}

const TARGET: Road = {
  id: 'road-target',
  name: 'Target',
  polyline: { points: [{ lat: 0, lng: -0.001 }, { lat: 0, lng: 0.001 }] },
  width: 8, surface: 'paved', type: 'arterial', metadata: {},
}

function syncGraph(doc: CampusDocument): Graph {
  const graph = new Graph('test')
  new GraphAdapter(graph).sync(doc)
  return graph
}

function distance(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  return Math.hypot(a.lat - b.lat, a.lng - b.lng)
}

/** Route between the two farthest-apart endpoint nodes of two traces. */
function routeAcross(graph: Graph, traceA: string, traceB: string) {
  const nodes = graph.nodes as unknown as NavNode[]
  const edges = graph.edges as unknown as NavEdge[]
  const a = nodes.filter((n) => n.metadata?.traceId === traceA)
  const b = nodes.filter((n) => n.metadata?.traceId === traceB)
  if (a.length === 0 || b.length === 0) return null
  let best: [NavNode, NavNode] | null = null
  let bestDist = -1
  for (const na of a) {
    for (const nb of b) {
      const d = distance(na.position, nb.position)
      if (d > bestDist) { bestDist = d; best = [na, nb] }
    }
  }
  if (!best) return null
  return findCanonicalRoutePath(nodes, edges, best[0].id, best[1].id)
}

function sharedJunctionNodes(graph: Graph, roadA: string, roadB: string): NavNode[] {
  return (graph.nodes as unknown as NavNode[]).filter((n) => {
    const ids = n.metadata?.traceIds as string[] | undefined
    return n.metadata?.connectionNode === true && Array.isArray(ids) && ids.includes(roadA) && ids.includes(roadB)
  })
}

describe('road connection repair — integration', () => {
  it('Connect endpoint→endpoint: shared junction and A* routes across', () => {
    const doc = docWithRoads([TARGET])
    roadCreateHandler.execute(doc, {
      id: 'road-new',
      name: 'New',
      points: [{ lat: 0, lng: -0.001 }, { lat: 0.001, lng: -0.001 }],
      connections: [{ pointIndex: 0, action: 'connect', kind: 'road-endpoint', targetRoadId: 'road-target', position: { lat: 0, lng: -0.001 } }],
    })

    const graph = syncGraph(doc)
    expect(sharedJunctionNodes(graph, 'road-target', 'road-new').length).toBeGreaterThanOrEqual(1)
    expect(routeAcross(graph, 'road-target', 'road-new')).not.toBeNull()
  })

  it('Connect endpoint→segment: target edge splits at the shared junction (degree ≥ 3)', () => {
    const doc = docWithRoads([TARGET])
    roadCreateHandler.execute(doc, {
      id: 'road-new',
      name: 'New',
      points: [{ lat: 0, lng: 0 }, { lat: 0.001, lng: 0 }],
      connections: [{ pointIndex: 0, action: 'connect', kind: 'road-segment', targetRoadId: 'road-target', position: { lat: 0, lng: 0 } }],
    })

    const graph = syncGraph(doc)
    const junctions = sharedJunctionNodes(graph, 'road-target', 'road-new')
    expect(junctions).toHaveLength(1)
    const junctionId = junctions[0].id
    const degree = graph.edges.filter((e) => e.from === junctionId || e.to === junctionId).length
    expect(degree).toBeGreaterThanOrEqual(3)
    expect(routeAcross(graph, 'road-target', 'road-new')).not.toBeNull()
  })

  it('Connect endpoint→existing junction merges instead of duplicating', () => {
    const other: Road = {
      id: 'road-other',
      name: 'Other',
      polyline: { points: [{ lat: -0.001, lng: 0 }, { lat: 0.001, lng: 0 }] },
      width: 8, surface: 'paved', type: 'arterial', metadata: {},
    }
    const existing: RoadJunction = {
      id: 'j-existing',
      position: { lat: 0, lng: 0 },
      roadIds: ['road-target', 'road-other'],
      source: 'authored',
    }
    const doc = docWithRoads([TARGET, other], [existing])
    roadCreateHandler.execute(doc, {
      id: 'road-new',
      name: 'New',
      points: [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.001 }],
      connections: [{ pointIndex: 0, action: 'connect', kind: 'existing-junction', targetRoadId: 'road-target', junctionId: 'j-existing', position: { lat: 0, lng: 0 } }],
    })

    expect(doc.roadJunctions).toHaveLength(1)
    expect(doc.roadJunctions![0].roadIds).toEqual(expect.arrayContaining(['road-target', 'road-other', 'road-new']))

    const graph = syncGraph(doc)
    const mergesIntoExisting = sharedJunctionNodes(graph, 'road-target', 'road-new')
    expect(mergesIntoExisting.length).toBeGreaterThanOrEqual(1)
    expect(routeAcross(graph, 'road-other', 'road-new')).not.toBeNull()
  })

  it('Interior crossing without an explicit decision stays disconnected', () => {
    const doc = docWithRoads([TARGET])
    roadCreateHandler.execute(doc, {
      id: 'road-new',
      name: 'New',
      points: [
        { lat: 0.001, lng: -0.001 },
        { lat: 0, lng: 0 },
        { lat: -0.001, lng: 0.001 },
      ],
    })

    const graph = syncGraph(doc)
    expect(sharedJunctionNodes(graph, 'road-target', 'road-new')).toHaveLength(0)
    expect(routeAcross(graph, 'road-target', 'road-new')).toBeNull()
  })

  it('Beyond 0.5 m: created road stays a separate component', () => {
    const doc = docWithRoads([TARGET])
    roadCreateHandler.execute(doc, {
      id: 'road-new',
      name: 'New',
      points: [{ lat: 0.000006, lng: 0 }, { lat: 0.002, lng: 0 }],
    })
    const graph = syncGraph(doc)
    expect(sharedJunctionNodes(graph, 'road-target', 'road-new')).toHaveLength(0)
    expect(graph.connectedComponentCount).toBe(2)
  })

  it('Keep Separate crossing persists a SeparatedCrossing through serialization and reload', () => {
    const doc = docWithRoads([TARGET])
    roadCreateHandler.execute(doc, {
      id: 'road-new',
      name: 'New',
      points: [
        { lat: 0.001, lng: -0.001 },
        { lat: 0, lng: 0 },
        { lat: -0.001, lng: 0.001 },
      ],
      connections: [{ pointIndex: 1, action: 'separate', kind: 'road-segment', targetRoadId: 'road-target', position: { lat: 0, lng: 0 } }],
    })

    const graph = syncGraph(doc)
    expect(graph.separatedCrossings).toHaveLength(1)

    const payload = serializeSnapshot(graph.toJSON(), 'test')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((payload as any).separatedCrossings).toHaveLength(1)

    const restored = Graph.fromJSON(JSON.parse(JSON.stringify(payload)))
    expect(restored.separatedCrossings).toHaveLength(1)

    const restoredDoc = createDocument(restored)
    expect(restoredDoc.separatedCrossings).toHaveLength(1)
  })

  it('Save → reload → sync keeps the authored junction and routing', () => {
    const doc = docWithRoads([TARGET])
    roadCreateHandler.execute(doc, {
      id: 'road-new',
      name: 'New',
      points: [{ lat: 0, lng: -0.001 }, { lat: 0.001, lng: -0.001 }],
      connections: [{ pointIndex: 0, action: 'connect', kind: 'road-endpoint', targetRoadId: 'road-target', position: { lat: 0, lng: -0.001 } }],
    })

    const graph = syncGraph(doc)
    const payload = serializeSnapshot(graph.toJSON(), 'test')
    const restoredGraph = Graph.fromJSON(JSON.parse(JSON.stringify(payload)))
    const restoredDoc = createDocument(restoredGraph)

    expect(restoredDoc.roadJunctions).toHaveLength(1)
    expect(restoredDoc.roadJunctions![0].roadIds).toEqual(expect.arrayContaining(['road-target', 'road-new']))

    new GraphAdapter(restoredGraph).sync(restoredDoc)
    // After the reload sync, authority must remain and the route must still work.
    expect(restoredDoc.roadJunctions).toHaveLength(1)
    expect(routeAcross(restoredGraph, 'road-target', 'road-new')).not.toBeNull()
  })

  it('reconcileAuthoredJunctions preserves valid records when no matching node is regenerated', () => {
    const junction: RoadJunction = {
      id: 'j-authored',
      position: { lat: 0, lng: 0 },
      roadIds: ['road-a', 'road-b'],
      source: 'authored',
    }
    const kept = reconcileAuthoredJunctions({
      existing: [junction],
      junctionNodes: [],
      actualTraceIds: new Set(['road-a', 'road-b']),
      validRoadIds: new Set(['road-a', 'road-b']),
    })
    expect(kept).toHaveLength(1)
    expect(kept[0].id).toBe('j-authored')
    expect(kept[0].source).toBe('authored')

    const dropped = reconcileAuthoredJunctions({
      existing: [junction],
      junctionNodes: [],
      actualTraceIds: new Set(['road-a']),
      validRoadIds: new Set(['road-a']),
    })
    expect(dropped).toHaveLength(0)
  })
})
