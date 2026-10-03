import { describe, it, expect } from 'vitest'
import { serialize, deserialize } from '../serializer'

describe('Serializer', () => {
  it('produces compact JSON without whitespace', () => {
    const bytes = serialize({ a: 1, b: 2 })
    const str = new TextDecoder().decode(bytes)
    expect(str).toBe('{"a":1,"b":2}')
  })

  it('round-trips objects through serialize/deserialize', () => {
    const obj = { name: 'test', values: [1, 2, 3], nested: { x: 10 } }
    const bytes = serialize(obj)
    const restored = deserialize<typeof obj>(bytes)
    expect(restored).toEqual(obj)
  })

  it('round-trips arrays', () => {
    const arr = ['a', 'b', 'c']
    const bytes = serialize(arr)
    const restored = deserialize<string[]>(bytes)
    expect(restored).toEqual(arr)
  })

  it('round-trips primitive values', () => {
    expect(deserialize<null>(serialize(null))).toBeNull()
    expect(deserialize<number>(serialize(42))).toBe(42)
    expect(deserialize<string>(serialize('hello'))).toBe('hello')
    expect(deserialize<boolean>(serialize(true))).toBe(true)
  })

  it('encodes UTF-8 correctly', () => {
    const str = 'Hello 世界 🎉'
    const bytes = serialize(str)
    const restored = deserialize<string>(bytes)
    expect(restored).toBe(str)
  })

  it('is deterministic — same object produces identical bytes', () => {
    const obj = { a: 1, b: 'hello', c: [1, null, true] }
    const a = serialize(obj)
    const b = serialize(obj)
    expect(a).toEqual(b)
  })

  it('produces different bytes for different objects', () => {
    const a = serialize({ x: 1 })
    const b = serialize({ x: 2 })
    expect(a).not.toEqual(b)
  })

  it('serializes empty objects and arrays', () => {
    expect(new TextDecoder().decode(serialize({}))).toBe('{}')
    expect(new TextDecoder().decode(serialize([]))).toBe('[]')
  })

  it('drops undefined values per JSON.stringify behavior', () => {
    const bytes = serialize({ a: 1, b: undefined })
    const str = new TextDecoder().decode(bytes)
    expect(str).toBe('{"a":1}')
  })

  it('round-trips a realistic BuiltPackage-shaped object', () => {
    const pkg = {
      campusId: 'campus-1',
      campusName: 'Test',
      publishedAt: '2026-07-17T12:00:00Z',
      compilerVersion: '1.0.0',
      metadata: {
        nodeCount: 4,
        edgeCount: 2,
        buildingCount: 2,
        floorCount: 3,
        routeable: true,
      },
    }
    const bytes = serialize(pkg)
    const restored = deserialize<typeof pkg>(bytes)
    expect(restored).toEqual(pkg)
  })
})
