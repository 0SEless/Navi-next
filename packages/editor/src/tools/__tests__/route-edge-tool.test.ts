import { describe, it, expect, beforeEach, vi } from 'vitest'
import { RouteEdgeTool } from '../route-edge-tool'
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

describe('RouteEdgeTool', () => {
  let tool: RouteEdgeTool

  beforeEach(() => {
    tool = new RouteEdgeTool()
  })

  it('has correct id and label', () => {
    expect(tool.id).toBe('route-edge')
    expect(tool.label).toBe('Route Edge')
  })

  it('starts in inactive state', () => {
    expect(tool.state.firstNodeId).toBeNull()
  })

  describe('two-click flow', () => {
    it('records first node on first click', () => {
      const execute = vi.fn()
      const ctx = makeCtx({ execute })

      tool.onPointerDown(makeEvent({ x: 10, y: 20 }), ctx)

      expect(tool.state.firstNodeId).toBe('10')
      expect(execute).not.toHaveBeenCalled()
    })

    it('dispatches edge on second click', () => {
      const execute = vi.fn()
      const ctx = makeCtx({ execute })

      tool.onPointerDown(makeEvent({ x: 10, y: 20 }), ctx)
      tool.onPointerDown(makeEvent({ x: 30, y: 40 }), ctx)

      expect(execute).toHaveBeenCalledOnce()
      expect(execute).toHaveBeenCalledWith({
        id: 'route.edge.create',
        label: 'Create Route Edge',
        payload: {
          edge: {
            from: '10',
            to: '30',
            type: 'walk',
          },
        },
      })
    })

    it('resets after second click', () => {
      const ctx = makeCtx()
      tool.onPointerDown(makeEvent({ x: 10, y: 20 }), ctx)
      tool.onPointerDown(makeEvent({ x: 30, y: 40 }), ctx)

      expect(tool.state.firstNodeId).toBeNull()
    })

    it('can create multiple edges in sequence', () => {
      const execute = vi.fn()
      const ctx = makeCtx({ execute })

      tool.onPointerDown(makeEvent({ x: 1, y: 2 }), ctx)
      tool.onPointerDown(makeEvent({ x: 3, y: 4 }), ctx)
      tool.onPointerDown(makeEvent({ x: 5, y: 6 }), ctx)
      tool.onPointerDown(makeEvent({ x: 7, y: 8 }), ctx)

      expect(execute).toHaveBeenCalledTimes(2)
    })
  })

  describe('cancel', () => {
    it('clears first node on Escape after first click', () => {
      const ctx = makeCtx()
      tool.onPointerDown(makeEvent({ x: 10, y: 20 }), ctx)
      expect(tool.state.firstNodeId).toBe('10')

      tool.onKeyDown({ key: 'Escape' } as KeyboardEvent, ctx)
      expect(tool.state.firstNodeId).toBeNull()
    })

    it('does not dispatch on cancel', () => {
      const execute = vi.fn()
      const ctx = makeCtx({ execute })

      tool.onPointerDown(makeEvent({ x: 10, y: 20 }), ctx)
      tool.onKeyDown({ key: 'Escape' } as KeyboardEvent, ctx)

      expect(execute).not.toHaveBeenCalled()
    })
  })

  describe('activation lifecycle', () => {
    it('clears first node on activate', () => {
      const ctx = makeCtx()
      tool.onPointerDown(makeEvent({ x: 10, y: 20 }), ctx)
      expect(tool.state.firstNodeId).not.toBeNull()

      tool.onActivate(ctx)
      expect(tool.state.firstNodeId).toBeNull()
    })

    it('clears first node on deactivate', () => {
      const ctx = makeCtx()
      tool.onPointerDown(makeEvent({ x: 10, y: 20 }), ctx)
      expect(tool.state.firstNodeId).not.toBeNull()

      tool.onDeactivate(ctx)
      expect(tool.state.firstNodeId).toBeNull()
    })
  })

  describe('route edge data contract', () => {
    it('dispatches with correct SPEC fields', () => {
      const execute = vi.fn()
      const ctx = makeCtx({ execute })

      tool.onPointerDown(makeEvent({ x: 10 }), ctx)
      tool.onPointerDown(makeEvent({ x: 30 }), ctx)

      const command = execute.mock.calls[0][0]
      const payload = command.payload

      expect(payload).toHaveProperty('edge')
      expect(typeof payload.edge.from).toBe('string')
      expect(typeof payload.edge.to).toBe('string')
      expect(typeof payload.edge.type).toBe('string')
    })

    it('uses default type walk', () => {
      const execute = vi.fn()
      const ctx = makeCtx({ execute })

      tool.onPointerDown(makeEvent({ x: 10 }), ctx)
      tool.onPointerDown(makeEvent({ x: 30 }), ctx)

      expect(execute.mock.calls[0][0].payload.edge.type).toBe('walk')
    })
  })
})
