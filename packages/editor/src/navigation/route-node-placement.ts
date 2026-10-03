import type { RouteNode, RouteNetwork } from '@navi/core'
import type { LocalCoord } from '@navi/core'
import type { RouteNodeType } from '@navi/core'
import { genId } from '../id'

export function placeRouteNode(
  position: LocalCoord,
  floor: number,
  network: RouteNetwork,
  type: RouteNodeType = 'waypoint',
): RouteNode {
  const node: RouteNode = {
    id: genId('rn'),
    type,
    position: { x: position.x, y: position.y },
    floor,
  }
  network.nodes.push(node)
  return node
}

export function removeRouteNode(nodeId: string, network: RouteNetwork): boolean {
  const idx = network.nodes.findIndex(n => n.id === nodeId)
  if (idx === -1) return false
  network.nodes.splice(idx, 1)
  network.edges = network.edges.filter(e => e.from !== nodeId && e.to !== nodeId)
  return true
}

export function findNearestNode(
  position: LocalCoord,
  network: RouteNetwork,
  threshold: number = Infinity,
): RouteNode | null {
  let best: RouteNode | null = null
  let bestDist = Infinity
  for (const node of network.nodes) {
    const dx = node.position.x - position.x
    const dy = node.position.y - position.y
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (dist < bestDist) {
      bestDist = dist
      best = node
    }
  }
  if (bestDist <= threshold) return best
  return null
}
