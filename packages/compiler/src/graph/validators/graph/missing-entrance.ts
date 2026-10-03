import type { GraphValidationRule, GraphValidationContext } from '../types'
import type { ValidationResult } from '../../../types'

export const MissingEntranceRule: GraphValidationRule = {
  ruleId: 'GRAPH_NO_REACHABLE_TRANSITION',
  description: 'Each building with nodes must have at least one transition node (entrance, stairs, elevator)',
  severity: 'error',

  validate(context: GraphValidationContext) {
    const { graph } = context
    const results: ValidationResult[] = []

    // Group nodes by building
    const nodesByBuilding = new Map<string, typeof graph.nodes>()
    for (const node of graph.nodes) {
      if (!node.buildingId) continue
      const list = nodesByBuilding.get(node.buildingId) || []
      list.push(node)
      nodesByBuilding.set(node.buildingId, list)
    }

    for (const [buildingId, nodes] of nodesByBuilding) {
      if (!buildingId) continue  // external/road nodes don't belong to a building
      const hasTransition = nodes.some(
        n => n.type === 'transition' ||
             n.properties?.entityType === 'entrance' ||
             n.properties?.entityType === 'staircase' ||
             n.properties?.entityType === 'elevator'
      )
      if (!hasTransition) {
        const sampleNode = nodes[0]
        results.push({
          severity: 'error',
          code: 'GRAPH_NO_REACHABLE_TRANSITION',
          message: `Building "${buildingId}" has ${nodes.length} node(s) but no transition point (entrance, stairs, or elevator)`,
          entityId: buildingId,
          references: nodes.slice(0, 5).map(n => n.id),
        })
      }
    }

    return results
  },
}
