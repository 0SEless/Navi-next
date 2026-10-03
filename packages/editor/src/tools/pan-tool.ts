import type { Tool, ToolPointerEvent, ToolContext } from './types'

export interface PanToolState {
  panning: boolean
  lastX: number
  lastY: number
}

export class PanTool implements Tool {
  readonly id = 'pan'
  readonly label = 'Pan'
  readonly cursor = 'grab'

  private _panning = false
  private _lastX = 0
  private _lastY = 0

  get state(): PanToolState {
    return {
      panning: this._panning,
      lastX: this._lastX,
      lastY: this._lastY,
    }
  }

  onActivate(_ctx: ToolContext): void {
    this.reset()
  }

  onDeactivate(_ctx: ToolContext): void {
    this.reset()
  }

  onPointerDown(event: ToolPointerEvent, _ctx: ToolContext): void {
    this._panning = true
    this._lastX = event.x
    this._lastY = event.y
  }

  onPointerMove(event: ToolPointerEvent, ctx: ToolContext): void {
    if (!this._panning) return

    const dx = event.x - this._lastX
    const dy = event.y - this._lastY
    this._lastX = event.x
    this._lastY = event.y

    ctx.services.viewport.panTo({
      lat: ctx.services.viewport.center.lat - dy * 0.00001,
      lng: ctx.services.viewport.center.lng - dx * 0.00001,
    })
  }

  onPointerUp(_event: ToolPointerEvent, _ctx: ToolContext): void {
    this._panning = false
  }

  onKeyDown(event: KeyboardEvent, _ctx: ToolContext): void {
    if (event.key === 'Escape') {
      this.reset()
    }
  }

  private reset(): void {
    this._panning = false
    this._lastX = 0
    this._lastY = 0
  }
}
