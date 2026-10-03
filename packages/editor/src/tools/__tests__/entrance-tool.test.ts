import { describe, it, expect, beforeEach, vi } from 'vitest'
import { EntranceTool } from '../entrance-tool'
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

function makeCtx(opts?: { execute?: ReturnType<typeof vi.fn>; viewport?: { activeBuildingId: string | null; activeFloorId: string | null } }): ToolContext {
  return {
    services: {
      dispatcher: (opts?.execute ? { execute: opts.execute } : { execute: vi.fn() }) as unknown as CommandDispatcher,
      viewport: opts?.viewport ?? { activeBuildingId: 'bld-1', activeFloorId: 'flr-1' },
    } as unknown as ToolContext['services'],
  }
}

describe('EntranceTool', () => {
  let tool: EntranceTool

  beforeEach(() => {
    tool = new EntranceTool()
  })

  it('has correct id and label', () => {
    expect(tool.id).toBe('entrance')
    expect(tool.label).toBe('Entrance')
  })

  it('starts in inactive state', () => {
    expect(tool.state.position).toBeNull()
  })

  describe('pointer flow', () => {
    it('places entrance on pointer down and dispatches', () => {
      const execute = vi.fn()
      const ctx = makeCtx({ execute })

      tool.onPointerDown(makeEvent({ x: 3, y: 7 }), ctx)

      expect(tool.state.position).toEqual({ x: 3, y: 7 })
      expect(execute).toHaveBeenCalledOnce()
      expect(execute).toHaveBeenCalledWith({
        id: 'entrance.create',
        label: 'Create Entrance',
        payload: {
          buildingId: 'bld-1',
          floorId: 'flr-1',
          position: { x: 3, y: 7 },
          type: 'side',
          hasQR: true,
          metadata: {},
        },
      })
    })

    it('does not dispatch when viewport has no building/floor', () => {
      const execute = vi.fn()
      const ctx = makeCtx({
        execute,
        viewport: { activeBuildingId: null, activeFloorId: null },
      })

      tool.onPointerDown(makeEvent({ x: 3, y: 7 }), ctx)

      expect(execute).not.toHaveBeenCalled()
    })

    it('overwrites previous position on second click', () => {
      const execute = vi.fn()
      const ctx = makeCtx({ execute })

      tool.onPointerDown(makeEvent({ x: 1, y: 2 }), ctx)
      tool.onPointerDown(makeEvent({ x: 5, y: 8 }), ctx)

      expect(tool.state.position).toEqual({ x: 5, y: 8 })
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

  describe('entrance data contract', () => {
    it('dispatches entrance with correct SPEC fields', () => {
      const execute = vi.fn()
      const ctx = makeCtx({ execute })

      tool.onPointerDown(makeEvent({ x: 0, y: 0 }), ctx)

      const command = execute.mock.calls[0][0]
      const payload = command.payload

      expect(payload).toHaveProperty('position')
      expect(payload).toHaveProperty('type')
      expect(payload).toHaveProperty('metadata')
      expect(payload).toHaveProperty('buildingId')
      expect(payload).toHaveProperty('floorId')

      expect(typeof payload.position.x).toBe('number')
      expect(typeof payload.position.y).toBe('number')
      expect(typeof payload.type).toBe('string')
      expect(typeof payload.metadata).toBe('object')
      expect(typeof payload.buildingId).toBe('string')
      expect(typeof payload.floorId).toBe('string')
    })

    it('uses default type side', () => {
      const execute = vi.fn()
      const ctx = makeCtx({ execute })

      tool.onPointerDown(makeEvent({ x: 0, y: 0 }), ctx)

      expect(execute.mock.calls[0][0].payload.type).toBe('side')
    })

    it('uses default hasQR true', () => {
      const execute = vi.fn()
      const ctx = makeCtx({ execute })

      tool.onPointerDown(makeEvent({ x: 0, y: 0 }), ctx)

      expect(execute.mock.calls[0][0].payload.hasQR).toBe(true)
    })
  })
})
