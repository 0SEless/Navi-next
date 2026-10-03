import { describe, it, expect, beforeEach } from 'vitest'
import { DocumentEventBus } from './eventbus'

describe('DocumentEventBus', () => {
  let bus: DocumentEventBus

  beforeEach(() => {
    bus = new DocumentEventBus()
  })

  it('emits and receives events', () => {
    let received: any = null
    bus.on('entity.created', (p) => { received = p })
    bus.emit('entity.created', { entityId: 'bld-1', entityType: 'building' })
    expect(received).toEqual({ entityId: 'bld-1', entityType: 'building' })
  })

  it('supports multiple listeners', () => {
    let count = 0
    bus.on('entity.created', () => count++)
    bus.on('entity.created', () => count++)
    bus.emit('entity.created', { entityId: 'x', entityType: 'building' })
    expect(count).toBe(2)
  })

  it('unsubscribe removes listener', () => {
    let count = 0
    const unsub = bus.on('entity.created', () => count++)
    unsub()
    bus.emit('entity.created', { entityId: 'x', entityType: 'building' })
    expect(count).toBe(0)
  })

  it('off removes specific listener', () => {
    let a = 0, b = 0
    const fnA = () => a++
    const fnB = () => b++
    bus.on('entity.created', fnA)
    bus.on('entity.created', fnB)
    bus.off('entity.created', fnA)
    bus.emit('entity.created', { entityId: 'x', entityType: 'building' })
    expect(a).toBe(0)
    expect(b).toBe(1)
  })

  it('queues events during transaction and flushes on end', () => {
    const received: string[] = []
    bus.on('entity.created', (p) => received.push(p.entityId))
    bus.on('transaction.flush', (p) => received.push(`flush:${p.queuedEvents}`))

    bus.begin()
    bus.emit('entity.created', { entityId: 'a', entityType: 'building' })
    bus.emit('entity.created', { entityId: 'b', entityType: 'building' })
    expect(received.length).toBe(0)
    bus.end()

    expect(received).toEqual(['a', 'b', 'flush:2'])
  })

  it('supports nested transactions', () => {
    const received: string[] = []
    bus.on('entity.created', (p) => received.push(p.entityId))

    bus.begin()
    bus.emit('entity.created', { entityId: 'a', entityType: 'building' })
    bus.begin()
    bus.emit('entity.created', { entityId: 'b', entityType: 'building' })
    bus.end()
    expect(received.length).toBe(0)
    bus.end()
    expect(received).toEqual(['a', 'b'])
  })

  it('transaction() helper wraps begin/end', () => {
    const received: string[] = []
    bus.on('entity.created', (p) => received.push(p.entityId))

    bus.transaction(() => {
      bus.emit('entity.created', { entityId: 'x', entityType: 'building' })
      bus.emit('entity.created', { entityId: 'y', entityType: 'building' })
    })
    expect(received).toEqual(['x', 'y'])
  })

  it('clears queue on transaction error', () => {
    const received: string[] = []
    bus.on('entity.created', (p) => received.push(p.entityId))

    expect(() => {
      bus.transaction(() => {
        bus.emit('entity.created', { entityId: 'x', entityType: 'building' })
        throw new Error('oops')
      })
    }).toThrow('oops')

    expect(received.length).toBe(0)
    bus.emit('entity.created', { entityId: 'y', entityType: 'building' })
    expect(received).toEqual(['y'])
  })

  it('removeAllListeners clears everything', () => {
    let count = 0
    bus.on('entity.created', () => count++)
    bus.on('entity.deleted', () => count++)
    bus.removeAllListeners()
    bus.emit('entity.created', { entityId: 'x', entityType: 'building' })
    bus.emit('entity.deleted', { entityId: 'x', entityType: 'building' })
    expect(count).toBe(0)
  })

  it('listenerCount returns correct count', () => {
    expect(bus.listenerCount).toBe(0)
    bus.on('entity.created', () => {})
    expect(bus.listenerCount).toBe(1)
    bus.on('entity.created', () => {})
    expect(bus.listenerCount).toBe(2)
    bus.on('entity.deleted', () => {})
    expect(bus.listenerCount).toBe(3)
  })
})
