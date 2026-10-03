import { describe, it, expect, beforeEach, vi } from 'vitest'
import { PanTool } from '../pan-tool'
import type { ToolContext, ToolPointerEvent } from '../types'
import type { Viewport } from '../../viewport'
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

function makeCtx(overrides: Partial<{ viewport: { panTo: ReturnType<typeof vi.fn>; center: { lat: number; lng: number } }; dispatcher: { execute: ReturnType<typeof vi.fn> }; selection: { select: ReturnType<typeof vi.fn>; clear: ReturnType<typeof vi.fn> } }> = {}): ToolContext {
  const viewport = overrides.viewport ?? { panTo: vi.fn(), center: { lat: 0, lng: 0 } }
  return {
    services: {
      viewport: viewport as unknown as Viewport,
      dispatcher: (overrides.dispatcher ?? { execute: vi.fn() }) as unknown as CommandDispatcher,
      selection: (overrides.selection ?? { select: vi.fn(), clear: vi.fn() }) as unknown as SelectionManager,
    } as ToolContext['services'],
  }
}

describe('PanTool', () => {
  let tool: PanTool

  beforeEach(() => {
    tool = new PanTool()
  })

  it('has correct id and label', () => {
    expect(tool.id).toBe('pan')
    expect(tool.label).toBe('Pan')
  })

  it('has grab cursor', () => {
    expect(tool.cursor).toBe('grab')
  })

  it('starts in inactive state', () => {
    expect(tool.state.panning).toBe(false)
    expect(tool.state.lastX).toBe(0)
    expect(tool.state.lastY).toBe(0)
  })

  describe('pointer flow', () => {
    it('begins panning on pointer down', () => {
      const ctx = makeCtx()
      tool.onPointerDown(makeEvent({ x: 100, y: 200 }), ctx)

      expect(tool.state.panning).toBe(true)
      expect(tool.state.lastX).toBe(100)
      expect(tool.state.lastY).toBe(200)
    })

    it('pans viewport on pointer move while panning', () => {
      const panTo = vi.fn()
      const ctx = makeCtx({ viewport: { panTo, center: { lat: 0, lng: 0 } } })

      tool.onPointerDown(makeEvent({ x: 100, y: 200 }), ctx)
      tool.onPointerMove(makeEvent({ x: 110, y: 210 }), ctx)

      expect(panTo).toHaveBeenCalledOnce()
      const newCenter = panTo.mock.calls[0][0]
      expect(typeof newCenter.lat).toBe('number')
      expect(typeof newCenter.lng).toBe('number')
    })

    it('does not pan when not panning', () => {
      const panTo = vi.fn()
      const ctx = makeCtx({ viewport: { panTo, center: { lat: 0, lng: 0 } } })

      tool.onPointerMove(makeEvent({ x: 110, y: 210 }), ctx)

      expect(panTo).not.toHaveBeenCalled()
    })

    it('stops panning on pointer up', () => {
      const ctx = makeCtx()
      tool.onPointerDown(makeEvent({ x: 100, y: 200 }), ctx)
      expect(tool.state.panning).toBe(true)

      tool.onPointerUp(makeEvent({ x: 110, y: 210 }), ctx)
      expect(tool.state.panning).toBe(false)
    })

    it('updates last position after move', () => {
      const ctx = makeCtx({ viewport: { panTo: vi.fn(), center: { lat: 0, lng: 0 } } })

      tool.onPointerDown(makeEvent({ x: 100, y: 200 }), ctx)
      tool.onPointerMove(makeEvent({ x: 150, y: 250 }), ctx)

      expect(tool.state.lastX).toBe(150)
      expect(tool.state.lastY).toBe(250)
    })
  })

  describe('cancel', () => {
    it('resets state on Escape key', () => {
      const ctx = makeCtx()
      tool.onPointerDown(makeEvent({ x: 100, y: 200 }), ctx)
      expect(tool.state.panning).toBe(true)

      tool.onKeyDown({ key: 'Escape' } as KeyboardEvent, ctx)
      expect(tool.state.panning).toBe(false)
      expect(tool.state.lastX).toBe(0)
      expect(tool.state.lastY).toBe(0)
    })
  })

  describe('activation lifecycle', () => {
    it('resets state on activate', () => {
      const ctx = makeCtx()
      tool.onPointerDown(makeEvent({ x: 100, y: 200 }), ctx)
      expect(tool.state.panning).toBe(true)

      tool.onActivate(ctx)
      expect(tool.state.panning).toBe(false)
    })

    it('resets state on deactivate', () => {
      const ctx = makeCtx()
      tool.onPointerDown(makeEvent({ x: 100, y: 200 }), ctx)
      expect(tool.state.panning).toBe(true)

      tool.onDeactivate(ctx)
      expect(tool.state.panning).toBe(false)
    })
  })
})
