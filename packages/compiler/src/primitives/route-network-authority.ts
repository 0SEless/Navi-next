import type { NormalizedFloor } from '../types'

export type RouteNetworkAuthority = 'ABSENT' | 'EMPTY' | 'INVALID' | 'USABLE'

/**
 * Assess whether a floor's routeNetwork is usable for compilation.
 *
 * Returns:
 *   ABSENT  — routeNetwork undefined
 *   EMPTY   — routeNetwork exists but has no nodes
 *   INVALID — routeNetwork has structural issues
 *   USABLE  — valid, traversable network
 */
export function assessRouteNetworkAuthority(
  floor: NormalizedFloor,
): RouteNetworkAuthority {
  const rn = floor.routeNetwork
  if (!rn) return 'ABSENT'
  if (rn.nodes.length === 0) return 'EMPTY'

  const nodeIds = new Set<string>()
  for (const node of rn.nodes) {
    if (nodeIds.has(node.id)) return 'INVALID'
    nodeIds.add(node.id)

    if (!Number.isFinite(node.position.x) || !Number.isFinite(node.position.y)) {
      return 'INVALID'
    }
  }

  const edgeIds = new Set<string>()
  for (const edge of rn.edges) {
    if (edgeIds.has(edge.id)) return 'INVALID'
    edgeIds.add(edge.id)

    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) return 'INVALID'
    if (edge.from === edge.to) return 'INVALID'
    if (!Number.isFinite(edge.distance) || edge.distance < 0) return 'INVALID'
  }

  return 'USABLE'
}
