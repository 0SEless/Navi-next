import { describe, it, expect, beforeEach, vi } from 'vitest'
import { SelectTool } from '../select-tool'
import type { ToolContext, ToolPointerEvent } from '../types'
import type { SelectionManager } from '../../selection'
import type { CommandDispatcher } from '../../commands/dispatcher'
import { SelectionOrigin } from '../../context/entity-id'
import { asEntityId } from '../../context/entity-id'

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

describe('SelectTool', () => {
  let tool: SelectTool

  beforeEach(() => {
    tool = new SelectTool()
  })

  it('has correct id and label', () => {
    expect(tool.id).toBe('select')
    expect(tool.label).toBe('Select')
  })

  it('has default cursor', () => {
    expect(tool.cursor).toBe('default')
  })

  it('starts in inactive state', () => {
    expect(tool.state.selectTarget).toBeNull()
  })

  describe('pointer flow', () => {
    it('clears selection on pointer down', () => {
      const clear = vi.fn()
      const ctx = makeCtx({ selection: { clear, select: vi.fn() } })

      tool.onPointerDown(makeEvent({ x: 5, y: 10 }), ctx)

      expect(clear).toHaveBeenCalledOnce()
      expect(clear).toHaveBeenCalledWith(SelectionOrigin.Canvas)
    })

    it('does not dispatch commands on pointer down', () => {
      const execute = vi.fn()
      const ctx = makeCtx({ dispatcher: { execute }, selection: { clear: vi.fn(), select: vi.fn() } })

      tool.onPointerDown(makeEvent({ x: 5, y: 10 }), ctx)

      expect(execute).not.toHaveBeenCalled()
    })
  })

  describe('entity selection', () => {
    it('selects an entity via selectEntity', () => {
      const select = vi.fn()
      const ctx = makeCtx({ selection: { select, clear: vi.fn() } })
      const selector = { type: 'room' as const, id: asEntityId('room-1'), buildingId: asEntityId('bld-1'), floorId: asEntityId('fl-1') }

      tool.selectEntity(selector, ctx)

      expect(select).toHaveBeenCalledOnce()
      expect(select).toHaveBeenCalledWith(selector, SelectionOrigin.Canvas)
      expect(tool.state.selectTarget).toEqual(selector)
    })
  })

  describe('cancel', () => {
    it('clears selection on Escape key', () => {
      const clear = vi.fn()
      const ctx = makeCtx({ selection: { clear, select: vi.fn() } })

      tool.onKeyDown({ key: 'Escape' } as KeyboardEvent, ctx)

      expect(clear).toHaveBeenCalledOnce()
      expect(clear).toHaveBeenCalledWith(SelectionOrigin.Keyboard)
    })
  })

  describe('activation lifecycle', () => {
    it('resets state on activate', () => {
      const ctx = makeCtx()
      const selector = { type: 'room' as const, id: asEntityId('room-1'), buildingId: asEntityId('bld-1'), floorId: asEntityId('fl-1') }
      tool.selectEntity(selector, ctx)
      expect(tool.state.selectTarget).not.toBeNull()

      tool.onActivate(ctx)
      expect(tool.state.selectTarget).toBeNull()
    })

    it('resets state on deactivate', () => {
      const ctx = makeCtx()
      const selector = { type: 'room' as const, id: asEntityId('room-1'), buildingId: asEntityId('bld-1'), floorId: asEntityId('fl-1') }
      tool.selectEntity(selector, ctx)
      expect(tool.state.selectTarget).not.toBeNull()

      tool.onDeactivate(ctx)
      expect(tool.state.selectTarget).toBeNull()
    })
  })
})
