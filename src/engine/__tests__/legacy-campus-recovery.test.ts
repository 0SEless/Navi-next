/**
 * Fix 2 — validation on a safe fixture copy of the affected campus
 * (`map-map-1-k6bv`). No production campus data is mutated: the fixture is
 * loaded into memory, recovered, persisted through a JSON round trip, and
 * verified with the canonical router.
 */
import { describe, expect, it } from 'vitest'
import type { CampusDocument, Road } from '@navi/core'
import { Graph } from '../graph'
import { GraphAdapter } from '../../../packages/editor/src/graph-adapter'
import { createDocument } from '../../../packages/editor/src/context/create-editor-context'
import { serializeSnapshot } from '../../services/graph-snapshot-serializer'
import { findCanonicalRoutePath } from '../canonical-routing-adapter'
import {
  detectLegacyConnections,
  roadRecoveryApplyHandler,
} from '../../../packages/editor/src/commands/index'
import type { NavNode, NavEdge } from '@/types/nav-types'
import fixture from './fixtures/legacy-campus-roads.json'

interface FixtureRoad {
  id: string
  name: string
  points: Array<{ lat: number; lng: number }>
  width: number
  surface: string
  type: string
}

function buildDocument(): CampusDocument {
  const roads: Road[] = (fixture.roads as FixtureRoad[]).map((r) => ({
    id: r.id,
    name: r.name,
    polyline: { points: r.points.map((p) => ({ lat: p.lat, lng: p.lng })) },
    width: r.width,
    surface: 'paved',
    type: r.type === 'service' ? 'service' : 'arterial',
    metadata: {},
  }))
  return {
    schemaVersion: 1,
    version: 0,
    metadata: { campusId: fixture.campusId, name: fixture.campusId, description: '', lastModified: '', editorVersion: '0.1.0' },
    buildings: [],
    roads,
    panoramas: [],
    qrCheckpoints: [],
  }
}

function syncGraph(doc: CampusDocument): Graph {
  const graph = new Graph(fixture.campusId)
  new GraphAdapter(graph).sync(doc)
  return graph
}

function graphComponents(graph: Graph): { count: number; labelOf: Map<string, string> } {
  const parent = new Map<string, string>()
  for (const n of graph.nodes) parent.set(n.id, n.id)
  const find = (x: string): string => {
    while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))!); x = parent.get(x)! }
    return x
  }
  for (const e of graph.edges) {
    const a = find(e.from), b = find(e.to)
    if (a !== b) parent.set(a, b)
  }
  const roots = new Set(graph.nodes.map((n) => find(n.id)))
  return { count: roots.size, labelOf: new Map([...parent.keys()].map((id) => [id, find(id)])) }
}

function componentOfTrace(graph: Graph, traceId: string, position: { lat: number; lng: number }): NavNode | null {
  const nodes = graph.nodes.filter((n) => n.metadata?.traceId === traceId) as unknown as NavNode[]
  if (nodes.length === 0) return null
  let best = nodes[0]
  let bestD = Infinity
  for (const n of nodes) {
    const d = Math.hypot(n.position.lat - position.lat, n.position.lng - position.lng)
    if (d < bestD) { bestD = d; best = n }
  }
  return best
}

