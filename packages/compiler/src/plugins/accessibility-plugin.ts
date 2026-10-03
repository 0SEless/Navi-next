import type { CompilerStagePlugin, CompilerStageInput, CompilerStageOutput } from '../types'

/**
 * Accessibility Weight Plugin
 *
 * Augments the build-edges stage to adjust edge weights
 * based on accessibility preferences. Non-accessible edges
 * receive a 50% weight penalty, making pathfinding prefer
 * accessible routes.
 */
export const accessibilityWeightPlugin: CompilerStagePlugin = {
  id: 'compiler-accessibility-weights',
  targetStage: 'build-edges',
  meta: {
    name: 'Accessibility Weight Plugin',
    version: '1.0.0',
    description: 'Adjusts edge weights for wheelchair accessibility',
    author: 'NAVI Team',
  },
  mode: 'augment',
  execute(input: CompilerStageInput, next: CompilerStageNext): CompilerStageOutput {
    const result = next(input)

    if (result.edges) {
      for (const edge of result.edges) {
        // Check if either endpoint is non-accessible
        const fromNode = input.nodes?.find(n => n.id === edge.from)
        const toNode = input.nodes?.find(n => n.id === edge.to)
        const fromAccessible = fromNode?.properties?.isAccessible !== false
        const toAccessible = toNode?.properties?.isAccessible !== false

        if (!fromAccessible || !toAccessible) {
          edge.weight *= 1.5 // 50% penalty for non-accessible routes
        }
      }
    }

    return result
  },
}

type CompilerStageNext = (input: CompilerStageInput) => CompilerStageOutput
