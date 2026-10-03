import type { PrimitiveContribution, NormalizedDocument, GenerationContext, CompilerDiagnostic } from '../types'

let seqId = 0
function nextId(prefix: string): string {
  return `${prefix}-${++seqId}`
}

export function extractRooms(document: NormalizedDocument, _context: GenerationContext): PrimitiveContribution {
  const nodes = []
  const diagnostics: CompilerDiagnostic[] = []

  for (const building of document.buildings) {
    for (const floor of building.floors) {
      for (const room of floor.rooms) {
        const id = nextId('POI')
        nodes.push({
          id,
          kind: 'poi' as const,
          label: `${room.name} (${room.number})`,
          position: room.centroid,
          floor: floor.level,
          buildingId: building.id,
          poiCategory: 'room',
          source: {
            entityId: room.id,
            entityType: 'room',
            field: 'centroid',
            generatorId: 'builtin:room-extractor',
          },
        })

        if (room.doors.length === 0) {
          diagnostics.push({
            severity: 'info',
            sourceEntityId: room.id,
            phase: 'primitives',
            code: 'ROOM_NO_DOOR',
            message: `Room "${room.name}" has no RoomDoor — using centroid fallback`,
            relatedNodeIds: [id],
          })
        }
      }
    }
  }

  return { nodes, diagnostics }
}
