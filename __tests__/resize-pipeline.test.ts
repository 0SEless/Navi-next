import { describe, it, expect } from 'vitest'
import { createEditingSession, isGeometryOperation } from '@navi/editing-engine'

describe('Resize pipeline through Editing Engine', () => {
  it('begins a resize operation (instant, stays Idle)', () => {
    const session = createEditingSession()
    session.begin({ kind: 'resize', entityId: 'room-1', vertexIndex: 2, newX: 15, newY: 20 })
    expect(session.state).toBe('idle')
    expect(session.currentOperation?.kind).toBe('resize')
  })

  it('commits a resize and marks geometryDirty + compilerDirty', () => {
    const session = createEditingSession()
    session.begin({ kind: 'resize', entityId: 'room-1', vertexIndex: 2, newX: 15, newY: 20 })
    const result = session.commit()
    expect(result.committed).toBe(true)
    expect(result.operation.kind).toBe('resize')
    expect(session.dirtyTracker.flags.geometryDirty).toBe(true)
    expect(session.dirtyTracker.flags.compilerDirty).toBe(true)
  })

  it('cancels a resize operation', () => {
    const session = createEditingSession()
    session.begin({ kind: 'resize', entityId: 'room-1', vertexIndex: 2, newX: 15, newY: 20 })
    session.cancel()
    expect(session.currentOperation).toBeNull()
    expect(session.state).toBe('idle')
    expect(session.dirtyTracker.isDirty).toBe(false)
  })

  it('stores vertex index and coordinates', () => {
    const session = createEditingSession()
    session.begin({ kind: 'resize', entityId: 'hallway-1', vertexIndex: 0, newX: 25.5, newY: -10.2 })
    const op = session.currentOperation!
    expect(op.kind).toBe('resize')
    if (op.kind === 'resize') {
      expect(op.vertexIndex).toBe(0)
      expect(op.newX).toBe(25.5)
      expect(op.newY).toBe(-10.2)
    }
  })

  it('isGeometryOperation returns true for resize', () => {
    expect(isGeometryOperation({ kind: 'resize', entityId: 'x', vertexIndex: 0, newX: 0, newY: 0 })).toBe(true)
  })

  it('execute completes begin+commit in one call', () => {
    const session = createEditingSession()
    const result = session.execute({ kind: 'resize', entityId: 'elevator-1', vertexIndex: 1, newX: 30, newY: 40 })
    expect(result.committed).toBe(true)
    expect(session.dirtyTracker.flags.geometryDirty).toBe(true)
  })
})
