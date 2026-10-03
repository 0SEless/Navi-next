import type { Tool, ToolPointerEvent, ToolContext } from './types'
import type { LocalCoord, EntranceType } from '@navi/core'

const ENTRANCE_DEFAULTS: { type: EntranceType; hasQR: boolean } = {
  type: 'side',
  hasQR: true,
}

export interface EntranceToolState {
  position: LocalCoord | null
}

export class EntranceTool implements Tool {
  readonly id = 'entrance'
  readonly label = 'Entrance'
  readonly cursor = 'crosshair'

  private position: LocalCoord | null = null

  get state(): EntranceToolState {
    return { position: this.position ? { ...this.position } : null }
  }

  onActivate(_ctx: ToolContext): void {
    this.position = null
  }

  onDeactivate(_ctx: ToolContext): void {
    this.position = null
  }

  onPointerDown(event: ToolPointerEvent, ctx: ToolContext): void {
    this.position = { x: event.x, y: event.y }
    
    const viewport = ctx.services.viewport
    const buildingId = viewport?.activeBuildingId
    const floorId = viewport?.activeFloorId

    if (buildingId && floorId) {
      const payload = this.buildPayload()
      ctx.services.dispatcher.execute({
        id: 'entrance.create',
        label: 'Create Entrance',
        payload: {
          buildingId,
          floorId,
          ...payload,
        },
      })
    }
  }

  onKeyDown(event: KeyboardEvent, _ctx: ToolContext): void {
    if (event.key === 'Escape') {
      this.position = null
    }
  }

  private buildPayload(): Record<string, unknown> {
    return {
      position: this.position!,
      type: ENTRANCE_DEFAULTS.type,
      hasQR: ENTRANCE_DEFAULTS.hasQR,
      metadata: {},
    }
  }
}
