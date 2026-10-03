import type { GraphValidationRule, GraphValidationContext } from '../types'

export const DuplicateNodeRule: GraphValidationRule = {
  ruleId: 'GRAPH_DUPLICATE_NODE',
  description: 'Detects nodes with duplicate IDs',
  severity: 'error',

  validate(context: GraphValidationContext) {
    const seen = new Set<string>()
    const results: { severity: 'error'; code: string; message: string; entityId?: string }[] = []
    for (const node of context.graph.nodes) {
      if (seen.has(node.id)) {
        results.push({
          severity: 'error',
          code: 'GRAPH_DUPLICATE_NODE',
          message: `Duplicate node ID: "${node.id}"`,
          entityId: node.id,
        })
      }
      seen.add(node.id)
    }
    return results
  },
}
