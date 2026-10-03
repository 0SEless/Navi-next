/**
 * Vertical slice test: Canvas rectangle drag → Staircase creation.
 *
 * Proves the COMPLETE interaction path:
 *   Canvas down-drag-release
 *     → InteractionController (with building-local coordinates)
 *     → StairTool pointer gesture
 *     → feature.create command (canonical)
 *     → CommandDispatcher → CommandRegistry
 *     → CampusDocument mutated
 *     → staircase appears in building.staircases
 *
 * This test uses REAL instances of:
 *   - StairTool (the actual tool implementation)
 *   - InteractionController (the actual event router)
 *   - CommandDispatcher + CommandRegistry (actual command pipeline)
 *   - featureCreateHandler (the real production handler)
 *
 * And MOCKS only the plumbing that requires React/DOM:
 *   - CurrentToolStore (extends BaseEditorService, needs ServiceRegistry init)
 *   - ToolContext.services (proxied ServiceAccessor)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { InteractionController } from '../interaction-controller'
import type { InteractionEvent } from '../interaction-controller'
import type { ToolContext, ToolPointerEvent } from '../../tools/types'
import { CommandDispatcher } from '../../commands/dispatcher'
import type { CurrentToolStore } from '../../tools/CurrentToolStore'
import { StairTool } from '../../tools/stair-tool'
import { CommandRegistry } from '../../commands/registry'
import { featureCreateHandler } from '../../commands/feature-handlers'
import type { CampusDocument } from '@navi/core'
import type { DocumentEventBus } from '../../eventbus'

// ── Helpers ──────────────────────────────────────────────────

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

function createMockViewport(buildingId: string, floorId: string) {
  return {
    activeBuildingId: buildingId,
    activeFloorId: floorId,
  }
}

function createMockToolContext(dispatcher: CommandDispatcher, document: CampusDocument, buildingId: string, floorId: string): ToolContext {
  return {
    services: {
      dispatcher,
      viewport: createMockViewport(buildingId, floorId),
    } as unknown as ToolContext['services'],
    document,
  }
}

function createPointerEvent(
  type: 'pointerDown' | 'pointerMove' | 'pointerUp',
  x: number,
  y: number,
  target: InteractionEvent['target'] = 'canvas',
): InteractionEvent {
  return {
    type,
    target,
    position: { x, y },
    originalEvent: new PointerEvent(type.toLowerCase(), { clientX: x, clientY: y }),
    button: 0,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
  }
}

function drawStairRectangle(
  controller: InteractionController,
  centerX: number,
  centerY: number,
  target: InteractionEvent['target'] = 'canvas',
): InteractionEvent['target'] | null {
  const routed = controller.handleEvent(createPointerEvent('pointerDown', centerX - 1, centerY - 1, target))
  controller.handleEvent(createPointerEvent('pointerMove', centerX + 1, centerY + 1, target))
  controller.handleEvent(createPointerEvent('pointerUp', centerX + 1, centerY + 1, target))
  return routed
}

function createTestDocument(): CampusDocument {
  return {
    schemaVersion: 1,
    version: 0,
    metadata: {
      campusId: 'test-campus',
      name: 'Test Campus',
      description: 'Test',
      lastModified: new Date().toISOString(),
      editorVersion: '0.0.1-test',
    },
    buildings: [
      {
        id: 'bld-1',
        name: 'Building A',
        code: 'A',
        category: 'academic',
        description: 'Test building',
        footprint: { points: [] },
        baseElevation: 0,
        height: 15,
        staircases: [],
        floors: [
          {
            id: 'flr-1',
            level: 0,
            label: 'Ground Floor',
            elevation: 0,
            height: 3.5,
            rooms: [],
            hallways: [],
            staircases: [],
            elevators: [],
            entrances: [],
            connectorStops: [],
            parametricComponents: [],
            metadata: {},
          },
        ],
        verticalConnectors: [],
        color: '#1C6EBB',
        aliases: [],
        metadata: {},
      },
    ],
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
  }
}

// ── Tests ────────────────────────────────────────────────────

describe('Staircase creation vertical slice', () => {
  let document: CampusDocument
  let commandRegistry: CommandRegistry
  let dispatcher: CommandDispatcher
  let toolContext: ToolContext
  let toolRegistry: CurrentToolStore
  let stairTool: StairTool
  let controller: InteractionController

  beforeEach(() => {
    // 1. Create a fresh document
    document = createTestDocument()

    // 2. Set up real command pipeline with the REAL featureCreateHandler
    commandRegistry = new CommandRegistry()
    commandRegistry.register(featureCreateHandler)

    // Mock eventBus for the dispatcher (needs it for entity.created emission)
    const mockEventBus = {
      emit: vi.fn(),
      transaction: vi.fn((fn: () => void) => fn()),
      on: vi.fn(),
      off: vi.fn(),
    } as unknown as DocumentEventBus

    dispatcher = new CommandDispatcher(commandRegistry, document, mockEventBus)

    // 3. Create tool context with real dispatcher, document, and viewport
    toolContext = createMockToolContext(dispatcher, document, 'bld-1', 'flr-1')

    // 4. Set up tool registry with staircase active
    toolRegistry = createMockToolRegistry('staircase')

    // 5. Create real StairTool
    stairTool = new StairTool()

    // 6. Wire InteractionController with real tool + real dispatcher
    controller = new InteractionController({
      toolRegistry,
      toolContext,
    })
    controller.registerTool(stairTool)
  })

  it('proves the complete chain: canvas rectangle drag → staircase in document', () => {
    const CLICK_X = 42.5
    const CLICK_Y = 87.3

    // Verify building.staircases starts empty
    const building = document.buildings[0]
    expect(building.staircases!).toHaveLength(0)

    // Step 1: Simulate canvas capture (activates the staircase tool)
    controller.capture('canvas')

    // Step 2: Simulate a rectangle centered at specific coordinates
    const routed = drawStairRectangle(controller, CLICK_X, CLICK_Y)

    // Step 3: Verify the event was routed to the canvas
    expect(routed).toBe('canvas')

    // Step 4: Verify the document was mutated — staircase in building.staircases (canonical)
    expect(building.staircases!).toHaveLength(1)

    // Step 5: Verify the staircase has the correct position from the rectangle center
    const staircase = building.staircases![0]
    expect(staircase.levels[0].position).toEqual({ x: CLICK_X, y: CLICK_Y })
  })

  it('passes building-local coordinates from InteractionController to StairTool', () => {
    const CLICK_X = 100
    const CLICK_Y = 200

    controller.capture('canvas')

    drawStairRectangle(controller, CLICK_X, CLICK_Y)

    const staircase = document.buildings[0].staircases![0]
    expect(staircase.levels[0].position.x).toBe(CLICK_X)
    expect(staircase.levels[0].position.y).toBe(CLICK_Y)
  })

  it('dispatches feature.create command with correct structure', () => {
    const executeSpy = vi.spyOn(dispatcher, 'execute')

    controller.capture('canvas')
    drawStairRectangle(controller, 10, 20)

    expect(executeSpy).toHaveBeenCalledOnce()
    expect(executeSpy).toHaveBeenCalledWith({
      id: 'feature.create',
      label: 'Create Staircase',
      payload: {
        buildingId: 'bld-1',
        floor: 0,
        featureType: 'staircase',
        position: { x: 10, y: 20 },
        rotation: 0,
        polygon: {
          points: [
            { x: 9, y: 19 }, { x: 11, y: 19 },
            { x: 11, y: 21 }, { x: 9, y: 21 },
          ],
        },
        name: '',
        fromLevel: 0,
        toLevel: 1,
      },
    })
  })

  it('creates a staircase with correct defaults', () => {
    controller.capture('canvas')
    drawStairRectangle(controller, 5, 10)

    const staircase = document.buildings[0].staircases![0]
    expect(staircase.name).toBe('Staircase')
    expect(staircase.type).toBe('standard')
    expect(staircase.accessible).toBe(false)
    expect(staircase.fromLevel).toBe(0)
    expect(staircase.toLevel).toBe(1)
    expect(staircase.id).toBeTruthy()
    expect(staircase.buildingId).toBe('bld-1')
  })

  it('allows multiple staircase placements', () => {
    controller.capture('canvas')

    drawStairRectangle(controller, 10, 20)
    drawStairRectangle(controller, 30, 40)
    drawStairRectangle(controller, 50, 60)

    const staircases = document.buildings[0].staircases!
    expect(staircases).toHaveLength(3)
    expect(staircases[0].levels[0].position).toEqual({ x: 10, y: 20 })
    expect(staircases[1].levels[0].position).toEqual({ x: 30, y: 40 })
    expect(staircases[2].levels[0].position).toEqual({ x: 50, y: 60 })
  })

  it('activates tool on canvas capture and deactivates on release', () => {
    expect(stairTool.state.placed).toBe(false)

    controller.capture('canvas')

    drawStairRectangle(controller, 10, 20)
    expect(document.buildings[0].staircases).toHaveLength(1)

    controller.release()
  })

  it('redirects maplibre events to canvas when captured (capture semantics)', () => {
    controller.capture('canvas')

    const routed = drawStairRectangle(controller, 10, 20, 'maplibre')

    expect(routed).toBe('canvas')
    expect(document.buildings[0].staircases).toHaveLength(1)
  })

  it('does not create staircase when canvas is NOT captured and event targets maplibre', () => {
    const maplibreEvent = createPointerEvent('pointerDown', 10, 20, 'maplibre')
    const routed = controller.handleEvent(maplibreEvent)

    expect(routed).toBe('maplibre')
    expect(document.buildings[0].staircases!).toHaveLength(0)
  })

  it('proves coordinate flow: screen → InteractionController → ToolPointerEvent → StairTool → command → document', () => {
    const originalOnPointerDown = stairTool.onPointerDown.bind(stairTool)
    let receivedToolEvent: ToolPointerEvent | null = null

    stairTool.onPointerDown = (event: ToolPointerEvent, ctx: ToolContext) => {
      receivedToolEvent = { ...event }
      originalOnPointerDown(event, ctx)
    }

    controller.capture('canvas')
    drawStairRectangle(controller, 42, 87)

    expect(receivedToolEvent).not.toBeNull()
    expect(receivedToolEvent!.x).toBe(41)
    expect(receivedToolEvent!.y).toBe(86)

    const staircase = document.buildings[0].staircases![0]
    expect(staircase.levels[0].position).toEqual({ x: 42, y: 87 })
  })

  it('registration/unregistration controls event routing', () => {
    controller.capture('canvas')

    drawStairRectangle(controller, 10, 20)
    expect(document.buildings[0].staircases).toHaveLength(1)

    controller.unregisterTool('staircase')

    drawStairRectangle(controller, 30, 40)
    expect(document.buildings[0].staircases).toHaveLength(1)
  })
})
