/**
 * Stage 3B — CompilerService
 *
 * Deterministic CampusDocument → NavigationGraph wrapper.
 * No state, no side effects. Recompiling the same document produces the same graph.
 */

import { compile } from '@navi/compiler'
import type { CampusDocument } from '@navi/core'
import type { NavigationGraph } from '@navi/compiler'

const DEFAULT_CONFIG = {
  nodeInterval: 5,
  mergeThreshold: 3,
  optimizationLevel: 'moderate' as const,
  includeAccessibility: false,
}

/**
 * Compile a CampusDocument into a NavigationGraph.
 * Deterministic — same input always produces the same output
 * (checksum differs only by createdAt timestamp, but graph topology is invariant).
 */
export function compileDocument(doc: CampusDocument): {
  graph: NavigationGraph
  nodeCount: number
  edgeCount: number
  duration: number
} {
  const result = compile(doc, DEFAULT_CONFIG)

  return {
    graph: result.graph,
    nodeCount: result.graph.nodes.length,
    edgeCount: result.graph.edges.length,
    duration: result.duration,
  }
}
