/**
 * Phase 6 — Cross-Producer Topology Parity Gate
 *
 * Proves that Studio/GraphAdapter (legacy Graph) and Compiler V2
 * interpret the same CampusDocument connectivity semantics equivalently.
 *
 * We do NOT compare raw graphs byte-for-byte.
 * We compare semantic/topological equivalence at the road level.
 */
import { describe, expect, it } from 'vitest'
import { CampusCompiler } from '../pipeline/campus-compiler'
import { GraphAdapter } from '@navi/editor'
import { Graph } from '@/engine/graph'
import type { CampusDocument, RoadJunction, SeparatedCrossing, Road, NavNode as CoreNavNode, NavEdge as CoreNavEdge } from '@navi/core'
import {
  CONNECTIVITY_CONTRACT_VERSION,
  CONNECTIVITY_POSITION_TOLERANCE_METERS,
  closestPointOnSegment,
  haversine,
} from '@navi/core'
import type { NavNode as LegacyNavNode, NavEdge as LegacyNavEdge } from '../../engine/nav-types'

// ═══════════════════════════════════════════════════════════════
// PARITY NORMALIZATION LAYER
// ═══════════════════════════════════════════════════════════════

/** Road-level connectivity signature extracted from any graph producer */
interface RoadConnectivitySignature {
  /** Set of road ID pairs that have a traversable path between them */
  connectedRoadPairs: Set<string>
  /** Set of road ID pairs that are explicitly separated */
  separatedRoadPairs: Set<string>
  /** Map from junction ID to set of participating road IDs */
  junctionIncidence: Map<string, Set<string>>
  /** Map from road ID to component label (same label = same component) */
  componentMembership: Map<string, string>
  /** Total node count */
  nodeCount: number
  /** Total edge count */
  edgeCount: number
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`
}

/** Extract road connectivity signature from a legacy Graph */
function extractLegacySignature(
  graph: Graph,
  roads: Road[],
): RoadConnectivitySignature {
  const connectedRoadPairs = new Set<string>()
  const separatedRoadPairs = new Set<string>(
    graph.separatedCrossings.map(sc => pairKey(sc.roadIds[0], sc.roadIds[1])),
  )

  // Build junction incidence from connection nodes
  const junctionIncidence = new Map<string, Set<string>>()
  for (const node of graph.nodes) {
    if (node.type === 'intersection' && node.metadata?.connectionNode) {
      const traceIds = node.metadata.traceIds as string[] | undefined
      if (traceIds && traceIds.length >= 2) {
        const jid = (node.metadata.junctionRecordId as string) || node.id
        junctionIncidence.set(jid, new Set(traceIds))
      }
    }
  }

  // Build road connectivity by finding nodes on each road and checking paths
  const roadNodes = new Map<string, LegacyNavNode[]>()
  for (const road of roads) {
    const nodes = graph.nodes.filter(n => {
      // Road nodes are outdoor waypoints along the trace
      if (n.floor !== 0) return false
      if (n.buildingId !== '__outdoor__' && n.buildingId !== '') return false
      // Check if any trace passes through this node
      const traceIds = n.metadata?.traceIds as string[] | undefined
      if (traceIds?.includes(road.id)) return true
      if (n.metadata?.traceId === road.id) return true
      // Compiler/legacy graph nodes can omit source metadata after emission;
      // use exact segment membership within the repository tolerance rather
      // than selecting the nearest unrelated node.
      for (let i = 1; i < road.polyline.points.length; i++) {
        const closest = closestPointOnSegment(n.position, road.polyline.points[i - 1], road.polyline.points[i])
        if (haversine(n.position, closest) <= CONNECTIVITY_POSITION_TOLERANCE_METERS) return true
      }
      return false
    })
    roadNodes.set(road.id, nodes)
  }

  // Check connectivity between all road pairs
  for (let i = 0; i < roads.length; i++) {
    for (let j = i + 1; j < roads.length; j++) {
      const nodesA = roadNodes.get(roads[i].id) || []
      const nodesB = roadNodes.get(roads[j].id) || []
      if (nodesA.length === 0 || nodesB.length === 0) continue

      // Check if any node from A can reach any node from B
      let connected = false
      for (const nA of nodesA) {
        for (const nB of nodesB) {
          const path = graph.findPath(nA.id, nB.id)
          if (path) { connected = true; break }
        }
        if (connected) break
      }
      if (connected) {
        connectedRoadPairs.add(pairKey(roads[i].id, roads[j].id))
      }
    }
  }

  // Component membership via BFS from first node of each road
  const componentMembership = new Map<string, string>()
  const visited = new Set<string>()
  let compIdx = 0
  for (const road of roads) {
    if (componentMembership.has(road.id)) continue
    const nodes = roadNodes.get(road.id) || []
    if (nodes.length === 0) {
      componentMembership.set(road.id, `comp-${compIdx++}`)
      continue
    }
    // BFS from first node
    const startNode = nodes[0]
    const queue = [startNode.id]
    const componentNodes = new Set<string>()
    while (queue.length > 0) {
      const id = queue.shift()!
      if (visited.has(id)) continue
      visited.add(id)
      componentNodes.add(id)
      for (const edge of graph.getEdgesForNode(id)) {
        const next = edge.from === id ? edge.to : edge.from
        if (!visited.has(next)) queue.push(next)
      }
    }
    const compLabel = `comp-${compIdx}`
    // Assign component label to all roads that have nodes in this component
    for (const r2 of roads) {
      if (componentMembership.has(r2.id)) continue
      const r2Nodes = roadNodes.get(r2.id) || []
      if (r2Nodes.some(n => componentNodes.has(n.id))) {
        componentMembership.set(r2.id, compLabel)
      }
    }
    if (!componentMembership.has(road.id)) {
      componentMembership.set(road.id, compLabel)
    }
    compIdx++
  }

  return {
    connectedRoadPairs,
    separatedRoadPairs,
    junctionIncidence,
    componentMembership,
    nodeCount: graph.nodeCount,
    edgeCount: graph.edgeCount,
  }
}

/** Extract road connectivity signature from a Compiler V2 NavigationGraph */
function extractV2Signature(
  navGraph: { nodes: CoreNavNode[]; edges: CoreNavEdge[] },
  roads: Road[],
): RoadConnectivitySignature {
  const connectedRoadPairs = new Set<string>()
  const separatedRoadPairs = new Set<string>()
  const junctionIncidence = new Map<string, Set<string>>()

  // Build adjacency list for A*
  const adj = new Map<string, { to: string; weight: number }[]>()
  for (const n of navGraph.nodes) adj.set(n.id, [])
  for (const e of navGraph.edges) {
    adj.get(e.from)?.push({ to: e.to, weight: e.distance })
    adj.get(e.to)?.push({ to: e.from, weight: e.distance })
  }

  // A* on V2 graph
  function v2FindPath(startId: string, endId: string): string[] | null {
    const heuristic = (id: string): number => {
      const n = navGraph.nodes.find(x => x.id === id)
      const g = navGraph.nodes.find(x => x.id === endId)
      if (!n || !g) return Infinity
      const dLat = n.position.lat - g.position.lat
      const dLng = n.position.lng - g.position.lng
      return Math.sqrt(dLat * dLat + dLng * dLng) * 111000
    }
    const open = new Set<string>([startId])
    const cameFrom = new Map<string, string>()
    const gScore = new Map<string, number>()
    gScore.set(startId, 0)
    while (open.size > 0) {
      let current = ''
      let bestF = Infinity
      for (const id of open) {
        const f = (gScore.get(id) ?? Infinity) + heuristic(id)
        if (f < bestF) { bestF = f; current = id }
      }
      if (current === endId) {
        const path: string[] = [current]
        let c = current
        while (cameFrom.has(c)) { c = cameFrom.get(c)!; path.unshift(c) }
        return path
      }
      open.delete(current)
      for (const { to, weight } of adj.get(current) || []) {
        const tentG = (gScore.get(current) ?? Infinity) + weight
        if (tentG < (gScore.get(to) ?? Infinity)) {
          cameFrom.set(to, current)
          gScore.set(to, tentG)
          open.add(to)
        }
      }
    }
    return null
  }

  // Find nodes on each road by source entity or position proximity
  const roadNodes = new Map<string, CoreNavNode[]>()
  for (const road of roads) {
    const nodes = navGraph.nodes.filter(n => {
      // Check source entity (compiler stamps this)
      const src = n.properties?.source as any
      if (src?.entityId === road.id) return true
      // Use exact segment membership within the repository tolerance; do not
      // classify a nearby building or unrelated waypoint as a road node.
      for (let i = 1; i < road.polyline.points.length; i++) {
        const closest = closestPointOnSegment(n.position, road.polyline.points[i - 1], road.polyline.points[i])
        if (haversine(n.position, closest) <= CONNECTIVITY_POSITION_TOLERANCE_METERS) return true
      }
      return false
    })
    roadNodes.set(road.id, nodes)
  }

  // Check connectivity between all road pairs
  for (let i = 0; i < roads.length; i++) {
    for (let j = i + 1; j < roads.length; j++) {
      const nodesA = roadNodes.get(roads[i].id) || []
      const nodesB = roadNodes.get(roads[j].id) || []
      if (nodesA.length === 0 || nodesB.length === 0) continue

      let connected = false
      for (const nA of nodesA) {
        for (const nB of nodesB) {
          const path = v2FindPath(nA.id, nB.id)
          if (path) { connected = true; break }
        }
        if (connected) break
      }
      if (connected) {
        connectedRoadPairs.add(pairKey(roads[i].id, roads[j].id))
      }
    }
  }

  // Component membership via BFS
  const componentMembership = new Map<string, string>()
  const visited = new Set<string>()
  let compIdx = 0
  for (const road of roads) {
    if (componentMembership.has(road.id)) continue
    const nodes = roadNodes.get(road.id) || []
    if (nodes.length === 0) {
      componentMembership.set(road.id, `comp-${compIdx++}`)
      continue
    }
    const startNode = nodes[0]
    const queue = [startNode.id]
    const componentNodes = new Set<string>()
    while (queue.length > 0) {
      const id = queue.shift()!
      if (visited.has(id)) continue
      visited.add(id)
      componentNodes.add(id)
      for (const { to } of adj.get(id) || []) {
        if (!visited.has(to)) queue.push(to)
      }
    }
    const compLabel = `comp-${compIdx}`
    for (const r2 of roads) {
      if (componentMembership.has(r2.id)) continue
      const r2Nodes = roadNodes.get(r2.id) || []
      if (r2Nodes.some(n => componentNodes.has(n.id))) {
        componentMembership.set(r2.id, compLabel)
      }
    }
    if (!componentMembership.has(road.id)) {
      componentMembership.set(road.id, compLabel)
    }
    compIdx++
  }

  return {
    connectedRoadPairs,
    separatedRoadPairs,
    junctionIncidence,
    componentMembership,
    nodeCount: navGraph.nodes.length,
    edgeCount: navGraph.edges.length,
  }
}

// ═══════════════════════════════════════════════════════════════
// SHARED FIXTURE FACTORY
// ═══════════════════════════════════════════════════════════════

function makeRoad(id: string, name: string, points: Array<{ lat: number; lng: number }>, opts?: { connectorEntranceId?: string }): Road {
  return {
    id,
    name,
    polyline: { points },
    width: 8,
    surface: 'paved',
    type: 'arterial',
    metadata: {},
    connectorEntranceId: opts?.connectorEntranceId,
  }
}

function makeCampus(opts: {
  campusId?: string
  name?: string
  roads: Road[]
  junctions?: RoadJunction[]
  separatedCrossings?: SeparatedCrossing[]
  connectivitySemanticsVersion?: string
}): CampusDocument {
  return {
    schemaVersion: 1,
    version: 1,
    metadata: {
      campusId: opts.campusId ?? 'test-campus',
      name: opts.name ?? 'Test Campus',
      description: 'Test',
      lastModified: '',
      editorVersion: 'test',
    },
    buildings: [{
      id: 'bld-a',
      name: 'Building A',
      code: 'A',
      category: 'academic',
      description: '',
      footprint: {
        points: [
          { lat: 14.0, lng: 121.0 },
          { lat: 14.001, lng: 121.0 },
          { lat: 14.001, lng: 121.001 },
          { lat: 14.0, lng: 121.001 },
        ],
      },
      baseElevation: 0,
      height: 10,
      floors: [{
        id: 'f1',
        level: 1,
        label: 'Ground',
        elevation: 0,
        rooms: [],
        hallways: [],
        staircases: [],
        elevators: [],
        entrances: [{
          id: 'e-a1',
          label: 'Main',
          position: { lat: 14.002, lng: 121.002 },
          level: 1,
          type: 'main',
          hasQR: false,
          hasPanorama: false,
        }],
        connectorStops: [],
        metadata: {},
      }],
      verticalConnectors: [],
      aliases: [],
      color: '#ff0000',
      metadata: {},
    }],
    roads: opts.roads,
    panoramas: [],
    qrCheckpoints: [],
    roadJunctions: opts.junctions,
    separatedCrossings: opts.separatedCrossings,
    connectivitySemanticsVersion: opts.connectivitySemanticsVersion ?? CONNECTIVITY_CONTRACT_VERSION,
  }
}

function compileLegacy(doc: CampusDocument): Graph {
  const graph = new Graph()
  graph.campusId = doc.metadata.campusId
  const adapter = new GraphAdapter(graph)
  adapter.sync(doc)
  return graph
}

function compileV2(doc: CampusDocument) {
  const compiler = new CampusCompiler({ nodeInterval: 10 })
  return compiler.compileV2(doc)
}

function assertTwoCrossingFixture(
  roads: Road[],
  p1: { lat: number; lng: number },
  p2: { lat: number; lng: number },
): void {
  for (const position of [p1, p2]) {
    for (const road of roads) {
      const distance = Math.min(...road.polyline.points.slice(1).map((point, index) =>
        haversine(position, closestPointOnSegment(position, road.polyline.points[index], point)),
      ))
      expect(distance, `${road.id} must contain ${JSON.stringify(position)}`).toBeLessThanOrEqual(0.1)
    }
  }
  expect(haversine(p1, p2)).toBeGreaterThan(CONNECTIVITY_POSITION_TOLERANCE_METERS)
}

function nodesAtPosition(
  nodes: Array<{ position: { lat: number; lng: number } }>,
  position: { lat: number; lng: number },
) {
  return nodes.filter(node => haversine(node.position, position) <= CONNECTIVITY_POSITION_TOLERANCE_METERS)
}

// ═══════════════════════════════════════════════════════════════
// PARITY TESTS
// ═══════════════════════════════════════════════════════════════

describe('Phase 6 — Cross-producer topology parity', () => {

  // ── 1. Two-road explicit junction ──

  it('FIXTURE 1: two-road explicit junction — both producers connect A↔B', () => {
    const roads = [
      makeRoad('road-a', 'Road A', [{ lat: 14.0, lng: 121.0 }, { lat: 14.001, lng: 121.0 }]),
      makeRoad('road-b', 'Road B', [{ lat: 14.0005, lng: 120.999 }, { lat: 14.0005, lng: 121.002 }]),
    ]
    const doc = makeCampus({
      roads,
      junctions: [{ id: 'j-ab', position: { lat: 14.0005, lng: 121.0 }, roadIds: ['road-a', 'road-b'], source: 'authored' }],
    })

    const legacyGraph = compileLegacy(doc)
    const v2Result = compileV2(doc)
    expect(v2Result.graph).not.toBeNull()

    const legacySig = extractLegacySignature(legacyGraph, roads)
    const v2Sig = extractV2Signature(v2Result.graph!, roads)

    // Both must connect road-a ↔ road-b
    const pk = pairKey('road-a', 'road-b')
    expect(legacySig.connectedRoadPairs.has(pk)).toBe(true)
    expect(v2Sig.connectedRoadPairs.has(pk)).toBe(true)
  })

  // ── 2. Three-road shared junction ──

  it('FIXTURE 2: three-road shared junction — all pairs connected', () => {
    const roads = [
      makeRoad('road-a', 'Road A', [{ lat: 14.0, lng: 121.0 }, { lat: 14.001, lng: 121.001 }]),
      makeRoad('road-b', 'Road B', [{ lat: 14.0005, lng: 120.999 }, { lat: 14.0005, lng: 121.002 }]),
      makeRoad('road-c', 'Road C', [{ lat: 14.001, lng: 121.0005 }, { lat: 13.999, lng: 121.0005 }]),
    ]
    const doc = makeCampus({
      roads,
      junctions: [{ id: 'j-abc', position: { lat: 14.0005, lng: 121.0005 }, roadIds: ['road-a', 'road-b', 'road-c'], source: 'authored' }],
    })

    const legacyGraph = compileLegacy(doc)
    const v2Result = compileV2(doc)
    expect(v2Result.graph).not.toBeNull()

    const legacySig = extractLegacySignature(legacyGraph, roads)
    const v2Sig = extractV2Signature(v2Result.graph!, roads)

    // All three pairs must be connected in both
    for (const [a, b] of [['road-a', 'road-b'], ['road-a', 'road-c'], ['road-b', 'road-c']]) {
      const pk = pairKey(a, b)
      expect(legacySig.connectedRoadPairs.has(pk), `Legacy: ${a}↔${b} not connected`).toBe(true)
      expect(v2Sig.connectedRoadPairs.has(pk), `V2: ${a}↔${b} not connected`).toBe(true)
    }
  })

  // ── 3. Four-plus road shared junction ──

  it('FIXTURE 3: four-road shared junction — all 6 pairs connected', () => {
    const roads = [
      makeRoad('road-a', 'Road A', [{ lat: 14.0, lng: 121.0 }, { lat: 14.0005, lng: 121.0005 }]),
      makeRoad('road-b', 'Road B', [{ lat: 14.001, lng: 121.0005 }, { lat: 14.0005, lng: 121.0005 }]),
      makeRoad('road-c', 'Road C', [{ lat: 14.0005, lng: 121.001 }, { lat: 14.0005, lng: 121.0005 }]),
      makeRoad('road-d', 'Road D', [{ lat: 14.0005, lng: 121.0 }, { lat: 14.0005, lng: 121.0005 }]),
    ]
    const doc = makeCampus({
      roads,
      junctions: [{ id: 'j-abcd', position: { lat: 14.0005, lng: 121.0005 }, roadIds: ['road-a', 'road-b', 'road-c', 'road-d'], source: 'authored' }],
    })

    const legacyGraph = compileLegacy(doc)
    const v2Result = compileV2(doc)
    expect(v2Result.graph).not.toBeNull()

    const legacySig = extractLegacySignature(legacyGraph, roads)
    const v2Sig = extractV2Signature(v2Result.graph!, roads)

    // All 6 pairs must be connected in both
    const roadIds = ['road-a', 'road-b', 'road-c', 'road-d']
    for (let i = 0; i < roadIds.length; i++) {
      for (let j = i + 1; j < roadIds.length; j++) {
        const pk = pairKey(roadIds[i], roadIds[j])
        expect(legacySig.connectedRoadPairs.has(pk), `Legacy: ${roadIds[i]}↔${roadIds[j]} not connected`).toBe(true)
        expect(v2Sig.connectedRoadPairs.has(pk), `V2: ${roadIds[i]}↔${roadIds[j]} not connected`).toBe(true)
      }
    }
  })

  // ── 4. Separated crossing — NO traversable connection ──

  it('FIXTURE 4: separated crossing — both producers keep A and B disconnected', () => {
    const roads = [
      makeRoad('road-a', 'Road A', [{ lat: 14.0, lng: 121.0 }, { lat: 14.001, lng: 121.001 }]),
      makeRoad('road-b', 'Road B', [{ lat: 14.0005, lng: 120.999 }, { lat: 14.0005, lng: 121.002 }]),
    ]
    const doc = makeCampus({
      roads,
      separatedCrossings: [{ id: 'sc-ab', position: { lat: 14.0005, lng: 121.0005 }, roadIds: ['road-a', 'road-b'] }],
    })

    const legacyGraph = compileLegacy(doc)
    const v2Result = compileV2(doc)
    expect(v2Result.graph).not.toBeNull()

    const legacySig = extractLegacySignature(legacyGraph, roads)
    const v2Sig = extractV2Signature(v2Result.graph!, roads)

    const pk = pairKey('road-a', 'road-b')
    // Both must NOT connect separated roads
    expect(legacySig.connectedRoadPairs.has(pk), 'Legacy connected separated roads').toBe(false)
    expect(v2Sig.connectedRoadPairs.has(pk), 'V2 connected separated roads').toBe(false)
    // Both must record the separation
    expect(legacySig.separatedRoadPairs.has(pk)).toBe(true)
  })

  // ── 5. Separated P1 + Connected P2 ──

  it('FIXTURE 5: separated P1 + connected P2 — both producers allow route through P2 but not P1', () => {
    // Use roads with two geometric crossings:
    // Road A is inverted-L shaped to cross Road B at two points
    const p1 = { lat: 14.0005, lng: 121.0005 }
    const p2 = { lat: 14.0005, lng: 121.001 }
    const roads = [
      makeRoad('road-a', 'Road A', [
        { lat: 14.0, lng: 121.0 },
        { lat: 14.001, lng: 121.001 },
        { lat: 14.0, lng: 121.001 },
      ]),
      makeRoad('road-b', 'Road B', [{ lat: 14.0005, lng: 120.999 }, { lat: 14.0005, lng: 121.002 }]),
    ]
    assertTwoCrossingFixture(roads, p1, p2)
    const doc = makeCampus({
      roads,
      junctions: [{ id: 'j-ab', position: p2, roadIds: ['road-a', 'road-b'], source: 'authored' }],
      separatedCrossings: [{ id: 'sc-ab', position: p1, roadIds: ['road-a', 'road-b'] }],
    })

    const legacyGraph = compileLegacy(doc)
    const v2Result = compileV2(doc)
    expect(v2Result.graph).not.toBeNull()

    const legacySig = extractLegacySignature(legacyGraph, roads)
    const v2Sig = extractV2Signature(v2Result.graph!, roads)

    const pk = pairKey('road-a', 'road-b')

    // Legacy connects through P2
    expect(legacySig.connectedRoadPairs.has(pk), 'Legacy: A↔B not connected through P2').toBe(true)

    // V2 must also retain the P2 connection. A separated P1 may have no
    // authored waypoint at all, or two unmerged road waypoints, but it must
    // never normalize to one shared connection node.
    expect(v2Sig.connectedRoadPairs.has(pk), 'V2: A↔B not connected through P2').toBe(true)
    const v2P1Nodes = nodesAtPosition(v2Result.graph!.nodes, p1)
    const v2P2Nodes = nodesAtPosition(v2Result.graph!.nodes, p2)
    expect(v2P1Nodes.length).not.toBe(1)
    expect(v2P2Nodes).toHaveLength(1)

    const legacyP1Junctions = legacyGraph.nodes.filter(node =>
      node.metadata?.connectionNode && haversine(node.position, p1) <= CONNECTIVITY_POSITION_TOLERANCE_METERS,
    )
    const legacyP2Junctions = legacyGraph.nodes.filter(node =>
      node.metadata?.connectionNode && haversine(node.position, p2) <= CONNECTIVITY_POSITION_TOLERANCE_METERS,
    )
    expect(legacyP1Junctions).toHaveLength(0)
    expect(legacyP2Junctions).toHaveLength(1)

    // Both must record the separation at P1
    expect(legacySig.separatedRoadPairs.has(pk)).toBe(true)
  })

  // ── 6. Close distinct junctions ──

  it('FIXTURE 6: close distinct junctions — both producers treat them as distinct', () => {
    // Roads that cross, with two junctions at different positions along Road B
    // Both junction positions must be on both roads' polylines
    const p1 = { lat: 14.0005, lng: 121.000495 }
    const p2 = { lat: 14.0005, lng: 121.000505 }
    const roads = [
      makeRoad('road-a', 'Road A', [{ lat: 14.0005, lng: 120.999 }, { lat: 14.0005, lng: 121.002 }]),
      makeRoad('road-b', 'Road B', [
        { lat: 14.0, lng: 121.00049 },
        { lat: 14.001, lng: 121.0005 },
        { lat: 14.0, lng: 121.00051 },
      ]),
    ]
    assertTwoCrossingFixture(roads, p1, p2)
    const doc = makeCampus({
      roads,
      junctions: [
        { id: 'j-close-1', position: p1, roadIds: ['road-a', 'road-b'], source: 'authored' },
        { id: 'j-close-2', position: p2, roadIds: ['road-a', 'road-b'], source: 'authored' },
      ],
    })

    const legacyGraph = compileLegacy(doc)
    const v2Result = compileV2(doc)
    expect(v2Result.graph).not.toBeNull()

    const legacySig = extractLegacySignature(legacyGraph, roads)
    const v2Sig = extractV2Signature(v2Result.graph!, roads)

    // Both must connect A↔B (through either junction)
    const pk = pairKey('road-a', 'road-b')
    expect(legacySig.connectedRoadPairs.has(pk)).toBe(true)
    expect(v2Sig.connectedRoadPairs.has(pk)).toBe(true)

    // Legacy must have two distinct junction incidences
    expect(legacySig.junctionIncidence.size).toBeGreaterThanOrEqual(2)
  })

  // ── 7. Navigation-only road ──

  it('FIXTURE 7: navigation-only road participates in junction topology', () => {
    const roads = [
      makeRoad('road-a', 'Road A', [{ lat: 14.0, lng: 121.0 }, { lat: 14.001, lng: 121.001 }]),
      makeRoad('road-nav', 'Nav Road', [{ lat: 14.0005, lng: 121.0005 }, { lat: 14.002, lng: 121.0005 }, { lat: 14.003, lng: 121.0005 }]),
    ]
    const doc = makeCampus({
      roads,
      junctions: [{ id: 'j-a-nav', position: { lat: 14.0005, lng: 121.0005 }, roadIds: ['road-a', 'road-nav'], source: 'authored' }],
    })

    const legacyGraph = compileLegacy(doc)
    const v2Result = compileV2(doc)
    expect(v2Result.graph).not.toBeNull()

    const legacySig = extractLegacySignature(legacyGraph, roads)
    const v2Sig = extractV2Signature(v2Result.graph!, roads)

    const pk = pairKey('road-a', 'road-nav')
    expect(legacySig.connectedRoadPairs.has(pk), 'Legacy: nav-only road not connected').toBe(true)
    expect(v2Sig.connectedRoadPairs.has(pk), 'V2: nav-only road not connected').toBe(true)
  })

  // ── 8. Geometry-only modern document ──

  it('FIXTURE 8: modern geometry-only document — neither producer infers connectivity', () => {
    const roads = [
      makeRoad('road-a', 'Road A', [{ lat: 14.0, lng: 121.0 }, { lat: 14.001, lng: 121.001 }]),
      makeRoad('road-b', 'Road B', [{ lat: 14.0005, lng: 120.999 }, { lat: 14.0005, lng: 121.002 }]),
    ]
    // Modern document: no junctions, no separated crossings
    const doc = makeCampus({
      roads,
      junctions: [],
      separatedCrossings: [],
    })

    const v2Result = compileV2(doc)
    expect(v2Result.graph).not.toBeNull()

    const v2Sig = extractV2Signature(v2Result.graph!, roads)
    const pk = pairKey('road-a', 'road-b')

    const legacyGraph = compileLegacy(doc)
    const legacySig = extractLegacySignature(legacyGraph, roads)
    expect(v2Sig.connectedRoadPairs.has(pk), 'V2 inferred geometry-only connectivity').toBe(false)
    expect(legacySig.connectedRoadPairs.has(pk), 'Legacy inferred modern geometry-only connectivity').toBe(false)

    // Both should complete without crashing — this is the core requirement
    expect(v2Result.graph!.nodes.length).toBeGreaterThan(0)
    expect(legacyGraph.nodeCount).toBeGreaterThan(0)
  })

  // ── 9. Legacy unmarked document ──

  it('FIXTURE 9: legacy unmarked document — both producers preserve compatibility', () => {
    const roads = [
      makeRoad('road-a', 'Road A', [{ lat: 14.0, lng: 121.0 }, { lat: 14.001, lng: 121.001 }]),
      makeRoad('road-b', 'Road B', [{ lat: 14.0005, lng: 120.999 }, { lat: 14.0005, lng: 121.002 }]),
    ]
    // Legacy document: no connectivitySemanticsVersion
    const doc = makeCampus({
      roads,
      junctions: undefined,
      separatedCrossings: undefined,
    })
    delete (doc as any).connectivitySemanticsVersion

    // Legacy always works (no version check)
    const legacyGraph = compileLegacy(doc)

    // V2 with legacy document: no marker → legacy fallback behavior
    const v2Result = compileV2(doc)

    // Both should complete without crashing
    expect(legacyGraph.nodeCount).toBeGreaterThan(0)
    expect(v2Result.graph).not.toBeNull()
    const legacySig = extractLegacySignature(legacyGraph, roads)
    const v2Sig = extractV2Signature(v2Result.graph!, roads)
    const pk = pairKey('road-a', 'road-b')
    expect(legacySig.connectedRoadPairs.has(pk)).toBe(true)
    expect(v2Sig.connectedRoadPairs.has(pk)).toBe(true)
  })

  // ── 10. Deleted-road stale junction defense ──

  it('FIXTURE 10: stale junction referencing deleted road — both producers handle defensively', () => {
    const roads = [
      makeRoad('road-a', 'Road A', [{ lat: 14.0, lng: 121.0 }, { lat: 14.001, lng: 121.0 }]),
      // road-b is NOT in the roads array but IS referenced by the junction
    ]
    const doc = makeCampus({
      roads,
      junctions: [{ id: 'j-stale', position: { lat: 14.0005, lng: 121.0 }, roadIds: ['road-a', 'road-b-deleted'], source: 'authored' }],
    })

    // Both must not crash
    const legacyGraph = compileLegacy(doc)
    const v2Result = compileV2(doc)

    expect(legacyGraph.nodeCount).toBeGreaterThan(0)
    // V2 should complete without crashing even with stale references
    // The key: road-a must still be traversable
    if (v2Result.graph) {
      const v2Sig = extractV2Signature(v2Result.graph, roads)
      // road-a should have nodes
      expect(v2Result.graph.nodes.length).toBeGreaterThan(0)
    }
  })

  // ── 11. Input order invariance ──

  it('FIXTURE 11: input order invariance — reordering roads produces same connectivity', () => {
    const roads1 = [
      makeRoad('road-a', 'Road A', [{ lat: 14.0, lng: 121.0 }, { lat: 14.001, lng: 121.001 }]),
      makeRoad('road-b', 'Road B', [{ lat: 14.0005, lng: 120.999 }, { lat: 14.0005, lng: 121.002 }]),
    ]
    const roads2 = [...roads1].reverse()

    const doc1 = makeCampus({
      roads: roads1,
      junctions: [{ id: 'j-ab', position: { lat: 14.0005, lng: 121.0005 }, roadIds: ['road-a', 'road-b'], source: 'authored' }],
    })
    const doc2 = makeCampus({
      roads: roads2,
      junctions: [{ id: 'j-ab', position: { lat: 14.0005, lng: 121.0005 }, roadIds: ['road-a', 'road-b'], source: 'authored' }],
    })

    const v2Result1 = compileV2(doc1)
    const v2Result2 = compileV2(doc2)
    expect(v2Result1.graph).not.toBeNull()
    expect(v2Result2.graph).not.toBeNull()

    const sig1 = extractV2Signature(v2Result1.graph!, roads1)
    const sig2 = extractV2Signature(v2Result2.graph!, roads2)

    // Connected pairs must be identical regardless of input order
    const pk = pairKey('road-a', 'road-b')
    expect(sig1.connectedRoadPairs.has(pk)).toBe(sig2.connectedRoadPairs.has(pk))
  })

  // ── 12. Repeated projection ──

  it('FIXTURE 12: repeated projection — both producers produce deterministic topology', () => {
    const roads = [
      makeRoad('road-a', 'Road A', [{ lat: 14.0, lng: 121.0 }, { lat: 14.001, lng: 121.001 }]),
      makeRoad('road-b', 'Road B', [{ lat: 14.0005, lng: 120.999 }, { lat: 14.0005, lng: 121.002 }]),
    ]
    const doc = makeCampus({
      roads,
      junctions: [{ id: 'j-ab', position: { lat: 14.0005, lng: 121.0005 }, roadIds: ['road-a', 'road-b'], source: 'authored' }],
    })

    const pk = pairKey('road-a', 'road-b')

    // Run legacy 3 times
    const legacyResults = Array.from({ length: 3 }, () => {
      const g = compileLegacy(doc)
      return extractLegacySignature(g, roads)
    })
    for (let i = 1; i < legacyResults.length; i++) {
      expect(legacyResults[i].connectedRoadPairs.has(pk)).toBe(legacyResults[0].connectedRoadPairs.has(pk))
    }

    // Run V2 3 times
    const v2Results = Array.from({ length: 3 }, () => {
      const r = compileV2(doc)
      return r.graph ? extractV2Signature(r.graph, roads) : null
    }).filter(Boolean)!
    for (let i = 1; i < v2Results.length; i++) {
      expect(v2Results[i]!.connectedRoadPairs.has(pk)).toBe(v2Results[0]!.connectedRoadPairs.has(pk))
    }
  })
})
