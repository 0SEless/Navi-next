import { describe, it, expect } from 'vitest'
import { createEditingSession, isGeometryOperation } from '@navi/editing-engine'

describe('Delete pipeline through Editing Engine', () => {
  it('begins a delete operation (instant, stays Idle)', () => {
    const session = createEditingSession()
    session.begin({ kind: 'delete', entityIds: ['room-1'] })
    expect(session.state).toBe('idle')
    expect(session.currentOperation?.kind).toBe('delete')
  })

  it('commits a delete and marks geometryDirty + compilerDirty', () => {
    const session = createEditingSession()
    session.begin({ kind: 'delete', entityIds: ['room-1'] })
    const result = session.commit()
    expect(result.committed).toBe(true)
    expect(result.operation.kind).toBe('delete')
    expect(session.dirtyTracker.flags.geometryDirty).toBe(true)
    expect(session.dirtyTracker.flags.compilerDirty).toBe(true)
  })

  it('cancels a delete operation', () => {
    const session = createEditingSession()
    session.begin({ kind: 'delete', entityIds: ['room-1'] })
    session.cancel()
    expect(session.currentOperation).toBeNull()
    expect(session.state).toBe('idle')
    expect(session.dirtyTracker.isDirty).toBe(false)
  })

  it('handles multiple entity IDs in one delete', () => {
    const session = createEditingSession()
    session.begin({ kind: 'delete', entityIds: ['room-1', 'hallway-2'] })
    const result = session.commit()
    expect(result.committed).toBe(true)
    expect(result.operation.entityIds).toHaveLength(2)
  })

  it('isGeometryOperation returns true for delete', () => {
    expect(isGeometryOperation({ kind: 'delete', entityIds: ['x'] })).toBe(true)
  })

  it('execute completes begin+commit in one call', () => {
    const session = createEditingSession()
    const result = session.execute({ kind: 'delete', entityIds: ['room-1'] })
    expect(result.committed).toBe(true)
    expect(session.dirtyTracker.flags.geometryDirty).toBe(true)
  })
})
