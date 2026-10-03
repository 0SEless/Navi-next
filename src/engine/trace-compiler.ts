import type { TracePath, NavNode, NavEdge, LatLng } from '../types/nav-types'
import { findEndpointNodes } from './intersection-engine'
import { haversine } from './geo-utils'
// Share the engine's single id counter so trace nodes can never collide with
// compiled component nodes (two independent counters produced identical ids
// like N0001, silently overwriting hallway/room nodes in the graph).
import { genId } from './component-compiler'

export interface CompileTraceResult {
  nodes: NavNode[]
  edges: NavEdge[]
}

function pointToLatLng(pt: LatLng): string {
  return `${pt.lat.toFixed(6)},${pt.lng.toFixed(6)}`
}

function findMatchingExistingNode(
  existingNodes: NavNode[],
  pos: LatLng,
  trace: TracePath,
): NavNode | undefined {
  const key = pointToLatLng(pos)
  const candidates = existingNodes.filter(n => pointToLatLng(n.position) === key)
  if (candidates.length === 0) return undefined
  // Identity reuse is scope-strict: stacked floors and adjacent buildings can
  // share identical coordinates, so adopting a same-position node from another
  // building/floor would silently overwrite it (addNode is a Map upsert).
  // Only an exact building+floor match may donate its stable id.
  const traceBuilding = trace.buildingId ?? ''
  const traceFloor = trace.floor ?? 0
  return candidates.find(
    (n) => (n.buildingId ?? '') === traceBuilding && (n.floor ?? 0) === traceFloor,
  )
}

export function compileTrace(
  trace: TracePath,
  existingNodes: NavNode[],
  existingEdges: NavEdge[],
  stableReference?: { nodes?: NavNode[]; edges?: NavEdge[] },
): CompileTraceResult {
  if (trace.metadata?.role === 'wall') return { nodes: [], edges: [] }

  const nodes: NavNode[] = []
  const edges: NavEdge[] = []
  const generatedNodePositions = new Set<string>()

  // 1. Collect node positions from trace endpoints and all points
  const nodePositions: LatLng[] = []
  const endpoints = findEndpointNodes(trace)
  const endpointKeys = new Set(endpoints.map(pointToLatLng))
  for (const ep of endpoints) {
    const key = pointToLatLng(ep)
    if (!generatedNodePositions.has(key)) {
      nodePositions.push(ep)
      generatedNodePositions.add(key)
    }
  }
  for (const pt of trace.points) {
    const key = pointToLatLng(pt)
    if (!generatedNodePositions.has(key)) {
      nodePositions.push(pt)
      generatedNodePositions.add(key)
    }
  }

  // 2. Create nodes (preserving stable identity when node exists at this position)
  const nodeMap = new Map<string, NavNode>()
  for (const pos of nodePositions) {
    const key = pointToLatLng(pos)
    const existing = findMatchingExistingNode(existingNodes, pos, trace)
      ?? (stableReference?.nodes ? findMatchingExistingNode(stableReference.nodes, pos, trace) : undefined)
    const id = existing ? existing.id : genId('N')
    const node: NavNode = {
      id,
      label: existing?.label ?? `${trace.name ?? 'Path'} Node`,
      name: existing?.name ?? `${trace.name ?? 'Path'} Node`,
      type: existing?.type ?? 'intersection',
      buildingId: trace.buildingId ?? '',
      campusId: trace.campusId ?? '',
      floor: trace.floor,
      position: pos,
      // Endpoint availability is distinct from a shared intersection. The
      // renderer uses this marker to expose both ends for explicit authoring;
      // it must never be interpreted as an automatic graph connection.
      metadata: {
        ...(existing?.metadata ?? {}),
        ...(endpointKeys.has(key) ? { roadEndpoint: true } : {}),
      },
    }
    nodeMap.set(key, node)
    nodes.push(node)
  }

  // 3. Create edges between consecutive trace points
  for (let i = 0; i < trace.points.length - 1; i++) {
    const fromKey = pointToLatLng(trace.points[i])
    const toKey = pointToLatLng(trace.points[i + 1])
    const fromNode = nodeMap.get(fromKey)
    const toNode = nodeMap.get(toKey)
    if (fromNode && toNode && fromNode.id !== toNode.id) {
      const edgeInGraph = existingEdges.some(
        (e) => (e.from === fromNode.id && e.to === toNode.id) ||
               (e.from === toNode.id && e.to === fromNode.id)
      )
      if (!edgeInGraph) {
        // Reuse edge id from stableReference if available
        const stableEdge = stableReference?.edges?.find(
          (e) => (e.from === fromNode.id && e.to === toNode.id) ||
                 (e.from === toNode.id && e.to === fromNode.id)
        )
        const edgeId = stableEdge ? stableEdge.id : genId('E')
        edges.push({
          id: edgeId,
          from: fromNode.id,
          to: toNode.id,
          type: stableEdge?.type ?? 'walk',
          distance: haversine(fromNode.position, toNode.position),
          weight: haversine(fromNode.position, toNode.position),
          campusId: trace.campusId ?? '',
        })
      }
    }
  }

  // 4. NOTE: traces intentionally do NOT connect to room doors. A road→room_door
  //    edge would bypass the building entrance (road → entrance → hallway →
  //    room_door is the ONLY valid path into a building). Buildings link to
  //    traces via their entrances only (see GraphAdapter post-trace pass).

  return { nodes, edges }
}
