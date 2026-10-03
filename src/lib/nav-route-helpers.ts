/**
 * Pure helpers for the enriched route contract (ADR 020).
 *
 * `buildNavRoute` — enriches a lean PathResult into a NavRoute.
 * `computeRouteProgress` — projects a GPS position onto the route polyline.
 * `computeSegments` — groups route steps into navigation segments.
 */

import type { NavNode, NavEdge, PathResult, LatLng } from '../types/nav-types'
import type {
  NavRoute,
  NavRouteStep,
  NavInstruction,
  NavArrival,
  NavRouteSegment,
  NavStepType,
  NavInstructionType,
  NavSegmentType,
  RouteProgress,
} from '../types/route-types'
import { haversine, closestPointOnSegment } from '../engine/geo-utils'

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildNodeMap(nodes: NavNode[]): Map<string, NavNode> {
  const m = new Map<string, NavNode>()
  for (const n of nodes) m.set(n.id, n)
  return m
}

function buildEdgeMap(edges: NavEdge[]): Map<string, NavEdge> {
  const m = new Map<string, NavEdge>()
  for (const e of edges) {
    m.set(`${e.from}->${e.to}`, e)
    m.set(`${e.to}->${e.from}`, e) // bidirectional
  }
  return m
}

function buildEdgeIdMap(edges: NavEdge[]): Map<string, NavEdge> {
  return new Map(edges.map((edge) => [edge.id, edge]))
}

/** Map NavNode.type + optional incoming edge type to a NavStepType. */
function nodeTypeToStepType(nodeType: NavNode['type'], edgeType?: string): NavStepType {
  if (nodeType === 'stair' || nodeType === 'staircase') return 'stairs'
  if (nodeType === 'elevator') return 'elevator'
  if (nodeType === 'entrance' || nodeType === 'building_entrance') return 'entrance'
  if (edgeType === 'door') return 'door'
  return 'walk'
}

/** Map NavStepType to a NavInstructionType (simplified — no turn detection yet). */
function stepTypeToInstructionType(stepType: NavStepType): NavInstructionType {
  if (stepType === 'stairs') return 'stairs'
  if (stepType === 'elevator') return 'elevator'
  return 'walk'
}

/** Derive NavSegmentType from a NavStepType. */
function stepTypeToSegmentType(stepType: NavStepType): NavSegmentType {
  if (stepType === 'entrance') return 'entrance'
  if (stepType === 'stairs' || stepType === 'elevator') return 'floor-transition'
  return 'indoor'
}

// ---------------------------------------------------------------------------
// buildNavRoute
// ---------------------------------------------------------------------------

/**
 * Enrich a lean `PathResult` into a full `NavRoute`.
 *
 * Each step gets floor/position/buildingId/type from the node map.
 * Instructions are typed from node/edge types.
 * `nodeFloors` is computed as distinct floors, numeric descending.
 */
export function buildNavRoute(
  pathResult: PathResult,
  nodes: NavNode[],
  edges: NavEdge[],
): NavRoute | null {
  if (!pathResult || pathResult.path.length === 0) return null

  const nodeById = buildNodeMap(nodes)
  const edgeMap = buildEdgeMap(edges)
  const edgeById = buildEdgeIdMap(edges)

  const startNode = nodeById.get(pathResult.path[0])
  const endNode = nodeById.get(pathResult.path[pathResult.path.length - 1])
  if (!startNode || !endNode) return null

  // Build enriched steps — one per path node
  const steps: NavRouteStep[] = []
  for (let i = 0; i < pathResult.path.length; i++) {
    const nodeId = pathResult.path[i]
    const node = nodeById.get(nodeId)
    if (!node) continue

    const prevNodeId = i > 0 ? pathResult.path[i - 1] : undefined
    const selectedEdgeId = pathResult.steps[i]?.edgeId
    const edge = selectedEdgeId
      ? edgeById.get(selectedEdgeId)
      : prevNodeId ? edgeMap.get(`${prevNodeId}->${nodeId}`) : undefined

    steps.push({
      nodeId,
      ...(selectedEdgeId ? { edgeId: selectedEdgeId } : {}),
      label: node.label,
      position: node.position,
      floor: node.floor,
      buildingId: node.buildingId,
      type: nodeTypeToStepType(node.type, edge?.type),
    })
  }

  // Build instructions — typed from node/edge types
  const instructions: NavInstruction[] = pathResult.steps.map((s, i) => {
    const node = nodeById.get(s.nodeId)
    const prevNodeId = i > 0 ? pathResult.steps[i - 1].nodeId : undefined
    const edge = s.edgeId
      ? edgeById.get(s.edgeId)
      : prevNodeId ? edgeMap.get(`${prevNodeId}->${s.nodeId}`) : undefined
    const stepType = node ? nodeTypeToStepType(node.type, edge?.type) : 'walk'
    const isLast = i === pathResult.steps.length - 1

    return {
      type: isLast ? 'arrive' : stepTypeToInstructionType(stepType),
      text: s.instruction,
      distance: s.distance,
      fromNode: i > 0 ? pathResult.steps[i - 1].nodeId : s.nodeId,
      toNode: s.nodeId,
    }
  })

  // Compute nodeFloors — distinct, numeric descending
  const floorSet = new Set<number>()
  for (const s of steps) floorSet.add(s.floor)
  const nodeFloors = [...floorSet].sort((a, b) => b - a)

  // Arrival summary
  const arrival: NavArrival = {
    nodeId: endNode.id,
    label: endNode.label,
    position: endNode.position,
    remainingDistance: 0,
  }

  return {
    path: pathResult.path,
    steps,
    instructions,
    totalDistance: pathResult.cost,
    ...(pathResult.generalizedCost === undefined ? {} : { generalizedCost: pathResult.generalizedCost }),
    totalDuration: 0, // placeholder — speed data not yet available
    fromLabel: startNode.label,
    toLabel: endNode.label,
    arrival,
    nodeFloors,
  }
}

