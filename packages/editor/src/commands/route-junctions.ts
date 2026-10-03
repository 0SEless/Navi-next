import type { LocalCoord, RouteNetwork, RouteNode } from '@navi/core'
import { genId } from '../id'

const ENDPOINT_REUSE_EPSILON_METERS = 0.05

export type RouteJunctionSplitResult =
  | { ok: true; junctionId: string; reusedEndpoint: true }
  | { ok: true; junctionId: string; reusedEndpoint: false; removedEdgeId: string; createdEdgeIds: [string, string] }
  | { ok: false; error: string }

function distance(a: LocalCoord, b: LocalCoord): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/** Clamp a click onto the segment so the junction is exact, not the raw click. */
function projectPointOntoSegment(point: LocalCoord, from: LocalCoord, to: LocalCoord): LocalCoord {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return { ...from }
  const t = Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared))
  return { x: from.x + t * dx, y: from.y + t * dy }
}

/**
 * Split one route edge at the projected connection point. The junction is an
 * ordinary waypoint; the original edge is replaced by two same-type edges.
 * A projection that lands on an endpoint reuses that node instead of splitting.
 */
export function applyRouteJunctionSplit(
  network: RouteNetwork,
  edgeId: string,
  position: LocalCoord,
  floorLevel: number,
): RouteJunctionSplitResult {
  const edge = network.edges.find(candidate => candidate.id === edgeId)
  if (!edge) return { ok: false, error: `Route edge not found: ${edgeId}` }
  const from = network.nodes.find(node => node.id === edge.from)
  const to = network.nodes.find(node => node.id === edge.to)
  if (!from || !to) return { ok: false, error: `Route edge ${edgeId} has missing endpoints` }

  const projected = projectPointOntoSegment(position, from.position, to.position)
  if (distance(projected, from.position) <= ENDPOINT_REUSE_EPSILON_METERS) {
    return { ok: true, junctionId: from.id, reusedEndpoint: true }
  }
  if (distance(projected, to.position) <= ENDPOINT_REUSE_EPSILON_METERS) {
    return { ok: true, junctionId: to.id, reusedEndpoint: true }
  }

  const junctionId = genId('route-node')
  const firstEdgeId = genId('route-edge')
  const secondEdgeId = genId('route-edge')
  const junction: RouteNode = { id: junctionId, type: 'waypoint', position: projected, floor: floorLevel }

  network.edges = network.edges.filter(candidate => candidate.id !== edgeId)
  network.nodes.push(junction)
  network.edges.push(
    { id: firstEdgeId, from: from.id, to: junctionId, type: edge.type, distance: distance(from.position, projected) },
    { id: secondEdgeId, from: junctionId, to: to.id, type: edge.type, distance: distance(projected, to.position) },
  )

  return { ok: true, junctionId, reusedEndpoint: false, removedEdgeId: edgeId, createdEdgeIds: [firstEdgeId, secondEdgeId] }
}
