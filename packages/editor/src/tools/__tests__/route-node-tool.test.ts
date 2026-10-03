import { describe, it, expect, beforeEach, vi } from 'vitest'
import { RouteNodeTool } from '../route-node-tool'
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

describe('RouteNodeTool', () => {
  let tool: RouteNodeTool

  beforeEach(() => {
    tool = new RouteNodeTool()
  })

  it('has correct id and label', () => {
    expect(tool.id).toBe('route-node')
    expect(tool.label).toBe('Route Node')
  })

  it('starts in inactive state', () => {
    expect(tool.state.position).toBeNull()
  })

  describe('pointer flow', () => {
    it('adds route node on pointer down and dispatches', () => {
      const execute = vi.fn()
      const ctx = makeCtx({ execute })

      tool.onPointerDown(makeEvent({ x: 4, y: 6 }), ctx)

      expect(tool.state.position).toEqual({ x: 4, y: 6 })
      expect(execute).toHaveBeenCalledOnce()
      expect(execute).toHaveBeenCalledWith({
        id: 'route.node.create',
        label: 'Create Route Node',
        payload: {
          node: {
            type: 'waypoint',
            position: { x: 4, y: 6 },
          },
        },
      })
    })

    it('overwrites position on second click', () => {
      const execute = vi.fn()
      const ctx = makeCtx({ execute })

      tool.onPointerDown(makeEvent({ x: 1, y: 2 }), ctx)
      tool.onPointerDown(makeEvent({ x: 9, y: 3 }), ctx)

      expect(tool.state.position).toEqual({ x: 9, y: 3 })
      expect(execute).toHaveBeenCalledTimes(2)
    })
  })

  describe('cancel', () => {
    it('clears position on Escape', () => {
      const ctx = makeCtx()
      tool.onPointerDown(makeEvent({ x: 1, y: 2 }), ctx)
      expect(tool.state.position).toEqual({ x: 1, y: 2 })

      tool.onKeyDown({ key: 'Escape' } as KeyboardEvent, ctx)
      expect(tool.state.position).toBeNull()
    })
  })

  describe('activation lifecycle', () => {
    it('clears position on activate', () => {
      const ctx = makeCtx()
      tool.onPointerDown(makeEvent({ x: 1, y: 2 }), ctx)
      expect(tool.state.position).not.toBeNull()

      tool.onActivate(ctx)
      expect(tool.state.position).toBeNull()
    })

    it('clears position on deactivate', () => {
      const ctx = makeCtx()
      tool.onPointerDown(makeEvent({ x: 1, y: 2 }), ctx)
      expect(tool.state.position).not.toBeNull()

      tool.onDeactivate(ctx)
      expect(tool.state.position).toBeNull()
    })
  })

  describe('route node data contract', () => {
    it('dispatches with correct SPEC fields', () => {
      const execute = vi.fn()
      const ctx = makeCtx({ execute })

      tool.onPointerDown(makeEvent({ x: 0, y: 0 }), ctx)

      const command = execute.mock.calls[0][0]
      const payload = command.payload

      expect(payload).toHaveProperty('node')
      expect(typeof payload.node.type).toBe('string')
      expect(typeof payload.node.position.x).toBe('number')
      expect(typeof payload.node.position.y).toBe('number')
    })

    it('uses default type waypoint', () => {
      const execute = vi.fn()
      const ctx = makeCtx({ execute })

      tool.onPointerDown(makeEvent({ x: 0, y: 0 }), ctx)

      expect(execute.mock.calls[0][0].payload.node.type).toBe('waypoint')
    })
  })
})
