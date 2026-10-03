import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PublishService } from '../publish-service'
import { PublishStore } from '../publish-store'
import type { EditorServiceContext } from '../../context/service-registry'

function makeSnapshot(overrides?: { errors?: number }) {
  const errs = overrides?.errors ?? 0
  return {
    issues: errs > 0 ? [{ severity: 'error', message: 'Validation error', ruleId: 'test' }] : [],
    statistics: { totalIssues: errs, errors: errs, warnings: 0, infos: 0, duration: 0, rulesExecuted: 0, rulesPassed: 0, rulesFailed: 0 },
  }
}

function createMockContext(overrides?: {
  isSaving?: boolean
  hasUnsavedChanges?: boolean
  canPublish?: boolean
  hasErrors?: boolean
  document?: any
  compileResult?: any
  publishResult?: any
}): { context: EditorServiceContext } {
  const eventBus = { on: vi.fn(), off: vi.fn(), emit: vi.fn() }
  const documentStore = {
    version: 1,
    document: overrides?.document ?? { metadata: { campusId: 'test-campus', name: 'test-campus' } },
  }

  const workflowService = {
    isSaving: vi.fn().mockReturnValue(overrides?.isSaving ?? false),
    hasUnsavedChanges: vi.fn().mockReturnValue(overrides?.hasUnsavedChanges ?? false),
    canPublish: vi.fn().mockReturnValue(overrides?.canPublish ?? true),
  }

  const validationEngine = {
    validate: vi.fn().mockReturnValue(makeSnapshot({ errors: overrides?.hasErrors ? 1 : 0 })),
    getLastSnapshot: vi.fn().mockReturnValue(makeSnapshot({ errors: overrides?.hasErrors ? 1 : 0 })),
  }

  const navCompiler = {
    compile: vi.fn().mockResolvedValue(
      overrides?.compileResult ?? { status: 'success', timestamp: Date.now(), artifacts: { navigationGraph: { version: '1.0.0', nodes: [], edges: [] }, searchIndex: null, poiData: null, buildingIndex: null } }
    ),
  }

  const persistence = {
    publish: vi.fn().mockResolvedValue(overrides?.publishResult ?? { success: true }),
  }

  const context = {
    get: (id: string) => {
      const map: Record<string, any> = {
        workflow: workflowService,
        validationEngine,
        navigationCompiler: navCompiler,
        persistence,
        documentStore,
        eventBus,
      }
      return map[id]
    },
    document: documentStore.document,
  } as unknown as EditorServiceContext

  return { context }
}

describe('PublishService', () => {
  let store: PublishStore
  let service: PublishService

  beforeEach(() => {
    store = new PublishStore()
    service = new PublishService(store)
  })

  afterEach(async () => {
    if (service.status !== 'uninitialized') {
      await service.destroy()
    }
  })

  it('initial snapshot is idle', () => {
    const snap = service.getSnapshot()
    expect(snap.publishState).toBe('idle')
    expect(snap.publishResult).toBeNull()
    expect(snap.publishError).toBeNull()
  })

  it('isPublishing returns false when idle', () => {
    expect(service.isPublishing()).toBe(false)
  })

  it('rejects publish when document has unsaved changes', async () => {
    const { context } = createMockContext({ hasUnsavedChanges: true })
    await service.init(context)
    await expect(service.publish()).rejects.toThrow('Document has unsaved changes')
  })

  it('rejects publish when validation has errors', async () => {
    const { context } = createMockContext({ hasErrors: true })
    await service.init(context)
    await expect(service.publish()).rejects.toThrow('Validation has errors')
  })

  it('rejects publish when save in progress', async () => {
    const { context } = createMockContext({ isSaving: true })
    await service.init(context)
    await expect(service.publish()).rejects.toThrow('Save in progress')
  })

  it('rejects publish when graph synchronization is incomplete', async () => {
    const { context } = createMockContext({ canPublish: false })
    await service.init(context)
    await expect(service.publish()).rejects.toThrow('Graph synchronization is not complete')
  })

  it('runs validation during publish', async () => {
    const { context } = createMockContext()
    await service.init(context)
    await service.publish()
    const engine = context.get('validationEngine') as any
    expect(engine.validate).toHaveBeenCalled()
    expect(service.getSnapshot().publishState).toBe('success')
  })

  it('cannot force-publish a disconnected authored route network', async () => {
    const { context } = createMockContext({
      document: {
        schemaVersion: 2,
        version: 1,
        metadata: { campusId: 'test-campus', name: 'test-campus', description: '', lastModified: '', editorVersion: 'test' },
        buildings: [{
          id: 'building-1',
          name: 'Building',
          footprint: { points: [] },
          baseElevation: 0,
          height: 10,
          floors: [{
            id: 'floor-0',
            level: 0,
            label: 'Ground',
            elevation: 0,
            height: 4,
            rooms: [],
            hallways: [],
            staircases: [],
            elevators: [],
            entrances: [],
            connectorStops: [],
            parametricComponents: [],
            metadata: {},
            routeNetwork: {
              nodes: [
                { id: 'route-node-1', type: 'waypoint', position: { x: 0, y: 0 }, floor: 0 },
                { id: 'route-node-isolated', type: 'waypoint', position: { x: 20, y: 20 }, floor: 0 },
              ],
              edges: [],
            },
          }],
          verticalConnectors: [],
          aliases: [],
          metadata: {},
        }],
        roads: [],
        panoramas: [],
        qrCheckpoints: [],
      },
    })
    await service.init(context)

    await service.publish(true)

    const compiler = context.get('navigationCompiler') as any
    const persistence = context.get('persistence') as any
    expect(compiler.compile).not.toHaveBeenCalled()
    expect(persistence.publish).not.toHaveBeenCalled()
    expect(service.getSnapshot().publishState).toBe('error')
    expect(service.getSnapshot().publishError).toContain('Route validation failed')
  })

  it('sets error state on compile failure', async () => {
    const { context } = createMockContext({ compileResult: { status: 'error', message: 'Graph has cycles', timestamp: Date.now() } })
    await service.init(context)
    await service.publish()
    const snap = service.getSnapshot()
    expect(snap.publishState).toBe('error')
    expect(snap.publishError).toContain('Graph has cycles')
  })

  it('sets error state on publish failure', async () => {
    const { context } = createMockContext({ publishResult: { success: false, message: 'Upload rejected' } })
    await service.init(context)
    await service.publish()
    const snap = service.getSnapshot()
    expect(snap.publishState).toBe('error')
    expect(snap.publishError).toContain('Upload rejected')
  })

  it('concurrent publish calls share the same in-flight promise', async () => {
    const { context } = createMockContext()
    await service.init(context)

    const p1 = service.publish()
    const p2 = service.publish()
    expect(p1).toBe(p2)
    await p1
    expect(service.getSnapshot().publishState).toBe('success')
  })

  it('transitions through all expected states on success', async () => {
    const { context } = createMockContext()
    await service.init(context)

    const states: string[] = []
    const unsub = store.subscribe(() => {
      states.push(store.getSnapshot().publishState)
    })

    await service.publish()
    unsub()

    expect(states).toContain('preparing')
    expect(states).toContain('validating')
    expect(states).toContain('compiling')
    expect(states).toContain('uploading')
    expect(states).toContain('success')
  })
})
