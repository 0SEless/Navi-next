import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ServiceRegistry, BaseEditorService } from './service-registry'
import type { EditorService, ServiceMap } from './service-registry'
import type { CampusDocument } from '@navi/core'

// ── Test service helpers ───────────────────────────────────────

const testDoc = { id: 'doc-1' } as CampusDocument

class TestService extends BaseEditorService {
  readonly id = 'test' as const
  readonly dependencies: readonly string[] = []
  initCalled = false
  destroyCalled = false

  async init(ctx: any): Promise<void> {
    this.initCalled = true
    await super.init(ctx)
  }

  async destroy(): Promise<void> {
    this.destroyCalled = true
    await super.destroy()
  }
}

// Extend ServiceMap for test services
interface TestServiceMap extends ServiceMap {
  test: TestService
  depA: TestService
  depB: TestService
}

class TestRegistry extends ServiceRegistry {
  register<K extends keyof TestServiceMap>(id: K, service: TestServiceMap[K]): void {
    super.register(id as any, service as any)
  }
  get<K extends keyof TestServiceMap>(id: K): TestServiceMap[K] | undefined {
    return super.get(id as any) as any
  }
}

// ── BaseEditorService ─────────────────────────────────────────

describe('BaseEditorService', () => {
  it('starts in uninitialized state', () => {
    const svc = new TestService()
    expect(svc.status).toBe('uninitialized')
  })

  it('transitions through initializing → ready on init()', async () => {
    const svc = new TestService()
    expect(svc.status).toBe('uninitialized')
    await svc.init({ get: () => undefined!, document: testDoc })
    expect(svc.status).toBe('ready')
  })

  it('transitions to destroyed on destroy()', async () => {
    const svc = new TestService()
    await svc.init({ get: () => undefined!, document: testDoc })
    await svc.destroy()
    expect(svc.status).toBe('destroyed')
  })

  it('throws on invalid transition', () => {
    const svc = new TestService()
    expect(() => (svc as any).transitionTo('destroyed')).toThrow('Invalid service status transition')
  })

  it('throws on double init', async () => {
    const svc = new TestService()
    await svc.init({ get: () => undefined!, document: testDoc })
    await expect(svc.init({ get: () => undefined!, document: testDoc })).rejects.toThrow(
      'Invalid service status transition',
    )
  })

  it('setConfig/getConfig round-trips', () => {
    const svc = new TestService()
    svc.setConfig('foo', 'bar')
    expect(svc.getConfig('foo')).toBe('bar')
  })

  it('getConfig without key returns full config', () => {
    const svc = new TestService()
    svc.setConfig('a', 1)
    svc.setConfig('b', 2)
    const all = svc.getConfig()
    expect(all).toEqual({ a: 1, b: 2 })
  })

  it('reset clears config', () => {
    const svc = new TestService()
    svc.setConfig('foo', 'bar')
    svc.reset()
    expect(svc.getConfig('foo')).toBeUndefined()
  })

  it('exposes id, version, capabilities, dependencies', () => {
    const svc = new TestService()
    expect(svc.id).toBe('test')
    expect(svc.version).toBe('1.0.0')
    expect(svc.capabilities).toEqual([])
    expect(svc.dependencies).toEqual([])
  })
})

// ── ServiceRegistry ────────────────────────────────────────────

