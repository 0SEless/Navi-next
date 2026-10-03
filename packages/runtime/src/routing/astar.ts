import type { NavigationGraph, NavNode, NavEdge } from '@navi/core'
import { haversine } from '@navi/core'

interface AdjacencyEntry {
  nodeId: string
  edge: NavEdge
}

export type TraversalCostProvider = (edge: NavEdge, traversalFromNodeId: string) => number
export type TraversalEligibilityProvider = (edge: NavEdge, traversalFromNodeId: string) => boolean
export type HeuristicProvider = (node: NavNode, goal: NavNode) => number

export interface AStarOptions {
  traversalCost?: TraversalCostProvider
  traversalEligibility?: TraversalEligibilityProvider
  heuristic?: HeuristicProvider
}

export interface AStarPathResult {
  path: string[]
  /** Exact edge sequence selected for each adjacent path-node pair. */
  edgeIds: string[]
  /** Generalized traversal cost used for optimal path selection. */
  cost: number
  /** @deprecated Generalized-cost alias retained for backward compatibility. */
  distance: number
}

export class AStar {
  private nodes = new Map<string, NavNode>()
  private adjacency = new Map<string, AdjacencyEntry[]>()
  private traversalCost: TraversalCostProvider
  private traversalEligibility: TraversalEligibilityProvider
  private heuristic: HeuristicProvider

  constructor(graph: NavigationGraph, options: AStarOptions = {}) {
    this.traversalCost = options.traversalCost ?? ((edge) => edge.weight)
    this.traversalEligibility = options.traversalEligibility ?? (() => true)
    this.heuristic = options.heuristic
      ?? (options.traversalCost
        ? (() => 0)
        : ((node, goal) => haversine(node.position, goal.position)))
    for (const node of graph.nodes) {
      this.nodes.set(node.id, node)
    }
    for (const edge of graph.edges) {
      const from = this.adjacency.get(edge.from) ?? []
      from.push({ nodeId: edge.to, edge })
      this.adjacency.set(edge.from, from)
      const to = this.adjacency.get(edge.to) ?? []
      to.push({ nodeId: edge.from, edge })
      this.adjacency.set(edge.to, to)
    }
  }

  findPath(fromId: string, toId: string): AStarPathResult | null {
    const fromNode = this.nodes.get(fromId)
    const toNode = this.nodes.get(toId)
    if (!fromNode || !toNode) return null

    const open = new Set<string>([fromId])
    const cameFrom = new Map<string, { nodeId: string; edgeId: string }>()
    const gScore = new Map<string, number>([[fromId, 0]])
    const initialHeuristic = this.getHeuristic(fromNode, toNode)
    const fScore = new Map<string, number>([[fromId, initialHeuristic]])

    while (open.size > 0) {
      let current = ''
      let currentF = Infinity
      for (const id of open) {
        const f = fScore.get(id) ?? Infinity
        if (f < currentF) { current = id; currentF = f }
      }

      if (current === toId) {
        const path: string[] = []
        const edgeIds: string[] = []
        let node = current
        while (node) {
          path.unshift(node)
          const predecessor = cameFrom.get(node)
          if (!predecessor) break
          edgeIds.unshift(predecessor.edgeId)
          node = predecessor.nodeId
        }
        const cost = gScore.get(toId) ?? 0
        return { path, edgeIds, cost, distance: cost }
      }

      open.delete(current)
      const neighbors = this.adjacency.get(current) ?? []
      for (const neighbor of neighbors) {
        if (!this.traversalEligibility(neighbor.edge, current)) continue
        const stepCost = this.traversalCost(neighbor.edge, current)
        if (!Number.isFinite(stepCost) || stepCost < 0) {
          throw new Error(`Traversal cost for edge ${neighbor.edge.id} must be finite and non-negative`)
        }
        const tentativeG = (gScore.get(current) ?? 0) + stepCost
        if (tentativeG < (gScore.get(neighbor.nodeId) ?? Infinity)) {
          cameFrom.set(neighbor.nodeId, { nodeId: current, edgeId: neighbor.edge.id })
          gScore.set(neighbor.nodeId, tentativeG)
          const target = this.nodes.get(neighbor.nodeId)
          if (target) {
            fScore.set(neighbor.nodeId, tentativeG + this.getHeuristic(target, toNode))
          }
          open.add(neighbor.nodeId)
        }
      }
    }

    return null
  }

  private getHeuristic(node: NavNode, goal: NavNode): number {
    const estimate = this.heuristic(node, goal)
    if (!Number.isFinite(estimate) || estimate < 0) {
      throw new Error('A* heuristic must be finite and non-negative')
    }
    return estimate
  }
}
