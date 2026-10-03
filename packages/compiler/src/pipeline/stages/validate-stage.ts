import type { CompilerStagePlugin, CompilerStageInput, CompilerStageOutput } from '../../types'
import { GraphValidator, buildContext } from '../../graph/validators'
import { DuplicateNodeRule } from '../../graph/validators/graph/duplicate-nodes'
import { DuplicateEdgeRule } from '../../graph/validators/graph/duplicate-edges'
import { MissingNodeRefRule, ZeroWeightRule } from '../../graph/validators/graph/edge-integrity'
import { DisconnectedGraphRule } from '../../graph/validators/graph/connectivity'
import { UnreachableRoomRule } from '../../graph/validators/graph/unreachable-room'
import { MissingEntranceRule } from '../../graph/validators/graph/missing-entrance'
import { DuplicateCoordsRule } from '../../graph/validators/graph/duplicate-coords'

/**
 * Stage 6: Validate — Checks graph correctness using the GraphValidator
 * registry. Error-level results halt the pipeline; warnings are reported
 * but non-blocking.
 */
export class ValidateStage implements CompilerStagePlugin {
  id = 'compiler-validate-stage'
  targetStage = 'validate' as const
  mode = 'replace' as const
  meta = {
    name: 'Validate Stage',
    version: '1.0.0',
    description: 'Validates graph connectivity, edge integrity, and routing invariants',
  }

  private validator: GraphValidator

  constructor() {
    this.validator = new GraphValidator()
    this.validator.registerRules([
      DuplicateNodeRule,
      DuplicateEdgeRule,
      MissingNodeRefRule,
      ZeroWeightRule,
      DisconnectedGraphRule,
      UnreachableRoomRule,
      MissingEntranceRule,
      DuplicateCoordsRule,
    ])
  }

  execute(input: CompilerStageInput, _next: (input: CompilerStageInput) => CompilerStageOutput): CompilerStageOutput {
    const nodes = input.nodes
    const edges = input.edges

    if (!nodes || !edges) {
      return { errors: [{ code: 'MISSING_INPUT', message: 'ValidateStage requires nodes and edges' }] }
    }

    // Build a NavigationGraph-like object for validation
    const graph = {
      version: '1.0.0',
      campusId: '',
      createdAt: '',
      checksum: '',
      nodes,
      edges,
      metadata: {
        nodeCount: nodes.length,
        edgeCount: edges.length,
        buildings: 0,
        floors: 0,
        boundingBox: { minLng: 0, maxLng: 0, minLat: 0, maxLat: 0 },
      },
    }

    const report = this.validator.validate(graph)
    const warnings = report.warnings.map(w => ({ code: w.code, message: w.message, entityId: w.entityId || '' }))
    const errors = report.errors.map(e => ({ code: e.code, message: e.message, entityId: e.entityId }))

    return {
      warnings,
      errors,
      context: { validationReport: report, ...input.context },
    }
  }
}

export { GraphValidator, buildContext } from '../../graph/validators'
export type { ValidationReport } from '../../graph/validators/types'
