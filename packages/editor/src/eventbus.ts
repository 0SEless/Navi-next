import type { LatLng, CampusDocument } from '@navi/core'
import { BaseEditorService } from './context'
import type { EditorServiceContext } from './context/service-registry'

export type EditorEventType =
  | 'entity.created'
  | 'entity.updated'
  | 'entity.deleted'
  | 'selection.changed'
  | 'tool.changed'
  | 'viewport.changed'
  | 'editingcontext.changed'
  | 'document.loaded'
  | 'document.saved'
  | 'document.changed'
  | 'revision.committed'
  | 'transaction.begin'
  | 'transaction.end'
  | 'transaction.flush'
  // Workflow events
  | 'workflow.saved'
  | 'publish.completed'
  | 'road.edit'

export interface EntityEventPayload {
  entityId: string
  entityType: string
  entity?: Record<string, unknown>
}

export interface SelectionEventPayload {
  entityIds: string[]
  selectors?: Array<{ type: string; id: string }>
  hoveredSelector?: { type: string; id: string } | null
  lastSelectedSelector?: { type: string; id: string } | null
  mode?: string
  origin?: string
}

export interface ToolEventPayload {
  toolId: string
}

export interface ViewportEventPayload {
  zoom: number
  center: LatLng
  bearing: number
  pitch: number
  activeBuildingId?: string
  activeFloorId?: string
}

export interface DocumentEventPayload {
  document?: CampusDocument
  timestamp?: string
}

export interface RevisionCommittedPayload {
  version: number
}

export interface TransactionFlushPayload {
  queuedEvents: number
}

export type EditorEventPayload =
  | EntityEventPayload
  | SelectionEventPayload
  | ToolEventPayload
  | ViewportEventPayload
  | DocumentEventPayload
  | RevisionCommittedPayload
  | TransactionFlushPayload

export type EditorEventHandler = (payload: any) => void

export class DocumentEventBus extends BaseEditorService {
  readonly id = 'eventBus'
  readonly dependencies: readonly string[] = []

  private listeners = new Map<EditorEventType, Set<EditorEventHandler>>()
  private txCounter = 0
  private txQueue: Array<{ type: EditorEventType; payload: any }> = []

  async init(context: EditorServiceContext): Promise<void> {
    await super.init(context)
  }

  async destroy(): Promise<void> {
    this.removeAllListeners()
    await super.destroy()
  }

  on(type: EditorEventType, handler: EditorEventHandler): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set())
    }
    this.listeners.get(type)!.add(handler)
    return () => { this.off(type, handler) }
  }

  off(type: EditorEventType, handler: EditorEventHandler): void {
    this.listeners.get(type)?.delete(handler)
  }

  emit(type: EditorEventType, payload?: any): void {
    if (this.txCounter > 0) {
      this.txQueue.push({ type, payload })
      return
    }
    this.dispatch(type, payload)
  }

  transaction<T>(fn: () => T): T {
    this.begin()
    try {
      const result = fn()
      this.end()
      return result
    } catch (e) {
      this.txQueue = []
      this.txCounter = 0
      throw e
    }
  }

  begin(): void {
    this.txCounter++
    if (this.txCounter === 1) {
      this.dispatch('transaction.begin')
    }
  }

  end(): void {
    if (this.txCounter === 0) return
    this.txCounter--
    if (this.txCounter === 0) {
      this.flush()
      this.dispatch('transaction.end')
    }
  }

  private flush(): void {
    const queue = this.txQueue
    this.txQueue = []
    for (const { type, payload } of queue) {
      this.dispatch(type, payload)
    }
    this.dispatch('transaction.flush', { queuedEvents: queue.length })
  }

  private dispatch(type: EditorEventType, payload?: any): void {
    this.listeners.get(type)?.forEach(h => h(payload))
  }

  removeAllListeners(): void {
    this.listeners.clear()
  }

  get listenerCount(): number {
    let count = 0
    for (const set of this.listeners.values()) {
      count += set.size
    }
    return count
  }
}
