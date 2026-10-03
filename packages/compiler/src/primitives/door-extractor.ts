import type { PrimitiveContribution, NormalizedDocument, GenerationContext, DoorSpec } from '../types'

/**
 * DoorExtractor produces DoorSpec records — it does NOT emit edges.
 * Edge resolution (nearest-waypoint) happens in Phase 2.3.
 */
export function extractDoors(document: NormalizedDocument, _context: GenerationContext): PrimitiveContribution {
  const doorSpecs: DoorSpec[] = []

  for (const building of document.buildings) {
    for (const floor of building.floors) {
      for (const room of floor.rooms) {
        for (const door of room.doors) {
          doorSpecs.push({
            roomId: room.id,
            doorId: door.id,
            position: door.position,
            floor: floor.level,
            buildingId: building.id,
            width: door.width,
            properties: door.properties,
          })
        }
      }
    }
  }

  return { doorSpecs }
}
