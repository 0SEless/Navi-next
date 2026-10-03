import { describe, it, expect } from 'vitest'
import { createEditingSession, isGeometryOperation } from '@navi/editing-engine'

describe('Move pipeline through Editing Engine', () => {
  it('begins a move operation (instant, stays Idle)', () => {
    const session = createEditingSession()
    session.begin({ kind: 'move', entityId: 'room-1', deltaX: 5, deltaY: -3 })
    expect(session.state).toBe('idle')
    expect(session.currentOperation?.kind).toBe('move')
  })

  it('commits a move and marks geometryDirty + compilerDirty', () => {
    const session = createEditingSession()
    session.begin({ kind: 'move', entityId: 'room-1', deltaX: 5, deltaY: -3 })
    const result = session.commit()
    expect(result.committed).toBe(true)
    expect(result.operation.kind).toBe('move')
    expect(session.dirtyTracker.flags.geometryDirty).toBe(true)
    expect(session.dirtyTracker.flags.compilerDirty).toBe(true)
  })

  it('cancels a move operation', () => {
    const session = createEditingSession()
    session.begin({ kind: 'move', entityId: 'room-1', deltaX: 5, deltaY: -3 })
    session.cancel()
    expect(session.currentOperation).toBeNull()
    expect(session.state).toBe('idle')
    expect(session.dirtyTracker.isDirty).toBe(false)
  })

  it('stores delta values in the operation', () => {
    const session = createEditingSession()
    session.begin({ kind: 'move', entityId: 'hallway-2', deltaX: 10.5, deltaY: -2.25 })
    const op = session.currentOperation!
    expect(op.kind).toBe('move')
    if (op.kind === 'move') {
      expect(op.deltaX).toBe(10.5)
      expect(op.deltaY).toBe(-2.25)
    }
  })

  it('isGeometryOperation returns true for move', () => {
    expect(isGeometryOperation({ kind: 'move', entityId: 'x', deltaX: 0, deltaY: 0 })).toBe(true)
  })

  it('execute completes begin+commit in one call', () => {
    const session = createEditingSession()
    const result = session.execute({ kind: 'move', entityId: 'elevator-1', deltaX: 3, deltaY: 4 })
    expect(result.committed).toBe(true)
    expect(session.dirtyTracker.flags.geometryDirty).toBe(true)
  })
})
