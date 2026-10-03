import { describe, it, expect, beforeEach, vi } from 'vitest'
import { MeasureTool } from '../measure-tool'
import type { ToolContext, ToolPointerEvent } from '../types'
import type { CommandDispatcher } from '../../commands/dispatcher'
import type { SelectionManager } from '../../selection'

function makeEvent(overrides: Partial<ToolPointerEvent> = {}): ToolPointerEvent {
  return {
    x: 0,
    y: 0,
    lng: 0,
    lat: 0,
    button: 0,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    ...overrides,
  }
}

function makeCtx(overrides: Partial<{ dispatcher: { execute: ReturnType<typeof vi.fn> }; selection: { select: ReturnType<typeof vi.fn>; clear: ReturnType<typeof vi.fn> } }> = {}): ToolContext {
  return {
    services: {
      dispatcher: (overrides.dispatcher ?? { execute: vi.fn() }) as unknown as CommandDispatcher,
      selection: (overrides.selection ?? { select: vi.fn(), clear: vi.fn() }) as unknown as SelectionManager,
    } as ToolContext['services'],
  }
}

describe('MeasureTool', () => {
  let tool: MeasureTool

  beforeEach(() => {
    tool = new MeasureTool()
  })

  it('has correct id and label', () => {
    expect(tool.id).toBe('measure')
    expect(tool.label).toBe('Measure')
  })

  it('has crosshair cursor', () => {
    expect(tool.cursor).toBe('crosshair')
  })

  it('starts in inactive state', () => {
    expect(tool.state.measuring).toBe(false)
    expect(tool.state.start).toBeNull()
    expect(tool.state.end).toBeNull()
    expect(tool.state.distance).toBeNull()
  })

  describe('measurement flow', () => {
    it('begins measuring on pointer down', () => {
      const ctx = makeCtx()
      tool.onPointerDown(makeEvent({ x: 0, y: 0 }), ctx)

      expect(tool.state.measuring).toBe(true)
      expect(tool.state.start).toEqual({ x: 0, y: 0 })
      expect(tool.state.end).toEqual({ x: 0, y: 0 })
      expect(tool.state.distance).toBe(0)
    })

    it('updates distance on pointer move while measuring', () => {
      const ctx = makeCtx()
      tool.onPointerDown(makeEvent({ x: 0, y: 0 }), ctx)
      tool.onPointerMove(makeEvent({ x: 3, y: 4 }), ctx)

      expect(tool.state.end).toEqual({ x: 3, y: 4 })
      expect(tool.state.distance).toBe(5)
    })

    it('does not measure when not measuring', () => {
      const ctx = makeCtx()
      tool.onPointerMove(makeEvent({ x: 3, y: 4 }), ctx)

      expect(tool.state.measuring).toBe(false)
      expect(tool.state.start).toBeNull()
      expect(tool.state.end).toBeNull()
      expect(tool.state.distance).toBeNull()
    })

    it('finalizes measurement on pointer up', () => {
      const ctx = makeCtx()
      tool.onPointerDown(makeEvent({ x: 0, y: 0 }), ctx)
      tool.onPointerUp(makeEvent({ x: 3, y: 4 }), ctx)

      expect(tool.state.measuring).toBe(true)
      expect(tool.state.distance).toBe(5)
    })

    it('calculates euclidean distance correctly', () => {
      const ctx = makeCtx()
      tool.onPointerDown(makeEvent({ x: 1, y: 2 }), ctx)
      tool.onPointerMove(makeEvent({ x: 4, y: 6 }), ctx)

      expect(tool.state.distance).toBe(5)
    })

    it('handles zero distance', () => {
      const ctx = makeCtx()
      tool.onPointerDown(makeEvent({ x: 5, y: 5 }), ctx)
      tool.onPointerMove(makeEvent({ x: 5, y: 5 }), ctx)

      expect(tool.state.distance).toBe(0)
    })
  })

  describe('cancel', () => {
    it('resets state on Escape key', () => {
      const ctx = makeCtx()
      tool.onPointerDown(makeEvent({ x: 0, y: 0 }), ctx)
      tool.onPointerMove(makeEvent({ x: 3, y: 4 }), ctx)
      expect(tool.state.measuring).toBe(true)

      tool.onKeyDown({ key: 'Escape' } as KeyboardEvent, ctx)
      expect(tool.state.measuring).toBe(false)
      expect(tool.state.start).toBeNull()
      expect(tool.state.end).toBeNull()
      expect(tool.state.distance).toBeNull()
    })
  })

  describe('activation lifecycle', () => {
    it('resets state on activate', () => {
      const ctx = makeCtx()
      tool.onPointerDown(makeEvent({ x: 0, y: 0 }), ctx)
      expect(tool.state.measuring).toBe(true)

      tool.onActivate(ctx)
      expect(tool.state.measuring).toBe(false)
    })

    it('resets state on deactivate', () => {
      const ctx = makeCtx()
      tool.onPointerDown(makeEvent({ x: 0, y: 0 }), ctx)
      expect(tool.state.measuring).toBe(true)

      tool.onDeactivate(ctx)
      expect(tool.state.measuring).toBe(false)
    })
  })

  describe('state snapshot', () => {
    it('returns copies of position objects', () => {
      const ctx = makeCtx()
      tool.onPointerDown(makeEvent({ x: 1, y: 2 }), ctx)

      const s1 = tool.state
      const s2 = tool.state
      expect(s1.start).toEqual(s2.start)
      expect(s1.start).not.toBe(s2.start)
    })
  })
})
