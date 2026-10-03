import { BaseEditorService } from '../context'
import type { EditorServiceContext } from '../context/service-registry'
import type { CampusDocument } from '@navi/core'
import type { NavigationCompiler, CompileResult } from './navigation-compiler'
import type { PersistenceService, PersistenceSyncState } from './persistence-service'
import type { WorkflowStore, ValidationResult, SyncStatus } from './workflow-store'
import type { DocumentStore } from '../context/document-store'
import type { DocumentEventBus } from '../eventbus'

// ── WorkflowService ───────────────────────────────────────────

/**
 * Orchestration service for the editor workflow.
 *
 * Tracks document state via a state machine:
 *   saved → dirty → saving → dirty-while-saving → dirty → saved
 *
 * Owns NO save logic. AutosaveService handles debounce, queue, and snapshot.
 * WorkflowService only tracks state and exposes lifecycle methods.
 *
 * INVARIANT: WorkflowService is the ONLY public workflow API.
 * UI code calls WorkflowService methods. No UI code calls
 * PersistenceService or NavigationCompiler directly.
 */
export class WorkflowService extends BaseEditorService {
  readonly id = 'workflow'
  readonly dependencies: readonly string[] = [
    'navigationCompiler', 'persistence',
    'documentStore', 'workflowStore', 'eventBus',
  ] as const

  private navCompiler!: NavigationCompiler
  private persistence!: PersistenceService
  private documentStore!: DocumentStore
  private workflowStore!: WorkflowStore
  private eventBus!: DocumentEventBus
  private document!: CampusDocument
  private revisionUnsub: (() => void) | null = null
  private syncUnsub: (() => void) | null = null
  private saveInFlight = 0
  private graphSyncStartedClean = false
  private blockedSyncDocumentVersion: number | null = null
  /** Document version captured when a Graph sync begins, including recovery writes outside workflow.save(). */
  private syncingDocumentVersion: number | null = null
  /** Document version captured when a reload freshness check begins. */
  private freshnessCheckDocumentVersion: number | null = null
  private lastPersistenceStatus: PersistenceSyncState['status'] | null = null

  async init(context: EditorServiceContext): Promise<void> {
    await super.init(context)
    this.navCompiler = context.get('navigationCompiler')
    this.persistence = context.get('persistence')
    this.documentStore = context.get('documentStore')
    this.workflowStore = context.get('workflowStore')
    this.eventBus = context.get('eventBus')
    this.document = context.document

    // Document is clean on load
    this.workflowStore.updateLifecycle({
      saveState: 'saved',
      lastSavedAt: Date.now(),
    })
    this.workflowStore.setLastSaveVersion(this.documentStore.version)

    // React to every committed revision
    this.revisionUnsub = this.eventBus.on('revision.committed', () => this.mutate())

    // A persistence adapter may be backed by a remote graph store whose
    // result settles after the editor-level save call begins. Keep workflow
    // state subscribed to that source so a conflict can never look saved.
    if (this.persistence.hasSyncState()) {
      this.syncUnsub = this.persistence.subscribeSyncState((state) => {
        this.handlePersistenceSyncState(state)
      })
      const initialSyncState = this.persistence.getSyncState()
      if (initialSyncState) this.handlePersistenceSyncState(initialSyncState)
    }
  }

  async destroy(): Promise<void> {
    this.revisionUnsub?.()
    this.syncUnsub?.()
    this.revisionUnsub = null
    this.syncUnsub = null
    await super.destroy()
  }

  // ── State machine ──────────────────────────────────────────

  /**
   * Called when a new revision is committed (via eventBus listener).
   * Transitions state based on current state.
   */
  mutate(): void {
    this.blockedSyncDocumentVersion = null
    const snap = this.workflowStore.getSnapshot()
    if (snap.saveState === 'saving') {
      this.workflowStore.updateLifecycle({ saveState: 'dirty-while-saving' })
    } else if (snap.saveState === 'saved') {
      this.workflowStore.updateLifecycle({ saveState: 'dirty' })
    }
  }

