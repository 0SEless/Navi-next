import { describe, it, expect } from 'vitest'
import type { CampusDocument } from './document'
import { recordChange, getChangesSince } from './document'

function makeMinimalDoc(): CampusDocument {
  return {
    schemaVersion: 1,
    version: 0,
    metadata: {
      campusId: 'Test Campus',
      name: 'Test Campus',
      description: 'Minimal test',
      lastModified: new Date().toISOString(),
      editorVersion: '0.1.0',
    },
    buildings: [],
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
  }
}

describe('CampusDocument', () => {
  it('creates an empty document', () => {
    const doc = makeMinimalDoc()
    expect(doc.schemaVersion).toBe(1)
    expect(doc.buildings).toEqual([])
  })

  it('has version field defaulted to 0', () => {
    const doc = makeMinimalDoc()
    expect(doc.version).toBe(0)
  })
})

describe('recordChange', () => {
  it('bumps version on each call', () => {
    const doc = makeMinimalDoc()
    expect(doc.version).toBe(0)
    recordChange(doc, { entityId: 'rm-1', entityType: 'room', operation: 'updated' })
    expect(doc.version).toBe(1)
    recordChange(doc, { entityId: 'bld-1', entityType: 'building', operation: 'created' })
    expect(doc.version).toBe(2)
  })

  it('initializes _changeJournal on first call', () => {
    const doc = makeMinimalDoc()
    expect(doc._changeJournal).toBeUndefined()
    recordChange(doc, { entityId: 'rm-1', entityType: 'room', operation: 'updated' })
    expect(doc._changeJournal).toHaveLength(1)
    expect(doc._changeJournal![0].entityId).toBe('rm-1')
  })
})

describe('getChangesSince', () => {
  it('returns empty array when no changes recorded', () => {
    const doc = makeMinimalDoc()
    expect(getChangesSince(doc, 0)).toHaveLength(0)
  })

  it('returns only changes after the given version', () => {
    const doc = makeMinimalDoc()
    recordChange(doc, { entityId: 'rm-1', entityType: 'room', operation: 'updated' })
    const v1 = doc.version
    recordChange(doc, { entityId: 'bld-1', entityType: 'building', operation: 'updated' })
    const changes = getChangesSince(doc, v1)
    expect(changes).toHaveLength(1)
    expect(changes[0].entityId).toBe('bld-1')
  })

  it('returns all changes from version 0', () => {
    const doc = makeMinimalDoc()
    recordChange(doc, { entityId: 'rm-1', entityType: 'room', operation: 'updated' })
    recordChange(doc, { entityId: 'bld-1', entityType: 'building', operation: 'created' })
    expect(getChangesSince(doc, 0)).toHaveLength(2)
  })

  it('is non-destructive — multiple calls return the same data', () => {
    const doc = makeMinimalDoc()
    recordChange(doc, { entityId: 'rm-1', entityType: 'room', operation: 'updated' })
    const r1 = getChangesSince(doc, 0)
    const r2 = getChangesSince(doc, 0)
    expect(r1).toEqual(r2)
    expect(r1).toHaveLength(1)
  })

  it('returns empty array for a version at or after current', () => {
    const doc = makeMinimalDoc()
    recordChange(doc, { entityId: 'rm-1', entityType: 'room', operation: 'updated' })
    expect(getChangesSince(doc, doc.version)).toHaveLength(0)
    expect(getChangesSince(doc, 999)).toHaveLength(0)
  })
})
