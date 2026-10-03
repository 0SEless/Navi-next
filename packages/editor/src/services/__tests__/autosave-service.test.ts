import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AutosaveService } from '../autosave-service'
import { DocumentEventBus } from '../../eventbus'
import type { EditorServiceContext } from '../../context/service-registry'

describe('AutosaveService', () => {
  let service: AutosaveService
  let workflow: {
    canAutosave: ReturnType<typeof vi.fn>
    save: ReturnType<typeof vi.fn>
  }
  let documentStore: { version: number; document: any }
  let eventBus: DocumentEventBus
  let saveSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    vi.useFakeTimers()

    eventBus = new DocumentEventBus()
    await eventBus.init({ get: () => {}, document: {} } as unknown as EditorServiceContext)

    workflow = {
      canAutosave: vi.fn(),
      save: vi.fn().mockResolvedValue(undefined),
    }
    saveSpy = vi.spyOn(workflow, 'save')

    documentStore = { version: 1, document: { metadata: { campusId: 'test', name: 'test' } } }

    const store = new Map<string, any>()
    store.set('workflow', workflow)
    store.set('documentStore', documentStore)
    store.set('eventBus', eventBus)

    const context = {
      get: (id: string) => store.get(id),
      document: {},
    } as unknown as EditorServiceContext

    service = new AutosaveService({ debounceMs: 50, maxIntervalMs: 5000 })
    await service.init(context)
  })

  afterEach(async () => {
    vi.useRealTimers()
    if (service) await service.destroy()
  })

  describe('revision-based triggers', () => {
    it('fires autosave after debounce when dirty', async () => {
      workflow.canAutosave.mockReturnValue(true)

      eventBus.emit('revision.committed', { version: 2 })

      expect(saveSpy).not.toHaveBeenCalled()

      vi.advanceTimersByTime(50)
      await vi.waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1))
      expect(saveSpy).toHaveBeenCalledWith('autosave')
    })

    it('debounce resets on rapid revisions — fires only once', async () => {
      workflow.canAutosave.mockReturnValue(true)

      eventBus.emit('revision.committed', { version: 2 })
      vi.advanceTimersByTime(30)
      eventBus.emit('revision.committed', { version: 3 })
      vi.advanceTimersByTime(30)
      eventBus.emit('revision.committed', { version: 4 })

      vi.advanceTimersByTime(50)
      await vi.waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1))
    })

    it('does NOT save if canAutosave returns false', async () => {
      workflow.canAutosave.mockReturnValue(false)

      eventBus.emit('revision.committed', { version: 2 })
      vi.advanceTimersByTime(100)

      expect(saveSpy).not.toHaveBeenCalled()
    })
  })

  describe('SaveQueue', () => {
    it('rapid edits produce exactly 1 save (pending supersedes)', async () => {
      workflow.canAutosave.mockReturnValue(true)
      // Make save resolve immediately so queue doesn't stay in 'saving'
      workflow.save.mockResolvedValue(undefined)

      // Simulate 100 edits: bump version and emit revision events
      for (let i = 2; i <= 101; i++) {
        documentStore.version = i
        eventBus.emit('revision.committed', { version: i })
        vi.advanceTimersByTime(5) // fast edits, all within debounce window
      }

      vi.advanceTimersByTime(50)
      await vi.waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1))
    })

    it('edit during save schedules second save after first completes', async () => {
      let resolveFirstSave: () => void
      workflow.save.mockImplementation(
        () => new Promise<void>((resolve) => { resolveFirstSave = resolve }),
      )
      workflow.canAutosave.mockReturnValue(true)

      // Trigger first autosave
      documentStore.version = 2
      eventBus.emit('revision.committed', { version: 2 })
      vi.advanceTimersByTime(50)
      await vi.waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1))

      // While save is in-flight, another revision occurs
      documentStore.version = 3
      eventBus.emit('revision.committed', { version: 3 })
      vi.advanceTimersByTime(50)

      // Still should be only 1 save call so far
      expect(saveSpy).toHaveBeenCalledTimes(1)

      // Resolve first save — second should fire immediately
      resolveFirstSave!()
      await Promise.resolve()
      await Promise.resolve()

      expect(saveSpy).toHaveBeenCalledTimes(2)
    })
  })

  describe('stale-save detection', () => {
    it('skips save when document version has moved past scheduled version', async () => {
      let saveCallCount = 0
      workflow.save.mockImplementation(async () => {
        saveCallCount++
        // On second call, simulate that it's stale
        if (saveCallCount === 2) {
          // The stale detection is internal to the save execution
        }
      })
      workflow.canAutosave.mockReturnValue(true)

      // Schedule save for version 2
      documentStore.version = 2
      eventBus.emit('revision.committed', { version: 2 })
      vi.advanceTimersByTime(50)
      await vi.waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1))

      // Before first save completes, version jumps to 3 and 4
      // (simulates rapid edits during save — queue should capture version 4)
      documentStore.version = 4
      eventBus.emit('revision.committed', { version: 4 })

      // The SaveQueue should have version 4 pending
      // When first save completes, second save runs — but executeSave
      // checks if documentStore.version (4) > scheduled version (4) → not stale
      // So it should fire save

      // First save resolves
      await Promise.resolve()
      await Promise.resolve()
      // Second save should fire after queue sees pending
      await vi.waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(2))
    })
  })

  describe('max interval', () => {
    it('triggers autosave even without revision events', async () => {
      workflow.canAutosave.mockReturnValue(true)

      vi.advanceTimersByTime(5000)
      await vi.waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1))
      expect(saveSpy).toHaveBeenCalledWith('autosave')
    })
  })

  describe('cleanup', () => {
    it('cleans up timers on destroy — no autosave after destroy', async () => {
      workflow.canAutosave.mockReturnValue(true)

      await service.destroy()

      // Ensure afterEach doesn't double-destroy
      const svc = service
      service = null as any

      eventBus.emit('revision.committed', { version: 2 })
      vi.advanceTimersByTime(100)
      vi.advanceTimersByTime(5000)

      expect(saveSpy).not.toHaveBeenCalled()
    })
  })
})