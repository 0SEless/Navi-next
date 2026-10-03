import type { Tool, ToolPointerEvent, ToolContext } from './types'
import type { LocalCoord } from '@navi/core'

export interface MeasureToolState {
  measuring: boolean
  start: LocalCoord | null
  end: LocalCoord | null
  distance: number | null
}

function euclideanDistance(a: LocalCoord, b: LocalCoord): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

export class MeasureTool implements Tool {
  readonly id = 'measure'
  readonly label = 'Measure'
  readonly cursor = 'crosshair'

  private _measuring = false
  private _start: LocalCoord | null = null
  private _end: LocalCoord | null = null
  private _distance: number | null = null

  get state(): MeasureToolState {
    return {
      measuring: this._measuring,
      start: this._start ? { ...this._start } : null,
      end: this._end ? { ...this._end } : null,
      distance: this._distance,
    }
  }

  onActivate(_ctx: ToolContext): void {
    this.reset()
  }

  onDeactivate(_ctx: ToolContext): void {
    this.reset()
  }

  onPointerDown(event: ToolPointerEvent, _ctx: ToolContext): void {
    if (!this._measuring) {
      this._measuring = true
      this._start = { x: event.x, y: event.y }
      this._end = { x: event.x, y: event.y }
      this._distance = 0
    }
  }

  onPointerMove(event: ToolPointerEvent, _ctx: ToolContext): void {
    if (!this._measuring || !this._start) return
    this._end = { x: event.x, y: event.y }
    this._distance = euclideanDistance(this._start, this._end)
  }

  onPointerUp(event: ToolPointerEvent, _ctx: ToolContext): void {
    if (!this._measuring || !this._start) return
    this._end = { x: event.x, y: event.y }
    this._distance = euclideanDistance(this._start, this._end)
  }

  onKeyDown(event: KeyboardEvent, _ctx: ToolContext): void {
    if (event.key === 'Escape') {
      this.reset()
    }
  }

  private reset(): void {
    this._measuring = false
    this._start = null
    this._end = null
    this._distance = null
  }
}
