/**
 * InteractionController — unified event router for canvas and MapLibre interactions.
 *
 * Handles capture/release semantics: when a target is captured, all events
 * route to that target regardless of original source. When not captured,
 * events route based on their target property.
 *
 * Wired to the ToolRegistry (CurrentToolStore) to forward events to the
 * active tool when canvas is captured.
 */

import type { Tool, ToolContext, ToolPointerEvent } from '../tools/types'
import type { CurrentToolStore } from '../tools/CurrentToolStore'

// ── Types ────────────────────────────────────────────────────

export type InteractionEventType =
  | 'pointerDown'
  | 'pointerMove'
  | 'pointerUp'
  | 'wheel'
  | 'keydown'

export type InteractionTarget = 'canvas' | 'maplibre'

export interface InteractionPosition {
  x: number
  y: number
}

export interface InteractionEvent {
  type: InteractionEventType
  target: InteractionTarget
  position: InteractionPosition
  /** Original DOM event for low-level access */
  originalEvent: Event
  /** Pointer-specific properties */
  button?: number
  shiftKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  /** Wheel-specific properties */
  deltaY?: number
  /** Keyboard-specific properties */
  key?: string
  code?: string
}

export interface InteractionControllerOptions {
  toolRegistry: CurrentToolStore
  toolContext: ToolContext
  /** Optional: convert screen pixels to building-local meters for ToolPointerEvent.x/y. */
  screenToBuildingLocal?: (screen: { x: number; y: number }) => { x: number; y: number } | null
  /** Optional: convert building-local meters to world LatLng for ToolPointerEvent.lng/lat. */
  buildingLocalToLatLng?: (local: { x: number; y: number }) => { lat: number; lng: number } | null
}

// ── InteractionController ────────────────────────────────────

export class InteractionController {
  private _capturedTarget: InteractionTarget | null = null
  private _toolRegistry: CurrentToolStore
  private _toolContext: ToolContext
  private _toolMap = new Map<string, Tool>()
  private _screenToBuildingLocalFn?: (screen: { x: number; y: number }) => { x: number; y: number } | null
  private _buildingLocalToLatLng?: (local: { x: number; y: number }) => { lat: number; lng: number } | null

  constructor(options: InteractionControllerOptions) {
    this._toolRegistry = options.toolRegistry
    this._toolContext = options.toolContext
    this._screenToBuildingLocalFn = options.screenToBuildingLocal
    this._buildingLocalToLatLng = options.buildingLocalToLatLng
  }

  // ── Public API ─────────────────────────────────────────────

  /**
   * Register a tool so the controller can forward events to it.
   */
  registerTool(tool: Tool): void {
    this._toolMap.set(tool.id, tool)
  }

  /**
   * Unregister a tool.
   */
  unregisterTool(toolId: string): void {
    const tool = this._toolMap.get(toolId)
    if (tool) {
      // Deactivate if this tool was active
      const activeId = this._toolRegistry.activeToolId
      if (activeId === toolId) {
        tool.onDeactivate?.(this._toolContext)
        this._toolRegistry.deactivate()
      }
      this._toolMap.delete(toolId)
    }
  }

  /**
   * Get the currently captured target, or null if none.
   */
  getCapturedTarget(): InteractionTarget | null {
    return this._capturedTarget
  }

  /**
   * Capture a target. All subsequent events will route to this target
   * until release() is called.
   *
   * @throws Error if already captured (must release first)
   */
  capture(target: InteractionTarget): void {
    if (this._capturedTarget !== null) {
      throw new Error(
        `InteractionController already captured: ${this._capturedTarget}. ` +
        `Call release() before capturing a new target.`
      )
    }
    this._capturedTarget = target

    // Activate tool when canvas is captured
    if (target === 'canvas') {
      this._activateCurrentTool()
    }
  }

  /**
   * Release the captured target. Events will resume normal routing.
   */
  release(): void {
    if (this._capturedTarget === 'canvas') {
      this._deactivateCurrentTool()
    }
    this._capturedTarget = null
  }

  /**
   * Handle an interaction event. Routes based on capture state.
   *
   * @returns The target that received the event, or null if no handler matched
   */
  handleEvent(event: InteractionEvent): InteractionTarget | null {
    const effectiveTarget = this._capturedTarget ?? event.target

    if (effectiveTarget === 'canvas') {
      this._handleCanvasEvent(event)
      return 'canvas'
    }

    if (effectiveTarget === 'maplibre') {
      this._handleMapLibreEvent(event)
      return 'maplibre'
    }

    return null
  }

  // ── Private: Canvas event handling ─────────────────────────

  private _handleCanvasEvent(event: InteractionEvent): void {
    const activeId = this._toolRegistry.activeToolId
    if (!activeId) return

    const tool = this._toolMap.get(activeId)
    if (!tool) return

    const toolEvent = this._toToolPointerEvent(event)

    switch (event.type) {
      case 'pointerDown':
        tool.onPointerDown?.(toolEvent, this._toolContext)
        break
      case 'pointerMove':
        tool.onPointerMove?.(toolEvent, this._toolContext)
        break
      case 'pointerUp':
        tool.onPointerUp?.(toolEvent, this._toolContext)
        break
      case 'keydown':
        tool.onKeyDown?.(event.originalEvent as KeyboardEvent, this._toolContext)
        break
      // 'wheel' is handled by canvas viewport, not tools
    }
  }

  private _toToolPointerEvent(event: InteractionEvent): ToolPointerEvent {
    // Convert screen coordinates to building-local meters
    const buildingLocal = this._screenToBuildingLocal(event.position)
    // Convert building-local to world LatLng
    const latlng = buildingLocal && this._buildingLocalToLatLng
      ? this._buildingLocalToLatLng(buildingLocal)
      : null

    return {
      x: buildingLocal?.x ?? event.position.x,
      y: buildingLocal?.y ?? event.position.y,
      lng: latlng?.lng ?? 0,
      lat: latlng?.lat ?? 0,
      button: event.button ?? 0,
      shiftKey: event.shiftKey ?? false,
      ctrlKey: event.ctrlKey ?? false,
      altKey: event.altKey ?? false,
    }
  }

  /**
   * Convert screen coordinates to building-local meters.
   * This uses a simplified flat-Earth approximation that is adequate
   * for the scale of a single building.
   */
  private _screenToBuildingLocal(screen: { x: number; y: number }): { x: number; y: number } {
    if (this._screenToBuildingLocalFn) {
      return this._screenToBuildingLocalFn(screen) ?? screen
    }
    // Fallback: return screen coordinates as-is
    return { x: screen.x, y: screen.y }
  }

  // ── Private: MapLibre event handling ───────────────────────

  private _handleMapLibreEvent(_event: InteractionEvent): void {
    // MapLibre handles its own navigation natively.
    // When canvas is captured, MapLibre events are suppressed
    // (they never reach this method because capture redirects them).
    // When not captured, MapLibre events pass through to the map.
  }

  // ── Private: Tool lifecycle ────────────────────────────────

  private _activateCurrentTool(): void {
    const activeId = this._toolRegistry.activeToolId
    if (!activeId) return

    const tool = this._toolMap.get(activeId)
    if (tool) {
      tool.onActivate?.(this._toolContext)
    }
  }

  private _deactivateCurrentTool(): void {
    const activeId = this._toolRegistry.activeToolId
    if (!activeId) return

    const tool = this._toolMap.get(activeId)
    if (tool) {
      tool.onDeactivate?.(this._toolContext)
    }
  }
}
