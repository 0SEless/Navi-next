import { createStateMachine, type EditingStateMachine } from '../state/transitions'
import { EditingState } from '../state/EditingState'
import { createSelectionModel, type SelectionModel } from '../selection/SelectionModel'
import { createDirtyTracker, type DirtyTracker } from './DirtyTracker'
import { createValidationPipeline, type ValidationPipeline, type ValidationResult } from '../validation/ValidationPipeline'
import type { EditingOperation } from '../operations/EditingOperations'
import { isGeometryOperation } from '../operations/EditingOperations'

export interface EditingSessionConfig {
  stateMachine?: EditingStateMachine
  selection?: SelectionModel
  dirtyTracker?: DirtyTracker
  validation?: ValidationPipeline
}

export interface CommitResult {
  committed: boolean
  operation: EditingOperation
  validationResult: ValidationResult
}

export function createEditingSession(config: EditingSessionConfig = {}) {
  const stateMachine = config.stateMachine ?? createStateMachine()
  const selection = config.selection ?? createSelectionModel()
  const dirtyTracker = config.dirtyTracker ?? createDirtyTracker()
  const validation = config.validation ?? createValidationPipeline()

  let currentOperation: EditingOperation | null = null
  let previewData: unknown = null
  let version = 0
  const listeners = new Set<() => void>()

  function notify() {
    version++
    listeners.forEach((l) => l())
  }

  function operationToToolType(op: EditingOperation): 'drawing' | 'select' | 'instant' {
    switch (op.kind) {
      case 'create':
        return 'drawing'
      default:
        return 'instant'
    }
  }

  return {
    get stateMachine() { return stateMachine },
    get selection() { return selection },
    get dirtyTracker() { return dirtyTracker },
    get validation() { return validation },

    get currentOperation(): EditingOperation | null {
      return currentOperation
    },

    get previewData(): unknown {
      return previewData
    },

    get state(): EditingState {
      return stateMachine.current
    },

    get version(): number {
      return version
    },

    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },

    begin(operation: EditingOperation): void {
      currentOperation = operation
      const toolType = operationToToolType(operation)
      stateMachine.send({ kind: 'activateTool', toolType })
      notify()
    },

    preview(data: unknown): void {
      previewData = data
      notify()
    },

    validate(): ValidationResult {
      const op = currentOperation
      if (!op) {
        return { level: 'editing' as any, issues: [], get passed() { return true } }
      }
      return validation.runEditing(op)
    },

    commit(): CommitResult {
      const op = currentOperation
      if (!op) {
        return {
          committed: false,
          operation: null as unknown as EditingOperation,
          validationResult: { level: 'editing' as any, issues: [], get passed() { return true } },
        }
      }

      const validationResult = validation.runEditing(op)
      if (!validationResult.passed) {
        return { committed: false, operation: op, validationResult }
      }

      if (isGeometryOperation(op)) {
        dirtyTracker.markGeometryDirty()
      } else {
        dirtyTracker.markMetadataDirty()
      }

      stateMachine.send({ kind: 'confirm' })
      currentOperation = null
      previewData = null
      notify()

      return { committed: true, operation: op, validationResult }
    },

    execute(operation: EditingOperation): CommitResult {
      this.begin(operation)
      return this.commit()
    },

    cancel(): void {
      stateMachine.send({ kind: 'cancel' })
      currentOperation = null
      previewData = null
      notify()
    },

    clickEmptySpace(): void {
      stateMachine.send({ kind: 'clickEmptySpace' })
      selection.clear()
      notify()
    },

    escape(): void {
      if (currentOperation) {
        this.cancel()
      } else if (!selection.isEmpty) {
        selection.clear()
        notify()
      }
    },

    reset(): void {
      stateMachine.reset()
      selection.reset()
      dirtyTracker.clearAll()
      currentOperation = null
      previewData = null
      notify()
    },
  }
}

export type EditingSession = ReturnType<typeof createEditingSession>
