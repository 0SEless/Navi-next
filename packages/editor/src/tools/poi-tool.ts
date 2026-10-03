import type { Tool, ToolPointerEvent, ToolContext } from './types'
import type { LocalCoord, POICategory } from '@navi/core'

export type POIToolMode = 'poi' | 'qr'

export interface POIToolState {
  placing: boolean
  position: LocalCoord | null
  mode: POIToolMode
}

const DEFAULT_POI_CATEGORY: POICategory = 'other' as POICategory

export class POITool implements Tool {
  readonly id = 'poi'
  readonly label = 'POI'
  readonly cursor = 'crosshair'

  private _placing = false
  private _position: LocalCoord | null = null
  private _mode: POIToolMode = 'poi'

  get state(): POIToolState {
    return {
      placing: this._placing,
      position: this._position ? { ...this._position } : null,
      mode: this._mode,
    }
  }

  get mode(): POIToolMode {
    return this._mode
  }

  setMode(mode: POIToolMode): void {
    this._mode = mode
  }

  onActivate(_ctx: ToolContext): void {
    this.reset()
  }

  onDeactivate(_ctx: ToolContext): void {
    this.reset()
  }

  onPointerDown(event: ToolPointerEvent, ctx: ToolContext): void {
    this._placing = true
    this._position = { x: event.x, y: event.y }

    const viewport = ctx.services.viewport
    const buildingId = viewport?.activeBuildingId
    const floorId = viewport?.activeFloorId

    if (buildingId && floorId) {
      if (this._mode === 'poi') {
        ctx.services.dispatcher.execute({
          id: 'poi.create',
          label: 'Create POI',
          payload: {
            buildingId,
            floorId,
            name: '',
            category: DEFAULT_POI_CATEGORY,
            position: { x: event.x, y: event.y },
            metadata: {},
          },
        })
      } else {
        ctx.services.dispatcher.execute({
          id: 'qr.create',
          label: 'Create QR Checkpoint',
          payload: {
            buildingId,
            floorId,
            label: '',
            position: { x: event.x, y: event.y },
            level: 0,
            code: '',
          },
        })
      }
    }

    this.reset()
  }

  onPointerMove(event: ToolPointerEvent, _ctx: ToolContext): void {
    if (this._placing) {
      this._position = { x: event.x, y: event.y }
    }
  }

  onPointerUp(_event: ToolPointerEvent, _ctx: ToolContext): void {
    // no-op: placement happens on pointer down
  }

  onKeyDown(event: KeyboardEvent, _ctx: ToolContext): void {
    if (event.key === 'Escape') {
      this.reset()
    }
  }

  private reset(): void {
    this._placing = false
    this._position = null
  }
}
