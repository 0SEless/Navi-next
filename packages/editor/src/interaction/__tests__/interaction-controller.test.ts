import { describe, it, expect, vi, beforeEach } from 'vitest'
import { InteractionController } from '../interaction-controller'
import type { InteractionEvent, InteractionControllerOptions } from '../interaction-controller'
import type { Tool, ToolContext, ToolPointerEvent } from '../../tools/types'
import type { CurrentToolStore } from '../../tools/CurrentToolStore'

// ── Helpers ──────────────────────────────────────────────────

function createMockTool(overrides?: Partial<Tool>): Tool {
  return {
    id: 'test-tool',
    label: 'Test Tool',
    onActivate: vi.fn(),
    onDeactivate: vi.fn(),
    onPointerDown: vi.fn(),
    onPointerMove: vi.fn(),
    onPointerUp: vi.fn(),
    onKeyDown: vi.fn(),
    ...overrides,
  }
}

function createMockToolRegistry(activeToolId: string | null = null): CurrentToolStore {
  return {
    id: 'toolRegistry',
    version: '1.0.0',
    status: 'ready',
    capabilities: [],
    dependencies: [],
    activeToolId,
    activate: vi.fn(),
    deactivate: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    init: vi.fn(),
    destroy: vi.fn(),
    reset: vi.fn(),
    getConfig: vi.fn(),
    setConfig: vi.fn(),
  } as unknown as CurrentToolStore
}

function createMockToolContext(): ToolContext {
  return {
    services: {} as any,
  }
}

function createInteractionEvent(
  overrides?: Partial<InteractionEvent>
): InteractionEvent {
  return {
    type: 'pointerDown',
    target: 'canvas',
    position: { x: 100, y: 200 },
    originalEvent: new PointerEvent('pointerdown'),
    button: 0,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    ...overrides,
  }
}

function createKeyEvent(key: string = 'Enter'): InteractionEvent {
  return {
    type: 'keydown',
    target: 'canvas',
    position: { x: 0, y: 0 },
    originalEvent: new KeyboardEvent('keydown', { key }),
    key,
  }
}

// ── Tests ────────────────────────────────────────────────────

