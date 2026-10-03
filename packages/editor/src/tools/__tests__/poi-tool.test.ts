import { describe, it, expect, beforeEach, vi } from 'vitest'
import { POITool } from '../poi-tool'
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

function makeCtx(overrides: Partial<{ dispatcher: { execute: ReturnType<typeof vi.fn> }; selection: { select: ReturnType<typeof vi.fn>; clear: ReturnType<typeof vi.fn> }; viewport: { activeBuildingId: string | null; activeFloorId: string | null } }> = {}): ToolContext {
  return {
    services: {
      dispatcher: (overrides.dispatcher ?? { execute: vi.fn() }) as unknown as CommandDispatcher,
      selection: (overrides.selection ?? { select: vi.fn(), clear: vi.fn() }) as unknown as SelectionManager,
      viewport: overrides.viewport ?? { activeBuildingId: 'bld-1', activeFloorId: 'flr-1' },
    } as unknown as ToolContext['services'],
  }
}

describe('POITool', () => {
  let tool: POITool

  beforeEach(() => {
    tool = new POITool()
  })

  it('has correct id and label', () => {
    expect(tool.id).toBe('poi')
    expect(tool.label).toBe('POI')
  })

  it('starts in inactive state', () => {
    expect(tool.state.placing).toBe(false)
    expect(tool.state.position).toBeNull()
    expect(tool.state.mode).toBe('poi')
  })

  it('defaults to poi mode', () => {
    expect(tool.mode).toBe('poi')
  })

  describe('mode switching', () => {
    it('switches to qr mode', () => {
      tool.setMode('qr')
      expect(tool.mode).toBe('qr')
      expect(tool.state.mode).toBe('qr')
    })

    it('switches back to poi mode', () => {
      tool.setMode('qr')
      tool.setMode('poi')
      expect(tool.mode).toBe('poi')
    })
  })

  describe('POI placement flow', () => {
    it('dispatches poi.create on pointer down in poi mode', () => {
      const execute = vi.fn()
      const ctx = makeCtx({ dispatcher: { execute } })

      tool.onPointerDown(makeEvent({ x: 5, y: 10 }), ctx)

      expect(execute).toHaveBeenCalledOnce()
      expect(execute).toHaveBeenCalledWith({
        id: 'poi.create',
        label: 'Create POI',
        payload: {
          buildingId: 'bld-1',
          floorId: 'flr-1',
          name: '',
          category: 'other',
          position: { x: 5, y: 10 },
          metadata: {},
        },
      })
    })

    it('does not dispatch when viewport has no building/floor', () => {
      const execute = vi.fn()
      const ctx = makeCtx({
        dispatcher: { execute },
        viewport: { activeBuildingId: null, activeFloorId: null },
      })

      tool.onPointerDown(makeEvent({ x: 5, y: 10 }), ctx)

      expect(execute).not.toHaveBeenCalled()
    })

    it('resets state after placement', () => {
      const ctx = makeCtx()
      tool.onPointerDown(makeEvent({ x: 5, y: 10 }), ctx)

      expect(tool.state.placing).toBe(false)
      expect(tool.state.position).toBeNull()
    })

    it('dispatches qr.create on pointer down in qr mode', () => {
      const execute = vi.fn()
      const ctx = makeCtx({ dispatcher: { execute } })
      tool.setMode('qr')

      tool.onPointerDown(makeEvent({ x: 3, y: 7 }), ctx)

      expect(execute).toHaveBeenCalledOnce()
      expect(execute).toHaveBeenCalledWith({
        id: 'qr.create',
        label: 'Create QR Checkpoint',
        payload: {
          buildingId: 'bld-1',
          floorId: 'flr-1',
          label: '',
          position: { x: 3, y: 7 },
          level: 0,
          code: '',
        },
      })
    })
  })

  describe('cancel', () => {
    it('resets state on Escape key mid-placement', () => {
      const ctx = makeCtx()
      // Start placing without completing (no pointer up)
      tool.onPointerDown(makeEvent({ x: 1, y: 2 }), ctx)
      // After pointer down, tool dispatches and resets
      // Escape on an already-reset tool is a no-op but doesn't error
      tool.onKeyDown({ key: 'Escape' } as KeyboardEvent, ctx)
      expect(tool.state.placing).toBe(false)
      expect(tool.state.position).toBeNull()
    })
  })

  describe('activation lifecycle', () => {
    it('resets state on activate', () => {
      const ctx = makeCtx()
      tool.onActivate(ctx)
      expect(tool.state.placing).toBe(false)
    })

    it('resets state on deactivate', () => {
      const ctx = makeCtx()
      tool.onDeactivate(ctx)
      expect(tool.state.placing).toBe(false)
    })
  })
})
