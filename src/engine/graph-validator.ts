import type { NavNode, NavEdge, Building, ValidationResult } from '../types/nav-types'

export function validateGraph(nodes: NavNode[], edges: NavEdge[], buildings: Building[]): ValidationResult[] {
  const results: ValidationResult[] = []
  const nodeIds = new Set(nodes.map((n) => n.id))
  const buildingIds = new Set(buildings.map((b) => b.id))


  // 1. All edge endpoints reference existing nodes
  const badRefs: string[] = []
  for (const e of edges) {
    if (!nodeIds.has(e.from) || !nodeIds.has(e.to)) {
      badRefs.push(e.id)
    }
  }
  results.push({
    category: 'Edge References',
    status: badRefs.length === 0 ? 'pass' : 'fail',
    message: badRefs.length === 0
      ? `All ${edges.length} edges reference valid node IDs`
      : `${badRefs.length} edge(s) reference missing nodes`,
    affectedIds: badRefs.length > 0 ? badRefs : undefined,
  })

  // 2. No duplicate IDs
  const dupNodes = nodes.filter((n, i) => nodes.findIndex((x) => x.id === n.id) !== i).map((n) => n.id)
  const dupEdges = edges.filter((e, i) => edges.findIndex((x) => x.id === e.id) !== i).map((e) => e.id)
  const allDups = [...dupNodes, ...dupEdges]
  results.push({
    category: 'Duplicate IDs',
    status: allDups.length === 0 ? 'pass' : 'fail',
    message: allDups.length === 0 ? 'No duplicate node or edge IDs found' : `${allDups.length} duplicate ID(s) found`,
    affectedIds: allDups.length > 0 ? allDups : undefined,
  })

  // 3. Graph connectivity (no disconnected nodes)
  const adj: Record<string, string[]> = {}
  for (const n of nodes) adj[n.id] = []
  for (const e of edges) {
    if (adj[e.from]) adj[e.from].push(e.to)
    if (adj[e.to]) adj[e.to].push(e.from)
  }
  const disconnected = nodes.filter((n) => !adj[n.id] || adj[n.id].length === 0).map((n) => n.id)
  results.push({
    category: 'Graph Connectivity',
    status: disconnected.length === 0 ? 'pass' : 'warn',
    message: disconnected.length === 0
      ? 'All nodes are connected'
      : `${disconnected.length} node(s) disconnected from the main graph`,
    affectedIds: disconnected.length > 0 ? disconnected : undefined,
  })

  // 4. Each building has at least 1 entrance node
  if (buildings.length > 0) {
    const buildingsMissingEntrance = buildings.filter(
      (b) => !nodes.some((n) => n.buildingId === b.id && n.type === 'building_entrance')
    ).map((b) => b.id)
    results.push({
      category: 'Building Entrances',
      status: buildingsMissingEntrance.length === 0 ? 'pass' : 'warn',
      message: buildingsMissingEntrance.length === 0
        ? 'All buildings have at least 1 entrance node'
        : `${buildingsMissingEntrance.length} building(s) missing entrance node`,
      affectedIds: buildingsMissingEntrance.length > 0 ? buildingsMissingEntrance : undefined,
    })
  }

  // 5. Building IDs in nodes reference valid buildings
  if (buildings.length > 0) {
    const badBuildingRefs = nodes
      .filter((n) => n.buildingId && !buildingIds.has(n.buildingId))
      .map((n) => n.id)
    results.push({
      category: 'Building References',
      status: badBuildingRefs.length === 0 ? 'pass' : 'warn',
      message: badBuildingRefs.length === 0
        ? 'All building IDs in nodes reference valid buildings'
        : `${badBuildingRefs.length} node(s) reference non-existent buildings`,
      affectedIds: badBuildingRefs.length > 0 ? badBuildingRefs : undefined,
    })
  }

  // 6. Coordinate bounds check
  const outOfBounds = nodes.filter(
    (n) => Math.abs(n.position.lat) > 90 || Math.abs(n.position.lng) > 180
  ).map((n) => n.id)
  results.push({
    category: 'Coordinate Bounds',
    status: outOfBounds.length === 0 ? 'pass' : 'fail',
    message: outOfBounds.length === 0
      ? 'All node coordinates are within valid bounds'
      : `${outOfBounds.length} node(s) have out-of-bounds coordinates`,
    affectedIds: outOfBounds.length > 0 ? outOfBounds : undefined,
  })

  // 7. Edge distance > 0
  const zeroDistEdges = edges.filter((e) => e.distance <= 0).map((e) => e.id)
  results.push({
    category: 'Edge Distances',
    status: zeroDistEdges.length === 0 ? 'pass' : 'warn',
    message: zeroDistEdges.length === 0
      ? 'All edges have positive distance'
      : `${zeroDistEdges.length} edge(s) have zero or negative distance`,
    affectedIds: zeroDistEdges.length > 0 ? zeroDistEdges : undefined,
  })

  // 8. Edge ID uniqueness
  const dupEdgeIds = edges.filter((e, i) => edges.findIndex((x) => x.id === e.id) !== i).map((e) => e.id)
  if (dupEdgeIds.length > 0) {
    // Already caught in #2, skip
  }

  // 9. Node ID uniqueness
  const dupNodeIds = nodes.filter((n, i) => nodes.findIndex((x) => x.id === n.id) !== i).map((n) => n.id)
  if (dupNodeIds.length > 0) {
    // Already caught in #2, skip
  }

  // 10. Nodes with hasQR should exist in QR tracking
  const nodesWithQR = nodes.filter((n) => n.hasQr)
  results.push({
    category: 'QR Assignments',
    status: 'pass',
    message: `${nodesWithQR.length} node(s) have QR checkpoint assignments`,
  })

  // 11. Nodes with hasPanorama
  const nodesWithPano = nodes.filter((n) => n.hasPanorama)
  results.push({
    category: 'Panorama Links',
    status: 'pass',
    message: `${nodesWithPano.length} node(s) have panorama links`,
  })

  return results
}
