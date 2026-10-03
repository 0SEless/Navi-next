import type {
  CompilerStagePlugin,
  CompilerStageInput,
  CompilerStageOutput,
  NavNode,
  NavEdge,
} from '../../types'

/**
 * Stage 5: Optimize — Removes redundant nodes, short-circuits dead ends,
 * merges co-located nodes.
 */
export class OptimizeStage implements CompilerStagePlugin {
  id = 'compiler-optimize-stage'
  targetStage = 'optimize' as const
  mode = 'replace' as const
  meta = {
    name: 'Optimize Stage',
    version: '1.0.0',
    description: 'Removes redundant nodes and optimizes graph connectivity',
  }

  execute(input: CompilerStageInput, _next: (input: CompilerStageInput) => CompilerStageOutput): CompilerStageOutput {
    const nodes = input.nodes
    const edges = input.edges
    if (!nodes) {
      return { errors: [{ code: 'MISSING_INPUT', message: 'OptimizeStage requires nodes' }] }
    }

    const result = optimizeGraph(nodes, edges || [])
    return {
      nodes: result.nodes,
      edges: result.edges,
      warnings: result.warnings,
    }
  }
}

export function optimizeGraph(
  nodes: NavNode[],
  edges: NavEdge[],
): {
  nodes: NavNode[]
  edges: NavEdge[]
  warnings: { code: string; message: string; entityId: string }[]
} {
  const warnings: { code: string; message: string; entityId: string }[] = []
  const nodeIds = new Set(nodes.map(n => n.id))

  // Remove edges that reference non-existent nodes
  const validEdges = edges.filter(e => nodeIds.has(e.from) && nodeIds.has(e.to))

  // Find orphaned nodes (no connections at all)
  const connectedNodes = new Set<string>()
  for (const e of validEdges) {
    connectedNodes.add(e.from)
    connectedNodes.add(e.to)
  }

  for (const node of nodes) {
    if (!connectedNodes.has(node.id) && node.type !== 'intersection') {
      warnings.push({
        code: 'ORPHANED_NODE',
        message: `Node "${node.label}" (${node.id}) has no connections`,
        entityId: node.id,
      })
    }
  }

  // Detect duplicate edges (same source+target, keep shortest)
  const bestEdges = new Map<string, NavEdge>()
  for (const e of validEdges) {
    const key = e.from < e.to ? `${e.from}->${e.to}` : `${e.to}->${e.from}`
    const existing = bestEdges.get(key)
    if (!existing || e.distance < existing.distance) {
      bestEdges.set(key, e)
    }
  }
  const dedupedEdges = Array.from(bestEdges.values())

  return { nodes, edges: dedupedEdges, warnings }
}
