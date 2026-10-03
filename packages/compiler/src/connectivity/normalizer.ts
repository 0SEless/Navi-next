import {
  haversineDistance,
  hasSeparatedCrossingAtPosition,
  SpatialQueryService,
  ROUTE_NETWORK_THRESHOLDS,
} from '@navi/core'
import type { PrimitiveGraph, ConnectivityGraph, PrimitiveNode, PrimitiveEdge, CompilerDiagnostic } from '../types'
import type { ConnectivitySemantics } from '@navi/core'

/**
 * Phase 3.1: Normalize Connectivity.
 *
 * This is the ONLY phase that modifies the PrimitiveGraph.
 * Responsibilities (in order):
 *   1. Dedupe nearby representations of the same authorized identity
 *   2. Remove dangling waypoints (zero incident edges)
 *   3. Repair broken edge references → reconnect to nearest survivor
 *   4. Merge overlapping access edges (same doorway)
 *
 * After this phase, the graph is "clean" — no further spatial repair needed.
 */
export function normalizeConnectivity(
  graph: PrimitiveGraph,
  // P1-T8 (R8.3): dedupe threshold owned by the route-network definitions
  // module — single source (risk R7). Default is the centralized 0.5 m.
  mergeThreshold: number = ROUTE_NETWORK_THRESHOLDS.dedupeMergeMeters,
  // Connectivity semantics for explicit road-junction authorization and
  // separated-crossing enforcement.
  connectivitySemantics?: ConnectivitySemantics,
): ConnectivityGraph {
  const diagnostics: CompilerDiagnostic[] = [...graph.diagnostics]
  const { nodes, edges } = deepCloneGraph(graph)

  // ── Step 1: Dedupe authorized waypoint representations ──
  // Building/floor equality and distance are necessary but not sufficient:
  // waypoint identity must come from a shared source entity or an explicit
  // persisted road junction at this position.
  const removedIds = new Set<string>()
  const mergeMap = new Map<string, string>() // removedId → survivorId

  // Build separated road pairs with positions for merge prevention
  // Separation is position-specific: only prevent merges near the separation point
  const separatedCrossings = connectivitySemantics?.separatedCrossings ?? []
  for (let i = 0; i < nodes.length; i++) {
    if (removedIds.has(nodes[i].id)) continue
    if (nodes[i].kind !== 'waypoint') continue

    for (let j = i + 1; j < nodes.length; j++) {
      if (removedIds.has(nodes[j].id)) continue
      if (nodes[j].kind !== 'waypoint') continue

      const a = nodes[i]
      const b = nodes[j]
      if (a.buildingId !== b.buildingId || a.floor !== b.floor) continue

      const d = haversineDistance(a.position, b.position)
      if (d > mergeThreshold) continue

      const sourceA = a.source?.entityId
      const sourceB = b.source?.entityId
      // Missing provenance cannot authorize an identity merge.
      if (!sourceA || !sourceB) continue

      // Skip merge if waypoints belong to separated road pairs AND are near
      // the separation position. Separation is position-specific: a separation
      // at P1 must not prevent merges at P2 for the same road pair.
      if (separatedCrossings.length > 0) {
        if (sourceA !== sourceB) {
          // Check the shared position-aware predicate near either waypoint.
          const isNearSeparation =
            hasSeparatedCrossingAtPosition(separatedCrossings, sourceA, sourceB, a.position) ||
            hasSeparatedCrossingAtPosition(separatedCrossings, sourceA, sourceB, b.position)
          if (isNearSeparation) continue
        }
      }

      const explicitlyJunctioned = sourceA !== sourceB &&
        (connectivitySemantics?.junctions ?? []).some(junction =>
          junction.roadIds.includes(sourceA) &&
          junction.roadIds.includes(sourceB) &&
          haversineDistance(junction.position, a.position) <= ROUTE_NETWORK_THRESHOLDS.dedupeMergeMeters &&
          haversineDistance(junction.position, b.position) <= ROUTE_NETWORK_THRESHOLDS.dedupeMergeMeters
        )
      if (sourceA !== sourceB && !explicitlyJunctioned) continue

      removedIds.add(b.id)
      mergeMap.set(b.id, a.id)
      diagnostics.push({
        severity: 'info',
        sourceEntityId: graph.metadata.campusId,
        phase: 'connectivity',
        code: 'WAYPOINT_MERGED',
        message: `Waypoint ${b.id} merged into ${a.id} (distance ${d.toFixed(2)}m) [sourceA=${sourceA} sourceB=${sourceB}]`,
        relatedNodeIds: [a.id, b.id],
      })
    }
  }

  const survivingNodes = nodes.filter(n => !removedIds.has(n.id))

  // ── Step 2: Repair edges referencing removed nodes ──
  const repairedEdges: PrimitiveEdge[] = []
  for (const edge of edges) {
    // Skip portal edges — they don't have from/to
    if (edge.kind === 'portal') {
      repairedEdges.push(edge)
      continue
    }

    let { from, to } = edge
    let repaired = false

    if (removedIds.has(from)) {
      from = mergeMap.get(from) || from
      repaired = true
    }
    if (removedIds.has(to)) {
      to = mergeMap.get(to) || to
      repaired = true
    }

    if (repaired) {
      repairedEdges.push({ ...edge, from, to })
    } else {
      repairedEdges.push(edge)
    }
  }

  // ── Step 3: Remove dangling waypoints (zero incident edges) ──
  const incidentCount = new Map<string, number>()
  for (const node of survivingNodes) {
    incidentCount.set(node.id, 0)
  }
  for (const edge of repairedEdges) {
    if (edge.kind === 'portal') continue
    incidentCount.set(edge.from, (incidentCount.get(edge.from) || 0) + 1)
    incidentCount.set(edge.to, (incidentCount.get(edge.to) || 0) + 1)
  }

  const danglingIds = new Set<string>()
  const finalNodes = survivingNodes.filter(n => {
    if (n.kind !== 'waypoint') return true
    const count = incidentCount.get(n.id) || 0
    if (count === 0) {
      danglingIds.add(n.id)
      diagnostics.push({
        severity: 'warning',
        sourceEntityId: n.source.entityId,
        phase: 'connectivity',
        code: 'SKELETON_DANGLING',
        message: `Waypoint ${n.id} has no incident edges — removed`,
        relatedNodeIds: [n.id],
      })
      return false
    }
    return true
  })

  // ── Step 3b: Reconnect skeleton edges that lost their target ──
  // Find edges where to/from was a dangling node and reconnect to nearest survivors
  const danglingRepairs: Array<{ edge: import('../types').SkeletonEdge; oldId: string; isFrom: boolean }> = []
  for (const edge of repairedEdges) {
    if (edge.kind === 'portal') continue
    if (danglingIds.has(edge.from) && edge.kind === 'skeleton') {
      danglingRepairs.push({ edge, oldId: edge.from, isFrom: true })
    }
    if (danglingIds.has(edge.to) && edge.kind === 'skeleton') {
      danglingRepairs.push({ edge, oldId: edge.to, isFrom: false })
    }
  }

  for (const repair of danglingRepairs) {
    const nearest = findNearestWaypoint(
      finalNodes.find(n => n.id === repair.edge.from || n.id === repair.edge.to)?.position || { lat: 0, lng: 0 },
      finalNodes,
    )
    if (nearest) {
      if (repair.isFrom) {
        repair.edge.from = nearest.id
      } else {
        repair.edge.to = nearest.id
      }
      diagnostics.push({
        severity: 'info',
        sourceEntityId: repair.edge.source.entityId,
        phase: 'connectivity',
        code: 'EDGE_REPAIRED',
        message: `Edge ${repair.edge.id} reconnected to ${nearest.id}`,
        relatedNodeIds: [repair.edge.id, nearest.id],
      })
    }
  }

  // ── Step 4: Merge overlapping access edges ──
  const seenAccessPairs = new Set<string>()
  const dedupedEdges = repairedEdges.filter(edge => {
    if (edge.kind !== 'access') return true
    const key = `${edge.from}|${edge.to}`
    if (seenAccessPairs.has(key)) return false
    seenAccessPairs.add(key)
    return true
  })

  // Build building/floor counts from final nodes
  const buildingIds = new Set(finalNodes.map(n => n.buildingId))
  const floorKeys = new Set(finalNodes.map(n => `${n.buildingId}:${n.floor}`))

  return {
    nodes: finalNodes,
    edges: dedupedEdges,
    metadata: {
      campusId: graph.metadata.campusId,
      buildingCount: buildingIds.size,
      floorCount: floorKeys.size,
      generatedAt: graph.metadata.generatedAt,
    },
    diagnostics,
  }
}

function findNearestWaypoint(pos: { lat: number; lng: number }, nodes: PrimitiveNode[]): PrimitiveNode | null {
  const svc = new SpatialQueryService()
  svc.loadFromNodes(nodes.map(n => ({
    id: n.id,
    position: n.position,
    type: n.kind,
    floor: n.floor,
    buildingId: n.buildingId,
  })))
  const result = svc.nearestEntity(pos, { type: 'waypoint' })
  if (!result) return null
  return nodes.find(n => n.id === result.entity.id) ?? null
}

function deepCloneGraph(graph: PrimitiveGraph): { nodes: PrimitiveNode[]; edges: PrimitiveEdge[] } {
  return {
    nodes: JSON.parse(JSON.stringify(graph.nodes)),
    edges: JSON.parse(JSON.stringify(graph.edges)),
  }
}
