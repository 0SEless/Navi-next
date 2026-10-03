import type { NavigationGraph, NavNode, NavEdge, ValidationResult } from '../../types'
import type { GraphValidationRule, GraphValidationContext, ValidationReport, ValidationStatistics } from './types'

const VALIDATOR_VERSION = '1.0.0'

export function buildContext(graph: NavigationGraph): GraphValidationContext {
  const nodeMap = new Map<string, NavNode>()
  for (const node of graph.nodes) {
    nodeMap.set(node.id, node)
  }

  const edgeMap = new Map<string, NavEdge>()
  for (const edge of graph.edges) {
    edgeMap.set(edge.id, edge)
  }

  const adjacency = new Map<string, string[]>()
  for (const node of graph.nodes) {
    adjacency.set(node.id, [])
  }
  for (const edge of graph.edges) {
    adjacency.get(edge.from)?.push(edge.to)
    adjacency.get(edge.to)?.push(edge.from)
  }

  return {
    graph,
    nodeMap,
    edgeMap,
    adjacency,
  }
}

function computeStatistics(context: GraphValidationContext): ValidationStatistics {
  const { graph, adjacency } = context
  const nodes = graph.nodes
  const edges = graph.edges

  const visited = new Set<string>()
  const componentSizes: number[] = []

  for (const node of nodes) {
    if (visited.has(node.id)) continue
    const queue = [node.id]
    visited.add(node.id)
    let size = 0
    while (queue.length > 0) {
      const current = queue.shift()!
      size++
      for (const neighbor of adjacency.get(current) || []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor)
          queue.push(neighbor)
        }
      }
    }
    componentSizes.push(size)
  }

  const isolatedNodes = componentSizes.filter(s => s === 1).length
  const largestComponent = Math.max(...componentSizes, 0)
  const connectivityScore = nodes.length > 0 ? largestComponent / nodes.length : 1

  let totalRouteLength = 0
  for (const edge of edges) {
    totalRouteLength += edge.distance
  }

  const buildingSet = new Set(nodes.map(n => n.buildingId).filter(Boolean))
  const floorSet = new Set(nodes.map(n => `${n.buildingId}:${n.floor}`))
  const roomCount = nodes.filter(n => n.type === 'space').length
  const hallwayCount = nodes.filter(n => n.type === 'corridor').length
  const transitionCount = nodes.filter(n => n.type === 'transition').length

  return {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    connectedComponents: componentSizes.length,
    isolatedNodes,
    buildingCount: buildingSet.size,
    floorCount: floorSet.size,
    roomCount,
    hallwayCount,
    transitionCount,
    totalRouteLength: Math.round(totalRouteLength),
    connectivityScore: Math.round(connectivityScore * 100) / 100,
  }
}

export class GraphValidator {
  private rules: GraphValidationRule[] = []

  registerRule(rule: GraphValidationRule): void {
    this.rules.push(rule)
  }

  registerRules(rules: GraphValidationRule[]): void {
    for (const rule of rules) {
      this.registerRule(rule)
    }
  }

  validate(graph: NavigationGraph): ValidationReport {
    const context = buildContext(graph)
    const allErrors: ValidationResult[] = []
    const allWarnings: ValidationResult[] = []

    for (const rule of this.rules) {
      const results = rule.validate(context)
      for (const result of results) {
        if (result.severity === 'error') {
          allErrors.push(result)
        } else {
          allWarnings.push(result)
        }
      }
    }

    const statistics = computeStatistics(context)

    return {
      passed: allErrors.length === 0,
      compilerVersion: '1.0.0',
      validatorVersion: VALIDATOR_VERSION,
      errors: allErrors,
      warnings: allWarnings,
      statistics,
    }
  }
}
