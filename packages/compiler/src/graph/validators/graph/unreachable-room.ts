import type { GraphValidationRule, GraphValidationContext } from '../types'

export const UnreachableRoomRule: GraphValidationRule = {
  ruleId: 'GRAPH_UNREACHABLE_ROOM',
  description: 'All room nodes must be reachable from at least one entrance via BFS',
  severity: 'error',

  validate(context: GraphValidationContext) {
    const { graph, adjacency } = context
    const results: { severity: 'error'; code: string; message: string; entityId?: string }[] = []

    // Find entrance nodes (transitions with entityType 'entrance')
    const entranceNodes = graph.nodes.filter(
      n => n.properties?.entityType === 'entrance' || n.type === 'transition'
    )
    if (entranceNodes.length === 0) return []  // covered by missing-entrance rule

    // BFS from all entrance nodes
    const reachable = new Set<string>()
    const queue = entranceNodes.map(n => n.id)
    for (const id of queue) reachable.add(id)
    while (queue.length > 0) {
      const current = queue.shift()!
      for (const neighbor of adjacency.get(current) || []) {
        if (!reachable.has(neighbor)) {
          reachable.add(neighbor)
          queue.push(neighbor)
        }
      }
    }

    // Find room nodes not reachable from any entrance
    for (const node of graph.nodes) {
      if (node.type === 'space' && !reachable.has(node.id)) {
        results.push({
          severity: 'error',
          code: 'GRAPH_UNREACHABLE_ROOM',
          message: `Room "${node.label}" (${node.id}) is not reachable from any entrance`,
          entityId: node.id,
        })
      }
    }

    return results
  },
}
