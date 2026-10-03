import type { Tool, ToolContext } from './types'
import { RectanglePlacementTool } from './rectangle-placement-tool'
import type { RectanglePlacement } from './rectangle-placement-tool'
export type { RectanglePlacementState as DoorToolState } from './rectangle-placement-tool'

/** Spatial Door authoring; wall openings remain a separate legacy entity. */
export class DoorTool extends RectanglePlacementTool implements Tool {
  readonly id = 'door'
  readonly label = 'Door'
  readonly cursor = 'crosshair'

  protected commitRectangle(placement: RectanglePlacement, ctx: ToolContext): void {
    const buildingId = ctx.services.viewport?.activeBuildingId
    const floorId = ctx.services.viewport?.activeFloorId
    if (!buildingId || !floorId) return
    ctx.services.dispatcher.execute({
      id: 'door.create',
      label: 'Create Door',
      payload: {
        buildingId,
        floorId,
        door: {
          name: 'Door',
          doorType: 'standard',
          position: placement.center,
          width: placement.width,
          depth: placement.depth,
          rotation: 0,
          geometry: { type: 'rectangle', min: placement.min, max: placement.max, rotation: 0 },
          metadata: {},
        },
      },
    })
  }
}
