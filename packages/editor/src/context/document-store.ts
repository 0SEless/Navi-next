import type { CampusDocument } from '@navi/core'
import type { DocumentEventBus } from '../eventbus'

/**
 * DocumentStore is a plain data holder (editor-owned render-subscription
 * source). It carries a `dependencies` field so it can be safely registered
 * in the ServiceRegistry (registry.init reads `dependencies` for its
 * topological sort) without needing full EditorService lifecycle.
 *
 * Owns the monotonic version counter. Every commit() bumps the version,
 * notifies React subscribers, and emits revision.committed on the eventBus
 * so services (workflow, autosave) can react without coupling.
 */
export class DocumentStore {
  readonly dependencies: readonly string[] = []
  version = 0
  revision = '' // reserved changeId/revisionId

  private listeners = new Set<() => void>()
  private eventBus?: DocumentEventBus

  constructor(public readonly document: CampusDocument, eventBus?: DocumentEventBus) {
    this.eventBus = eventBus
  }

  getVersion = (): number => this.version

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Increment version AND notify React subscribers (useDocumentVersion). */
  commit(): void {
    this.version++
    this.listeners.forEach((l) => l())
    this.eventBus?.emit('revision.committed', { version: this.version })
  }

  /**
   * Restore an editor-owned snapshot without creating a new revision.
   *
   * This is intentionally limited to transaction rollback. Callers must not
   * use it as a normal mutation path; successful changes still go through a
   * registered command and commit().
  */
  restore(snapshot: CampusDocument, version: number, revision = ''): void {
    for (const key of Object.keys(this.document)) {
      Reflect.deleteProperty(this.document, key)
    }
    Object.assign(this.document, structuredClone(snapshot))
    this.version = version
    this.revision = revision
  }
}