describe('legacy campus recovery (fixture copy)', () => {
  it('detects the legacy contacts, recovers high-confidence ones, routes and persists', () => {
    const doc = buildDocument()
    const graphBefore = syncGraph(doc)
    const before = graphComponents(graphBefore)
    const candidates = detectLegacyConnections(doc)
    const high = candidates.filter((c) => c.confidence === 'high')

    // eslint-disable-next-line no-console
    console.log('VALIDATION', JSON.stringify({
      beforeComponents: before.count,
      candidates: candidates.length,
      highConfidence: high.length,
      highPairs: high.map((c) => c.roadIds.join('↔')),
    }))

    // The fixture carries the 20 authored traces; each is its own component
    // before recovery (the saved snapshot's 21st node was an isolated
    // building entrance, which is not part of the road fixture).
    expect(before.count).toBe(20)
    expect(high.length).toBeGreaterThanOrEqual(2)
    expect(high.some((c) => c.roadIds.includes('T-1-zp21') && c.roadIds.includes('T-2-0qr0'))).toBe(true)
    expect(high.some((c) => c.roadIds.includes('T-1-ddva') && c.roadIds.includes('T-1-7x23'))).toBe(true)

    // Capture two endpoints that were in different components before recovery.
    const traceA = 'T-1-zp21'
    const traceB = 'T-2-0qr0'
    const nodeABefore = componentOfTrace(graphBefore, traceA, { lat: 11.8183007, lng: 122.1715982 })
    const nodeBBefore = componentOfTrace(graphBefore, traceB, { lat: 11.8183007, lng: 122.1715982 })
    expect(nodeABefore).not.toBeNull()
    expect(nodeBBefore).not.toBeNull()
    const edgesBefore = graphBefore.edges as unknown as NavEdge[]
    expect(findCanonicalRoutePath(
      graphBefore.nodes as unknown as NavNode[], edgesBefore, nodeABefore!.id, nodeBBefore!.id,
    )).toBeNull()

    // Approve the high-confidence set (explicit review action).
    const applied = roadRecoveryApplyHandler.execute(doc, { candidates: high })
    expect(applied.success).toBe(true)

    const graphAfter = syncGraph(doc)
    const after = graphComponents(graphAfter)
    const nodeAAfter = componentOfTrace(graphAfter, traceA, nodeABefore!.position)
    const nodeBAfter = componentOfTrace(graphAfter, traceB, nodeBBefore!.position)
    const route = findCanonicalRoutePath(
      graphAfter.nodes as unknown as NavNode[], graphAfter.edges as unknown as NavEdge[], nodeAAfter!.id, nodeBAfter!.id,
    )

    // eslint-disable-next-line no-console
    console.log('VALIDATION2', JSON.stringify({
      afterComponents: after.count,
      junctions: doc.roadJunctions?.map((j) => {
        const node = graphAfter.nodes.find((n) => n.metadata?.junctionRecordId === j.id)
        const degree = node ? graphAfter.edges.filter((e) => e.from === node.id || e.to === node.id).length : 0
        return { id: j.id, roads: j.roadIds, source: j.source, degree }
      }),
      routeFound: route !== null,
      routeNodes: route?.path.length ?? 0,
    }))

    expect(after.count).toBeLessThan(before.count)
    expect(doc.roadJunctions?.length).toBeGreaterThanOrEqual(2)
    expect(doc.roadJunctions?.every((j) => j.source === 'authored')).toBe(true)
    expect(route).not.toBeNull()

    // Persistence: save → reload → sync keeps authority and routing.
    const payload = serializeSnapshot(graphAfter.toJSON(), fixture.campusId)
    const restoredGraph = Graph.fromJSON(JSON.parse(JSON.stringify(payload)))
    const restoredDoc = createDocument(restoredGraph)
    expect(restoredDoc.roadJunctions?.length).toBe(doc.roadJunctions?.length)

    new GraphAdapter(restoredGraph).sync(restoredDoc)
    const nodeAReloaded = componentOfTrace(restoredGraph, traceA, nodeABefore!.position)
    const nodeBReloaded = componentOfTrace(restoredGraph, traceB, nodeBBefore!.position)
    const routeReloaded = findCanonicalRoutePath(
      restoredGraph.nodes as unknown as NavNode[], restoredGraph.edges as unknown as NavEdge[], nodeAReloaded!.id, nodeBReloaded!.id,
    )
    expect(routeReloaded).not.toBeNull()
    expect(restoredDoc.roadJunctions?.length).toBe(doc.roadJunctions?.length)
  })
})
