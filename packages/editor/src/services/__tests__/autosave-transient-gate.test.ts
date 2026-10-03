import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AutosaveService } from '../autosave-service'
import { DocumentEventBus } from '../../eventbus'
import type { EditorServiceContext } from '../../context/service-registry'

/**
 * Phase 3C — transient interaction gate + unified eligibility.
 * Both the 5s debounce and the 30s safety interval go through the same gate.
 */

describe('AutosaveService — Phase 3C transient gate', () => {
  let service: AutosaveService
  let workflow: { canAutosave: ReturnType<typeof vi.fn>; save: ReturnType<typeof vi.fn> }
  let documentStore: { version: number; document: unknown }
  let eventBus: DocumentEventBus
  let saveSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    vi.useFakeTimers()
    eventBus = new DocumentEventBus()
    await eventBus.init({ get: () => {}, document: {} } as unknown as EditorServiceContext)

    workflow = { canAutosave: vi.fn().mockReturnValue(true), save: vi.fn().mockResolvedValue(undefined) }
    saveSpy = vi.spyOn(workflow, 'save')
    documentStore = { version: 1, document: { metadata: { campusId: 'test', name: 'test' } } }

    const store = new Map<string, unknown>()
    store.set('workflow', workflow)
    store.set('documentStore', documentStore)
    store.set('eventBus', eventBus)
    const context = { get: (id: string) => store.get(id), document: {} } as unknown as EditorServiceContext

    service = new AutosaveService({ debounceMs: 5000, maxIntervalMs: 30000 })
    await service.init(context)
  })

  afterEach(async () => {
    vi.useRealTimers()
    if (service) await service.destroy()
  })

  it('TEST 1/5s-timing — tool selected but idle: 4999ms no save, 5000ms exactly one save', async () => {
    eventBus.emit('revision.committed', { version: 2 })
    vi.advanceTimersByTime(4999)
    await Promise.resolve()
    expect(saveSpy).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    await vi.waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1))
    expect(saveSpy).toHaveBeenCalledWith('autosave')
  })

  it('TEST 2/3C-16 — debounce resets: commit A, commit B at t=3s, one save 5s after B', async () => {
    eventBus.emit('revision.committed', { version: 2 })
    vi.advanceTimersByTime(3000)
    eventBus.emit('revision.committed', { version: 3 })
    vi.advanceTimersByTime(4999)
    await Promise.resolve()
    expect(saveSpy).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    await vi.waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1))
  })

  it('TEST 2/8 — active transient gesture blocks BOTH the 5s debounce and the 30s safety interval', async () => {
    service.setTransientInteractionActive(true)
    eventBus.emit('revision.committed', { version: 2 })

    vi.advanceTimersByTime(5000)
    await Promise.resolve()
    expect(saveSpy).not.toHaveBeenCalled()

    vi.advanceTimersByTime(25000) // crosses the 30s interval
    await Promise.resolve()
    expect(saveSpy).not.toHaveBeenCalled()
  })

  it('TEST 3 — finishing the gesture then committing restarts the 5s countdown and saves once', async () => {
    service.setTransientInteractionActive(true)
    eventBus.emit('revision.committed', { version: 2 })
    vi.advanceTimersByTime(5000)
    await Promise.resolve()
    expect(saveSpy).not.toHaveBeenCalled()

    service.setTransientInteractionActive(false)
    eventBus.emit('revision.committed', { version: 3 }) // commit boundary of the finished gesture
    vi.advanceTimersByTime(4999)
    await Promise.resolve()
    expect(saveSpy).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    await vi.waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1))
  })

  it('TEST 4 — Road Tool stays selected: two completed roads autosave twice without tool exit', async () => {
    // Road A completes (tool still selected -> no transient active).
    eventBus.emit('revision.committed', { version: 2 })
    vi.advanceTimersByTime(5000)
    await vi.waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1))

    // Road B completed later, same tool still selected.
    eventBus.emit('revision.committed', { version: 3 })
    vi.advanceTimersByTime(5000)
    await vi.waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(2))
  })

  it('TEST 6 — clean document: repeated 30s cycles produce zero saves', async () => {
    workflow.canAutosave.mockReturnValue(false)
    eventBus.emit('revision.committed', { version: 2 })
    vi.advanceTimersByTime(30000)
    vi.advanceTimersByTime(30000)
    await Promise.resolve()
    expect(saveSpy).not.toHaveBeenCalled()
  })
})
