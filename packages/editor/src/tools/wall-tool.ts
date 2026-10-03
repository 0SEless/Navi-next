import type { Tool, ToolPointerEvent, ToolContext } from './types'
import type { LocalCoord } from '@navi/core'

const WALL_DEFAULTS = {
  thickness: 0.15,
  height: 3.5,
}

export interface WallToolState {
  drawing: boolean
  start: LocalCoord | null
  end: LocalCoord | null
}

export class WallTool implements Tool {
  readonly id = 'wall'
  readonly label = 'Wall'
  readonly cursor = 'crosshair'

  private drawing = false
  private start: LocalCoord | null = null
  private end: LocalCoord | null = null

  get state(): WallToolState {
    return {
      drawing: this.drawing,
      start: this.start ? { ...this.start } : null,
      end: this.end ? { ...this.end } : null,
    }
  }

  onActivate(_ctx: ToolContext): void {
    this.reset()
  }

  onDeactivate(_ctx: ToolContext): void {
    this.reset()
  }

  onPointerDown(event: ToolPointerEvent, _ctx: ToolContext): void {
    this.drawing = true
    this.start = { x: event.x, y: event.y }
    this.end = { x: event.x, y: event.y }
  }

  onPointerMove(event: ToolPointerEvent, _ctx: ToolContext): void {
    if (!this.drawing) return
    this.end = { x: event.x, y: event.y }
  }

  onPointerUp(event: ToolPointerEvent, ctx: ToolContext): void {
    if (!this.drawing || !this.start) {
      this.reset()
      return
    }

    this.end = { x: event.x, y: event.y }
    const wall = this.buildWallPayload()
    this.reset()

    ctx.services.dispatcher.execute({
      id: 'wall.create',
      label: 'Create Wall',
      payload: wall,
    })
  }

  onKeyDown(event: KeyboardEvent, _ctx: ToolContext): void {
    if (event.key === 'Escape') {
      this.reset()
    }
  }

  private buildWallPayload(): Record<string, unknown> {
    return {
      start: this.start!,
      end: this.end!,
      thickness: WALL_DEFAULTS.thickness,
      height: WALL_DEFAULTS.height,
      metadata: {},
    }
  }

  private reset(): void {
    this.drawing = false
    this.start = null
    this.end = null
  }
}
