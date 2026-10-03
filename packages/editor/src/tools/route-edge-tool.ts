import type { Tool, ToolPointerEvent, ToolContext } from './types'
import type { RouteEdgeType } from '@navi/core'

const ROUTE_EDGE_DEFAULTS: { type: RouteEdgeType } = { type: 'walk' }

export interface RouteEdgeToolState {
  firstNodeId: string | null
}

export class RouteEdgeTool implements Tool {
  readonly id = 'route-edge'
  readonly label = 'Route Edge'
  readonly cursor = 'crosshair'

  private firstNodeId: string | null = null

  get state(): RouteEdgeToolState {
    return { firstNodeId: this.firstNodeId }
  }

  onActivate(_ctx: ToolContext): void {
    this.firstNodeId = null
  }

  onDeactivate(_ctx: ToolContext): void {
    this.firstNodeId = null
  }

  onPointerDown(event: ToolPointerEvent, ctx: ToolContext): void {
    if (this.firstNodeId === null) {
      this.firstNodeId = String(event.x)
    } else {
      const secondNodeId = String(event.x)
      ctx.services.dispatcher.execute({
        id: 'route.edge.create',
        label: 'Create Route Edge',
        payload: {
          edge: {
            from: this.firstNodeId,
            to: secondNodeId,
            type: ROUTE_EDGE_DEFAULTS.type,
          },
        },
      })
      this.firstNodeId = null
    }
  }

  onKeyDown(event: KeyboardEvent, _ctx: ToolContext): void {
    if (event.key === 'Escape') {
      this.firstNodeId = null
    }
  }
}
