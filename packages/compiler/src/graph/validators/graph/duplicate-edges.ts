import type { GraphValidationRule, GraphValidationContext } from '../types'

export const DuplicateEdgeRule: GraphValidationRule = {
  ruleId: 'GRAPH_DUPLICATE_EDGE',
  description: 'Detects edges with duplicate IDs',
  severity: 'error',

  validate(context: GraphValidationContext) {
    const seen = new Set<string>()
    const results: { severity: 'error'; code: string; message: string; entityId?: string }[] = []
    for (const edge of context.graph.edges) {
      if (seen.has(edge.id)) {
        results.push({
          severity: 'error',
          code: 'GRAPH_DUPLICATE_EDGE',
          message: `Duplicate edge ID: "${edge.id}"`,
          entityId: edge.id,
        })
      }
      seen.add(edge.id)
    }
    return results
  },
}
