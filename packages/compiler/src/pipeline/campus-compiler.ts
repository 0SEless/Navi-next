import type { CampusDocument } from '@navi/core'
import { ROUTE_NETWORK_THRESHOLDS } from '@navi/core'
import type {
  CompilerStagePlugin,
  CompilerStageInput,
  CompilerStageOutput,
  CompileStageId,
  CompileResultV2,
  CompilerConfig,
  ParsedDocument,
  NavNode,
  NavEdge,
  CompileWarning,
  CompileError,
  CompileStats,
  CompileStage,
} from '../types'
import { ParseStage, parseDocument } from './stages/parse-stage'
import { BuildNodesStage, buildNodes } from './stages/build-nodes-stage'
import { BuildEdgesStage, buildEdges } from './stages/build-edges-stage'
import { OptimizeStage, optimizeGraph } from './stages/optimize-stage'
import { ValidateStage } from './stages/validate-stage'
import { normalizeDocument } from '../normalize'
import { generatePrimitives } from '../primitives/coordinator'
import { normalizeConnectivity } from '../connectivity/normalizer'
import { validateConnectivity } from '../connectivity/validator'
import { emitGraph } from '../emitter'
import { buildArtifacts } from '../emitter/artifacts'
import { createHash } from 'crypto'

const DEFAULT_STAGES: Record<CompileStageId, CompilerStagePlugin> = {
  'parse': new ParseStage(),
  'build-nodes': new BuildNodesStage(),
  'build-edges': new BuildEdgesStage(),
  'optimize': new OptimizeStage(),
  'validate': new ValidateStage(),
}

const STAGE_NAMES: Record<CompileStageId, string> = {
  'parse': 'Parsing document',
  'build-nodes': 'Building nodes',
  'build-edges': 'Building edges',
  'optimize': 'Optimizing graph',
  'validate': 'Validating graph',
}

const STAGE_ORDER: CompileStageId[] = [
  'parse',
  'build-nodes',
  'build-edges',
  'optimize',
  'validate',
]

export class CampusCompiler {
  private stagePlugins = new Map<CompileStageId, CompilerStagePlugin[]>()
  private stageOverrides = new Map<CompileStageId, CompilerStagePlugin>()

  constructor(private config: CompilerConfig = {} as CompilerConfig) {
    this.registerPlugins(config.plugins || [])
    this.applyStageOverrides(config.stages)
  }

  // ── Plugin Registration ──

  registerPlugin(plugin: CompilerStagePlugin): void {
    if (!plugin.id.startsWith('compiler-')) {
      throw new Error(`Plugin ID must start with "compiler-": ${plugin.id}`)
    }
    if (!this.stagePlugins.has(plugin.targetStage)) {
      this.stagePlugins.set(plugin.targetStage, [])
    }
    this.stagePlugins.get(plugin.targetStage)!.push(plugin)
  }

  registerPlugins(plugins: CompilerStagePlugin[]): void {
    for (const plugin of plugins) {
      this.registerPlugin(plugin)
    }
  }

  private applyStageOverrides(stages?: CompilerConfig['stages']): void {
    if (!stages) return
    const stageMap: [CompileStageId, string][] = [
      ['parse', 'parse'],
      ['build-nodes', 'build-nodes'],
      ['build-edges', 'build-edges'],
      ['optimize', 'optimize'],
      ['validate', 'validate'],
    ]
    for (const [id, key] of stageMap) {
      const OverrideClass = (stages as any)[key]
      if (OverrideClass) {
        this.stageOverrides.set(id, new OverrideClass())
      }
    }
  }

  // ── Main Compilation ──

  compile(document: CampusDocument): CompileResultV2 {
    return this.compileWithProgress(document, () => {})
  }

