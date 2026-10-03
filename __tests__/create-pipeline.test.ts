import { describe, it, expect } from 'vitest'
import { createEditingSession, isGeometryOperation } from '@navi/editing-engine'

describe('Create pipeline through Editing Engine', () => {
  it('begins a create operation (drawing, transitions to drawing state)', () => {
    const session = createEditingSession()
    session.begin({ kind: 'create', entityType: 'space', geometry: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], properties: { name: 'Room 1' } })
    expect(session.state).toBe('drawing')
    expect(session.currentOperation?.kind).toBe('create')
  })

  it('commits a create and marks geometryDirty + compilerDirty', () => {
    const session = createEditingSession()
    session.begin({ kind: 'create', entityType: 'hallway', geometry: [{ x: 0, y: 0 }, { x: 10, y: 5 }], properties: { name: 'Hallway 1' } })
    const result = session.commit()
    expect(result.committed).toBe(true)
    expect(result.operation.kind).toBe('create')
    expect(session.dirtyTracker.flags.geometryDirty).toBe(true)
    expect(session.dirtyTracker.flags.compilerDirty).toBe(true)
  })

  it('cancels a create operation', () => {
    const session = createEditingSession()
    session.begin({ kind: 'create', entityType: 'space', geometry: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] })
    session.cancel()
    expect(session.currentOperation).toBeNull()
    expect(session.state).toBe('idle')
    expect(session.dirtyTracker.isDirty).toBe(false)
  })

  it('stores entity type and geometry', () => {
    const session = createEditingSession()
    const geometry = [{ x: 5, y: 5 }, { x: 15, y: 5 }, { x: 15, y: 15 }]
    session.begin({ kind: 'create', entityType: 'space', geometry })
    const op = session.currentOperation!
    expect(op.kind).toBe('create')
    if (op.kind === 'create') {
      expect(op.entityType).toBe('space')
      expect(op.geometry).toEqual(geometry)
    }
  })

  it('isGeometryOperation returns true for create', () => {
    expect(isGeometryOperation({ kind: 'create', entityType: 'space', geometry: [] })).toBe(true)
  })

  it('execute completes begin+commit in one call', () => {
    const session = createEditingSession()
    const result = session.execute({ kind: 'create', entityType: 'hallway', geometry: [{ x: 0, y: 0 }, { x: 5, y: 5 }] })
    expect(result.committed).toBe(true)
    expect(session.dirtyTracker.flags.geometryDirty).toBe(true)
  })
})
