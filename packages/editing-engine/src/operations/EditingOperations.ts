export interface CreateOperation {
  kind: 'create'
  entityType: 'building' | 'road' | 'space' | 'hallway' | 'entrance' | 'stair' | 'elevator'
  /** Polygon vertices for space/hallway; position for point entities */
  geometry: unknown
  properties?: Record<string, unknown>
}

export interface DeleteOperation {
  kind: 'delete'
  entityIds: string[]
}

export interface MoveOperation {
  kind: 'move'
  entityId: string
  deltaX: number
  deltaY: number
}

export interface ResizeOperation {
  kind: 'resize'
  entityId: string
  vertexIndex: number
  newX: number
  newY: number
}

export interface SplitOperation {
  kind: 'split'
  entityId: string
  /** Line along which to split the polygon */
  splitLine: { x1: number; y1: number; x2: number; y2: number }
}

export interface MergeOperation {
  kind: 'merge'
  entityIds: [string, string, ...string[]]
}

export interface RenameOperation {
  kind: 'rename'
  entityId: string
  name: string
}

export interface AssignOperation {
  kind: 'assign'
  entityId: string
  property: string
  value: unknown
}

export interface ModifyGeometryOperation {
  kind: 'modifyGeometry'
  entityId: string
  geometry: Record<string, unknown>
}

export type EditingOperation =
  | CreateOperation
  | DeleteOperation
  | MoveOperation
  | ResizeOperation
  | SplitOperation
  | MergeOperation
  | RenameOperation
  | AssignOperation
  | ModifyGeometryOperation

export type GeometryOperation = Extract<EditingOperation, { kind: 'create' | 'delete' | 'move' | 'resize' | 'split' | 'merge' | 'modifyGeometry' }>
export type MetadataOperation = Extract<EditingOperation, { kind: 'rename' | 'assign' }>

export function isGeometryOperation(op: EditingOperation): op is GeometryOperation {
  return ['create', 'delete', 'move', 'resize', 'split', 'merge', 'modifyGeometry'].includes(op.kind)
}

export function isMetadataOperation(op: EditingOperation): op is MetadataOperation {
  return ['rename', 'assign'].includes(op.kind)
}
