import { haversine } from '@navi/core'
import type { NavEdge, NavNode } from '@navi/core'

export type ExperimentalTraversalCost = (
  edge: NavEdge,
  traversalFromNodeId: string,
) => number

export interface ExperimentalSearchResult {
  path: string[]
  totalCost: number
}

interface Neighbor {
  nodeId: string
  edge: NavEdge
}

function buildAdjacency(
  nodes: readonly NavNode[],
  edges: readonly NavEdge[],
): ReadonlyMap<string, readonly Neighbor[]> {
  const adjacency = new Map<string, Neighbor[]>()
  for (const node of nodes) adjacency.set(node.id, [])

  for (const edge of edges) {
    adjacency.get(edge.from)?.push({ nodeId: edge.to, edge })
    adjacency.get(edge.to)?.push({ nodeId: edge.from, edge })
  }

  return adjacency
}

function reconstructPath(
  cameFrom: ReadonlyMap<string, string>,
  goalId: string,
): string[] {
  const path = [goalId]
  let current = goalId
  while (cameFrom.has(current)) {
    current = cameFrom.get(current)!
    path.unshift(current)
  }
  return path
}

function checkedTraversalCost(
  getTraversalCost: ExperimentalTraversalCost,
  edge: NavEdge,
  fromNodeId: string,
): number {
  const cost = getTraversalCost(edge, fromNodeId)
  if (!Number.isFinite(cost) || cost < 0) {
    throw new RangeError(`Traversal cost for ${edge.id} must be finite and nonnegative`)
  }
  return cost
}

export function experimentalAStar(
  nodes: readonly NavNode[],
  edges: readonly NavEdge[],
  fromId: string,
  toId: string,
  getTraversalCost: ExperimentalTraversalCost,
): ExperimentalSearchResult | null {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const start = nodeById.get(fromId)
  const goal = nodeById.get(toId)
  if (!start || !goal) return null

  const adjacency = buildAdjacency(nodes, edges)
  const open = new Set([fromId])
  const cameFrom = new Map<string, string>()
  const gScore = new Map<string, number>([[fromId, 0]])
  const fScore = new Map<string, number>([
    [fromId, haversine(start.position, goal.position)],
  ])

  while (open.size > 0) {
    let current = ''
    let lowestFScore = Number.POSITIVE_INFINITY
    for (const candidate of open) {
      const candidateScore = fScore.get(candidate) ?? Number.POSITIVE_INFINITY
      if (candidateScore < lowestFScore) {
        current = candidate
        lowestFScore = candidateScore
      }
    }

    if (!current) return null
    if (current === toId) {
      return {
        path: reconstructPath(cameFrom, current),
        totalCost: gScore.get(current)!,
      }
    }

    open.delete(current)
    for (const neighbor of adjacency.get(current) ?? []) {
      const traversalCost = checkedTraversalCost(
        getTraversalCost,
        neighbor.edge,
        current,
      )
      const tentative = (gScore.get(current) ?? Number.POSITIVE_INFINITY) + traversalCost
      if (tentative >= (gScore.get(neighbor.nodeId) ?? Number.POSITIVE_INFINITY)) {
        continue
      }

      const neighborNode = nodeById.get(neighbor.nodeId)
      if (!neighborNode) continue
      cameFrom.set(neighbor.nodeId, current)
      gScore.set(neighbor.nodeId, tentative)
      fScore.set(
        neighbor.nodeId,
        tentative + haversine(neighborNode.position, goal.position),
      )
      open.add(neighbor.nodeId)
    }
  }

  return null
}

export function dijkstraOracle(
  nodes: readonly NavNode[],
  edges: readonly NavEdge[],
  fromId: string,
  toId: string,
  getTraversalCost: ExperimentalTraversalCost,
): ExperimentalSearchResult | null {
  const nodeIds = new Set(nodes.map((node) => node.id))
  if (!nodeIds.has(fromId) || !nodeIds.has(toId)) return null

  const adjacency = buildAdjacency(nodes, edges)
  const frontier = new Set([fromId])
  const settled = new Set<string>()
  const cameFrom = new Map<string, string>()
  const distance = new Map<string, number>([[fromId, 0]])

  while (frontier.size > 0) {
    let current = ''
    let lowestDistance = Number.POSITIVE_INFINITY
    for (const candidate of frontier) {
      const candidateDistance = distance.get(candidate) ?? Number.POSITIVE_INFINITY
      if (candidateDistance < lowestDistance) {
        current = candidate
        lowestDistance = candidateDistance
      }
    }

    if (!current) return null
    frontier.delete(current)
    if (settled.has(current)) continue
    settled.add(current)

    if (current === toId) {
      return {
        path: reconstructPath(cameFrom, current),
        totalCost: distance.get(current)!,
      }
    }

    for (const neighbor of adjacency.get(current) ?? []) {
      if (settled.has(neighbor.nodeId)) continue
      const traversalCost = checkedTraversalCost(
        getTraversalCost,
        neighbor.edge,
        current,
      )
      const tentative = distance.get(current)! + traversalCost
      if (tentative >= (distance.get(neighbor.nodeId) ?? Number.POSITIVE_INFINITY)) {
        continue
      }
      distance.set(neighbor.nodeId, tentative)
      cameFrom.set(neighbor.nodeId, current)
      frontier.add(neighbor.nodeId)
    }
  }

  return null
}
