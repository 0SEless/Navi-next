import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NavigationCompiler } from '../navigation-compiler'
import { PersistenceService } from '../persistence-service'
import { WorkflowStore } from '../workflow-store'
import { WorkflowService } from '../workflow-service'
import type { CompilerAdapter } from '../navigation-compiler'
import type { PersistenceAdapter } from '../persistence-service'
import type { EditorServiceContext } from '../../context/service-registry'
import { DocumentEventBus } from '../../eventbus'

describe('WorkflowService', () => {
  let service: WorkflowService
  let workflowStore: WorkflowStore
  let documentStore: { version: number; document: any }
  let context: EditorServiceContext
  type TestSyncStatus = 'idle' | 'syncing' | 'checking' | 'synced' | 'error' | 'conflict'
  let emitPersistenceSyncState: (status: TestSyncStatus, error?: string | null) => void = () => {}

  function buildContext(options?: { compileSuccess?: boolean }): EditorServiceContext {
    const eventBus = new DocumentEventBus()

    let syncState: { status: TestSyncStatus; error: string | null } = {
      status: 'synced',
      error: null,
    }
    const syncListeners = new Set<(state: typeof syncState) => void>()
    emitPersistenceSyncState = (status, error = null) => {
      syncState = { status, error }
      syncListeners.forEach((listener) => listener(syncState))
    }

    const compileAdapter: CompilerAdapter = {
      compile: vi.fn().mockResolvedValue(
        options?.compileSuccess === false
          ? { status: 'error', message: 'Compile error', timestamp: 0 }
          : { status: 'success', timestamp: 0, artifacts: { navigationGraph: { nodes: [] }, searchIndex: null, poiData: null, buildingIndex: null } }
      ),
    }

    const persistAdapter = {
      save: vi.fn().mockResolvedValue(undefined),
      syncToSupabase: vi.fn().mockResolvedValue(undefined),
      publish: vi.fn().mockResolvedValue({ success: true, version: '1.0.0' }),
      getSyncState: () => syncState,
      subscribeSyncState: (listener: (state: typeof syncState) => void) => {
        syncListeners.add(listener)
        return () => syncListeners.delete(listener)
      },
    } as unknown as PersistenceAdapter

    documentStore = { version: 0, document: { metadata: { campusId: 'test', name: 'test' } } }
    workflowStore = new WorkflowStore()

    const navCompiler = new NavigationCompiler(compileAdapter)
    const persistence = new PersistenceService(persistAdapter)
    service = new WorkflowService()

    // Register all services
    const store = new Map<string, any>()
    store.set('navigationCompiler', navCompiler)
    store.set('persistence', persistence)
    store.set('validationEngine', {
      validate: () => ({
        issues: [],
        statistics: { totalIssues: 0, errors: 0, warnings: 0, infos: 0, duration: 0, rulesExecuted: 0, rulesPassed: 0, rulesFailed: 0 },
      }),
    })
    store.set('documentStore', documentStore)
    store.set('workflowStore', workflowStore)
    store.set('eventBus', eventBus)

    // Build a minimal context for dependency init
    const ctx = {
      get: (id: string) => store.get(id),
      document: documentStore.document,
    } as unknown as EditorServiceContext

    // Initialize dependent services so they have valid status transitions
    // (PersistenceService.transitionTo('busy') requires 'ready' status)
    navCompiler.init(ctx)
    persistence.init(ctx)

    return ctx
  }

  beforeEach(async () => {
    context = buildContext()
    await service.init(context)
  })

  describe('isDirty', () => {
    it('returns false when state is saved', () => {
      expect(service.isDirty()).toBe(false)
    })

    it('returns true after mutate()', () => {
      service.mutate()
      expect(service.isDirty()).toBe(true)
    })
  })

  describe('validate', () => {
    it('returns validation result', async () => {
      const result = await service.validate()
      expect(result.timestamp).toBeGreaterThan(0)
    })

    it('validation result with errors', async () => {
      const ctx = buildContext()
      const originalGet = ctx.get.bind(ctx)
      ctx.get = (id: string) => {
        if (id === 'validationEngine') return {
          validate: () => ({
            issues: [{ severity: 'error', message: 'Missing name', ruleId: 'test' }],
            statistics: { totalIssues: 1, errors: 1, warnings: 0, infos: 0, duration: 0, rulesExecuted: 0, rulesPassed: 0, rulesFailed: 0 },
          }),
        } as any
        return originalGet(id as any)
      }
      await service.init(ctx as EditorServiceContext)
      const result = await service.validate()
      expect(result.failed).toBe(1)
      expect(result.errors).toContain('Missing name')
    })
  })

  describe('compile', () => {
    it('writes compile result to WorkflowStore', async () => {
      await service.compile()
      expect(workflowStore.getSnapshot().lastCompile?.status).toBe('success')
    })
  })

  describe('save', () => {
    it('manual save updates WorkflowStore', async () => {
      service.mutate()
      documentStore.version = 3
      await service.save('manual')
      const snap = workflowStore.getSnapshot()
      expect(snap.lastSave?.reason).toBe('manual')
      expect(snap.lastSaveVersion).toBe(3)
    })

    it('autosave updates WorkflowStore', async () => {
      service.mutate()
      await service.save('autosave')
      expect(workflowStore.getSnapshot().lastSave?.reason).toBe('autosave')
    })
  })

  describe('document lifecycle', () => {
    it('saveState is "saved" after initialization', () => {
      const snapshot = workflowStore.getSnapshot()
      expect(snapshot.saveState).toBe('saved')
      expect(snapshot.lastSavedAt).toBeGreaterThan(0)
    })

    it('transitions saveState during successful save', async () => {
      expect(workflowStore.getSnapshot().saveState).toBe('saved')

      service.mutate()

      const savePromise = service.save('manual')
      expect(workflowStore.getSnapshot().saveState).toBe('saving')

      await savePromise
      const snapshot = workflowStore.getSnapshot()
      expect(snapshot.saveState).toBe('saved')
      expect(snapshot.saveError).toBeNull()
      expect(snapshot.lastSaveReason).toBe('manual')
      expect(snapshot.lastSavedAt).toBeGreaterThan(0)
    })

    it('returns to dirty state on failed save', async () => {
      // Spy on persistence to make save fail
      const persistence = context.get('persistence')
      vi.spyOn(persistence, 'save').mockRejectedValueOnce(new Error('Network error'))

      service.mutate()
      const savePromise = service.save('manual')
      expect(workflowStore.getSnapshot().saveState).toBe('saving')

      await expect(savePromise).rejects.toThrow('Network error')

      const snapshot = workflowStore.getSnapshot()
      expect(snapshot.saveState).toBe('dirty')
      expect(snapshot.saveError).toBe('Network error')
    })

    it('sets lastSaveReason to autosave for autosave saves', async () => {
      service.mutate()
      await service.save('autosave')
      const snapshot = workflowStore.getSnapshot()
      expect(snapshot.lastSaveReason).toBe('autosave')
      expect(snapshot.saveState).toBe('saved')
    })

    it('emits workflow.saved event only after persistence succeeds', async () => {
      const eventBus = context.get('eventBus') as any
      const emitSpy = vi.fn()
      eventBus.on('workflow.saved', emitSpy)

      service.mutate()
      await service.save('manual')

      expect(emitSpy).toHaveBeenCalledTimes(1)
      expect(emitSpy).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'manual', timestamp: expect.any(Number) })
      )
    })

    it('does not report saved while graph-store sync is pending', () => {
      emitPersistenceSyncState('syncing')

      const snapshot = workflowStore.getSnapshot()
      expect(snapshot.syncStatus).toBe('syncing')
      expect(snapshot.saveState).not.toBe('saved')
    })

    it('treats a load-time checking state as unresolved without marking saved or dirty', () => {
      expect(workflowStore.getSnapshot().saveState).toBe('saved')
      emitPersistenceSyncState('checking')
      let snapshot = workflowStore.getSnapshot()
      expect(snapshot.saveState).toBe('saved')
      expect(snapshot.saveError).toBeNull()

      service.mutate()
      expect(workflowStore.getSnapshot().saveState).toBe('dirty')
      emitPersistenceSyncState('checking')
      snapshot = workflowStore.getSnapshot()
      expect(snapshot.saveState).toBe('dirty')
      expect(snapshot.saveError).toBeNull()
    })

    it('a committed revision immediately leaves the saved state (no debounce gap)', () => {
      expect(workflowStore.getSnapshot().saveState).toBe('saved')

      context.get('eventBus').emit('revision.committed', { version: 1 })

      const snapshot = workflowStore.getSnapshot()
      expect(snapshot.saveState).toBe('dirty')
      expect(snapshot.saveState).not.toBe('saved')
    })

    it('reports saving (never saved) while a save is in flight, then saved after an acknowledged save', async () => {
      const persistence = context.get('persistence')
      let releaseSave: (() => void) | undefined
      vi.spyOn(persistence, 'save').mockImplementationOnce(
        () => new Promise<void>((resolve) => {
          releaseSave = resolve
        }),
      )

      service.mutate()
      const savePromise = service.save('manual')
      expect(workflowStore.getSnapshot().saveState).toBe('saving')
      expect(workflowStore.getSnapshot().saveState).not.toBe('saved')

      releaseSave?.()
      await savePromise
      expect(workflowStore.getSnapshot().saveState).toBe('saved')
    })

    it('a concurrent edit during a save cannot end in saved', async () => {
      const persistence = context.get('persistence')
      let releaseSave: (() => void) | undefined
      vi.spyOn(persistence, 'save').mockImplementationOnce(
        () => new Promise<void>((resolve) => {
          releaseSave = resolve
        }),
      )

      service.mutate()
      const savePromise = service.save('autosave')
      expect(workflowStore.getSnapshot().saveState).toBe('saving')

      service.mutate()
      expect(workflowStore.getSnapshot().saveState).toBe('dirty-while-saving')

      releaseSave?.()
      await savePromise

      const snapshot = workflowStore.getSnapshot()
      expect(snapshot.saveState).toBe('dirty')
      expect(snapshot.saveState).not.toBe('saved')
    })

    it('surfaces graph-store conflicts as dirty and preserves the local document', () => {
      const localDocument = documentStore.document

      emitPersistenceSyncState('conflict', 'The server has a different version of this map')

      const snapshot = workflowStore.getSnapshot()
      expect(snapshot.syncStatus).toBe('conflict')
      expect(snapshot.saveState).toBe('dirty')
      expect(snapshot.saveError).toBe('The server has a different version of this map')
      expect(documentStore.document).toBe(localDocument)
    })

    it('blocks publish until graph-store sync succeeds', () => {
      emitPersistenceSyncState('syncing')
      expect(service.canPublish()).toBe(false)

      emitPersistenceSyncState('conflict', 'conflict')
      expect(service.canPublish()).toBe(false)

      emitPersistenceSyncState('synced')
      expect(service.canPublish()).toBe(true)
    })

    it('keeps dirty local edits dirty when a newer server snapshot conflicts', () => {
      service.mutate()
      emitPersistenceSyncState('conflict', 'The server has a newer revision')

      const snapshot = workflowStore.getSnapshot()
      expect(snapshot.saveState).toBe('dirty')
      expect(snapshot.syncStatus).toBe('conflict')
      expect(snapshot.saveError).toBe('The server has a newer revision')
    })
  })
})