describe('InteractionController', () => {
  let toolRegistry: CurrentToolStore
  let toolContext: ToolContext
  let controller: InteractionController

  beforeEach(() => {
    toolRegistry = createMockToolRegistry()
    toolContext = createMockToolContext()
    controller = new InteractionController({
      toolRegistry,
      toolContext,
    })
  })

  describe('event routing', () => {
    it('routes canvas events to canvas target', () => {
      const event = createInteractionEvent({ target: 'canvas' })
      const result = controller.handleEvent(event)
      expect(result).toBe('canvas')
    })

    it('routes maplibre events to maplibre target', () => {
      const event = createInteractionEvent({ target: 'maplibre' })
      const result = controller.handleEvent(event)
      expect(result).toBe('maplibre')
    })

    it('routes events based on target when not captured', () => {
      const canvasEvent = createInteractionEvent({ target: 'canvas' })
      const maplibreEvent = createInteractionEvent({ target: 'maplibre' })

      expect(controller.handleEvent(canvasEvent)).toBe('canvas')
      expect(controller.handleEvent(maplibreEvent)).toBe('maplibre')
    })
  })

  describe('capture/release semantics', () => {
    it('starts with no captured target', () => {
      expect(controller.getCapturedTarget()).toBeNull()
    })

    it('captures a target', () => {
      controller.capture('canvas')
      expect(controller.getCapturedTarget()).toBe('canvas')
    })

    it('routes all events to captured target', () => {
      controller.capture('canvas')

      const canvasEvent = createInteractionEvent({ target: 'canvas' })
      const maplibreEvent = createInteractionEvent({ target: 'maplibre' })

      expect(controller.handleEvent(canvasEvent)).toBe('canvas')
      expect(controller.handleEvent(maplibreEvent)).toBe('canvas')
    })

    it('releases capture', () => {
      controller.capture('canvas')
      controller.release()

      expect(controller.getCapturedTarget()).toBeNull()
    })

    it('resumes normal routing after release', () => {
      controller.capture('canvas')
      controller.release()

      const canvasEvent = createInteractionEvent({ target: 'canvas' })
      const maplibreEvent = createInteractionEvent({ target: 'maplibre' })

      expect(controller.handleEvent(canvasEvent)).toBe('canvas')
      expect(controller.handleEvent(maplibreEvent)).toBe('maplibre')
    })

    it('throws when capturing while already captured', () => {
      controller.capture('canvas')
      expect(() => controller.capture('maplibre')).toThrow('already captured')
    })

    it('allows recapture after release', () => {
      controller.capture('canvas')
      controller.release()
      controller.capture('maplibre')

      expect(controller.getCapturedTarget()).toBe('maplibre')
    })
  })

  describe('active tool receives events', () => {
    it('forwards pointerDown to active tool when canvas is captured', () => {
      const tool = createMockTool()
      const registry = createMockToolRegistry('test-tool')
      const ctrl = new InteractionController({
        toolRegistry: registry,
        toolContext,
      })
      ctrl.registerTool(tool)

      ctrl.capture('canvas')
      const event = createInteractionEvent({ type: 'pointerDown' })
      ctrl.handleEvent(event)

      expect(tool.onPointerDown).toHaveBeenCalledTimes(1)
      expect(tool.onPointerDown).toHaveBeenCalledWith(
        expect.objectContaining({ x: 100, y: 200 }),
        toolContext
      )
    })

    it('forwards pointerMove to active tool', () => {
      const tool = createMockTool()
      const registry = createMockToolRegistry('test-tool')
      const ctrl = new InteractionController({
        toolRegistry: registry,
        toolContext,
      })
      ctrl.registerTool(tool)

      ctrl.capture('canvas')
      const event = createInteractionEvent({ type: 'pointerMove' })
      ctrl.handleEvent(event)

      expect(tool.onPointerMove).toHaveBeenCalledTimes(1)
    })

    it('forwards pointerUp to active tool', () => {
      const tool = createMockTool()
      const registry = createMockToolRegistry('test-tool')
      const ctrl = new InteractionController({
        toolRegistry: registry,
        toolContext,
      })
      ctrl.registerTool(tool)

      ctrl.capture('canvas')
      const event = createInteractionEvent({ type: 'pointerUp' })
      ctrl.handleEvent(event)

      expect(tool.onPointerUp).toHaveBeenCalledTimes(1)
    })

    it('forwards keydown to active tool', () => {
      const tool = createMockTool()
      const registry = createMockToolRegistry('test-tool')
      const ctrl = new InteractionController({
        toolRegistry: registry,
        toolContext,
      })
      ctrl.registerTool(tool)

      ctrl.capture('canvas')
      const event = createKeyEvent('Delete')
      ctrl.handleEvent(event)

      expect(tool.onKeyDown).toHaveBeenCalledTimes(1)
      expect(tool.onKeyDown).toHaveBeenCalledWith(
        event.originalEvent,
        toolContext
      )
    })

    it('does not forward events when no tool is active', () => {
      const registry = createMockToolRegistry(null)
      const ctrl = new InteractionController({
        toolRegistry: registry,
        toolContext,
      })

      ctrl.capture('canvas')
      const event = createInteractionEvent()
      const result = ctrl.handleEvent(event)

      expect(result).toBe('canvas')
    })

    it('does not forward events when registered tool does not match active ID', () => {
      const tool = createMockTool({ id: 'other-tool' })
      const registry = createMockToolRegistry('test-tool')
      const ctrl = new InteractionController({
        toolRegistry: registry,
        toolContext,
      })
      ctrl.registerTool(tool)

      ctrl.capture('canvas')
      const event = createInteractionEvent()
      ctrl.handleEvent(event)

      expect(tool.onPointerDown).not.toHaveBeenCalled()
    })
  })

  describe('MapLibre navigation suppressed during capture', () => {
    it('does not call MapLibre handlers when canvas is captured', () => {
      const maplibreHandler = vi.fn()
      const registry = createMockToolRegistry()
      const ctrl = new InteractionController({
        toolRegistry: registry,
        toolContext,
      })

      ctrl.capture('canvas')
      const event = createInteractionEvent({ target: 'maplibre' })
      const result = ctrl.handleEvent(event)

      // Event is redirected to canvas, not maplibre
      expect(result).toBe('canvas')
    })

    it('allows maplibre events when not captured', () => {
      const registry = createMockToolRegistry()
      const ctrl = new InteractionController({
        toolRegistry: registry,
        toolContext,
      })

      const event = createInteractionEvent({ target: 'maplibre' })
      const result = ctrl.handleEvent(event)

      expect(result).toBe('maplibre')
    })
  })

  describe('tool lifecycle', () => {
    it('activates tool when canvas is captured', () => {
      const tool = createMockTool()
      const registry = createMockToolRegistry('test-tool')
      const ctrl = new InteractionController({
        toolRegistry: registry,
        toolContext,
      })
      ctrl.registerTool(tool)

      ctrl.capture('canvas')

      expect(tool.onActivate).toHaveBeenCalledWith(toolContext)
    })

    it('deactivates tool when canvas is released', () => {
      const tool = createMockTool()
      const registry = createMockToolRegistry('test-tool')
      const ctrl = new InteractionController({
        toolRegistry: registry,
        toolContext,
      })
      ctrl.registerTool(tool)

      ctrl.capture('canvas')
      ctrl.release()

      expect(tool.onDeactivate).toHaveBeenCalledWith(toolContext)
    })

    it('does not activate tool when non-canvas target is captured', () => {
      const tool = createMockTool()
      const registry = createMockToolRegistry('test-tool')
      const ctrl = new InteractionController({
        toolRegistry: registry,
        toolContext,
      })
      ctrl.registerTool(tool)

      ctrl.capture('maplibre')

      expect(tool.onActivate).not.toHaveBeenCalled()
    })

    it('does not deactivate tool when non-canvas target is released', () => {
      const tool = createMockTool()
      const registry = createMockToolRegistry('test-tool')
      const ctrl = new InteractionController({
        toolRegistry: registry,
        toolContext,
      })
      ctrl.registerTool(tool)

      ctrl.capture('maplibre')
      ctrl.release()

      expect(tool.onDeactivate).not.toHaveBeenCalled()
    })
  })

  describe('tool registration', () => {
    it('registers a tool', () => {
      const tool = createMockTool()
      controller.registerTool(tool)

      const registry = createMockToolRegistry('test-tool')
      const ctrl = new InteractionController({
        toolRegistry: registry,
        toolContext,
      })
      ctrl.registerTool(tool)
      ctrl.capture('canvas')

      const event = createInteractionEvent()
      ctrl.handleEvent(event)

      expect(tool.onPointerDown).toHaveBeenCalled()
    })

    it('unregisters a tool', () => {
      const tool = createMockTool()
      const registry = createMockToolRegistry('test-tool')
      const ctrl = new InteractionController({
        toolRegistry: registry,
        toolContext,
      })
      ctrl.registerTool(tool)
      ctrl.unregisterTool('test-tool')

      ctrl.capture('canvas')
      const event = createInteractionEvent()
      ctrl.handleEvent(event)

      expect(tool.onPointerDown).not.toHaveBeenCalled()
    })

    it('deactivates tool on unregister if it was active', () => {
      const tool = createMockTool()
      const registry = createMockToolRegistry('test-tool')
      const ctrl = new InteractionController({
        toolRegistry: registry,
        toolContext,
      })
      ctrl.registerTool(tool)

      // Simulate active state
      ctrl.capture('canvas')
      expect(tool.onActivate).toHaveBeenCalled()

      ctrl.unregisterTool('test-tool')
      expect(tool.onDeactivate).toHaveBeenCalled()
    })
  })
})
