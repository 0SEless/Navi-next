import type { PrimitiveContribution, NormalizedDocument, GenerationContext } from '../types'

let seqId = 0
function nextId(prefix: string): string {
  return `${prefix}-${++seqId}`
}

export function extractEntrances(document: NormalizedDocument, _context: GenerationContext): PrimitiveContribution {
  const nodes = []

  for (const building of document.buildings) {
    for (const floor of building.floors) {
      for (const entrance of floor.entrances) {
        const pos = {
          lat: (entrance.outdoorPosition.lat + entrance.indoorPosition.lat) / 2,
          lng: (entrance.outdoorPosition.lng + entrance.indoorPosition.lng) / 2,
        }
        const id = nextId('EP')
        nodes.push({
          id,
          kind: 'entrance_portal' as const,
          position: pos,
          outdoorPosition: entrance.outdoorPosition,
          indoorPosition: entrance.indoorPosition,
          floor: entrance.level,
          buildingId: building.id,
          entranceId: entrance.id,
          accessible: entrance.accessible,
          connectorRoadId: entrance.connectorRoadId,
          source: {
            entityId: entrance.id,
            entityType: 'entrance',
            field: 'position',
            generatorId: 'builtin:entrance-extractor',
          },
        })
      }
    }
  }

  return { nodes }
}