// ---------------------------------------------------------------------------
// computeRouteProgress
// ---------------------------------------------------------------------------

/**
 * Project a GPS position onto the route polyline and compute progress.
 *
 * This is the **authoritative** progress source — not nearest-node matching.
 * The user's position is projected onto the nearest line segment between
 * consecutive route steps, giving smooth interpolation between nodes.
 */
export function computeRouteProgress(
  route: NavRoute,
  position: LatLng,
): RouteProgress {
  const { steps } = route

  if (steps.length === 0) {
    return {
      index: 0,
      remainingDistance: route.totalDistance,
      currentSegment: 'outdoor',
      snappedPosition: position,
    }
  }

  if (steps.length === 1) {
    return {
      index: 0,
      remainingDistance: haversine(position, steps[0].position),
      currentSegment: stepTypeToSegmentType(steps[0].type),
      snappedPosition: steps[0].position,
    }
  }

  // Find nearest point on route polyline (all segments)
  let bestDist = Infinity
  let bestSnapped: LatLng = steps[0].position
  let bestIndex = 0

  for (let i = 0; i < steps.length - 1; i++) {
    const a = steps[i].position
    const b = steps[i + 1].position
    const snapped = closestPointOnSegment(position, a, b)
    const dist = haversine(position, snapped)
    if (dist < bestDist) {
      bestDist = dist
      bestSnapped = snapped
      bestIndex = i
    }
  }

  // Also check distance to the final node (handles the "past the end" case)
  const lastDist = haversine(position, steps[steps.length - 1].position)
  if (lastDist <= bestDist) {
    bestDist = lastDist
    bestSnapped = steps[steps.length - 1].position
    bestIndex = steps.length - 1
  }

  // If snapped position is essentially at the next step, advance index.
  // This handles the "exactly at a node" case where the projection lands
  // on a shared boundary between two segments.
  if (bestIndex < steps.length - 1) {
    const distToNext = haversine(bestSnapped, steps[bestIndex + 1].position)
    if (distToNext < 1) {
      bestIndex += 1
      bestSnapped = steps[bestIndex].position
    }
  }

  // Compute remaining distance from snapped position to destination
  let remainingDistance = 0
  if (bestIndex >= steps.length - 1) {
    // Snapped to or past the last step
    remainingDistance = haversine(bestSnapped, steps[steps.length - 1].position)
  } else {
    // Distance from snapped position to the next step
    remainingDistance = haversine(bestSnapped, steps[bestIndex + 1].position)
    // Plus all subsequent segments
    for (let i = bestIndex + 1; i < steps.length - 1; i++) {
      remainingDistance += haversine(steps[i].position, steps[i + 1].position)
    }
  }

  // Derive current segment from the step at the projection point
  const currentStep = steps[Math.min(bestIndex, steps.length - 1)]
  const currentSegment = stepTypeToSegmentType(currentStep.type)

  return {
    index: bestIndex,
    remainingDistance,
    currentSegment,
    snappedPosition: bestSnapped,
  }
}

// ---------------------------------------------------------------------------
// computeSegments
// ---------------------------------------------------------------------------

/**
 * Group route steps into contiguous navigation segments.
 *
 * Segment boundaries occur at:
 * - Entrance nodes (outdoor → entrance → indoor)
 * - Floor-change nodes (stairs/elevator → floor-transition)
 * - Floor changes between consecutive steps
 */
export function computeSegments(route: NavRoute): NavRouteSegment[] {
  const { steps } = route
  if (steps.length === 0) return []

  const segments: NavRouteSegment[] = []
  let segStart = 0
  let segType = stepTypeToSegmentType(steps[0].type)

  for (let i = 1; i < steps.length; i++) {
    const thisType = stepTypeToSegmentType(steps[i].type)
    const floorChanged = steps[i].floor !== steps[i - 1].floor

    // Break segment if type changes or floor changes (unless both are indoor)
    if (thisType !== segType || (floorChanged && segType === 'indoor' && thisType === 'indoor')) {
      segments.push({
        type: segType,
        startIndex: segStart,
        endIndex: i - 1,
        floor: steps[segStart].floor,
        buildingId: steps[segStart].buildingId,
      })
      segStart = i
      segType = thisType
    }
  }

  // Push final segment
  segments.push({
    type: segType,
    startIndex: segStart,
    endIndex: steps.length - 1,
    floor: steps[segStart].floor,
    buildingId: steps[segStart].buildingId,
  })

  return segments
}
