import { describe, it, expect } from 'vitest'
import { createStateMachine, type TransitionEvent } from './transitions'
import { EditingState } from './EditingState'

function machine() {
  return createStateMachine()
}

function send(m: ReturnType<typeof createStateMachine>, events: TransitionEvent[]) {
  for (const e of events) m.send(e)
}

describe('EditingStateMachine', () => {
  it('starts in Idle', () => {
    const m = machine()
    expect(m.current).toBe(EditingState.Idle)
    expect(m.previous).toBeNull()
  })

  it('transitions to Drawing on activateTool drawing', () => {
    const m = machine()
    m.send({ kind: 'activateTool', toolType: 'drawing' })
    expect(m.current).toBe(EditingState.Drawing)
  })

  it('transitions to Selecting on activateTool select', () => {
    const m = machine()
    m.send({ kind: 'activateTool', toolType: 'select' })
    expect(m.current).toBe(EditingState.Selecting)
  })

  it('stays in Idle on activateTool instant', () => {
    const m = machine()
    m.send({ kind: 'activateTool', toolType: 'instant' })
    expect(m.current).toBe(EditingState.Idle)
  })

  describe('Panning', () => {
    it('enters Panning from Idle on spaceDown', () => {
      const m = machine()
      m.send({ kind: 'spaceDown' })
      expect(m.current).toBe(EditingState.Panning)
      expect(m.previous).toBe(EditingState.Idle)
    })

    it('enters Panning from Drawing on spaceDown', () => {
      const m = machine()
      send(m, [
        { kind: 'activateTool', toolType: 'drawing' },
        { kind: 'spaceDown' },
      ])
      expect(m.current).toBe(EditingState.Panning)
      expect(m.previous).toBe(EditingState.Drawing)
    })

    it('returns to Idle on spaceUp when previous was Idle', () => {
      const m = machine()
      send(m, [
        { kind: 'spaceDown' },
        { kind: 'spaceUp' },
      ])
      expect(m.current).toBe(EditingState.Idle)
      expect(m.previous).toBeNull()
    })

    it('returns to Drawing on spaceUp when previous was Drawing', () => {
      const m = machine()
      send(m, [
        { kind: 'activateTool', toolType: 'drawing' },
        { kind: 'spaceDown' },
        { kind: 'spaceUp' },
      ])
      expect(m.current).toBe(EditingState.Drawing)
      expect(m.previous).toBeNull()
    })

    it('returns to Selecting on spaceUp when previous was Selecting', () => {
      const m = machine()
      send(m, [
        { kind: 'activateTool', toolType: 'select' },
        { kind: 'spaceDown' },
        { kind: 'spaceUp' },
      ])
      expect(m.current).toBe(EditingState.Selecting)
    })

    it('returns to Moving on spaceUp when previous was Moving', () => {
      const m = machine()
      send(m, [
        { kind: 'activateTool', toolType: 'select' },
        { kind: 'startDrag' },
        { kind: 'spaceDown' },
        { kind: 'spaceUp' },
      ])
      expect(m.current).toBe(EditingState.Moving)
    })

    it('returns to VertexEditing on spaceUp when previous was VertexEditing', () => {
      const m = machine()
      send(m, [
        { kind: 'activateTool', toolType: 'select' },
        { kind: 'doubleClick' },
        { kind: 'spaceDown' },
        { kind: 'spaceUp' },
      ])
      expect(m.current).toBe(EditingState.VertexEditing)
    })

    it('defaults to Idle on spaceUp if previous is null (edge case)', () => {
      const m = machine()
      send(m, [
        { kind: 'spaceDown' },
        { kind: 'spaceUp' },
      ])
      expect(m.current).toBe(EditingState.Idle)
    })
  })

  describe('Drawing transitions', () => {
    it('returns to Idle on confirm', () => {
      const m = machine()
      send(m, [
        { kind: 'activateTool', toolType: 'drawing' },
        { kind: 'confirm' },
      ])
      expect(m.current).toBe(EditingState.Idle)
    })

    it('returns to Idle on cancel', () => {
      const m = machine()
      send(m, [
        { kind: 'activateTool', toolType: 'drawing' },
        { kind: 'cancel' },
      ])
      expect(m.current).toBe(EditingState.Idle)
    })

    it('returns to Idle on escape', () => {
      const m = machine()
      send(m, [
        { kind: 'activateTool', toolType: 'drawing' },
        { kind: 'escape' },
      ])
      expect(m.current).toBe(EditingState.Idle)
    })

    it('returns to Idle on deactivateTool', () => {
      const m = machine()
      send(m, [
        { kind: 'activateTool', toolType: 'drawing' },
        { kind: 'deactivateTool' },
      ])
      expect(m.current).toBe(EditingState.Idle)
    })

    it('ignores startDrag during Drawing', () => {
      const m = machine()
      send(m, [
        { kind: 'activateTool', toolType: 'drawing' },
        { kind: 'startDrag' },
      ])
      expect(m.current).toBe(EditingState.Drawing)
    })
  })

  describe('Selecting transitions', () => {
    it('transitions to Moving on startDrag', () => {
      const m = machine()
      send(m, [
        { kind: 'activateTool', toolType: 'select' },
        { kind: 'startDrag' },
      ])
      expect(m.current).toBe(EditingState.Moving)
    })

    it('transitions to VertexEditing on doubleClick', () => {
      const m = machine()
      send(m, [
        { kind: 'activateTool', toolType: 'select' },
        { kind: 'doubleClick' },
      ])
      expect(m.current).toBe(EditingState.VertexEditing)
    })

    it('returns to Idle on clickEmptySpace', () => {
      const m = machine()
      send(m, [
        { kind: 'activateTool', toolType: 'select' },
        { kind: 'clickEmptySpace' },
      ])
      expect(m.current).toBe(EditingState.Idle)
    })

    it('returns to Idle on escape', () => {
      const m = machine()
      send(m, [
        { kind: 'activateTool', toolType: 'select' },
        { kind: 'escape' },
      ])
      expect(m.current).toBe(EditingState.Idle)
    })
  })

  describe('Moving transitions', () => {
    it('returns to Idle on endDrag', () => {
      const m = machine()
      send(m, [
        { kind: 'activateTool', toolType: 'select' },
        { kind: 'startDrag' },
        { kind: 'endDrag' },
      ])
      expect(m.current).toBe(EditingState.Idle)
    })

    it('returns to Idle on escape', () => {
      const m = machine()
      send(m, [
        { kind: 'activateTool', toolType: 'select' },
        { kind: 'startDrag' },
        { kind: 'escape' },
      ])
      expect(m.current).toBe(EditingState.Idle)
    })

    it('ignores doubleClick during Moving', () => {
      const m = machine()
      send(m, [
        { kind: 'activateTool', toolType: 'select' },
        { kind: 'startDrag' },
        { kind: 'doubleClick' },
      ])
      expect(m.current).toBe(EditingState.Moving)
    })
  })

  describe('VertexEditing transitions', () => {
    it('returns to Idle on confirm', () => {
      const m = machine()
      send(m, [
        { kind: 'activateTool', toolType: 'select' },
        { kind: 'doubleClick' },
        { kind: 'confirm' },
      ])
      expect(m.current).toBe(EditingState.Idle)
    })

    it('returns to Idle on escape', () => {
      const m = machine()
      send(m, [
        { kind: 'activateTool', toolType: 'select' },
        { kind: 'doubleClick' },
        { kind: 'escape' },
      ])
      expect(m.current).toBe(EditingState.Idle)
    })

    it('returns to Idle on deactivateTool (tool switch)', () => {
      const m = machine()
      send(m, [
        { kind: 'activateTool', toolType: 'select' },
        { kind: 'doubleClick' },
        { kind: 'deactivateTool' },
      ])
      expect(m.current).toBe(EditingState.Idle)
    })
  })

  describe('Invariants', () => {
    it('exactly one state at all times — visits all 6 states', () => {
      const m = machine()
      const visited = new Set<EditingState>()
      visited.add(m.current)

      const events: TransitionEvent[] = [
        { kind: 'activateTool', toolType: 'select' },   // → Selecting
        { kind: 'startDrag' },                            // → Moving
        { kind: 'endDrag' },                              // → Idle
        { kind: 'activateTool', toolType: 'drawing' },   // → Drawing
        { kind: 'spaceDown' },                            // → Panning
        { kind: 'spaceUp' },                              // → Drawing
        { kind: 'confirm' },                              // → Idle
        { kind: 'activateTool', toolType: 'select' },   // → Selecting
        { kind: 'doubleClick' },                          // → VertexEditing
        { kind: 'escape' },                               // → Idle
      ]

      for (const e of events) {
        m.send(e)
        visited.add(m.current)
      }

      expect(visited.size).toBe(6)
    })

    it('spaceDown from any state enters Panning', () => {
      const sources = [EditingState.Idle, EditingState.Drawing, EditingState.Selecting]
      for (const s of sources) {
        const m = machine()
        m.send({ kind: 'activateTool', toolType: s === EditingState.Idle ? 'instant' : s === EditingState.Drawing ? 'drawing' : 'select' })
        m.send({ kind: 'spaceDown' })
        expect(m.current).toBe(EditingState.Panning)
      }
    })

    it('reset returns to Idle', () => {
      const m = machine()
      send(m, [
        { kind: 'activateTool', toolType: 'drawing' },
        { kind: 'confirm' },
      ])
      m.reset()
      expect(m.current).toBe(EditingState.Idle)
      expect(m.previous).toBeNull()
    })

    it('cannot be in Drawing and Moving simultaneously', () => {
      const m = machine()
      m.send({ kind: 'activateTool', toolType: 'drawing' })
      expect(m.current).toBe(EditingState.Drawing)
      // startDrag is ignored during Drawing
      m.send({ kind: 'startDrag' })
      expect(m.current).toBe(EditingState.Drawing)
    })

    it('cannot be in VertexEditing and Moving simultaneously', () => {
      const m = machine()
      send(m, [
        { kind: 'activateTool', toolType: 'select' },
        { kind: 'doubleClick' }, // → VertexEditing
      ])
      expect(m.current).toBe(EditingState.VertexEditing)
      // startDrag is ignored during VertexEditing
      m.send({ kind: 'startDrag' })
      expect(m.current).toBe(EditingState.VertexEditing)
    })
  })
})
