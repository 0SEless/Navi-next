import type { GraphValidationRule, GraphValidationContext } from '../types'

const COORD_KEY = (n: { position: { lat: number; lng: number } }) =>
  `${n.position.lat.toFixed(6)},${n.position.lng.toFixed(6)}`

export const DuplicateCoordsRule: GraphValidationRule = {
  ruleId: 'GRAPH_DUPLICATE_COORDINATES',
  description: 'Detects nodes sharing the same coordinate (possible authoring mistake)',
  severity: 'warning',

  validate(context: GraphValidationContext) {
    const coordMap = new Map<string, typeof context.graph.nodes>()
    for (const node of context.graph.nodes) {
      const key = COORD_KEY(node)
      const list = coordMap.get(key) || []
      list.push(node)
      coordMap.set(key, list)
    }

    const results: { severity: 'warning'; code: string; message: string; entityId?: string; references?: string[] }[] = []
    for (const [key, nodes] of coordMap) {
      if (nodes.length > 1) {
        const [lat, lng] = key.split(',')
        results.push({
          severity: 'warning',
          code: 'GRAPH_DUPLICATE_COORDINATES',
          message: `${nodes.length} nodes share the same coordinate (${lat}, ${lng})`,
          entityId: nodes[0].id,
          references: nodes.map(n => n.id),
        })
      }
    }
    return results
  },
}
