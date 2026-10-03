import type { CampusDocument } from '@navi/core'

// ── Forward declarations for ServiceMap ──────────────────────
// Type-only imports to avoid circular deps; services implement EditorService by ID
import type { DocumentEventBus } from '../eventbus'
import type { CommandDispatcher } from '../commands/dispatcher'
import type { SelectionManager } from '../selection'
import type { Viewport } from '../viewport'
import type { CurrentToolStore } from '../tools/CurrentToolStore'
import type { EditingContextService } from '../editing-context'
import type { HistoryStack } from '../history'
import type { DocumentStore } from './document-store'
import type { NavigationCompiler, PersistenceService, WorkflowStore, WorkflowService, AutosaveService, PublishStore, PublishService } from '../services'
import type { ValidationEngine } from '../validation/validation-engine'
import type { AutoFixRegistry } from '../validation/fix'

// ── Service status state machine ─────────────────────────────

export type ServiceStatus =
  | 'uninitialized'
  | 'initializing'
  | 'ready'
  | 'busy'
  | 'degraded'
  | 'error'
  | 'destroyed'

const STATUS_TRANSITIONS: Record<ServiceStatus, readonly ServiceStatus[]> = {
  uninitialized: ['initializing'],
  initializing: ['ready', 'error'],
  ready: ['busy', 'degraded', 'error', 'destroyed'],
  busy: ['ready', 'error'],
  degraded: ['ready', 'error', 'destroyed'],
  error: ['ready', 'destroyed'],
  destroyed: [],
}

// ── Core types ───────────────────────────────────────────────

export interface Capability {
  id: string
  description: string
}

export interface EditorService {
  readonly id: string
  readonly version: string
  readonly status: ServiceStatus
  readonly capabilities: readonly Capability[]
  /** IDs of other services this service depends on (resolved at init) */
  readonly dependencies: readonly string[]

  /** Initialize the service. Called by ServiceRegistry after deps are ready. */
  init(context: EditorServiceContext): Promise<void>

  /** Destroy the service. Called by ServiceRegistry in LIFO order. */
  destroy(): Promise<void>

  /** Reset runtime config / state (does NOT change status). */
  reset(): void

  /** Get config value by key, or entire config object if key omitted. */
  getConfig<T = unknown>(key?: string): T | undefined

  /** Set a config value. */
  setConfig(key: string, value: unknown): void
}

export interface EditorServiceContext {
  /** Get a peer service by ID (typed via ServiceMap). Providers are guaranteed registered. */
  get<K extends keyof ServiceMap>(id: K): ServiceMap[K]
  /** The current campus document. */
  document: CampusDocument
}

// ── ServiceMap: maps service IDs to concrete types ───────────

export interface ServiceMap {
  eventBus: DocumentEventBus
  dispatcher: CommandDispatcher
  selection: SelectionManager
  viewport: Viewport
  editingContext: EditingContextService
  toolRegistry: CurrentToolStore
  history: HistoryStack
  documentStore: DocumentStore
  navigationCompiler: NavigationCompiler
  persistence: PersistenceService
  workflowStore: WorkflowStore
  workflow: WorkflowService
  autosave: AutosaveService
  validationEngine: ValidationEngine
  autoFixRegistry: AutoFixRegistry
  publishStore: PublishStore
  publish: PublishService
}

/** Typed dotted-access interface — mirrors ServiceMap with `T` (not `T | undefined`). */
export type ServiceAccessor = {
  [K in keyof ServiceMap]: ServiceMap[K]
}

// ── BaseEditorService — default implementation ───────────────

export abstract class BaseEditorService implements EditorService {
  abstract readonly id: string
  readonly version = '1.0.0'

  protected _status: ServiceStatus = 'uninitialized'
  protected _config = new Map<string, unknown>()
  protected _context: EditorServiceContext | null = null

  get status(): ServiceStatus {
    return this._status
  }

  readonly capabilities: readonly Capability[] = []
  readonly dependencies: readonly string[] = []

  async init(_context: EditorServiceContext): Promise<void> {
    this.transitionTo('initializing')
    this._context = _context
    this.transitionTo('ready')
  }

  async destroy(): Promise<void> {
    this.transitionTo('destroyed')
    this._context = null
    this._config.clear()
  }

  reset(): void {
    this._config.clear()
  }

  getConfig<T = unknown>(key?: string): T | undefined {
    if (key !== undefined) return this._config.get(key) as T | undefined
    return Object.fromEntries(this._config) as T
  }

  setConfig(key: string, value: unknown): void {
    this._config.set(key, value)
  }

  // ── helpers for subclasses ──────────────────────────────────

  /** Validate and apply a status transition. Throws on invalid transitions. */
  protected transitionTo(newStatus: ServiceStatus): void {
    const valid = STATUS_TRANSITIONS[this._status]
    if (!valid.includes(newStatus)) {
      throw new Error(
        `Invalid service status transition: ${this._status} → ${newStatus} (service: ${this.id})`,
      )
    }
    this._status = newStatus
  }

  /** Convenience: cast stored context to a concrete type for init logic. */
  protected get ctx(): EditorServiceContext {
    if (!this._context) throw new Error(`Service ${this.id} not yet initialized`)
    return this._context
  }
}

// ── ServiceRegistry ───────────────────────────────────────────

