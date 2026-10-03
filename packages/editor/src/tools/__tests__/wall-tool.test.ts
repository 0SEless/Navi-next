import { describe, it, expect, beforeEach, vi } from 'vitest'
import { WallTool } from '../wall-tool'
import type { ToolContext, ToolPointerEvent } from '../types'
import type { CommandDispatcher } from '../../commands/dispatcher'

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

function makeCtx(dispatcher?: { execute: ReturnType<typeof vi.fn> }): ToolContext {
  return {
    services: {
      dispatcher: (dispatcher ?? { execute: vi.fn() }) as unknown as CommandDispatcher,
    } as ToolContext['services'],
  }
}

describe('WallTool', () => {
  let tool: WallTool

  beforeEach(() => {
    tool = new WallTool()
  })

  it('has correct id and label', () => {
    expect(tool.id).toBe('wall')
    expect(tool.label).toBe('Wall')
  })

  it('starts in inactive state', () => {
    expect(tool.state.drawing).toBe(false)
    expect(tool.state.start).toBeNull()
    expect(tool.state.end).toBeNull()
  })

  describe('pointer flow', () => {
    it('begins drawing on pointer down', () => {
      const ctx = makeCtx()
      tool.onPointerDown(makeEvent({ x: 1, y: 2 }), ctx)

      expect(tool.state.drawing).toBe(true)
      expect(tool.state.start).toEqual({ x: 1, y: 2 })
      expect(tool.state.end).toEqual({ x: 1, y: 2 })
    })

    it('updates endpoint on pointer move while drawing', () => {
      const ctx = makeCtx()
      tool.onPointerDown(makeEvent({ x: 0, y: 0 }), ctx)
      tool.onPointerMove(makeEvent({ x: 5, y: 10 }), ctx)

      expect(tool.state.end).toEqual({ x: 5, y: 10 })
      expect(tool.state.start).toEqual({ x: 0, y: 0 })
    })

    it('keeps pointer move preview-only without dispatching a command', () => {
      const execute = vi.fn()
      const ctx = makeCtx({ execute })

      tool.onPointerDown(makeEvent({ x: 0, y: 0 }), ctx)
      tool.onPointerMove(makeEvent({ x: 5, y: 10 }), ctx)

      expect(execute).not.toHaveBeenCalled()
    })

    it('ignores pointer move when not drawing', () => {
      const ctx = makeCtx()
      tool.onPointerMove(makeEvent({ x: 5, y: 10 }), ctx)

      expect(tool.state.drawing).toBe(false)
      expect(tool.state.start).toBeNull()
      expect(tool.state.end).toBeNull()
    })

    it('dispatches wall.create on pointer up', () => {
      const execute = vi.fn()
      const ctx = makeCtx({ execute })

      tool.onPointerDown(makeEvent({ x: 1, y: 2 }), ctx)
      tool.onPointerMove(makeEvent({ x: 5, y: 8 }), ctx)
      tool.onPointerUp(makeEvent({ x: 5, y: 8 }), ctx)

      expect(execute).toHaveBeenCalledOnce()
      expect(execute).toHaveBeenCalledWith({
        id: 'wall.create',
        label: 'Create Wall',
        payload: {
          start: { x: 1, y: 2 },
          end: { x: 5, y: 8 },
          thickness: 0.15,
          height: 3.5,
          metadata: {},
        },
      })
    })

    it('resets state after pointer up', () => {
      const ctx = makeCtx()
      tool.onPointerDown(makeEvent({ x: 1, y: 2 }), ctx)
      tool.onPointerUp(makeEvent({ x: 5, y: 8 }), ctx)

      expect(tool.state.drawing).toBe(false)
      expect(tool.state.start).toBeNull()
      expect(tool.state.end).toBeNull()
    })

    it('does not dispatch if pointer up without pointer down', () => {
      const execute = vi.fn()
      const ctx = makeCtx({ execute })

      tool.onPointerUp(makeEvent({ x: 5, y: 8 }), ctx)

      expect(execute).not.toHaveBeenCalled()
    })
  })

  describe('cancel', () => {
    it('resets state on Escape key', () => {
      const ctx = makeCtx()
      tool.onPointerDown(makeEvent({ x: 1, y: 2 }), ctx)
      tool.onKeyDown({ key: 'Escape' } as KeyboardEvent, ctx)

      expect(tool.state.drawing).toBe(false)
      expect(tool.state.start).toBeNull()
      expect(tool.state.end).toBeNull()
    })

    it('does not dispatch on cancel', () => {
      const execute = vi.fn()
      const ctx = makeCtx({ execute })

      tool.onPointerDown(makeEvent({ x: 1, y: 2 }), ctx)
      tool.onKeyDown({ key: 'Escape' } as KeyboardEvent, ctx)

      expect(execute).not.toHaveBeenCalled()
    })
  })

  describe('activation lifecycle', () => {
    it('resets state on activate', () => {
      const ctx = makeCtx()
      tool.onPointerDown(makeEvent({ x: 1, y: 2 }), ctx)
      expect(tool.state.drawing).toBe(true)

      tool.onActivate(ctx)
      expect(tool.state.drawing).toBe(false)
    })

    it('resets state on deactivate', () => {
      const ctx = makeCtx()
      tool.onPointerDown(makeEvent({ x: 1, y: 2 }), ctx)
      expect(tool.state.drawing).toBe(true)

      tool.onDeactivate(ctx)
      expect(tool.state.drawing).toBe(false)
    })
  })

  describe('wall data contract', () => {
    it('dispatches wall with correct SPEC fields', () => {
      const execute = vi.fn()
      const ctx = makeCtx({ execute })

      tool.onPointerDown(makeEvent({ x: 0, y: 0 }), ctx)
      tool.onPointerUp(makeEvent({ x: 10, y: 5 }), ctx)

      const command = execute.mock.calls[0][0]
      const payload = command.payload

      expect(payload).toHaveProperty('start')
      expect(payload).toHaveProperty('end')
      expect(payload).toHaveProperty('thickness')
      expect(payload).toHaveProperty('height')
      expect(payload).toHaveProperty('metadata')

      expect(typeof payload.start.x).toBe('number')
      expect(typeof payload.start.y).toBe('number')
      expect(typeof payload.end.x).toBe('number')
      expect(typeof payload.end.y).toBe('number')
      expect(typeof payload.thickness).toBe('number')
      expect(typeof payload.height).toBe('number')
      expect(typeof payload.metadata).toBe('object')
    })

    it('uses default thickness 0.15', () => {
      const execute = vi.fn()
      const ctx = makeCtx({ execute })

      tool.onPointerDown(makeEvent({ x: 0, y: 0 }), ctx)
      tool.onPointerUp(makeEvent({ x: 1, y: 1 }), ctx)

      expect(execute.mock.calls[0][0].payload.thickness).toBe(0.15)
    })

    it('uses default height 3.5', () => {
      const execute = vi.fn()
      const ctx = makeCtx({ execute })

      tool.onPointerDown(makeEvent({ x: 0, y: 0 }), ctx)
      tool.onPointerUp(makeEvent({ x: 1, y: 1 }), ctx)

      expect(execute.mock.calls[0][0].payload.height).toBe(3.5)
    })
  })
})
