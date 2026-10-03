import { BaseEditorService } from '../context'
import type { EditorServiceContext } from '../context/service-registry'
import type { WorkflowService } from './workflow-service'
import type { DocumentStore } from '../context/document-store'
import type { DocumentEventBus } from '../eventbus'

export interface AutosaveOptions {
  debounceMs?: number
  maxIntervalMs?: number
}

// ── SaveQueue ──────────────────────────────────────────────────

/**
 * Serialized save queue.
 *
 * Contract: at most one active save + one pending save.
 * Pending save always captures the latest revision; older pending is superseded.
 *
 * States:
 *   idle ──→ saving ──→ idle
 *               │
 *               └──→ pending ──→ saving ──→ idle
 */
class SaveQueue {
  private state: 'idle' | 'saving' | 'pending' = 'idle'
  private pendingVersion: number | null = null
  private executor: (version: number) => Promise<void>
  private onIdle?: () => void

  constructor(executor: (version: number) => Promise<void>, onIdle?: () => void) {
    this.executor = executor
    this.onIdle = onIdle
  }

  schedule(version: number): void {
    if (this.state === 'idle') {
      this.state = 'saving'
      this.execute(version)
    } else if (this.state === 'saving') {
      this.pendingVersion = version
      this.state = 'pending'
    } else {
      // pending — supersede with latest version
      this.pendingVersion = version
    }
  }

  private async execute(version: number): Promise<void> {
    try {
      await this.executor(version)
    } catch {
      // Error is handled by WorkflowService; queue continues
    }
    this.handleComplete()
  }

  private handleComplete(): void {
    if (this.state === 'pending' && this.pendingVersion !== null) {
      const nextVersion = this.pendingVersion
      this.pendingVersion = null
      this.state = 'saving'
      this.execute(nextVersion)
    } else {
      this.state = 'idle'
      this.pendingVersion = null
      this.onIdle?.()
    }
  }

  get isIdle(): boolean {
    return this.state === 'idle'
  }

  get isSaving(): boolean {
    return this.state === 'saving' || this.state === 'pending'
  }
}

// ── AutosaveService ────────────────────────────────────────────

export class AutosaveService extends BaseEditorService {
  readonly id = 'autosave'
  readonly dependencies = ['workflow', 'documentStore', 'eventBus'] as const

  private debounceMs: number
  private maxIntervalMs: number
  private workflow!: WorkflowService
  private documentStore!: DocumentStore
  private eventBus!: DocumentEventBus

  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private maxIntervalTimer: ReturnType<typeof setInterval> | null = null
  private onRevisionCommitted!: () => void
  private queue: SaveQueue

  constructor(options?: AutosaveOptions) {
    super()
    this.debounceMs = options?.debounceMs ?? 5000
    this.maxIntervalMs = options?.maxIntervalMs ?? 30000
    this.queue = new SaveQueue(
      (version) => this.executeSave(version),
      () => this.onQueueIdle(),
    )
  }

  async init(context: EditorServiceContext): Promise<void> {
    await super.init(context)
    this.workflow = context.get('workflow')
    this.documentStore = context.get('documentStore')
    this.eventBus = context.get('eventBus')

    this.onRevisionCommitted = () => this.handleRevisionCommitted()
    this.eventBus.on('revision.committed', this.onRevisionCommitted)

    this.maxIntervalTimer = setInterval(() => this.tryAutosave(), this.maxIntervalMs)
  }

  async destroy(): Promise<void> {
    this.clearDebounce()
    if (this.maxIntervalTimer !== null) {
      clearInterval(this.maxIntervalTimer)
      this.maxIntervalTimer = null
    }
    if (this.onRevisionCommitted) {
      this.eventBus.off('revision.committed', this.onRevisionCommitted)
    }
    await super.destroy()
  }

  private handleRevisionCommitted(): void {
    this.clearDebounce()
    this.debounceTimer = setTimeout(() => this.tryAutosave(), this.debounceMs)
  }

  private tryAutosave(): void {
    if (!this.workflow.canAutosave()) return

    const currentVersion = this.documentStore.version
    this.queue.schedule(currentVersion)
  }

  /**
   * Execute a save for a specific version.
   * Stale-save detection: if the document has moved past the scheduled
   * version, skip this save (a newer queued save handles it).
   */
  private async executeSave(version: number): Promise<void> {
    if (this.documentStore.version > version) {
      // Stale — a newer revision exists; skip and let the pending save handle it
      return
    }
    await this.workflow.save('autosave')
  }

  private onQueueIdle(): void {
    // Queue is idle — nothing to do
  }

  private clearDebounce(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
  }
}