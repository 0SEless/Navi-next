import type { GraphValidationRule, GraphValidationContext } from '../types'

export const DisconnectedGraphRule: GraphValidationRule = {
  ruleId: 'GRAPH_DISCONNECTED',
  description: 'All nodes must belong to the same connected component',
  severity: 'error',

  validate(context: GraphValidationContext) {
    const { graph, adjacency } = context
    if (graph.nodes.length === 0) return []

    // BFS from first node
    const visited = new Set<string>()
    const queue = [graph.nodes[0].id]
    visited.add(queue[0])
    while (queue.length > 0) {
      const current = queue.shift()!
      for (const neighbor of adjacency.get(current) || []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor)
          queue.push(neighbor)
        }
      }
    }

    // Find unvisited nodes
    const unvisited = graph.nodes.filter(n => !visited.has(n.id))
    if (unvisited.length === 0) return []

    // Group by component for better error reporting
    const componentGroups: string[][] = []
    const remaining = new Set(unvisited.map(n => n.id))
    for (const node of unvisited) {
      if (!remaining.has(node.id)) continue
      const comp: string[] = []
      const q = [node.id]
      remaining.delete(node.id)
      while (q.length > 0) {
        const current = q.shift()!
        comp.push(current)
        for (const neighbor of adjacency.get(current) || []) {
          if (remaining.has(neighbor)) {
            remaining.delete(neighbor)
            q.push(neighbor)
          }
        }
      }
      componentGroups.push(comp)
    }

    return componentGroups.map((comp, i) => ({
      severity: 'error' as const,
      code: 'GRAPH_DISCONNECTED',
      message: `Disconnected component ${i + 1} with ${comp.length} node(s) — first node: "${context.nodeMap.get(comp[0])?.label || comp[0]}"`,
      entityId: comp[0],
      references: comp.slice(0, 5),
    }))
  },
}