export class ServiceRegistry {
  private store = new Map<string, EditorService>()
  private _initialized = false
  private _accessor: ServiceAccessor | null = null

  // ── registration ────────────────────────────────────────────

  register<K extends keyof ServiceMap>(id: K, service: ServiceMap[K]): void {
    if (this.store.has(id as string)) {
      throw new Error(`Service already registered: ${String(id)}`)
    }
    this.store.set(id as string, service as unknown as EditorService)
    // invalidate cached typed accessor (new services may appear)
    this._accessor = null
  }

  // ── typed getters ───────────────────────────────────────────

  /** Typed method-based access — returns the service or undefined. */
  get<K extends keyof ServiceMap>(id: K): ServiceMap[K] | undefined {
    return this.store.get(id as string) as ServiceMap[K] | undefined
  }

  /** Typed dotted access — all services must be registered before use. */
  get typed(): ServiceAccessor {
    if (!this._accessor) {
      const store = this.store
      this._accessor = new Proxy({} as ServiceAccessor, {
        get(_, prop: string | symbol) {
          if (typeof prop === 'string' && store.has(prop)) {
            return store.get(prop)
          }
          return undefined
        },
      })
    }
    return this._accessor
  }

  // ── lifecycle ───────────────────────────────────────────────

  /** Initialize all services in dependency order (leaf services first). */
  async init(document: CampusDocument): Promise<void> {
    if (this._initialized) throw new Error('ServiceRegistry already initialized')
    this._initialized = true

    const ids = Array.from(this.store.keys()) as (keyof ServiceMap)[]
    const ordered = this.topologicalSort(ids)

    for (const id of ordered) {
      const svc = this.store.get(id as string)
      if (!svc || svc.status !== 'uninitialized') continue
      await this.initService(id, svc, document, new Set())
    }
  }

  /** Destroy services in LIFO order (reverse init order). */
  async destroy(): Promise<void> {
    const entries = Array.from(this.store.entries()).reverse()
    const errors: Array<{ id: string; error: unknown }> = []
    for (const [id, svc] of entries) {
      if (svc.status === 'destroyed' || svc.status === 'uninitialized') continue
      try {
        await svc.destroy()
      } catch (e) {
        errors.push({ id, error: e })
      }
    }
    this.store.clear()
    this._initialized = false
    this._accessor = null
    if (errors.length > 0) {
      throw new AggregateError(
        errors.map(e => new Error(`Service ${e.id} destroy failed: ${e.error}`)),
        `${errors.length} service(s) failed to destroy`,
      )
    }
  }

  // ── health ──────────────────────────────────────────────────

  /** Returns the status of every registered service. */
  health(): Record<string, ServiceStatus> {
    const result: Record<string, ServiceStatus> = {}
    for (const [id, svc] of this.store) {
      result[id] = svc.status
    }
    return result
  }

  /** Returns true if all services are in 'ready' state. */
  get healthy(): boolean {
    if (this.store.size === 0) return false
    for (const svc of this.store.values()) {
      if (svc.status !== 'ready') return false
    }
    return true
  }

  // ── utility ─────────────────────────────────────────────────

  has(id: string): boolean {
    return this.store.has(id)
  }

  remove(id: string): void {
    this.store.delete(id)
    this._accessor = null
  }

  get size(): number {
    return this.store.size
  }

  // ── private ─────────────────────────────────────────────────

  private async initService(
    id: keyof ServiceMap,
    svc: EditorService,
    document: CampusDocument,
    visiting: Set<string>,
  ): Promise<void> {
    if (visiting.has(id as string)) {
      throw new Error(`Circular dependency detected: ${Array.from(visiting).join(' → ')} → ${String(id)}`)
    }
    visiting.add(id as string)

    // resolve dependencies first
    for (const depId of svc.dependencies) {
      const depSvc = this.store.get(depId)
      if (!depSvc) {
        throw new Error(`Service ${String(id)} depends on unknown service: ${depId}`)
      }
      if (depSvc.status === 'uninitialized') {
        await this.initService(depId as keyof ServiceMap, depSvc, document, visiting)
      }
    }

    // build context for this service
    const context: EditorServiceContext = {
      get: <K extends keyof ServiceMap>(depId: K): ServiceMap[K] => {
        const s = this.store.get(depId as string)
        if (!s) throw new Error(`Service ${depId as string} not registered`)
        return s as ServiceMap[K]
      },
      document,
    }

    await svc.init(context)
  }

  /** Simple topological sort: services with no deps first, then those whose deps are already ordered. */
  private topologicalSort(ids: (keyof ServiceMap)[]): (keyof ServiceMap)[] {
    const visited = new Set<string>()
    const result: (keyof ServiceMap)[] = []
    const self = this

    function visit(id: string, stack: Set<string>) {
      if (visited.has(id)) return
      if (stack.has(id)) throw new Error(`Circular dependency: ${id}`)
      stack.add(id)
      const svc = self.store.get(id)
      if (svc) {
        for (const dep of svc.dependencies) {
          visit(dep, stack)
        }
      }
      visited.add(id)
      result.push(id as keyof ServiceMap)
      stack.delete(id)
    }

    for (const id of ids) {
      visit(id as string, new Set())
    }

    return result
  }
}
