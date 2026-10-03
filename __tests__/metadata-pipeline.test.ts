import { describe, it, expect } from 'vitest'
import { createEditingSession, isMetadataOperation } from '@navi/editing-engine'

describe('Metadata pipeline through Editing Engine', () => {
  it('begins a rename operation (instant, stays in idle state)', () => {
    const session = createEditingSession()
    session.begin({ kind: 'rename', entityId: 'room-1', name: 'Conference Room A' })
    expect(session.state).toBe('idle')
    expect(session.currentOperation?.kind).toBe('rename')
  })

  it('commits a rename and marks metadataDirty + compilerDirty (not geometryDirty)', () => {
    const session = createEditingSession()
    session.begin({ kind: 'rename', entityId: 'room-1', name: 'Updated Name' })
    const result = session.commit()
    expect(result.committed).toBe(true)
    expect(result.operation.kind).toBe('rename')
    expect(session.dirtyTracker.flags.metadataDirty).toBe(true)
    expect(session.dirtyTracker.flags.compilerDirty).toBe(true)
    expect(session.dirtyTracker.flags.geometryDirty).toBe(false)
  })

  it('begins an assign operation and stores property + value', () => {
    const session = createEditingSession()
    session.begin({ kind: 'assign', entityId: 'room-1', property: 'category', value: 'classroom' })
    expect(session.currentOperation?.kind).toBe('assign')
    const op = session.currentOperation!
    if (op.kind === 'assign') {
      expect(op.property).toBe('category')
      expect(op.value).toBe('classroom')
    }
  })

  it('commits an assign and marks metadataDirty + compilerDirty', () => {
    const session = createEditingSession()
    session.begin({ kind: 'assign', entityId: 'hallway-1', property: 'width', value: 3.5 })
    const result = session.commit()
    expect(result.committed).toBe(true)
    expect(session.dirtyTracker.flags.metadataDirty).toBe(true)
    expect(session.dirtyTracker.flags.compilerDirty).toBe(true)
    expect(session.dirtyTracker.flags.geometryDirty).toBe(false)
  })

  it('isMetadataOperation returns true for rename and assign', () => {
    expect(isMetadataOperation({ kind: 'rename', entityId: 'r1', name: 'x' })).toBe(true)
    expect(isMetadataOperation({ kind: 'assign', entityId: 'r1', property: 'cap', value: 30 })).toBe(true)
    expect(isMetadataOperation({ kind: 'delete' as any, entityIds: ['x'] })).toBe(false)
  })

  it('cancels a metadata operation', () => {
    const session = createEditingSession()
    session.begin({ kind: 'assign', entityId: 'room-1', property: 'capacity', value: 50 })
    session.cancel()
    expect(session.currentOperation).toBeNull()
    expect(session.dirtyTracker.isDirty).toBe(false)
  })

  it('execute completes begin+commit in one call for assign', () => {
    const session = createEditingSession()
    const result = session.execute({ kind: 'assign', entityId: 'room-1', property: 'capacity', value: 40 })
    expect(result.committed).toBe(true)
    expect(session.dirtyTracker.flags.metadataDirty).toBe(true)
    expect(session.dirtyTracker.flags.compilerDirty).toBe(true)
  })
})
