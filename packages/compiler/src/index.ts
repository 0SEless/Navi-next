export * from './types'
export { compile, CampusCompiler } from './compiler'
export { generateArtifacts, generateManifest, buildGraph, buildSearchIndex, buildPOIData, buildBuildingIndex } from './artifacts'
export { accessibilityWeightPlugin, customValidationPlugin } from './plugins'
export {
  ParseStage, parseDocument,
  BuildNodesStage, buildNodes,
  BuildEdgesStage, buildEdges,
  OptimizeStage, optimizeGraph,
  ValidateStage,
} from './pipeline/stages'

// ── V2 pipeline (M5 Phase 2) — new 4-stage compiler ──
export { normalizeDocument } from './normalize'
export type { NormalizeResult } from './normalize'
export { generatePrimitives } from './primitives/coordinator'
export { PolylineSkeletonGenerator } from './primitives/skeleton-generator'
export { normalizeConnectivity } from './connectivity/normalizer'
export { validateConnectivity } from './connectivity/validator'
export type { ValidationReport as ConnectivityValidationReport } from './connectivity/validator'
export { emitGraph } from './emitter'
export { buildArtifacts } from './emitter/artifacts'
export { COMPILER_VERSION } from './version'
export {
  validateNavigationArtifacts,
} from './validation'
export type {
  ArtifactDiagnostic,
  ArtifactValidationOptions,
  ArtifactValidationResult,
} from './validation'
