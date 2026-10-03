/**
 * InteractionController — manages temporary interaction modes.
 *
 * This is a lightweight framework for editor interactions that go beyond
 * simple tool selection. It handles:
 *
 * - Entering/exiting interaction modes
 * - Routing events (click, hover, Esc, right-click) to the active mode
 * - Clean state restoration when returning to Idle
 *
 * Current modes:
 *   Idle              — no interaction in progress
 *   RelationshipSelection — user is picking a relationship target
 *
 * Future modes:
 *   PlaceComponent, VertexEdit, DrawTrace, etc.
 */

import type { CampusDocument, LatLng } from '@navi/core'

// ── Interaction State ───────────────────────────────────────────────────────

export type InteractionMode = 'idle' | 'relationshipSelection' | 'canvasCapture'

/**
 * InteractionState contains only intent — what the user is trying to do.
 * Derived data (like owner position) belongs in the visualization layer.
 */
export interface RelationshipSelectionState {
  mode: 'relationshipSelection'
  ownerId: string
  ownerType: string
  relationshipType: string
}

/**
 * CanvasCaptureState — Canvas has captured pointer events.
 * MapLibre navigation is suppressed until release.
 */
export interface CanvasCaptureState {
  mode: 'canvasCapture'
  /** The tool that captured (for UI feedback) */
  tool: string
  /** Timestamp of capture (for debugging) */
  capturedAt: number
}

export type InteractionState =
  | { mode: 'idle' }
  | RelationshipSelectionState
  | CanvasCaptureState

// ── Interaction Events ──────────────────────────────────────────────────────

export interface InteractionClickEvent {
  type: 'click'
  latLng: LatLng
  featureId?: string
  featureType?: string
}

export interface InteractionHoverEvent {
  type: 'hover'
  latLng: LatLng
  featureId?: string
  featureType?: string
}

export interface InteractionCancelEvent {
  type: 'cancel'
  reason: 'escape' | 'rightClick' | 'toolSwitch' | 'entitySelect' | 'modeSwitch'
}

export type InteractionEvent =
  | InteractionClickEvent
  | InteractionHoverEvent
  | InteractionCancelEvent

// ── Interaction Handler ─────────────────────────────────────────────────────

export interface InteractionHandler {
  mode: InteractionMode

  /** Called when entering this mode */
  onEnter(state: RelationshipSelectionState): void

  /** Called when leaving this mode */
  onExit(): void

  /** Handle a click event. Return true if consumed. */
  onClick(event: InteractionClickEvent, document: CampusDocument): boolean

  /** Handle a hover event. Return true if consumed. */
  onHover(event: InteractionHoverEvent, document: CampusDocument): boolean

  /** Handle a cancel event. Always returns to Idle. */
  onCancel(event: InteractionCancelEvent): void

  /** Get the status bar message for this mode */
  getStatusMessage(): string
}

// ── InteractionController ───────────────────────────────────────────────────

export type InteractionCallback = (state: InteractionState) => void

export class InteractionController {
  private state: InteractionState = { mode: 'idle' }
  private handler: InteractionHandler | null = null
  private listeners: InteractionCallback[] = []

  /** Subscribe to state changes */
  onChange(callback: InteractionCallback): () => void {
    this.listeners.push(callback)
    return () => {
      this.listeners = this.listeners.filter(l => l !== callback)
    }
  }

  /** Get current state */
  getState(): InteractionState {
    return this.state
  }

  /** Get status message (empty string if idle) */
  getStatusMessage(): string {
    return this.handler?.getStatusMessage() ?? ''
  }

  /** Check if a feature is a valid target for the current interaction */
  isValidTarget(featureId: string, featureType: string): boolean {
    if (this.state.mode !== 'relationshipSelection') return false
    // For entrance-road relationships, valid targets are roads
    if (this.state.relationshipType === 'entrance-road') {
      return featureType === 'road'
    }
    return false
  }

