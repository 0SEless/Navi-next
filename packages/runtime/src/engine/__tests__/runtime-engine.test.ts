import { describe, it, expect } from 'vitest'
import { RuntimeEngine } from '../runtime-engine'
import { load } from '../../loader'
import { resolve } from 'path'

const fixturesDir = resolve(__dirname, '../../../test/fixtures')

describe('RuntimeEngine', () => {
  it('create returns a ready engine', async () => {
    const result = await load(fixturesDir)
    expect(result.success).toBe(true)
    if (!result.success) return
    const engine = new RuntimeEngine(result.package)
    expect(engine).toBeDefined()
  })

  it('data API returns correct values', async () => {
    const result = await load(fixturesDir)
    expect(result.success).toBe(true)
    if (!result.success) return
    const engine = new RuntimeEngine(result.package)
    expect(engine.data.getCampusId()).toBe('test-campus')
    expect(engine.data.getBuilding('b1')?.name).toBe('Building A')
    expect(engine.data.getBoundingBox().minLng).toBe(121.0)
  })

  it('future APIs are wired correctly', async () => {
    const result = await load(fixturesDir)
    expect(result.success).toBe(true)
    if (!result.success) return
    const engine = new RuntimeEngine(result.package)
    expect(() => engine.location.resolve({ lat: 14.5, lng: 121.0 })).not.toThrow()
    expect(engine.location.resolve({ lat: 14.5, lng: 121.0 }).isIndoor).toBeDefined()
  })

  it('rejects on nonexistent path', async () => {
    const result = await load('/nonexistent/path')
    expect(result.success).toBe(false)
  })
})
