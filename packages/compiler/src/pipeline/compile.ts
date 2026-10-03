import type { CampusDocument } from '@navi/core'
import type { CompilerConfig, CompileResult } from '../types'
import { CampusCompiler } from './campus-compiler'
import { directExtract } from '../extractors/direct-extract'
import { buildGraph, buildSearchIndex } from '../artifacts'
import { createHash } from 'crypto'

/**
 * Legacy compile function — kept for backward compatibility.
 *
 * Uses the old pipeline path (directExtract → buildGraph) directly
 * without the new stage plugin system.
 *
 * @deprecated Use `new CampusCompiler(config).compile(document)` for
 * plugin support and the new CompileResultV2 format.
 */
export function compile(document: CampusDocument, config: CompilerConfig): CompileResult {
  const start = performance.now()
  const extraction = directExtract(document)
  const graph = buildGraph(document, extraction)

  // Count buildings/floors from the campus document
  const bldSet = new Set(document.buildings.map(b => b.id))
  const flrSet = new Set<string>()
  for (const b of document.buildings) {
    for (const f of b.floors) flrSet.add(`${b.id}-${f.level}`)
  }

  // Exclude createdAt from checksum so identical input produces identical hash
  const { createdAt: _, checksum: __, ...contentOnly } = graph
  return {
    graph: {
      ...graph,
      checksum: createHash('sha256').update(JSON.stringify(contentOnly)).digest('hex'),
      metadata: {
        ...graph.metadata,
        buildings: bldSet.size,
        floors: flrSet.size,
      },
    },
    report: {
      spacesExtracted: extraction.spaces.length,
      transitionsExtracted: extraction.transitions.length,
      corridorsExtracted: extraction.corridors.length,
      nodesGenerated: graph.nodes.length,
      edgesGenerated: graph.edges.length,
      warnings: [],
      errors: [],
      validation: [],
    },
    duration: performance.now() - start,
    extraction,
  }
}

export { CampusCompiler } from './campus-compiler'
