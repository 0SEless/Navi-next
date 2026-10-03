import { describe, it, expect } from 'vitest'
import { createEditingSession } from './EditingSession'
import { EditingState } from '../state/EditingState'
import { ValidationLevel } from '../validation/ValidationPipeline'
import type { EditingOperation } from '../operations/EditingOperations'

describe('EditingSession', () => {
  it('starts in Idle state with no operation', () => {
    const s = createEditingSession()
    expect(s.state).toBe(EditingState.Idle)
    expect(s.currentOperation).toBeNull()
    expect(s.selection.isEmpty).toBe(true)
    expect(s.dirtyTracker.isDirty).toBe(false)
  })

  describe('begin', () => {
    it('begins a create operation and transitions to Drawing', () => {
      const s = createEditingSession()
      s.begin({ kind: 'create', entityType: 'space', geometry: [] })
      expect(s.state).toBe(EditingState.Drawing)
      expect(s.currentOperation?.kind).toBe('create')
    })

    it('begins a move operation as instant (stays Idle)', () => {
      const s = createEditingSession()
      s.begin({ kind: 'move', entityId: 'room-1', deltaX: 5, deltaY: 0 })
      expect(s.state).toBe(EditingState.Idle)
    })

    it('begins a rename as instant (stays Idle)', () => {
      const s = createEditingSession()
      s.begin({ kind: 'rename', entityId: 'room-1', name: 'New Name' })
      expect(s.state).toBe(EditingState.Idle)
    })
  })

  describe('preview', () => {
    it('stores preview data', () => {
      const s = createEditingSession()
      s.begin({ kind: 'create', entityType: 'space', geometry: [] })
      s.preview({ x: 10, y: 20 })
      expect(s.previewData).toEqual({ x: 10, y: 20 })
    })
  })

  describe('validate', () => {
    it('returns passed when no validators registered', () => {
      const s = createEditingSession()
      s.begin({ kind: 'create', entityType: 'space', geometry: [] })
      const result = s.validate()
      expect(result.passed).toBe(true)
    })

    it('returns failed when validators reject', () => {
      const s = createEditingSession()
      s.validation.register(ValidationLevel.Editing, (ctx: unknown) => {
        const op = ctx as EditingOperation
        if (op.kind === 'create' && op.entityType === 'space') {
          const coords = op.geometry as any[]
          if (coords.length < 3) {
            return { level: ValidationLevel.Editing, passed: false, message: 'Need 3+ points', code: 'MIN_POINTS' }
          }
        }
        return { level: ValidationLevel.Editing, passed: true }
      })

      s.begin({ kind: 'create', entityType: 'space', geometry: [{ x: 0, y: 0 }] })
      expect(s.validate().passed).toBe(false)

      s.begin({ kind: 'create', entityType: 'space', geometry: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] })
      expect(s.validate().passed).toBe(true)
    })
  })

  describe('commit', () => {
    it('commits a geometry operation and marks geometry+compiler dirty', () => {
      const s = createEditingSession()
      s.begin({ kind: 'create', entityType: 'space', geometry: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] })
      const result = s.commit()
      expect(result.committed).toBe(true)
      expect(s.dirtyTracker.flags.geometryDirty).toBe(true)
      expect(s.dirtyTracker.flags.compilerDirty).toBe(true)
      expect(s.state).toBe(EditingState.Idle)
      expect(s.currentOperation).toBeNull()
    })

    it('commits a metadata operation and marks metadata + compiler dirty', () => {
      const s = createEditingSession()
      s.begin({ kind: 'rename', entityId: 'room-1', name: 'New Name' })
      const result = s.commit()
      expect(result.committed).toBe(true)
      expect(s.dirtyTracker.flags.metadataDirty).toBe(true)
      expect(s.dirtyTracker.flags.compilerDirty).toBe(true)
      expect(s.dirtyTracker.flags.geometryDirty).toBe(false)
    })

    it('rejects commit when validation fails', () => {
      const s = createEditingSession()
      s.validation.register(ValidationLevel.Editing, () => ({
        level: ValidationLevel.Editing,
        passed: false,
        message: 'Blocked',
        code: 'BLOCKED',
      }))
      s.begin({ kind: 'create', entityType: 'space', geometry: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] })
      const result = s.commit()
      expect(result.committed).toBe(false)
      expect(s.dirtyTracker.isDirty).toBe(false)
      // currentOperation is preserved so user can fix and retry
      expect(s.currentOperation).not.toBeNull()
    })

    it('does nothing when no operation in progress', () => {
      const s = createEditingSession()
      const result = s.commit()
      expect(result.committed).toBe(false)
    })
  })

  describe('execute', () => {
    it('completes the full lifecycle for geometry operations', () => {
      const s = createEditingSession()
      const result = s.execute({ kind: 'delete', entityIds: ['room-1'] })
      expect(result.committed).toBe(true)
      expect(s.state).toBe(EditingState.Idle)
      expect(s.dirtyTracker.flags.geometryDirty).toBe(true)
    })

    it('completes the full lifecycle for metadata operations', () => {
      const s = createEditingSession()
      const result = s.execute({ kind: 'assign', entityId: 'room-1', property: 'category', value: 'office' })
      expect(result.committed).toBe(true)
      expect(s.dirtyTracker.flags.metadataDirty).toBe(true)
      expect(s.dirtyTracker.flags.compilerDirty).toBe(true)
    })
  })

  describe('cancel', () => {
    it('cancels an in-progress operation', () => {
      const s = createEditingSession()
      s.begin({ kind: 'create', entityType: 'space', geometry: [] })
      s.preview({ x: 10, y: 10 })
      s.cancel()
      expect(s.state).toBe(EditingState.Idle)
      expect(s.currentOperation).toBeNull()
      expect(s.previewData).toBeNull()
    })
  })

  describe('clickEmptySpace', () => {
    it('clears selection', () => {
      const s = createEditingSession()
      s.selection.select('entity-1')
      s.clickEmptySpace()
      expect(s.selection.isEmpty).toBe(true)
    })
  })

  describe('escape', () => {
    it('cancels operation when one is in progress', () => {
      const s = createEditingSession()
      s.begin({ kind: 'create', entityType: 'space', geometry: [] })
      s.escape()
      expect(s.state).toBe(EditingState.Idle)
      expect(s.currentOperation).toBeNull()
    })

    it('clears selection when no operation', () => {
      const s = createEditingSession()
      s.selection.select('entity-1')
      s.escape()
      expect(s.selection.isEmpty).toBe(true)
    })

    it('does nothing if no operation and no selection', () => {
      const s = createEditingSession()
      s.escape()
      expect(s.state).toBe(EditingState.Idle)
    })
  })

  describe('reset', () => {
    it('resets all subsystems to initial state', () => {
      const s = createEditingSession()
      s.execute({ kind: 'create', entityType: 'space', geometry: [] })
      s.selection.select('x')
      s.reset()
      expect(s.state).toBe(EditingState.Idle)
      expect(s.currentOperation).toBeNull()
      expect(s.selection.isEmpty).toBe(true)
      expect(s.dirtyTracker.isDirty).toBe(false)
    })
  })

  describe('full lifecycle integration', () => {
    it('can create, validate, preview, and commit a space', () => {
      const s = createEditingSession()
      const geometry = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]

      s.begin({ kind: 'create', entityType: 'space', geometry })
      expect(s.state).toBe(EditingState.Drawing)

      s.preview({ previewVertices: geometry, valid: true })

      const validation = s.validate()
      expect(validation.passed).toBe(true)

      const result = s.commit()
      expect(result.committed).toBe(true)
      expect(s.dirtyTracker.flags.geometryDirty).toBe(true)
      expect(s.state).toBe(EditingState.Idle)
    })

    it('supports panning interrupt during drawing', () => {
      const s = createEditingSession()
      s.begin({ kind: 'create', entityType: 'space', geometry: [] })

      // Space down
      s.stateMachine.send({ kind: 'spaceDown' })
      expect(s.state).toBe(EditingState.Panning)

      // Space up → return to Drawing
      s.stateMachine.send({ kind: 'spaceUp' })
      expect(s.state).toBe(EditingState.Drawing)

      // Can still commit
      s.commit()
      expect(s.dirtyTracker.flags.geometryDirty).toBe(true)
    })
  })
})
