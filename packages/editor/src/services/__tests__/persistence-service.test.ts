import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PersistenceService } from '../persistence-service'
import type { PersistenceAdapter, CompiledArtifacts } from '../persistence-service'
import type { EditorServiceContext } from '../../context/service-registry'
import { DocumentEventBus } from '../../eventbus'

describe('PersistenceService', () => {
  let adapter: PersistenceAdapter
  let service: PersistenceService

  const mockArtifacts: CompiledArtifacts = {
    navigationGraph: { nodes: [] },
    searchIndex: null,
    poiData: null,
    buildingIndex: null,
  }

  function createContext(): EditorServiceContext {
    const eventBus = new DocumentEventBus()
    const store = new Map<string, any>()
    store.set('eventBus', eventBus)
    return {
      get: (id: string) => store.get(id),
    } as unknown as EditorServiceContext
  }

  beforeEach(async () => {
    adapter = {
      save: vi.fn().mockResolvedValue(undefined),
      syncToSupabase: vi.fn().mockResolvedValue(undefined),
      publish: vi.fn().mockResolvedValue({ success: true, version: '1.0.0' }),
    }
    service = new PersistenceService(adapter)
    await service.init(createContext())
  })

  it('save delegates to adapter', async () => {
    await service.save()
    expect(adapter.save).toHaveBeenCalledOnce()
  })

  it('save propagates adapter error', async () => {
    adapter.save = vi.fn().mockRejectedValue(new Error('Save failed'))
    await expect(service.save()).rejects.toThrow('Save failed')
  })

  it('publish delegates to adapter with artifacts', async () => {
    const result = await service.publish(mockArtifacts)
    expect(adapter.publish).toHaveBeenCalledWith(mockArtifacts)
    expect(result.success).toBe(true)
    expect(result.version).toBe('1.0.0')
  })

  it('publish returns error result on adapter failure', async () => {
    adapter.publish = vi.fn().mockRejectedValue(new Error('Publish failed'))
    const result = await service.publish(mockArtifacts)
    expect(result.success).toBe(false)
    expect(result.message).toContain('Publish failed')
  })
})