  /** Enter RelationshipSelection mode */
  enterRelationshipSelection(
    ownerId: string,
    ownerType: string,
    relationshipType: string,
  ): void {
    if (this.state.mode !== 'idle') {
      this.exit('modeSwitch')
    }

    const state: RelationshipSelectionState = {
      mode: 'relationshipSelection',
      ownerId,
      ownerType,
      relationshipType,
    }

    this.state = state
    this.handler = new RelationshipSelectionHandler()
    this.handler.onEnter(state)
    this.notify()
  }

  /** Capture pointer events for Canvas editing (suppresses MapLibre navigation) */
  capture(tool: string): void {
    if (this.state.mode === 'canvasCapture') return
    if (this.state.mode !== 'idle') {
      this.exit('modeSwitch')
    }

    const state: CanvasCaptureState = {
      mode: 'canvasCapture',
      tool,
      capturedAt: Date.now(),
    }

    this.state = state
    this.notify()
  }

  /** Release pointer capture (MapLibre regains navigation control) */
  release(): void {
    if (this.state.mode !== 'canvasCapture') return
    this.exit('release')
  }

  /** Check if Canvas has captured pointer events */
  isCaptured(): boolean {
    return this.state.mode === 'canvasCapture'
  }

  /** Route a click event to the active handler */
  onClick(event: InteractionClickEvent, document: CampusDocument): boolean {
    if (this.state.mode === 'idle') return false
    if (!this.handler) return false

    const consumed = this.handler.onClick(event, document)
    if (consumed) {
      this.notify()
    }
    return consumed
  }

  /** Route a hover event to the active handler */
  onHover(event: InteractionHoverEvent, document: CampusDocument): boolean {
    if (this.state.mode === 'idle') return false
    if (!this.handler) return false

    return this.handler.onHover(event, document)
  }

  /** Route a cancel event and return to Idle */
  onCancel(event: InteractionCancelEvent): void {
    if (this.state.mode === 'idle') return
    // For canvasCapture mode, just release without calling handler
    if (this.state.mode === 'canvasCapture') {
      this.exit(event.reason)
      return
    }
    this.handler?.onCancel(event)
    this.exit(event.reason)
  }

  /** Exit the current mode and return to Idle */
  private exit(reason: string): void {
    this.handler?.onExit()
    this.handler = null
    this.state = { mode: 'idle' }
    this.notify()
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.state)
    }
  }
}

// ── RelationshipSelection Handler ───────────────────────────────────────────

class RelationshipSelectionHandler implements InteractionHandler {
  mode: InteractionMode = 'relationshipSelection'
  private state!: RelationshipSelectionState
  private hoveredTargetId: string | null = null

  onEnter(state: RelationshipSelectionState): void {
    this.state = state
    this.hoveredTargetId = null
  }

  onExit(): void {
    this.hoveredTargetId = null
  }

  onClick(event: InteractionClickEvent, document: CampusDocument): boolean {
    if (event.type !== 'click') return false

    // Check if clicked on a valid target (road)
    if (event.featureType === 'road' && event.featureId) {
      // Return the selected target ID — caller dispatches the command
      this.hoveredTargetId = event.featureId
      return true
    }

    return false
  }

  onHover(event: InteractionHoverEvent, document: CampusDocument): boolean {
    if (event.type !== 'hover') return false

    // Track hovered target for preview
    if (event.featureType === 'road' && event.featureId) {
      this.hoveredTargetId = event.featureId
    } else {
      this.hoveredTargetId = null
    }

    return false // Don't consume hover events
  }

  onCancel(event: InteractionCancelEvent): void {
    this.hoveredTargetId = null
  }

  getStatusMessage(): string {
    return 'Select a road to connect. Esc to cancel.'
  }

  /** Get the currently hovered target ID (for preview rendering) */
  getHoveredTargetId(): string | null {
    return this.hoveredTargetId
  }
}

// ── Singleton ───────────────────────────────────────────────────────────────

let _instance: InteractionController | null = null

export function getInteractionController(): InteractionController {
  if (!_instance) {
    _instance = new InteractionController()
  }
  return _instance
}
