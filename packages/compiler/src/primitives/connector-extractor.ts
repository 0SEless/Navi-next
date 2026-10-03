import type { PrimitiveContribution, NormalizedDocument, GenerationContext } from '../types'

let seqId = 0
function nextId(prefix: string): string {
  return `${prefix}-${++seqId}`
}

/**
 * ConnectorExtractor produces Transition nodes for vertical movement:
 *  1. Legacy path: one node per ConnectorStop, grouped by connectorId
 *     (pairing happens in Phase 2.3).
 *  2. P1-T9 (R2.6/D19): levels-based stair/elevator features emit ONE node
 *     per ACCESS floor present in `levels` (absent floors simply absent,
 *     never zero-filled), at that floor's OWN placement, connectorId =
 *     feature id. When a building carries feature staircases/elevators, the
 *     legacy connector-stop path for stair/elevator connectors is SKIPPED
 *     (features are authoritative — no duplicate stair nodes).
 */
export function extractConnectors(document: NormalizedDocument, _context: GenerationContext): PrimitiveContribution {
  const nodes = []

  for (const building of document.buildings) {
    const hasFeatureStairs = (building.staircases ?? []).length > 0
    const hasFeatureElevators = (building.elevators ?? []).length > 0

    // Legacy connector stops (suppressed per-connector when features exist)
    for (const floor of building.floors) {
      for (const stop of floor.connectorStops) {
        if (hasFeatureStairs && stop.behavior === 'stairs') continue
        if (hasFeatureElevators && stop.behavior === 'elevator') continue
        const id = nextId('T')
        nodes.push({
          id,
          kind: 'transition' as const,
          position: stop.position,
          floor: stop.floor,
          buildingId: building.id,
          connectorId: stop.connectorId,
          stopId: stop.id,
          behavior: stop.behavior,
          accessible: stop.accessible,
          baseCost: stop.baseCost,
          source: {
            entityId: stop.id,
            entityType: 'connector_stop',
            field: 'position',
            generatorId: 'builtin:connector-extractor',
          },
        })
      }
    }

    // P1-T9: feature levels → one transition node per access floor
    for (const st of building.staircases ?? []) {
      for (const [levelKey, geom] of Object.entries(st.levels)) {
        const level = Number(levelKey)
        if (!Number.isInteger(level)) continue
        nodes.push({
          id: nextId('T'),
          kind: 'transition' as const,
          position: geom.position,
          floor: level,
          buildingId: building.id,
          connectorId: st.id,
          behavior: 'stairs',
          accessible: st.accessible,
          baseCost: 15,
          source: {
            entityId: st.id,
            entityType: 'staircase',
            field: 'position',
            generatorId: 'builtin:connector-extractor',
          },
        })
      }
    }
    for (const el of building.elevators ?? []) {
      for (const [levelKey, geom] of Object.entries(el.levels)) {
        const level = Number(levelKey)
        if (!Number.isInteger(level)) continue
        nodes.push({
          id: nextId('T'),
          kind: 'transition' as const,
          position: geom.position,
          floor: level,
          buildingId: building.id,
          connectorId: el.id,
          behavior: 'elevator',
          accessible: el.accessible,
          baseCost: 20,
          source: {
            entityId: el.id,
            entityType: 'elevator',
            field: 'position',
            generatorId: 'builtin:connector-extractor',
          },
        })
      }
    }
  }

  return { nodes }
}