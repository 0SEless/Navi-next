import { describe, it, expect } from 'vitest'
import type { EditingOperation } from './EditingOperations'
import { isGeometryOperation, isMetadataOperation } from './EditingOperations'

describe('EditingOperations', () => {
  describe('CreateOperation', () => {
    it('creates a space create operation', () => {
      const op: EditingOperation = {
        kind: 'create',
        entityType: 'space',
        geometry: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
      }
      expect(op.kind).toBe('create')
      expect(op.entityType).toBe('space')
      expect(isGeometryOperation(op)).toBe(true)
    })

    it('creates a hallway create operation', () => {
      const op: EditingOperation = {
        kind: 'create',
        entityType: 'hallway',
        geometry: [{ x: 0, y: 0 }, { x: 20, y: 0 }],
        properties: { width: 3 },
      }
      expect(op.entityType).toBe('hallway')
      expect(op.properties?.width).toBe(3)
    })

    it('creates an entrance create operation', () => {
      const op: EditingOperation = {
        kind: 'create',
        entityType: 'entrance',
        geometry: { x: 5, y: 5 },
      }
      expect(op.entityType).toBe('entrance')
    })
  })

  describe('DeleteOperation', () => {
    it('deletes multiple entities', () => {
      const op: EditingOperation = { kind: 'delete', entityIds: ['a', 'b', 'c'] }
      expect(op.entityIds).toHaveLength(3)
      expect(isGeometryOperation(op)).toBe(true)
    })

    it('deletes a single entity', () => {
      const op: EditingOperation = { kind: 'delete', entityIds: ['a'] }
      expect(op.entityIds).toEqual(['a'])
    })
  })

  describe('MoveOperation', () => {
    it('describes a move delta', () => {
      const op: EditingOperation = {
        kind: 'move',
        entityId: 'room-1',
        deltaX: 5,
        deltaY: -3,
      }
      expect(op.deltaX).toBe(5)
      expect(op.deltaY).toBe(-3)
      expect(isGeometryOperation(op)).toBe(true)
    })
  })

  describe('ResizeOperation', () => {
    it('describes a vertex adjustment', () => {
      const op: EditingOperation = {
        kind: 'resize',
        entityId: 'room-1',
        vertexIndex: 2,
        newX: 15,
        newY: 20,
      }
      expect(op.vertexIndex).toBe(2)
      expect(op.newX).toBe(15)
      expect(isGeometryOperation(op)).toBe(true)
    })
  })

  describe('SplitOperation', () => {
    it('describes a polygon split', () => {
      const op: EditingOperation = {
        kind: 'split',
        entityId: 'room-1',
        splitLine: { x1: 0, y1: 5, x2: 20, y2: 5 },
      }
      expect(op.splitLine.x1).toBe(0)
      expect(isGeometryOperation(op)).toBe(true)
    })
  })

  describe('MergeOperation', () => {
    it('requires at least two entity ids', () => {
      const op: EditingOperation = {
        kind: 'merge',
        entityIds: ['room-1', 'room-2'],
      }
      expect(op.entityIds).toHaveLength(2)
      expect(isGeometryOperation(op)).toBe(true)
    })
  })

  describe('RenameOperation', () => {
    it('describes a rename', () => {
      const op: EditingOperation = {
        kind: 'rename',
        entityId: 'room-1',
        name: 'Conference Room A',
      }
      expect(op.name).toBe('Conference Room A')
      expect(isMetadataOperation(op)).toBe(true)
      expect(isGeometryOperation(op)).toBe(false)
    })
  })

  describe('AssignOperation', () => {
    it('describes a property assignment', () => {
      const op: EditingOperation = {
        kind: 'assign',
        entityId: 'room-1',
        property: 'category',
        value: 'classroom',
      }
      expect(op.property).toBe('category')
      expect(op.value).toBe('classroom')
      expect(isMetadataOperation(op)).toBe(true)
      expect(isGeometryOperation(op)).toBe(false)
    })

    it('assigns numeric values', () => {
      const op: EditingOperation = {
        kind: 'assign',
        entityId: 'room-1',
        property: 'capacity',
        value: 30,
      }
      expect(op.value).toBe(30)
    })
  })

  describe('isGeometryOperation', () => {
    it('returns true for create, delete, move, resize, split, merge', () => {
      const geometryKinds: EditingOperation['kind'][] = ['create', 'delete', 'move', 'resize', 'split', 'merge']
      for (const kind of geometryKinds) {
        const op = { kind, entityId: 'x' } as unknown as EditingOperation
        expect(isGeometryOperation(op)).toBe(true)
      }
    })

    it('returns false for rename and assign', () => {
      expect(isGeometryOperation({ kind: 'rename', entityId: 'x', name: 'y' })).toBe(false)
      expect(isGeometryOperation({ kind: 'assign', entityId: 'x', property: 'p', value: 'v' })).toBe(false)
    })
  })

  describe('isMetadataOperation', () => {
    it('returns true for rename and assign', () => {
      expect(isMetadataOperation({ kind: 'rename', entityId: 'x', name: 'y' })).toBe(true)
      expect(isMetadataOperation({ kind: 'assign', entityId: 'x', property: 'p', value: 'v' })).toBe(true)
    })

    it('returns false for geometry kinds', () => {
      expect(isMetadataOperation({ kind: 'create', entityType: 'space', geometry: {} })).toBe(false)
      expect(isMetadataOperation({ kind: 'delete', entityIds: ['x'] })).toBe(false)
    })
  })
})
