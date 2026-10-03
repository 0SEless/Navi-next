/**
 * P2A.1: Room (Space) drawing tool for the Canvas editor.
 *
 * Polygon drawing tool that collects vertices via clicks and creates
 * a room when the polygon is confirmed (double-click or close).
 * Operates in building-local meters.
 */

import type { Tool, ToolPointerEvent, ToolContext } from './types'
import type { LocalCoord } from '@navi/core'

export interface RoomToolState {
  drawing: boolean
  vertices: LocalCoord[]
}

export class RoomTool implements Tool {
  readonly id = 'space'
  readonly label = 'Room'
  readonly cursor = 'crosshair'

  private _drawing = false
  private _vertices: LocalCoord[] = []
  private _onStateChange: ((state: RoomToolState) => void) | null = null

  get state(): RoomToolState {
    return {
      drawing: this._drawing,
      vertices: [...this._vertices],
    }
  }

  /**
   * Subscribe to state changes for external preview rendering.
   */
  onStateChange(callback: (state: RoomToolState) => void): () => void {
    this._onStateChange = callback
    return () => { this._onStateChange = null }
  }

  onActivate(_ctx: ToolContext): void {
    this.reset()
  }

  onDeactivate(_ctx: ToolContext): void {
    this.reset()
  }

  onPointerDown(event: ToolPointerEvent, _ctx: ToolContext): void {
    this._drawing = true
    this._vertices.push({ x: event.x, y: event.y })
    this._notifyState()
  }

  onPointerMove(_event: ToolPointerEvent, _ctx: ToolContext): void {
    // Cursor tracking is handled externally via cursorPoint state
  }

  onPointerUp(_event: ToolPointerEvent, _ctx: ToolContext): void {
    // No-op: vertices are added on pointerDown
  }

  onKeyDown(event: KeyboardEvent, _ctx: ToolContext): void {
    if (event.key === 'Escape') {
      this.reset()
    } else if (event.key === 'Backspace') {
      this._vertices.pop()
      this._notifyState()
    }
  }

  /**
   * Get the current vertices for preview rendering.
   */
  getVertices(): LocalCoord[] {
    return [...this._vertices]
  }

  /**
   * Check if there are enough vertices to form a polygon.
   */
  canConfirm(): boolean {
    return this._vertices.length >= 3
  }

  /**
   * Get the finalized polygon vertices and reset state.
   * Returns null if not enough vertices.
   */
  finalize(): LocalCoord[] | null {
    if (this._vertices.length < 3) return null
    const result = [...this._vertices]
    this.reset()
    return result
  }

  /**
   * Cancel the current drawing and reset state.
   */
  cancel(): void {
    this.reset()
  }

  private reset(): void {
    this._drawing = false
    this._vertices = []
    this._notifyState()
  }

  private _notifyState(): void {
    this._onStateChange?.(this.state)
  }
}