describe('ServiceRegistry', () => {
  let registry: TestRegistry

  beforeEach(() => {
    registry = new TestRegistry()
  })

  describe('registration and basic access', () => {
    it('registers and retrieves a service via get()', () => {
      const svc = new TestService()
      registry.register('test', svc)
      expect(registry.get('test')).toBe(svc)
    })

    it('returns undefined for unknown service via get()', () => {
      expect(registry.get('test')).toBeUndefined()
    })

    it('typed Proxy accessor returns services', () => {
      const svc = new TestService()
      registry.register('test', svc)
      expect(registry.typed.test).toBe(svc)
    })

    it('typed Proxy returns undefined for unknown property', () => {
      const svc = new TestService()
      registry.register('test', svc)
      expect((registry.typed as any).nonexistent).toBeUndefined()
    })

    it('has() checks existence', () => {
      const svc = new TestService()
      registry.register('test', svc)
      expect(registry.has('test')).toBe(true)
      expect(registry.has('nope')).toBe(false)
    })

    it('remove() deletes a service', () => {
      const svc = new TestService()
      registry.register('test', svc)
      registry.remove('test')
      expect(registry.has('test')).toBe(false)
    })

    it('tracks size correctly', () => {
      expect(registry.size).toBe(0)
      registry.register('depA' as any, new TestService())
      expect(registry.size).toBe(1)
      registry.register('depB' as any, new TestService())
      expect(registry.size).toBe(2)
      registry.remove('depA' as any)
      expect(registry.size).toBe(1)
    })

    it('throws when registering duplicate service', () => {
      registry.register('test', new TestService())
      expect(() => registry.register('test', new TestService())).toThrow('Service already registered')
    })
  })

  describe('lifecycle — init', () => {
    it('calls init on registered services', async () => {
      const svc = new TestService()
      registry.register('test', svc)
      await registry.init(testDoc)
      expect(svc.initCalled).toBe(true)
      expect(svc.status).toBe('ready')
    })

    it('initializes services in dependency-first order', async () => {
      const order: string[] = []
      class DepA extends BaseEditorService {
        readonly id = 'depA' as const
        readonly dependencies = [] as readonly string[]
        async init(ctx: any) { order.push('depA'); await super.init(ctx) }
      }
      class DepB extends BaseEditorService {
        readonly id = 'depB' as const
        readonly dependencies = ['depA'] as readonly string[]
        async init(ctx: any) { order.push('depB'); await super.init(ctx) }
      }
      class Main extends BaseEditorService {
        readonly id = 'main' as const
        readonly dependencies = ['depB'] as readonly string[]
        async init(ctx: any) { order.push('main'); await super.init(ctx) }
      }
      const a = new DepA(), b = new DepB(), m = new Main()
      registry.register('depA' as any, a)
      registry.register('depB' as any, b)
      registry.register('main' as any, m)
      await registry.init(testDoc)
      expect(order).toEqual(['depA', 'depB', 'main'])
    })

    it('throws if dependency is missing', async () => {
      class NeedsDep extends BaseEditorService {
        readonly id = 'needs' as const
        readonly dependencies = ['missing'] as readonly string[]
      }
      registry.register('needs' as any, new NeedsDep())
      await expect(registry.init(testDoc)).rejects.toThrow('depends on unknown service: missing')
    })

    it('throws on circular dependency', async () => {
      class A extends BaseEditorService {
        readonly id = 'a' as const
        readonly dependencies = ['b'] as readonly string[]
      }
      class B extends BaseEditorService {
        readonly id = 'b' as const
        readonly dependencies = ['a'] as readonly string[]
      }
      registry.register('a' as any, new A())
      registry.register('b' as any, new B())
      await expect(registry.init(testDoc)).rejects.toThrow('Circular dependency')
    })

    it('throws on double init', async () => {
      registry.register('test', new TestService())
      await registry.init(testDoc)
      await expect(registry.init(testDoc)).rejects.toThrow('already initialized')
    })
  })

  describe('lifecycle — destroy', () => {
    it('calls destroy on services in reverse order', async () => {
      const order: string[] = []
      class Svc extends BaseEditorService {
        readonly id = '' as const
        readonly dependencies = [] as readonly string[]
        name: string
        constructor(name: string) { super(); this.name = name; (this as any).id = name }
        async init(ctx: any) { await super.init(ctx) }
        async destroy() { order.push(this.name); await super.destroy() }
      }
      const a = new Svc('a'), b = new Svc('b'), c = new Svc('c')
      registry.register('a' as any, a)
      registry.register('b' as any, b)
      registry.register('c' as any, c)
      await registry.init(testDoc)
      await registry.destroy()
      expect(order).toEqual(['c', 'b', 'a'])
    })

    it('clears all services on destroy', async () => {
      registry.register('test', new TestService())
      await registry.init(testDoc)
      await registry.destroy()
      expect(registry.size).toBe(0)
    })

    it('sets status to destroyed', async () => {
      const svc = new TestService()
      registry.register('test', svc)
      await registry.init(testDoc)
      await registry.destroy()
      expect(svc.status).toBe('destroyed')
    })
  })

  describe('health', () => {
    it('health() returns status of all services', async () => {
      const svc = new TestService()
      registry.register('test', svc)
      await registry.init(testDoc)
      const h = registry.health()
      expect(h.test).toBe('ready')
    })

    it('healthy is true when all are ready', async () => {
      registry.register('test', new TestService())
      await registry.init(testDoc)
      expect(registry.healthy).toBe(true)
    })

    it('healthy is false when no services', () => {
      expect(registry.healthy).toBe(false)
    })

    it('healthy is false when a service is not ready', async () => {
      registry.register('test', new TestService())
      expect(registry.healthy).toBe(false)
    })
  })

  describe('typed Proxy accessor', () => {
    it('provides typed dotted property access', async () => {
      const svc = new TestService()
      registry.register('test', svc)
      await registry.init(testDoc)
      expect(registry.typed.test).toBe(svc)
    })

    it('accessor is stable (cached)', () => {
      const svc = new TestService()
      registry.register('test', svc)
      const a1 = registry.typed
      const a2 = registry.typed
      expect(a1).toBe(a2)
    })

    it('accessor is invalidated after register', () => {
      registry.register('test', new TestService())
      const a1 = registry.typed
      registry.register('depA' as any, new TestService())
      const a2 = registry.typed
      expect(a1).not.toBe(a2)
    })

    it('accessor is invalidated after remove', () => {
      registry.register('test', new TestService())
      const a1 = registry.typed
      registry.remove('test')
      const a2 = registry.typed
      expect(a1).not.toBe(a2)
    })
  })
})
