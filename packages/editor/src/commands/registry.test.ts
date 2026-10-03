import { describe, it, expect, beforeEach } from 'vitest'
import { CommandRegistry } from './registry'
import type { CommandHandler } from './types'

describe('CommandRegistry', () => {
  let registry: CommandRegistry

  beforeEach(() => {
    registry = new CommandRegistry()
  })

  it('registers and retrieves handlers', () => {
    const handler: CommandHandler = { id: 'test', execute: () => ({ success: true }) }
    registry.register(handler)
    expect(registry.get('test')).toBe(handler)
  })

  it('throws on duplicate registration', () => {
    const handler: CommandHandler = { id: 'dup', execute: () => ({ success: true }) }
    registry.register(handler)
    expect(() => registry.register(handler)).toThrow('already registered')
  })

  it('has() checks existence', () => {
    registry.register({ id: 'a', execute: () => ({ success: true }) })
    expect(registry.has('a')).toBe(true)
    expect(registry.has('b')).toBe(false)
  })

  it('remove() deletes handler', () => {
    registry.register({ id: 'x', execute: () => ({ success: true }) })
    registry.remove('x')
    expect(registry.has('x')).toBe(false)
  })

  it('all returns all handlers', () => {
    registry.register({ id: 'a', execute: () => ({ success: true }) })
    registry.register({ id: 'b', execute: () => ({ success: true }) })
    expect(registry.all).toHaveLength(2)
  })
})