  // ── Derived state ───────────────────────────────────────────

  isDirty(): boolean {
    if (!this.workflowStore) return false
    const snap = this.workflowStore.getSnapshot()
    return snap.saveState === 'dirty' || snap.saveState === 'dirty-while-saving'
  }

  canAutosave(): boolean {
    if (!this.workflowStore) return false
    return this.isDirty() && !this.isSaving()
  }

  isSaving(): boolean {
    if (!this.workflowStore) return false
    return this.workflowStore.getSnapshot().saveState === 'saving'
  }

  hasUnsavedChanges(): boolean {
    return this.isDirty()
  }

  canPublish(): boolean {
    const syncState = this.persistence?.getSyncState() ?? null
    return !this.isSaving()
      && !this.isDirty()
      && (syncState === null || syncState.status === 'synced')
  }

  // ── Actions ─────────────────────────────────────────────────

  async validate(): Promise<ValidationResult> {
    const validationEngine = this._context?.get('validationEngine')
    let result: ValidationResult
    if (validationEngine) {
      const snapshot = validationEngine.validate(this.document, 'publish')
      result = {
        passed: snapshot.statistics.totalIssues - snapshot.statistics.errors - snapshot.statistics.warnings,
        failed: snapshot.statistics.errors + snapshot.statistics.warnings,
        errors: snapshot.issues.filter(i => i.severity === 'error').map(i => i.message),
        timestamp: Date.now(),
      }
    } else {
      result = { passed: 0, failed: 0, errors: [], timestamp: Date.now() }
    }
    // Store the result so WorkflowStore subscribers (BuildStatus UI) see the update
    this.workflowStore.setValidation(result)
    return result
  }

  async compile(): Promise<CompileResult> {
    const result = await this.navCompiler.compile(this.document)
    this.workflowStore.setCompile(result)
    return result
  }

  /**
   * Save the current document.
   *
   * Lifecycle: dirty → saving → dirtyWhileSaving → dirty → saving → saved
   *
   * On success: updates lastSavedAt, emits workflow.saved (manual only).
   * If edits happened during save: transitions back to dirty for re-save.
   * On failure: stays dirty for retry.
   */
  async save(reason: 'manual' | 'autosave'): Promise<void> {
    this.workflowStore.updateLifecycle({ saveState: 'saving' })
    this.saveInFlight += 1
    try {
      await this.persistence.save()
      this.saveComplete(reason)
    } catch (err: any) {
      this.saveFailed(err)
      throw err
    } finally {
      this.saveInFlight -= 1
    }
  }

  private saveComplete(reason: 'manual' | 'autosave'): void {
    this.syncingDocumentVersion = null
    const snap = this.workflowStore.getSnapshot()
    const wasDirtyWhileSaving = snap.saveState === 'dirty-while-saving'
    const syncState = this.persistence.getSyncState()
    const syncComplete = syncState === null || syncState.status === 'synced'

    this.workflowStore.setSave(Date.now(), reason)
    this.workflowStore.setLastSaveVersion(this.documentStore.version)

    if (wasDirtyWhileSaving || !syncComplete) {
      this.workflowStore.updateLifecycle({
        saveState: 'dirty',
        saveError: syncComplete
          ? null
          : syncState?.error ?? 'Graph synchronization has not completed',
      })
    } else {
      this.workflowStore.updateLifecycle({
        saveState: 'saved',
        saveError: null,
        lastSaveReason: reason,
        lastSavedAt: Date.now(),
      })
      this.blockedSyncDocumentVersion = null
    }

    if (reason === 'manual') {
      this.eventBus.emit('workflow.saved', { timestamp: Date.now(), reason })
    }
  }

  private saveFailed(err: any): void {
    this.syncingDocumentVersion = null
    this.workflowStore.updateLifecycle({
      saveState: 'dirty',
      saveError: err?.message ?? 'Save failed',
    })
  }

