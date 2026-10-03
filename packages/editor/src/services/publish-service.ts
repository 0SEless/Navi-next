import { BaseEditorService } from '../context'
import type { EditorServiceContext } from '../context/service-registry'
import type { DocumentEventBus } from '../eventbus'
import type { DocumentStore } from '../context/document-store'
import type { WorkflowService } from './workflow-service'
import type { NavigationCompiler, CompileResult } from './navigation-compiler'
import type { ValidationEngine } from '../validation/validation-engine'
import type { CampusDocument } from '@navi/core'
import { validateRouteNetwork } from '../validation/rules/modules/route-network'
import type { PersistenceService } from './persistence-service'
import type { PublishStore, PublishSnapshot, PublishState, PublishResult } from './publish-store'

export class PublishService extends BaseEditorService {
  readonly id = 'publish'
  readonly dependencies: readonly string[] = [
    'workflow', 'navigationCompiler', 'persistence',
    'documentStore', 'eventBus', 'publishStore',
  ] as const

  private publishStore!: PublishStore
  private workflowService!: WorkflowService
  private validationEngine!: ValidationEngine
  private navCompiler!: NavigationCompiler
  private persistence!: PersistenceService
  private documentStore!: DocumentStore
  private eventBus!: DocumentEventBus

  private currentPublishPromise: Promise<void> | null = null

  constructor(publishStore: PublishStore) {
    super()
    this.publishStore = publishStore
  }

  async init(context: EditorServiceContext): Promise<void> {
    await super.init(context)
    this.workflowService = context.get('workflow')
    this.validationEngine = context.get('validationEngine')
    this.navCompiler = context.get('navigationCompiler')
    this.persistence = context.get('persistence')
    this.documentStore = context.get('documentStore')
    this.eventBus = context.get('eventBus')
  }

  getSnapshot(): PublishSnapshot {
    return this.publishStore.getSnapshot()
  }

  subscribe(listener: () => void): () => void {
    return this.publishStore.subscribe(listener)
  }

  isPublishing(): boolean {
    const state = this.publishStore.getSnapshot().publishState
    return state !== 'idle' && state !== 'success' && state !== 'error'
  }

  publish(force = false): Promise<void> {
    if (this.currentPublishPromise) {
      return this.currentPublishPromise
    }

    this.currentPublishPromise = this.runPublish(force).finally(() => {
      this.currentPublishPromise = null
    })
    return this.currentPublishPromise
  }

  private async runPublish(force = false): Promise<void> {
    this.assertCanPublish(force)

    const document = this.documentStore.document as CampusDocument
    const revision = this.documentStore.version

    this.transition('preparing')

    const startedAt = Date.now()

    this.transition('validating')

    // Route connectivity is a publish invariant. Keep this check independent
    // of `force`: force may bypass legacy cached diagnostics, but it must never
    // publish a graph whose authored indoor network cannot be traversed.
    const routeErrors = validateRouteNetwork(document, 'publish')
      .filter((issue) => issue.severity === 'error')
    if (routeErrors.length > 0) {
      this.fail(`Route validation failed: ${routeErrors[0].message}`)
      return
    }

    if (!force) {
      const snapshot = this.validationEngine.validate(this.documentStore.document as any, 'publish')
      if (snapshot.statistics.errors > 0) {
        this.fail('Validation failed')
        return
      }
    }

    this.transition('compiling')

    const compileResult: CompileResult = await this.navCompiler.compile(document)
    if (compileResult.status !== 'success' || !compileResult.artifacts) {
      this.fail(compileResult.message ?? 'Compilation failed')
      return
    }

    this.transition('uploading')

    const publishResult = await this.persistence.publish(compileResult.artifacts)
    if (!publishResult.success) {
      this.fail(publishResult.message ?? 'Publish failed')
      return
    }

    const finishedAt = Date.now()
    const navGraph = compileResult.artifacts.navigationGraph as any

    this.publishStore.updatePublishState({
      publishState: 'success',
      publishResult: {
        revision,
        compiledGraphVersion: navGraph?.version ?? '0.0.0',
        campusId: document?.metadata?.campusId ?? 'unknown',
        artifactCount: Object.keys(compileResult.artifacts).length,
        nodeCount: navGraph?.nodes?.length ?? 0,
        edgeCount: navGraph?.edges?.length ?? 0,
        startedAt,
        finishedAt,
      },
      publishError: null,
      lastPublishedRevision: revision,
      lastPublishedAt: finishedAt,
    })

    this.eventBus.emit('publish.completed', { revision, finishedAt, navigationGraph: compileResult.artifacts.navigationGraph })
  }

  private assertCanPublish(force = false): void {
    if (this.isPublishing()) throw new Error('Already publishing')
    if (!force) {
      const snap = this.validationEngine.getLastSnapshot()
      if (snap && snap.statistics.errors > 0) throw new Error('Validation has errors')
    }
    if (this.workflowService.isSaving()) throw new Error('Save in progress')
    if (this.workflowService.hasUnsavedChanges()) throw new Error('Document has unsaved changes')
    if (typeof this.workflowService.canPublish === 'function' && !this.workflowService.canPublish()) {
      throw new Error('Graph synchronization is not complete')
    }
  }

  private transition(state: PublishState): void {
    this.publishStore.updatePublishState({
      publishState: state,
      publishError: null,
      currentStageStartedAt: Date.now(),
    })
  }

  private fail(message: string): void {
    this.publishStore.updatePublishState({
      publishState: 'error',
      publishError: message,
    })
  }
}
