export { EditingState } from './state/EditingState'
export { createStateMachine } from './state/transitions'
export type { TransitionEvent, StateSnapshot, EditingStateMachine } from './state/transitions'

export { createSelectionModel } from './selection/SelectionModel'
export type { SelectionModel } from './selection/SelectionModel'

export { createDirtyTracker } from './lifecycle/DirtyTracker'
export type { DirtyTracker, DirtyFlags } from './lifecycle/DirtyTracker'

export { createEditingSession } from './lifecycle/EditingSession'
export type { EditingSession, EditingSessionConfig, CommitResult } from './lifecycle/EditingSession'

export { createValidationPipeline } from './validation/ValidationPipeline'
export type { ValidationPipeline, ValidationResult, ValidationIssue, ValidatorFn } from './validation/ValidationPipeline'
export { ValidationLevel } from './validation/ValidationPipeline'

export type {
  EditingOperation,
  CreateOperation,
  DeleteOperation,
  MoveOperation,
  ResizeOperation,
  SplitOperation,
  MergeOperation,
  RenameOperation,
  AssignOperation,
} from './operations/EditingOperations'
export { isGeometryOperation, isMetadataOperation } from './operations/EditingOperations'
