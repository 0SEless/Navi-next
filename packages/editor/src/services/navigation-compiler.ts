import { BaseEditorService } from '../context'
import type { EditorServiceContext } from '../context/service-registry'
import type { CampusDocument } from '@navi/core'

// ── Types ─────────────────────────────────────────────────────

/**
 * Artifact set produced by a successful compilation.
 * Loosely typed — actual shape depends on @navi/compiler output.
 */
export interface CompiledArtifacts {
  navigationGraph: unknown
  searchIndex: unknown
  poiData: unknown
  buildingIndex: unknown
  [key: string]: unknown
}

export interface CompileResult {
  status: 'success' | 'error'
  message?: string
  artifacts?: CompiledArtifacts
  timestamp: number
}

/**
 * Adapter interface for the compilation implementation.
 *
 * The concrete adapter is injected at construction time (from the
 * application layer in EditorBridge), which keeps @navi/editor
 * free of @navi/compiler dependencies and avoids tracing Node
 * built-ins (crypto) into the client bundle.
 *
 * The adapter implementation lazy-imports @navi/compiler.
 */
export interface CompilerAdapter {
  compile(document: CampusDocument): Promise<CompileResult>
}

// ── NavigationCompiler ────────────────────────────────────────

/**
 * Stateless compiler service.
 *
 * Delegates compilation to an injected CompilerAdapter.
 * No cached state — every call compiles fresh.
 * Concurrent calls return the in-flight promise (not duplicate work).
 *
 * Invariant: never stores a `lastResult`. WorkflowService owns
 * the compile result in WorkflowStore.
 */
export class NavigationCompiler extends BaseEditorService {
  readonly id = 'navigationCompiler'
  readonly dependencies: readonly string[] = ['eventBus']

  private adapter: CompilerAdapter
  private currentCompile: Promise<CompileResult> | null = null

  constructor(adapter: CompilerAdapter) {
    super()
    this.adapter = adapter
  }

  async init(context: EditorServiceContext): Promise<void> {
    await super.init(context)
  }

  /**
   * Compile a CampusDocument into navigation artifacts.
   * Delegates to the injected CompilerAdapter.
   * Returns the in-flight promise if called concurrently.
   */
  async compile(document: CampusDocument): Promise<CompileResult> {
    if (this.currentCompile) {
      return this.currentCompile
    }

    const promise = this.adapter.compile(document)
    this.currentCompile = promise
    try {
      return await promise
    } finally {
      this.currentCompile = null
    }
  }
}
