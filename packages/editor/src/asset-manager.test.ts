import { describe, it, expect, beforeEach } from 'vitest'
import { AssetManager } from './asset-manager'

describe('AssetManager', () => {
  let manager: AssetManager

  beforeEach(() => {
    manager = new AssetManager()
  })

  it('import creates entry with correct fields', () => {
    const entry = manager.import('textures/brick.png')
    expect(entry.id).toMatch(/^asset-/)
    expect(entry.fileName).toBe('brick.png')
    expect(entry.mimeType).toBe('application/octet-stream')
    expect(entry.size).toBe(0)
    expect(entry.storagePath).toBe('textures/brick.png')
    expect(entry.importedAt).toBeTruthy()
  })

  it('import of same path returns different entry', () => {
    const a = manager.import('textures/brick.png')
    const b = manager.import('textures/brick.png')
    expect(a.id).not.toBe(b.id)
  })

  it('get returns entry', () => {
    const entry = manager.import('test.png')
    expect(manager.get(entry.id)).toBe(entry)
  })

  it('get returns undefined for missing', () => {
    expect(manager.get('asset-nonexistent')).toBeUndefined()
  })

  it('has works', () => {
    const entry = manager.import('test.png')
    expect(manager.has(entry.id)).toBe(true)
    expect(manager.has('asset-nonexistent')).toBe(false)
  })

  it('remove removes entry', () => {
    const entry = manager.import('test.png')
    expect(manager.remove(entry.id)).toBe(true)
    expect(manager.has(entry.id)).toBe(false)
  })

  it('remove fails if entity references asset', () => {
    const entry = manager.import('test.png')
    manager.addReference(entry.id, 'entity-1')
    expect(manager.remove(entry.id)).toBe(false)
    expect(manager.has(entry.id)).toBe(true)
  })

  it('addReference/removeReference track references', () => {
    const entry = manager.import('test.png')
    manager.addReference(entry.id, 'entity-1')
    manager.addReference(entry.id, 'entity-2')
    expect(manager.referencesOf(entry.id)).toEqual(['entity-1', 'entity-2'])
    manager.removeReference(entry.id, 'entity-1')
    expect(manager.referencesOf(entry.id)).toEqual(['entity-2'])
  })

  it('referencesOf returns entity IDs', () => {
    const a = manager.import('tex/a.png')
    const b = manager.import('tex/b.png')
    manager.addReference(a.id, 'entity-x')
    manager.addReference(a.id, 'entity-y')
    manager.addReference(b.id, 'entity-z')
    expect(manager.referencesOf(a.id)).toEqual(['entity-x', 'entity-y'])
    expect(manager.referencesOf(b.id)).toEqual(['entity-z'])
  })

  it('cleanup removes unreferenced', () => {
    manager.import('orphan.png')
    const kept = manager.import('kept.png')
    manager.addReference(kept.id, 'entity-1')
    const removed = manager.cleanup()
    expect(removed).toHaveLength(1)
    expect(removed[0]).toMatch(/^asset-/)
    expect(manager.has(kept.id)).toBe(true)
  })

  it('cleanup does not remove referenced', () => {
    const a = manager.import('a.png')
    const b = manager.import('b.png')
    manager.addReference(a.id, 'entity-1')
    const removed = manager.cleanup()
    expect(removed).toEqual([b.id])
    expect(manager.has(a.id)).toBe(true)
    expect(manager.has(b.id)).toBe(false)
  })

  it('list returns all entries', () => {
    expect(manager.list()).toHaveLength(0)
    const a = manager.import('a.png')
    const b = manager.import('b.png')
    const list = manager.list()
    expect(list).toHaveLength(2)
    expect(list.map(e => e.id)).toContain(a.id)
    expect(list.map(e => e.id)).toContain(b.id)
  })
})
