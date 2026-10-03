import { describe, it, expect, beforeEach } from 'vitest'
import { ToolRegistry, toolRegistry } from '../tool-registry'
import type { ToolDefinition } from '../tool-registry'

describe('ToolRegistry', () => {
  let registry: ToolRegistry

  beforeEach(() => {
    registry = new ToolRegistry()
  })

  it('registers and retrieves tools', () => {
    const tool: ToolDefinition = { id: 'test', name: 'Test', icon: 'test', category: 'utility' }
    registry.register(tool)
    expect(registry.get('test')).toBe(tool)
  })

  it('throws on duplicate registration', () => {
    const tool: ToolDefinition = { id: 'dup', name: 'Dup', icon: 'dup', category: 'utility' }
    registry.register(tool)
    expect(() => registry.register(tool)).toThrow('already registered')
  })

  it('returns undefined for unknown tool', () => {
    expect(registry.get('nonexistent')).toBeUndefined()
  })

  it('getAll returns all tools', () => {
    registry.register({ id: 'a', name: 'A', icon: 'a', category: 'geometry' })
    registry.register({ id: 'b', name: 'B', icon: 'b', category: 'navigation' })
    expect(registry.getAll()).toHaveLength(2)
  })

  it('size reflects registration count', () => {
    expect(registry.size).toBe(0)
    registry.register({ id: 'a', name: 'A', icon: 'a', category: 'utility' })
    expect(registry.size).toBe(1)
  })

  it('getByCategory filters correctly', () => {
    registry.register({ id: 'w', name: 'W', icon: 'w', category: 'geometry' })
    registry.register({ id: 'p', name: 'P', icon: 'p', category: 'navigation' })
    registry.register({ id: 'u', name: 'U', icon: 'u', category: 'utility' })
    expect(registry.getByCategory('geometry')).toHaveLength(1)
    expect(registry.getByCategory('geometry')[0].id).toBe('w')
    expect(registry.getByCategory('navigation')).toHaveLength(1)
    expect(registry.getByCategory('feature')).toHaveLength(0)
  })
})

describe('toolRegistry singleton', () => {
  it('is a ToolRegistry instance', () => {
    expect(toolRegistry).toBeInstanceOf(ToolRegistry)
  })

  it('registers all SPEC tools', () => {
    expect(toolRegistry.size).toBe(24)
  })

  it('has all geometry tools', () => {
    const geometry = toolRegistry.getByCategory('geometry')
    const ids = geometry.map((t) => t.id)
    expect(ids).toContain('space')
    expect(ids).toContain('hallway')
    expect(ids).toContain('wall')
    expect(ids).toContain('door')
    expect(ids).toContain('window')
  })

  it('has all feature tools', () => {
    const feature = toolRegistry.getByCategory('feature')
    const ids = feature.map((t) => t.id)
    expect(ids).toContain('staircase')
    expect(ids).toContain('elevator')
    expect(ids).toContain('entrance')
    expect(ids).toContain('poi')
    expect(ids).toContain('poi-circle')
    expect(ids).toContain('poi-rectangle')
    expect(ids).toContain('poi-polygon')
  })

  it('has all navigation tools', () => {
    const nav = toolRegistry.getByCategory('navigation')
    const ids = nav.map((t) => t.id)
    expect(ids).toContain('route-node')
    expect(ids).toContain('route-edge')
  })

  it('has all utility tools', () => {
    const util = toolRegistry.getByCategory('utility')
    const ids = util.map((t) => t.id)
    expect(ids).toContain('select')
    expect(ids).toContain('align')
    expect(ids).toContain('pan')
    expect(ids).toContain('measure')
  })

  it('tool IDs match SPEC definitions', () => {
    const expected = [
      'select', 'space', 'hallway',
      'wall', 'door', 'window',
      'entrance', 'staircase', 'elevator', 'align',
      'poi', 'poi-circle', 'poi-rectangle', 'poi-polygon', 'route-node', 'route-edge',
      'pan', 'measure', 'place-panorama',
      'area', 'building', 'route', 'import-osm', 'set-boundary',
    ]
    for (const id of expected) {
      expect(toolRegistry.get(id)).toBeDefined()
    }
  })

  it('all tools have required fields', () => {
    for (const tool of toolRegistry.getAll()) {
      expect(tool.id).toBeTruthy()
      expect(tool.name).toBeTruthy()
      expect(tool.icon).toBeTruthy()
      expect(tool.category).toBeTruthy()
    }
  })
})
