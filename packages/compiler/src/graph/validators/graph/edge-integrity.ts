import type { GraphValidationRule, GraphValidationContext } from '../types'

export const MissingNodeRefRule: GraphValidationRule = {
  ruleId: 'GRAPH_MISSING_NODE_REF',
  description: 'Detects edges referencing non-existent node IDs',
  severity: 'error',

  validate(context: GraphValidationContext) {
    const results: { severity: 'error'; code: string; message: string; entityId?: string }[] = []
    for (const edge of context.graph.edges) {
      if (!context.nodeMap.has(edge.from)) {
        results.push({
          severity: 'error',
          code: 'GRAPH_MISSING_NODE_REF',
          message: `Edge "${edge.id}" references non-existent source node: "${edge.from}"`,
          entityId: edge.id,
        })
      }
      if (!context.nodeMap.has(edge.to)) {
        results.push({
          severity: 'error',
          code: 'GRAPH_MISSING_NODE_REF',
          message: `Edge "${edge.id}" references non-existent target node: "${edge.to}"`,
          entityId: edge.id,
        })
      }
    }
    return results
  },
}

export const ZeroWeightRule: GraphValidationRule = {
  ruleId: 'GRAPH_ZERO_WEIGHT',
  description: 'Detects edges with zero or negative weight/distance',
  severity: 'error',

  validate(context: GraphValidationContext) {
    const results: { severity: 'error'; code: string; message: string; entityId?: string }[] = []
    for (const edge of context.graph.edges) {
      if (edge.weight <= 0) {
        results.push({
          severity: 'error',
          code: 'GRAPH_ZERO_WEIGHT',
          message: `Edge "${edge.id}" has ${edge.weight <= 0 ? 'zero or negative' : 'zero'} weight (${edge.weight})`,
          entityId: edge.id,
        })
      }
      if (edge.distance < 0) {
        results.push({
          severity: 'error',
          code: 'GRAPH_ZERO_WEIGHT',
          message: `Edge "${edge.id}" has negative distance (${edge.distance})`,
          entityId: edge.id,
        })
      }
    }
    return results
  },
}
