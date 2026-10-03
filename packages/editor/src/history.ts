import type { CampusDocument } from '@navi/core'
import type { Command } from './commands/types'
import { CommandDispatcher } from './commands/dispatcher'
import { CommandRegistry } from './commands/registry'
import type { PreHook, PostHook } from './commands/types'
import { BaseEditorService } from './context'
import type { EditorServiceContext } from './context/service-registry'
import type { DocumentStore } from './context/document-store'
import type { DocumentEventBus } from './eventbus'

export interface HistoryEntry {
  command: Command
  handlerId: string
  inverse: Command | null
  beforeHash: string
  afterHash: string
  snapshotBefore?: CampusDocument
  snapshotAfter?: CampusDocument
  estimatedSize: number
}

function hash(obj: unknown): string {
  const str = JSON.stringify(obj)
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i)
    h |= 0
  }
  return h.toString(36)
}

function estimateSize(obj: unknown): number {
  return JSON.stringify(obj).length * 2
}

export class HistoryStack extends BaseEditorService implements PreHook, PostHook {
  readonly id = 'history'
  readonly dependencies: readonly string[] = ['dispatcher']

  private past: HistoryEntry[] = []
  private future: HistoryEntry[] = []
  private maxMemory: number
  private currentMemory = 0
  private pendingBeforeHash: string | null = null
  private pendingSnapshot: CampusDocument | null = null
  private dispatcher!: CommandDispatcher
  private document!: CampusDocument
  private registry: CommandRegistry
  private documentStore?: DocumentStore
  private eventBus?: DocumentEventBus

  constructor(dispatcher?: CommandDispatcher, document?: CampusDocument, registry?: CommandRegistry, maxMemoryMB = 200, documentStore?: DocumentStore) {
    super()
    this.maxMemory = maxMemoryMB * 1024 * 1024
    this.registry = registry ?? new CommandRegistry()
    this.documentStore = documentStore
    if (dispatcher) this.dispatcher = dispatcher
    if (document) this.document = document
  }

  async init(context: EditorServiceContext): Promise<void> {
    await super.init(context)
    this.dispatcher = context.get('dispatcher')
    this.documentStore = context.get('documentStore')
    this.eventBus = context.get('eventBus')
    this.document = context.document
  }

  before(command: Command): void {
    this.pendingBeforeHash = hash(this.document)
    this.pendingSnapshot = structuredClone(this.document)
  }

  after(command: Command, result: any): void {
    if (!result.success) return
    this.push(command, result)
    this.pendingBeforeHash = null
    this.pendingSnapshot = null
  }

  afterBatch(commands: Command[], results: Array<{ success: boolean }>, document: CampusDocument, snapshotBefore: CampusDocument): void {
    if (commands.length === 0 || results.some((result) => !result.success)) return

    const snapshotAfter = structuredClone(document)
    const command: Command = {
      id: 'command.batch',
      label: commands.length === 1 ? commands[0].label : `${commands[0].label} (${commands.length} commands)`,
      payload: { commands: structuredClone(commands) },
    }
    const entry: HistoryEntry = {
      command,
      handlerId: command.id,
      inverse: null,
      beforeHash: hash(snapshotBefore),
      afterHash: hash(snapshotAfter),
      snapshotBefore: structuredClone(snapshotBefore),
      snapshotAfter,
      estimatedSize: estimateSize({ command, snapshotBefore, snapshotAfter }),
    }

    this.past.push(entry)
    this.currentMemory += entry.estimatedSize
    this.future = []
    this.evictIfNeeded()
  }

  push(command: Command, result: { entityId?: string; data?: Record<string, unknown> }): void {
    const handler = this.registry.get(command.id)
    if (!handler) return

    const beforeHash = this.pendingBeforeHash || hash(this.document)
    const afterHash = hash(this.document)
    const inverse = handler.inverse ? handler.inverse(command.payload, { success: true, entityId: result.entityId, data: result.data }) : null
    const needsSnapshot = inverse === null

    if (needsSnapshot && !this.pendingSnapshot) {
      this.pendingSnapshot = structuredClone(this.document)
    }
    const snapshotBefore = needsSnapshot ? this.pendingSnapshot! : undefined
    const snapshotAfter = needsSnapshot ? structuredClone(this.document) : undefined

    const entry: HistoryEntry = {
      command,
      handlerId: command.id,
      inverse,
      beforeHash,
      afterHash,
      snapshotBefore,
      snapshotAfter,
      estimatedSize: estimateSize({ command, inverse, snapshotBefore, snapshotAfter }),
    }

    this.past.push(entry)
    this.currentMemory += entry.estimatedSize
    this.future = []

    this.evictIfNeeded()
  }

  undo(): boolean {
    const entry = this.past.pop()
    if (!entry) return false
    this.currentMemory -= entry.estimatedSize

    if (entry.inverse) {
      const inverseCmd: Command = {
        id: entry.inverse.id,
        label: `Undo ${entry.command.label}`,
        payload: entry.inverse.payload,
      }
      this.dispatcher.execute(inverseCmd, { skipHooks: true })
    } else if (entry.snapshotBefore) {
      this.restoreSnapshot(entry.snapshotBefore)
    } else {
      return false
    }

    this.future.push(entry)
    return true
  }

  redo(): boolean {
    const entry = this.future.pop()
    if (!entry) return false

    if (entry.snapshotAfter) {
      this.restoreSnapshot(entry.snapshotAfter)
    } else {
      this.dispatcher.execute(entry.command, { skipHooks: true })
    }

    this.past.push(entry)
    this.currentMemory += entry.estimatedSize
    return true
  }

  clear(): void {
    this.past = []
    this.future = []
    this.currentMemory = 0
  }

  get canUndo(): boolean { return this.past.length > 0 }
  get canRedo(): boolean { return this.future.length > 0 }
  get undoCount(): number { return this.past.length }
  get redoCount(): number { return this.future.length }
  get memoryUsage(): number { return this.currentMemory }

  private restoreSnapshot(snapshot: CampusDocument): void {
    for (const key of Object.keys(this.document)) {
      Reflect.deleteProperty(this.document, key)
    }
    Object.assign(this.document, structuredClone(snapshot))
    this.documentStore?.commit()
    this.eventBus?.emit('document.changed', {
      version: this.documentStore?.version,
      entityType: 'batch',
    })
  }

  private evictIfNeeded(): void {
    while (this.currentMemory > this.maxMemory && this.past.length > 1) {
      const oldest = this.past.shift()
      if (oldest) {
        this.currentMemory -= oldest.estimatedSize
      }
    }
  }
}
