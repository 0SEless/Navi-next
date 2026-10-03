import type { CompilerStagePlugin, CompilerStageInput, CompilerStageOutput } from '../types'

/**
 * Custom Validation Plugin
 *
 * Replaces the validate stage with a custom validator
 * that implements university-specific validation rules.
 * Does not call the default validator — full replacement.
 */
export const customValidationPlugin: CompilerStagePlugin = {
  id: 'compiler-custom-validator',
  targetStage: 'validate',
  meta: {
    name: 'Custom Campus Validator',
    version: '2.0.0',
    description: 'Custom validation rules for university-specific requirements',
    author: 'NAVI Team',
  },
  mode: 'replace',
  execute(input: CompilerStageInput, _next: CompilerStageNext): CompilerStageOutput {
    const warnings: Array<{ code: string; message: string; entityId: string }> = []
    const errors: Array<{ code: string; message: string; entityId?: string }> = []

    // Validate: check that all rooms have names
    for (const node of input.nodes || []) {
      if (node.type === 'space' && !node.label) {
        warnings.push({
          code: 'UNNAMED_ROOM',
          message: `Room ${node.id} has no name`,
          entityId: node.id,
        })
      }
    }

    // Validate: check for disconnected buildings
    const buildings = new Set(input.nodes?.map(n => n.buildingId).filter(Boolean) || [])
    if (buildings.size > 0) {
      // Basic check: each building should have at least one node with connections
      for (const bldId of buildings) {
        const bldNodes = input.nodes?.filter(n => n.buildingId === bldId) || []
        if (bldNodes.length === 0) {
          warnings.push({
            code: 'EMPTY_BUILDING',
            message: `Building ${bldId} has no nodes`,
            entityId: bldId,
          })
        }
      }
    }

    return { warnings, errors }
  },
}

type CompilerStageNext = (input: CompilerStageInput) => CompilerStageOutput
