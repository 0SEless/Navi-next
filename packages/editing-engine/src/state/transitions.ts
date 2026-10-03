import { EditingState } from './EditingState'

export type TransitionEvent =
  | { kind: 'activateTool'; toolType: 'drawing' | 'select' | 'instant' }
  | { kind: 'deactivateTool' }
  | { kind: 'startDrag' }
  | { kind: 'endDrag' }
  | { kind: 'doubleClick' }
  | { kind: 'confirm' }
  | { kind: 'cancel' }
  | { kind: 'escape' }
  | { kind: 'spaceDown' }
  | { kind: 'spaceUp' }
  | { kind: 'clickEmptySpace' }

export interface StateSnapshot {
  current: EditingState
  previous: EditingState | null
}

const INITIAL: StateSnapshot = { current: EditingState.Idle, previous: null }

function transition(state: EditingState, event: TransitionEvent): EditingState {
  switch (state) {
    case EditingState.Idle:
      switch (event.kind) {
        case 'activateTool':
          if (event.toolType === 'select') return EditingState.Selecting
          if (event.toolType === 'drawing') return EditingState.Drawing
          return EditingState.Idle
        case 'spaceDown':
          return EditingState.Panning
        default:
          return EditingState.Idle
      }

    case EditingState.Drawing:
      switch (event.kind) {
        case 'confirm':
        case 'cancel':
        case 'escape':
        case 'deactivateTool':
          return EditingState.Idle
        case 'spaceDown':
          return EditingState.Panning
        default:
          return EditingState.Drawing
      }

    case EditingState.Selecting:
      switch (event.kind) {
        case 'startDrag':
          return EditingState.Moving
        case 'doubleClick':
          return EditingState.VertexEditing
        case 'escape':
        case 'clickEmptySpace':
        case 'deactivateTool':
          return EditingState.Idle
        case 'spaceDown':
          return EditingState.Panning
        default:
          return EditingState.Selecting
      }

    case EditingState.Moving:
      switch (event.kind) {
        case 'endDrag':
        case 'escape':
          return EditingState.Idle
        case 'spaceDown':
          return EditingState.Panning
        default:
          return EditingState.Moving
      }

    case EditingState.VertexEditing:
      switch (event.kind) {
        case 'confirm':
        case 'escape':
        case 'deactivateTool':
          return EditingState.Idle
        case 'spaceDown':
          return EditingState.Panning
        default:
          return EditingState.VertexEditing
      }

    case EditingState.Panning:
      if (event.kind === 'spaceUp') return state // resolved by machine with previous
      return EditingState.Panning
  }
}

export function createStateMachine() {
  let snapshot: StateSnapshot = { ...INITIAL }

  return {
    get current(): EditingState {
      return snapshot.current
    },

    get previous(): EditingState | null {
      return snapshot.previous
    },

    get snapshot(): StateSnapshot {
      return { ...snapshot }
    },

    send(event: TransitionEvent): void {
      const next = transition(snapshot.current, event)

      if (event.kind === 'spaceDown' && next === EditingState.Panning) {
        snapshot = { current: next, previous: snapshot.current }
      } else if (event.kind === 'spaceUp') {
        const prev = snapshot.previous ?? EditingState.Idle
        snapshot = { current: prev, previous: null }
      } else {
        snapshot = { current: next, previous: null }
      }
    },

    reset(): void {
      snapshot = { ...INITIAL }
    },
  }
}

export type EditingStateMachine = ReturnType<typeof createStateMachine>
