import type { CampusDocument } from '@navi/core'
import type { CompilerAdapter, CompileResult } from '@navi/editor'

/**
 * Server-side CompilerAdapter that imports @navi/compiler directly.
 * NOT for client bundles — Node built-ins (crypto/fs) are unavailable there.
 *
 * Uses compileV2 pipeline: normalize → generatePrimitives → connectivity → emit → artifacts
 */
export class CampusCompilerAdapter implements CompilerAdapter {
  async compile(document: CampusDocument): Promise<CompileResult> {
    try {
      const { CampusCompiler } = await import('@navi/compiler')

      const compiler = new CampusCompiler({
        nodeInterval: 5,
        mergeThreshold: 3,
        optimizationLevel: 'moderate',
        includeAccessibility: false,
      })

      // Use compileV2 — the new primitives-based pipeline
      const result = compiler.compileV2(document)

      if (!result.success || !result.graph) {
        const prefix = result.errors?.some(e => e.code?.startsWith('GRAPH_'))
          ? 'Graph validation failed'
          : 'Compilation failed'
        return {
          status: 'error',
          message: `${prefix}: ${result.errors.map(e => e.code ? `[${e.code}] ${e.message}` : e.message).join('; ')}`,
          timestamp: Date.now(),
        }
      }

      // compileV2 already builds artifacts internally
      return {
        status: 'success',
        timestamp: Date.now(),
        artifacts: {
          ...(result.artifacts ?? {}),
          navigationGraph: result.graph,
          searchIndex: result.artifacts?.searchIndex ?? null,
          poiData: result.artifacts?.poiIndex ?? null,
          buildingIndex: result.artifacts?.buildingIndex ?? null,
        },
      }
    } catch (err) {
      return {
        status: 'error',
        message: (err as Error).message,
        timestamp: Date.now(),
      }
    }
  }
}