  private handlePersistenceSyncState(state: PersistenceSyncState): void {
    const previousPersistenceStatus = this.lastPersistenceStatus
    this.lastPersistenceStatus = state.status

    if (state.status === 'checking') {
      // Freshness verification is still unresolved. Neither mark the document
      // saved nor dirty: the previous state stands until the check settles.
      this.syncingDocumentVersion = null
      this.freshnessCheckDocumentVersion = this.documentStore.version
      return
    }

    const completedFreshnessCheck = previousPersistenceStatus === 'checking'
      && this.freshnessCheckDocumentVersion === this.documentStore.version
    const completedFreshnessCheckVersion = completedFreshnessCheck
      ? this.freshnessCheckDocumentVersion
      : null
    this.freshnessCheckDocumentVersion = null

    const workflowSyncStatus: SyncStatus = state.status === 'synced' ? 'success' : state.status
    this.workflowStore.setSyncStatus(workflowSyncStatus)

    const snapshot = this.workflowStore.getSnapshot()

    if (state.status === 'syncing') {
      this.syncingDocumentVersion = this.documentStore.version
      this.graphSyncStartedClean = snapshot.saveState === 'saved' || snapshot.saveState === 'idle'
      if (this.saveInFlight > 0) {
        this.workflowStore.updateLifecycle({ saveState: 'saving', saveError: null })
      } else if (this.graphSyncStartedClean) {
        // Do not let a background graph sync leave a clean-looking badge.
        this.workflowStore.updateLifecycle({
          saveState: 'dirty',
          saveError: 'Graph synchronization pending',
        })
      }
      return
    }

    if (state.status === 'conflict' || state.status === 'error') {
      this.syncingDocumentVersion = null
      this.graphSyncStartedClean = false
      this.blockedSyncDocumentVersion = this.documentStore.version
      this.workflowStore.updateLifecycle({
        saveState: 'dirty',
        saveError: state.error ?? (state.status === 'conflict'
          ? 'Graph synchronization conflict'
          : 'Graph synchronization failed'),
      })
      return
    }

    if (state.status === 'idle') {
      this.syncingDocumentVersion = null
      if (snapshot.saveState === 'saved' || snapshot.saveState === 'idle') {
        this.graphSyncStartedClean = true
        this.workflowStore.updateLifecycle({
          saveState: 'dirty',
          saveError: 'Graph synchronization pending',
        })
      }
      return
    }

    // A successful graph sync can finish an explicit recovery action as well
    // as a normal save. Only clear dirty state when no new document revision
    // appeared after the conflict/pending state was observed.
    if (state.status === 'synced' && this.saveInFlight === 0) {
      const completedSyncDocumentVersion = this.syncingDocumentVersion
      this.syncingDocumentVersion = null
      const expectedVersion = completedFreshnessCheckVersion
        ?? this.blockedSyncDocumentVersion
        ?? completedSyncDocumentVersion
        ?? snapshot.lastSaveVersion
      const canMarkSaved = (
        this.graphSyncStartedClean
        || this.blockedSyncDocumentVersion !== null
        // Local-ahead recovery can acknowledge directly through GraphStore,
        // without passing through WorkflowService.save(). Treat that ACK as a
        // workflow baseline only if no authored document revision landed
        // during the sync.
        || completedSyncDocumentVersion !== null
        // A reused editor context can carry a stale dirty baseline across a
        // client-side reload. A completed freshness check is an authoritative
        // canonical read, so heal that baseline only when no document revision
        // occurred while the check was in flight.
        || completedFreshnessCheck
      )
        && this.documentStore.version === expectedVersion
        && snapshot.saveState !== 'dirty-while-saving'

      if (canMarkSaved) {
        this.workflowStore.updateLifecycle({
          saveState: 'saved',
          saveError: null,
          lastSavedAt: Date.now(),
        })
      }

      this.graphSyncStartedClean = false
      this.blockedSyncDocumentVersion = null
    }
  }
}
