import type { Tool, ToolPointerEvent, ToolContext } from './types'

const WINDOW_DEFAULTS = {
  width: 1.2,
  sillHeight: 0.9,
}

export interface WindowToolState {
  placing: boolean
  position: { x: number; y: number } | null
}

export class WindowTool implements Tool {
  readonly id = 'window'
  readonly label = 'Window'
  readonly cursor = 'crosshair'

  private placing = false
  private position: { x: number; y: number } | null = null

  get state(): WindowToolState {
    return {
      placing: this.placing,
      position: this.position ? { ...this.position } : null,
    }
  }

  onActivate(_ctx: ToolContext): void {
    this.reset()
  }

  onDeactivate(_ctx: ToolContext): void {
    this.reset()
  }

  onPointerDown(event: ToolPointerEvent, _ctx: ToolContext): void {
    this.placing = true
    this.position = { x: event.x, y: event.y }
  }

  onPointerMove(event: ToolPointerEvent, _ctx: ToolContext): void {
    if (!this.placing) return
    this.position = { x: event.x, y: event.y }
  }

  onPointerUp(_event: ToolPointerEvent, ctx: ToolContext): void {
    if (!this.placing || !this.position) {
      this.reset()
      return
    }

    const win = this.buildWindowPayload()
    this.reset()

    ctx.services.dispatcher.execute({
      id: 'window.create',
      label: 'Create Window',
      payload: win,
    })
  }

  onKeyDown(event: KeyboardEvent, _ctx: ToolContext): void {
    if (event.key === 'Escape') {
      this.reset()
    }
  }

  private buildWindowPayload(): Record<string, unknown> {
    return {
      buildingId: '',
      floorId: '',
      window: {
        wallId: '',
        offset: 0,
        width: WINDOW_DEFAULTS.width,
        sillHeight: WINDOW_DEFAULTS.sillHeight,
        metadata: {},
      },
    }
  }

  private reset(): void {
    this.placing = false
    this.position = null
  }
}
