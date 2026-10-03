/**
 * P2A.1: Hallway drawing tool for the Canvas editor.
 *
 * Polyline drawing tool that collects vertices via clicks and creates
 * a hallway centerline when confirmed (double-click or 2+ points).
 * Operates in building-local meters.
 */

import type { Tool, ToolPointerEvent, ToolContext } from './types'
import type { LocalCoord } from '@navi/core'

export interface HallwayToolState {
  drawing: boolean
  vertices: LocalCoord[]
  width: number
}

const DEFAULT_WIDTH = 3

export class HallwayTool implements Tool {
  readonly id = 'hallway'
  readonly label = 'Hallway'
  readonly cursor = 'crosshair'

  private _drawing = false
  private _vertices: LocalCoord[] = []
  private _width = DEFAULT_WIDTH
  private _onStateChange: ((state: HallwayToolState) => void) | null = null

  get state(): HallwayToolState {
    return {
      drawing: this._drawing,
      vertices: [...this._vertices],
      width: this._width,
    }
  }

  /**
   * Subscribe to state changes for external preview rendering.
   */
  onStateChange(callback: (state: HallwayToolState) => void): () => void {
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
   * Get the current hallway width.
   */
  getWidth(): number {
    return this._width
  }

  /**
   * Set the hallway width.
   */
  setWidth(width: number): void {
    this._width = Math.max(0.5, width)
    this._notifyState()
  }

  /**
   * Check if there are enough vertices to form a hallway (min 2).
   */
  canConfirm(): boolean {
    return this._vertices.length >= 2
  }

  /**
   * Get the finalized polyline vertices and reset state.
   * Returns null if not enough vertices.
   */
  finalize(): LocalCoord[] | null {
    if (this._vertices.length < 2) return null
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
    this._width = DEFAULT_WIDTH
    this._notifyState()
  }

  private _notifyState(): void {
    this._onStateChange?.(this.state)
  }
}
