import type { ConnectivityGraph, CompilerDiagnostic } from '../types'

export interface ValidationReport {
  diagnostics: CompilerDiagnostic[]
  metrics: {
    totalComponents: number
    reachableWaypoints: number
    orphanedWaypoints: number
    disconnectedComponents: number
  }
}

/**
 * Phase 3.2: Validate Connectivity.
 *
 * READ-ONLY. Never modifies the input graph.
 * Returns a report with diagnostics and metrics.
 */
export function validateConnectivity(graph: ConnectivityGraph): ValidationReport {
  const diagnostics: CompilerDiagnostic[] = []
  const waypoints = graph.nodes.filter(n => n.kind === 'waypoint')

  // ── Orphan detection ──
  const incidentCount = new Map<string, number>()
  for (const node of graph.nodes) {
    incidentCount.set(node.id, 0)
  }
  for (const edge of graph.edges) {
    if (edge.kind === 'portal') continue
    incidentCount.set(edge.from, (incidentCount.get(edge.from) || 0) + 1)
    incidentCount.set(edge.to, (incidentCount.get(edge.to) || 0) + 1)
  }

  const orphanedWaypoints = waypoints.filter(w => (incidentCount.get(w.id) || 0) === 0)
  for (const wp of orphanedWaypoints) {
    diagnostics.push({
      severity: 'warning',
      sourceEntityId: wp.source.entityId,
      phase: 'connectivity',
      code: 'SKELETON_DANGLING',
      message: `Waypoint ${wp.id} has no incident edges`,
      relatedNodeIds: [wp.id],
    })
  }

  // ── Dangling edge detection ──
  const allNodeIds = new Set(graph.nodes.map(n => n.id))
  for (const edge of graph.edges) {
    if (edge.kind === 'portal') continue
    if (!allNodeIds.has(edge.from)) {
      diagnostics.push({
        severity: 'error',
        sourceEntityId: edge.source.entityId,
        phase: 'connectivity',
        code: 'EDGE_ORPHANED',
        message: `Edge ${edge.id} references non-existent node ${edge.from}`,
        relatedNodeIds: [edge.id],
      })
    }
    if (!allNodeIds.has(edge.to)) {
      diagnostics.push({
        severity: 'error',
        sourceEntityId: edge.source.entityId,
        phase: 'connectivity',
        code: 'EDGE_ORPHANED',
        message: `Edge ${edge.id} references non-existent node ${edge.to}`,
        relatedNodeIds: [edge.id],
      })
    }
  }

  // ── Disconnected component detection (BFS from entrance portals) ──
  const entranceIds = new Set<string>()
  const portalEdges = graph.edges.filter(e => e.kind === 'portal')
  for (const pe of portalEdges) {
    entranceIds.add(pe.nodeId)
  }

  const reachable = new Set<string>()
  const adjacency = new Map<string, string[]>()
  for (const node of graph.nodes) {
    adjacency.set(node.id, [])
  }
  for (const edge of graph.edges) {
    if (edge.kind === 'portal') continue
    adjacency.get(edge.from)?.push(edge.to)
    adjacency.get(edge.to)?.push(edge.from)
  }

  // BFS from each entrance node
  const queue: string[] = []
  for (const eid of entranceIds) {
    reachable.add(eid)
    queue.push(eid)
  }

  // Also BFS from the entrance's connected waypoints
  for (const edge of graph.edges) {
    if (edge.kind === 'portal') continue
    for (const eid of entranceIds) {
      if (edge.from === eid || edge.to === eid) {
        const other = edge.from === eid ? edge.to : edge.from
        if (!reachable.has(other)) {
          reachable.add(other)
          queue.push(other)
        }
      }
    }
  }

  while (queue.length > 0) {
    const current = queue.pop()!
    const neighbors = adjacency.get(current) || []
    for (const n of neighbors) {
      if (!reachable.has(n)) {
        reachable.add(n)
        queue.push(n)
      }
    }
  }

  // Find disconnected waypoints
  const waypointIds = new Set(waypoints.map(w => w.id))
  const unreachableWaypoints = waypoints.filter(w => !reachable.has(w.id))

  if (unreachableWaypoints.length > 0) {
    // Group unreachable waypoints by connected component
    const components = findConnectedComponents(graph, reachable)
    for (let i = 0; i < components.length; i++) {
      diagnostics.push({
        severity: 'error',
        sourceEntityId: graph.metadata.campusId,
        phase: 'connectivity',
        code: 'HALLWAY_DISCONNECTED',
        message: `Disconnected component #${i + 1} with ${components[i].length} waypoints — not reachable from any entrance`,
        relatedNodeIds: components[i],
      })
    }
  }

  return {
    diagnostics,
    metrics: {
      totalComponents: 1 + (unreachableWaypoints.length > 0 ? new Set(unreachableWaypoints.map(w => w.buildingId)).size : 0),
      reachableWaypoints: waypoints.length - unreachableWaypoints.length,
      orphanedWaypoints: orphanedWaypoints.length,
      disconnectedComponents: unreachableWaypoints.length > 0 ? 1 : 0,
    },
  }
}

function findConnectedComponents(graph: ConnectivityGraph, exclude: Set<string>): string[][] {
  const visited = new Set(exclude)
  const components: string[][] = []

  for (const node of graph.nodes) {
    if (node.kind !== 'waypoint') continue
    if (visited.has(node.id)) continue

    // BFS for this component
    const component: string[] = []
    const queue = [node.id]
    visited.add(node.id)

    while (queue.length > 0) {
      const current = queue.pop()!
      component.push(current)

      for (const edge of graph.edges) {
        if (edge.kind === 'portal') continue
        if (edge.from === current && !visited.has(edge.to)) {
          visited.add(edge.to)
          queue.push(edge.to)
        }
        if (edge.to === current && !visited.has(edge.from)) {
          visited.add(edge.from)
          queue.push(edge.from)
        }
      }
    }

    if (component.length > 0) {
      components.push(component)
    }
  }

  return components
}
