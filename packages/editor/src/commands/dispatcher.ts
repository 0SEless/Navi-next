import type { CampusDocument } from '@navi/core'
import type { BatchMutationResult, Command, MutationResult, PreHook, PostHook } from './types'
import { CommandRegistry } from './registry'
import { BaseEditorService } from '../context'
import type { EditorServiceContext } from '../context/service-registry'
import type { DocumentStore } from '../context/document-store'
import type { DocumentEventBus } from '../eventbus'

export interface ExecuteOptions {
  skipHooks?: boolean
}

export class CommandDispatcher extends BaseEditorService {
  readonly id = 'dispatcher'
  readonly dependencies: readonly string[] = ['eventBus']

  private registry: CommandRegistry
  private document: CampusDocument
  private eventBus!: DocumentEventBus
  private documentStore?: DocumentStore
  private preHooks: PreHook[] = []
  private postHooks: PostHook[] = []

  constructor(registry?: CommandRegistry, document?: CampusDocument, eventBus?: DocumentEventBus) {
    super()
    this.registry = registry ?? new CommandRegistry()
    this.document = document ?? ({} as CampusDocument)
    this.eventBus = eventBus ?? ({} as DocumentEventBus)
  }

  async init(context: EditorServiceContext): Promise<void> {
    await super.init(context)
    this.eventBus = context.get('eventBus')
    this.document = context.document
    this.documentStore = context.get('documentStore')
  }

  addPreHook(hook: PreHook): void {
    this.preHooks.push(hook)
  }

  removePreHook(id: string): void {
    this.preHooks = this.preHooks.filter(h => h.id !== id)
  }

  addPostHook(hook: PostHook): void {
    this.postHooks.push(hook)
  }

  removePostHook(id: string): void {
    this.postHooks = this.postHooks.filter(h => h.id !== id)
  }

  execute(command: Command, options?: ExecuteOptions): any {
    const handler = this.registry.get(command.id)
    if (!handler) {
      throw new Error(`Unknown command: ${command.id}`)
    }

    if (!options?.skipHooks) {
      for (const hook of this.preHooks) {
        hook.before(command, this.document)
      }
    }

    const result = handler.execute(this.document, command.payload)

    if (result.success && !options?.skipHooks) {
      this.eventBus.transaction(() => {
        for (const hook of this.postHooks) {
          hook.after(command, result, this.document)
        }
        this.eventBus.emit('entity.' + (command.id.includes('create') ? 'created' : command.id.includes('delete') ? 'deleted' : 'updated'), {
          entityId: result.entityId,
          entityType: command.id.split('.')[0],
        })
      })
    }

    // FROZEN order: handler → (postHooks + entity.updated) → documentStore.commit() → document.changed
    // commit() + document.changed run on every successful command, including skipHooks (undo/redo),
    // so React re-renders (useDocumentVersion) even when history recording is suppressed.
    if (result.success) {
      this.documentStore?.commit()
      this.eventBus.emit('document.changed', {
        version: this.documentStore?.version,
        entityId: result.entityId,
        entityType: command.id.split('.')[0],
      })
    }

    return result
  }

  /**
   * Execute existing commands as one document transaction.
   *
   * Batch execution intentionally does not invoke per-command hooks. The
   * Capture importer uses this boundary after its own preflight validation so
   * a HistoryStack pre-hook cannot record entries for a batch that later
   * rolls back. Successful batches may notify an optional batch hook exactly
   * once after the document transaction commits. Normal single-command
   * execute() semantics are unchanged.
   */
  executeBatch(commands: Command[], options?: ExecuteOptions): BatchMutationResult {
    if (commands.length === 0) return { success: true, results: [] }

    for (const [index, command] of commands.entries()) {
      if (!this.registry.get(command.id)) {
        return {
          success: false,
          results: [],
          failedCommandIndex: index,
          error: `Unknown command: ${command.id}`,
        }
      }
    }

    const snapshot = structuredClone(this.document)
    const startingStoreVersion = this.documentStore?.version ?? 0
    const startingRevision = this.documentStore?.revision ?? ''
    const results: MutationResult[] = []
    let failedCommandIndex: number | undefined

    try {
      this.eventBus.transaction(() => {
        for (const [index, command] of commands.entries()) {
          const handler = this.registry.get(command.id)!
          const result = handler.execute(this.document, command.payload)
          results.push(result)
          if (!result.success) {
            failedCommandIndex = index
            throw new Error(result.error ?? `Command failed: ${command.id}`)
          }

          this.eventBus.emit('entity.' + (command.id.includes('create') ? 'created' : command.id.includes('delete') ? 'deleted' : 'updated'), {
            entityId: result.entityId,
            entityType: command.id.split('.')[0],
          })
        }

        this.documentStore?.commit()
        this.eventBus.emit('document.changed', {
          version: this.documentStore?.version,
          entityId: results.at(-1)?.entityId,
          entityType: 'batch',
        })
      })

      if (!options?.skipHooks) {
        for (const hook of this.postHooks) {
          hook.afterBatch?.(commands, results, this.document, snapshot)
        }
      }

      return { success: true, results }
    } catch (error) {
      this.documentStore?.restore(snapshot, startingStoreVersion, startingRevision)
      if (this.documentStore === undefined) Object.assign(this.document, snapshot)
      return {
        success: false,
        results,
        failedCommandIndex,
        error: error instanceof Error ? error.message : 'Command batch failed',
      }
    }
  }
}