  /**
   * V2 compilation — the new 4-stage pipeline.
   *
   *   Stage 1   Normalize        → NormalizedDocument (local→world once)
   *   Stage 2   Generate Primitives → PrimitiveGraph
   *   Stage 3.1 Connectivity Normalize → ConnectivityGraph (only mutation phase)
   *   Stage 3.2 Connectivity Validate  → diagnostics (read-only)
   *   Stage 3.3 Emit Graph        → NavigationGraph (mechanical, no spatial search)
   *   Stage 4   Build Artifacts   → NavigationArtifacts
   *
   * Runs entirely independent of `compile()`. No shared stages, no shared
   * mutable state. Diagnostics accumulate monotonically. Errors are collected,
   * never thrown, except structural Stage 1 errors which halt the pipeline.
   *
   * TEMPORARY migration endpoint. In M6, `compile()` becomes this pipeline.
   */
  compileV2(document: CampusDocument): CompileResultV2 {
    const startTime = performance.now()
    const diagnostics: import('../types').CompilerDiagnostic[] = []
    const warnings: CompileWarning[] = []
    const errors: CompileError[] = []

    // P1-T8 (R8.3): compiler defaults flow from the route-network definitions
    // module — single source (risk R7). Explicit config still wins.
    const nodeInterval = this.config.nodeInterval ?? ROUTE_NETWORK_THRESHOLDS.nodeIntervalMeters
    const mergeThreshold = this.config.mergeThreshold ?? ROUTE_NETWORK_THRESHOLDS.dedupeMergeMeters
    const maxEntranceRoadDistance = this.config.maxEntranceRoadDistance ?? ROUTE_NETWORK_THRESHOLDS.compilerFallbackMeters

    try {
      // ── Stage 1: Normalize ──
      const normResult = normalizeDocument(document)
      diagnostics.push(...normResult.diagnostics)

      const structuralErrors = normResult.diagnostics.filter(d => d.severity === 'error')
      if (structuralErrors.length > 0) {
        for (const d of structuralErrors) {
          errors.push({ code: d.code, message: d.message })
        }
        return this.failV2(startTime, diagnostics, warnings, errors, 0)
      }

      // ── Stage 2: Generate Primitives ──
      const primitiveGraph = generatePrimitives(normResult.document, {
        nodeInterval,
        mergeThreshold,
        maxEntranceRoadDistance,
      })
      diagnostics.push(...primitiveGraph.diagnostics.filter(d => !diagnostics.includes(d)))

      // ── Stage 3.1: Connectivity Normalize ──
      const connectivityGraph = normalizeConnectivity(primitiveGraph, mergeThreshold, normResult.document.connectivitySemantics)
      diagnostics.push(...connectivityGraph.diagnostics.filter(d => !diagnostics.includes(d)))

      // ── Stage 3.2: Connectivity Validate (read-only) ──
      const validation = validateConnectivity(connectivityGraph)
      diagnostics.push(...validation.diagnostics)

      // ── Stage 3.3: Emit Graph ──
      connectivityGraph.metadata.campusId = document.metadata.campusId
      const navGraph = emitGraph(connectivityGraph)
      navGraph.createdAt = new Date().toISOString()

      // ── Stage 4: Build Artifacts ──
      const artifacts = buildArtifacts(connectivityGraph, navGraph, document)

      // ── Assemble diagnostics into report ──
      for (const d of diagnostics) {
        if (d.severity === 'warning') warnings.push({ code: d.code, message: d.message, entityId: d.sourceEntityId })
        else if (d.severity === 'error') errors.push({ code: d.code, message: d.message })
      }

      const report = this.buildReport(diagnostics, connectivityGraph, navGraph, performance.now() - startTime)

      const stats: CompileStats = {
        totalNodes: navGraph.nodes.length,
        totalEdges: navGraph.edges.length,
        buildingsProcessed: navGraph.metadata.buildings,
        floorsProcessed: navGraph.metadata.floors,
        roomsProcessed: navGraph.nodes.filter(n => n.type === 'poi').length,
        hallwaysProcessed: navGraph.nodes.filter(n => n.type === 'waypoint').length,
        totalRouteLength: Math.round(navGraph.edges.reduce((s, e) => s + e.distance, 0)),
        connectivityScore: validation.metrics.disconnectedComponents === 0 ? 1 : 0.5,
      }

      return {
        success: errors.length === 0,
        graph: navGraph,
        artifacts,
        report,
        stats,
        warnings,
        errors,
        duration: performance.now() - startTime,
      }
    } catch (err) {
      errors.push({ code: 'COMPILE_V2_ERROR', message: (err as Error).message })
      return this.failV2(startTime, diagnostics, warnings, errors, 0)
    }
  }

