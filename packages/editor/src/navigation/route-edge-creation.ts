import type { RouteEdge, RouteNetwork } from '@navi/core'
import type { RouteEdgeType } from '@navi/core'
import { genId } from '../id'

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.sqrt(dx * dx + dy * dy)
}

export function createRouteEdge(
  fromId: string,
  toId: string,
  network: RouteNetwork,
  type: RouteEdgeType = 'walk',
): RouteEdge | null {
  if (!validateEdge(fromId, toId, network)) return null
  const fromNode = network.nodes.find(n => n.id === fromId)!
  const toNode = network.nodes.find(n => n.id === toId)!
  const edge: RouteEdge = {
    id: genId('re'),
    from: fromId,
    to: toId,
    type,
    distance: distance(fromNode.position, toNode.position),
  }
  network.edges.push(edge)
  return edge
}

export function removeRouteEdge(edgeId: string, network: RouteNetwork): boolean {
  const idx = network.edges.findIndex(e => e.id === edgeId)
  if (idx === -1) return false
  network.edges.splice(idx, 1)
  return true
}

export function validateEdge(fromId: string, toId: string, network: RouteNetwork): boolean {
  if (fromId === toId) return false
  const fromNode = network.nodes.find(n => n.id === fromId)
  const toNode = network.nodes.find(n => n.id === toId)
  if (!fromNode || !toNode) return false
  if (fromNode.floor !== toNode.floor) return false
  const exists = network.edges.some(
    e => (e.from === fromId && e.to === toId) || (e.from === toId && e.to === fromId),
  )
  return !exists
}
