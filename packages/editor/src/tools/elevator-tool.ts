import type { Tool, ToolContext } from './types'
import { RectanglePlacementTool } from './rectangle-placement-tool'
import type { RectanglePlacement } from './rectangle-placement-tool'
export type { RectanglePlacementState as ElevatorToolState } from './rectangle-placement-tool'

export class ElevatorTool extends RectanglePlacementTool implements Tool {
  readonly id = 'elevator'
  readonly label = 'Elevator'
  readonly cursor = 'crosshair'

  protected commitRectangle(placement: RectanglePlacement, ctx: ToolContext): void {
    const buildingId = ctx.services.viewport?.activeBuildingId
    const floorId = ctx.services.viewport?.activeFloorId
    const building = ctx.document?.buildings.find(candidate => candidate.id === buildingId)
    const floor = building?.floors.find(candidate => candidate.id === floorId)
    if (!buildingId || !floor) return
    ctx.services.dispatcher.execute({
      id: 'feature.create', label: 'Create Elevator',
      payload: {
        buildingId, floor: floor.level, featureType: 'elevator', position: placement.center,
        rotation: 0, polygon: { points: placement.points }, name: '',
        fromLevel: floor.level, toLevel: floor.level + 1,
      },
    })
  }
}