  private buildReport(
    diagnostics: import('../types').CompilerDiagnostic[],
    connectivityGraph: import('../types').ConnectivityGraph,
    navGraph: import('../types').NavigationGraph,
    compileTime: number,
  ): import('../types').CompilerReport {
    const diagCounts = { error: 0, warning: 0, info: 0 }
    for (const d of diagnostics) diagCounts[d.severity]++

    return {
      diagnostics,
      statistics: {
        rooms: connectivityGraph.nodes.filter(n => n.kind === 'poi').length,
        hallways: connectivityGraph.nodes.filter(n => n.kind === 'waypoint').length,
        roads: 0,
        primitives: connectivityGraph.nodes.length,
        waypoints: connectivityGraph.nodes.filter(n => n.kind === 'waypoint').length,
        edges: navGraph.edges.length,
        diagnostics: diagCounts,
        compileTime: Math.round(compileTime),
      },
    }
  }

  private failV2(
    startTime: number,
    diagnostics: import('../types').CompilerDiagnostic[],
    warnings: CompileWarning[],
    errors: CompileError[],
    compileTime: number,
  ): CompileResultV2 {
    return {
      success: false,
      graph: null,
      report: {
        diagnostics,
        statistics: {
          rooms: 0, hallways: 0, roads: 0, primitives: 0, waypoints: 0, edges: 0,
          diagnostics: {
            error: diagnostics.filter(d => d.severity === 'error').length,
            warning: diagnostics.filter(d => d.severity === 'warning').length,
            info: diagnostics.filter(d => d.severity === 'info').length,
          },
          compileTime,
        },
      },
      stats: {
        totalNodes: 0, totalEdges: 0,
        buildingsProcessed: 0, floorsProcessed: 0,
        roomsProcessed: 0, hallwaysProcessed: 0,
        totalRouteLength: 0, connectivityScore: 0,
      },
      warnings,
      errors,
      duration: performance.now() - startTime,
    }
  }

  compileWithProgress(
    document: CampusDocument,
    onProgress: (stage: CompileStage, progress: number) => void,
  ): CompileResultV2 {
    const startTime = performance.now()
    const allWarnings: CompileWarning[] = []
    const allErrors: CompileError[] = []

    // Shared state passed through stages
    const ctx: Record<string, unknown> = {}
    let nodes: NavNode[] | undefined
    let edges: NavEdge[] | undefined
    let parsed: import('../types').ParsedDocument | undefined

    try {
      for (let i = 0; i < STAGE_ORDER.length; i++) {
        const stageId = STAGE_ORDER[i]
        const progress = (i + 1) / STAGE_ORDER.length
        onProgress({ name: STAGE_NAMES[stageId], progress }, progress)

        const input: CompilerStageInput = {
          document,
          context: ctx,
          parsed,
          nodes,
          edges,
        }

        const output = this.executeStage(stageId, input)

        // Collect warnings and errors
        if (output.warnings) allWarnings.push(...output.warnings)
        if (output.errors) {
          allErrors.push(...output.errors)
          // Errors halt the pipeline
          if (output.errors.length > 0) break
        }

        // Update shared state (stages may return empty arrays — that's valid)
        if (output.nodes !== undefined) nodes = output.nodes
        if (output.edges !== undefined) edges = output.edges
        if (output.context) Object.assign(ctx, output.context)

        // Extract parsed document from context after parse stage
        if (ctx.parsed) {
          parsed = ctx.parsed as ParsedDocument
        }
      }

      // Build the NavigationGraph
      const safeNodes = nodes || []
      const safeEdges = edges || []
      const graph = this.buildGraph(document, safeNodes, safeEdges)

      // Get stats from context (set by validate stage) or compute them
      const stats: CompileStats = (ctx.stats as CompileStats) || {
        totalNodes: safeNodes.length,
        totalEdges: safeEdges.length,
        buildingsProcessed: new Set(safeNodes.map(n => n.buildingId).filter(Boolean)).size,
        floorsProcessed: new Set(safeNodes.map(n => `${n.buildingId}:${n.floor}`)).size,
        roomsProcessed: safeNodes.filter(n => n.type === 'space').length,
        hallwaysProcessed: safeNodes.filter(n => n.type === 'corridor').length,
        totalRouteLength: Math.round(safeEdges.reduce((s, e) => s + e.distance, 0)),
        connectivityScore: 1,
      }

      return {
        success: allErrors.length === 0,
        graph,
        stats,
        warnings: allWarnings,
        errors: allErrors,
        duration: performance.now() - startTime,
        validation: ctx.validationReport as import('../graph/validators/types').ValidationReport | undefined,
      }
    } catch (err) {
      return {
        success: false,
        graph: null,
        stats: {
          totalNodes: 0, totalEdges: 0,
          buildingsProcessed: 0, floorsProcessed: 0,
          roomsProcessed: 0, hallwaysProcessed: 0,
          totalRouteLength: 0, connectivityScore: 0,
        },
        warnings: allWarnings,
        errors: [...allErrors, { code: 'COMPILE_ERROR', message: (err as Error).message }],
        duration: performance.now() - startTime,
      }
    }
  }

