import type { NavNode, LatLng } from '@/types/nav-types'
import { distanceMeters } from '@navi/core'

export { distanceMeters }

export interface NearestNodeResult {
  node: NavNode
  distanceMeters: number
}

/**
 * Resolve a GPS coordinate to the nearest routable graph node.
 * `maxDistance` guards against resolving coordinates that are nowhere
 * near the campus (e.g. GPS garbage); returns null beyond it.
 */
export function resolveNearestNode(
  nodes: NavNode[],
  position: LatLng,
  maxDistance = 1500,
): NearestNodeResult | null {
  if (nodes.length === 0) return null
  let nearest = nodes[0]
  let minDist = distanceMeters(position, nearest.position)
  for (let i = 1; i < nodes.length; i++) {
    const dist = distanceMeters(position, nodes[i].position)
    if (dist < minDist) {
      minDist = dist
      nearest = nodes[i]
    }
  }
  if (minDist > maxDistance) return null
  return { node: nearest, distanceMeters: minDist }
}
