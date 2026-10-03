import type { Tool, ToolPointerEvent, ToolContext } from './types'
import type { LocalCoord, RouteNodeType } from '@navi/core'

const ROUTE_NODE_DEFAULTS: { type: RouteNodeType } = { type: 'waypoint' }

export interface RouteNodeToolState {
  position: LocalCoord | null
}

export class RouteNodeTool implements Tool {
  readonly id = 'route-node'
  readonly label = 'Route Node'
  readonly cursor = 'crosshair'

  private position: LocalCoord | null = null

  get state(): RouteNodeToolState {
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
    const payload = this.buildPayload()
    ctx.services.dispatcher.execute({
      id: 'route.node.create',
      label: 'Create Route Node',
      payload,
    })
  }

  onKeyDown(event: KeyboardEvent, _ctx: ToolContext): void {
    if (event.key === 'Escape') {
      this.position = null
    }
  }

  private buildPayload(): Record<string, unknown> {
    return {
      node: {
        type: ROUTE_NODE_DEFAULTS.type,
        position: this.position!,
      },
    }
  }
}