  // ── Stage Execution with Plugin Chaining ──

  private executeStage(stageId: CompileStageId, input: CompilerStageInput): CompilerStageOutput {
    const plugins = this.stagePlugins.get(stageId) || []
    const defaultImpl = this.stageOverrides.get(stageId) || DEFAULT_STAGES[stageId]

    if (plugins.length === 0) {
      // No plugins → use default implementation
      return defaultImpl.execute(input, () => ({ context: {} }))
    }

    // Chain plugins: first 'replace' wins, 'augment' plugins wrap
    const replacePlugin = plugins.find(p => p.mode === 'replace')
    const augmentPlugins = plugins.filter(p => p.mode === 'augment')

    if (replacePlugin) {
      // Replace mode: plugin takes full control, receives `next` as fallback
      return replacePlugin.execute(input, () => defaultImpl.execute(input, () => ({ context: {} })))
    }

    // Augment mode: chain plugins around default
    // Last registered augment plugin runs closest to the default
    let chain = (inp: CompilerStageInput) => defaultImpl.execute(inp, () => ({ context: {} }))
    for (const plugin of augmentPlugins.reverse()) {
      const next = chain
      chain = (inp: CompilerStageInput) => plugin.execute(inp, next)
    }
    return chain(input)
  }

  // ── Graph Construction ──

  private buildGraph(document: CampusDocument, nodes: NavNode[], edges: NavEdge[]) {
    // Bounding box
    const bbox = nodes.length > 0
      ? nodes.reduce((bb, n) => ({
          minLng: Math.min(bb.minLng, n.position.lng),
          maxLng: Math.max(bb.maxLng, n.position.lng),
          minLat: Math.min(bb.minLat, n.position.lat),
          maxLat: Math.max(bb.maxLat, n.position.lat),
        }), { minLng: Infinity, maxLng: -Infinity, minLat: Infinity, maxLat: -Infinity })
      : { minLng: 0, maxLng: 0, minLat: 0, maxLat: 0 }

    const buildingSet = new Set(nodes.map(n => n.buildingId).filter(Boolean))
    const floorSet = new Set(nodes.map(n => `${n.buildingId}:${n.floor}`))

    // Compute checksum from content only (exclude timestamps)
    const contentOnly = {
      nodes,
      edges,
      version: '1.0.0',
      campusId: document.metadata.campusId,
      metadata: {
        nodeCount: nodes.length,
        edgeCount: edges.length,
        buildings: buildingSet.size,
        floors: floorSet.size,
        boundingBox: bbox,
      },
    }

    return {
      version: '1.0.0',
      campusId: document.metadata.campusId,
      createdAt: new Date().toISOString(),
      checksum: createHash('sha256').update(JSON.stringify(contentOnly)).digest('hex'),
      nodes,
      edges,
      metadata: {
        nodeCount: nodes.length,
        edgeCount: edges.length,
        buildings: buildingSet.size,
        floors: floorSet.size,
        boundingBox: bbox,
      },
    }
  }
}
