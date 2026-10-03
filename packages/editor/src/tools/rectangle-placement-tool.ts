import { localRectangleFromDrag, normalizeLocalRectangle } from '@navi/core'
import type { LocalCoord } from '@navi/core'
import type { ToolContext, ToolPointerEvent } from './types'

export interface RectanglePlacementState {
  phase: 'idle' | 'dragging'
  start: LocalCoord | null
  current: LocalCoord | null
  /** Legacy click-placement compatibility: rectangles never remain placed. */
  placed: false
}

export interface RectanglePlacement {
  min: LocalCoord
  max: LocalCoord
  center: LocalCoord
  width: number
  depth: number
  points: LocalCoord[]
}

const MIN_RECTANGLE_SIDE_METERS = 0.2

/** Shared click-drag-release interaction for spatial indoor rectangles. */
export abstract class RectanglePlacementTool {
  private start: LocalCoord | null = null
  private current: LocalCoord | null = null

  get state(): RectanglePlacementState {
    return {
      phase: this.start ? 'dragging' : 'idle',
      start: this.start ? { ...this.start } : null,
      current: this.current ? { ...this.current } : null,
      placed: false,
    }
  }

  get preview(): LocalCoord[] | null {
    return this.start && this.current ? localRectangleFromDrag(this.start, this.current) : null
  }

  onActivate(): void { this.resetRectangle() }
  onDeactivate(): void { this.resetRectangle() }

  onPointerDown(event: ToolPointerEvent, _ctx: ToolContext): void {
    void _ctx
    if (event.button !== 0 || this.start) return
    this.start = { x: event.x, y: event.y }
    this.current = { ...this.start }
  }

  onPointerMove(event: ToolPointerEvent, _ctx: ToolContext): void {
    void _ctx
    if (!this.start) return
    this.current = { x: event.x, y: event.y }
  }

  onPointerUp(event: ToolPointerEvent, ctx: ToolContext): void {
    if (!this.start) return
    const end = { x: event.x, y: event.y }
    const { min, max } = normalizeLocalRectangle(this.start, end)
    const width = max.x - min.x
    const depth = max.y - min.y
    const placement: RectanglePlacement | null = width >= MIN_RECTANGLE_SIDE_METERS && depth >= MIN_RECTANGLE_SIDE_METERS
      ? {
          min, max, width, depth,
          center: { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2 },
          points: localRectangleFromDrag(min, max),
        }
      : null
    this.resetRectangle()
    if (placement) this.commitRectangle(placement, ctx)
  }

  onKeyDown(event: KeyboardEvent, _ctx: ToolContext): void {
    void _ctx
    if (event.key === 'Escape') this.resetRectangle()
  }

  protected abstract commitRectangle(placement: RectanglePlacement, ctx: ToolContext): void

  protected resetRectangle(): void {
    this.start = null
    this.current = null
  }
}
