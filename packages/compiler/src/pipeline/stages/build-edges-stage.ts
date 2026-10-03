import type { CampusDocument } from '@navi/core'
import { haversine } from '@navi/core'
import type {
  CompilerStagePlugin,
  CompilerStageInput,
  CompilerStageOutput,
  NavNode,
  NavEdge,
  ParsedDocument,
} from '../../types'
import { verticalEdgeDistance } from '../../primitives/vertical-distance'

/**
 * Stage 3: Build Edges — Connects nodes based on entity relationships.
 * Room↔Hallway, Hallway↔Entrance, Entrance↔Road, etc.
 */
export class BuildEdgesStage implements CompilerStagePlugin {
  id = 'compiler-build-edges-stage'
  targetStage = 'build-edges' as const
  mode = 'replace' as const
  meta = {
    name: 'Build Edges Stage',
    version: '1.0.0',
    description: 'Creates edges between nodes from authored relationships and same-floor indoor topology',
  }

  execute(input: CompilerStageInput, _next: (input: CompilerStageInput) => CompilerStageOutput): CompilerStageOutput {
    const nodes = input.nodes
    const parsed = input.context?.parsed as ParsedDocument | undefined

    if (!nodes || !parsed) {
      return { errors: [{ code: 'MISSING_INPUT', message: 'BuildEdgesStage requires nodes and parsed document' }] }
    }

    const edges = buildEdges(nodes, parsed)
    return { edges }
  }
}

function edgeKey(a: string, b: string): string {
  return a < b ? `${a}--${b}` : `${b}--${a}`
}

export function buildEdges(nodes: NavNode[], parsed: ParsedDocument): NavEdge[] {
  const edges: NavEdge[] = []
  const seen = new Set<string>()
  let idx = 0

  // Group nodes by building+floor
  const byFloor = new Map<string, NavNode[]>()
  for (const node of nodes) {
    const key = `${node.buildingId}:${node.floor}`
    if (!byFloor.has(key)) byFloor.set(key, [])
    byFloor.get(key)!.push(node)
  }

  // Within each floor: connect rooms to nearest hallway/entrance
  for (const [, floorNodes] of byFloor) {
    const spaceNodes = floorNodes.filter(n => n.type === 'space')
    const corridorNodes = floorNodes.filter(n => n.type === 'corridor')
    const transitionNodes = floorNodes.filter(n => n.type === 'transition')

    for (const sn of spaceNodes) {
      // Nearest corridor (hallway) — this is the ONLY valid connection for a
      // room access point. The room is reached via its door on the hallway.
      let bestCorridorDist = Infinity
      let bestCorridor: NavNode | null = null
      for (const cn of corridorNodes) {
        const d = haversine(sn.position, cn.position)
        if (d < bestCorridorDist) { bestCorridorDist = d; bestCorridor = cn }
      }
      if (bestCorridor && bestCorridorDist < 200) {
        const key = edgeKey(sn.id, bestCorridor.id)
        if (!seen.has(key)) {
          seen.add(key)
          edges.push({
            id: `edge-${idx++}`,
            from: sn.id,
            to: bestCorridor.id,
            type: 'walk',
            distance: bestCorridorDist,
            weight: bestCorridorDist,
          })
        }
      }

      // NOTE: rooms (space nodes) intentionally do NOT connect to transitions
      // (entrances) or other rooms. The valid routing model is:
      //   road → entrance → hallway → room door
      // Connecting rooms directly to entrances or to each other would create
      // shortcuts that bypass the hallway network (see valid-connection model).
    }

    // Connect transitions to the routing network.
    // Valid model: road → entrance → hallway → room door.
    // - ENTRANCES (entityType 'entrance') retain the legacy same-floor
    //   hallway link for documents that predate explicit EntranceAccess.
    //   Outdoor route links are only honored when an explicit legacy connector
    //   field names the road; proximity is never used for this relationship.
    // - STAIRS/ELEVATORS (entityType 'staircase'/'elevator') are per-floor
    //   nodes: they link to the nearest hallway ON THEIR FLOOR and chain
    //   vertically to the same entity's node on adjacent floors (below).
    //   They NEVER link to roads — only entrances bridge indoor↔outdoor.
    const outdoorCorridors = (byFloor.get(':0') ?? []).filter(n => n.type === 'corridor')
    for (const tn of transitionNodes) {
      // Edge 1: transition ↔ nearest hallway
      let bestHallwayDist = Infinity
      let bestHallway: NavNode | null = null
      for (const cn of corridorNodes) {
        const d = haversine(tn.position, cn.position)
        if (d < bestHallwayDist) { bestHallwayDist = d; bestHallway = cn }
      }
      if (bestHallway && bestHallwayDist < 200) {
        const key = edgeKey(tn.id, bestHallway.id)
        if (!seen.has(key)) {
          seen.add(key)
          edges.push({
            id: `edge-${idx++}`,
            from: tn.id,
            to: bestHallway.id,
            type: 'walk',
            distance: bestHallwayDist,
            weight: bestHallwayDist,
          })
        }
      }

      if (tn.properties?.entityType !== 'entrance') continue
      const entranceId = String(tn.properties.entityId || '')
      const explicitRoadId = typeof tn.properties.connectorRoadId === 'string' && tn.properties.connectorRoadId.length > 0
        ? tn.properties.connectorRoadId
        : parsed.roads.find((road) => road.connectorEntranceId === entranceId)?.id
      if (!explicitRoadId) continue

      const explicitRoad = outdoorCorridors.find((candidate) => candidate.properties?.entityId === explicitRoadId)
      if (!explicitRoad) continue
      const key = edgeKey(tn.id, explicitRoad.id)
      if (!seen.has(key)) {
        seen.add(key)
        const distance = haversine(tn.position, explicitRoad.position)
        edges.push({
          id: `edge-${idx++}`,
          from: tn.id,
          to: explicitRoad.id,
          type: 'walk',
          distance,
          weight: distance,
        })
      }

    }

    // Connect corridor end-to-end (hallway segments)
    // Group corridor nodes by entityId
    const byEntity = new Map<string, NavNode[]>()
    for (const cn of corridorNodes) {
      const eid = String(cn.properties.entityId || '')
      if (!byEntity.has(eid)) byEntity.set(eid, [])
      byEntity.get(eid)!.push(cn)
    }
    for (const [, group] of byEntity) {
      for (let i = 0; i < group.length - 1; i++) {
        const d = haversine(group[i].position, group[i + 1].position)
        const key = edgeKey(group[i].id, group[i + 1].id)
        if (!seen.has(key)) {
          seen.add(key)
          edges.push({
            id: `edge-${idx++}`,
            from: group[i].id,
            to: group[i + 1].id,
            type: 'walk',
            distance: d,
            weight: d,
          })
        }
      }
    }
  }

  // Vertical chains: chain each stair/elevator's per-floor nodes across
  // adjacent floors (staircase/elevator ↔ staircase/elevator). Without this,
  // the F0 stair node and the F1 stair node would be separate components and
  // upper floors would be unreachable.
  //
  // P1-T17: edge distance = authored floor-elevation delta where both floors
  // are known; ROUTE_NETWORK_THRESHOLDS.verticalEdgeFallbackMeters otherwise.
  // Single source: vertical-distance.ts (risk R7) — the old fixed 4 m
  // literals lived here and in the primitives connector.
  const elevationsByBuilding = new Map<string, Record<number, number>>()
  for (const b of parsed.buildings) {
    if (b.floorElevations) elevationsByBuilding.set(b.id, b.floorElevations)
  }
  const byVerticalEntity = new Map<string, NavNode[]>()
  for (const node of nodes) {
    if (node.type !== 'transition') continue
    const et = node.properties?.entityType
    if (et !== 'staircase' && et !== 'elevator') continue
    const eid = String(node.properties.entityId || '')
    if (!byVerticalEntity.has(eid)) byVerticalEntity.set(eid, [])
    byVerticalEntity.get(eid)!.push(node)
  }
  for (const [, group] of byVerticalEntity) {
    const sorted = [...group].sort((a, b) => a.floor - b.floor)
    const edgeType = sorted[0]?.properties?.entityType === 'elevator' ? 'elevator' : 'stairs'
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i]
      const b = sorted[i + 1]
      if (a.floor === b.floor) continue
      const key = edgeKey(a.id, b.id)
      if (seen.has(key)) continue
      seen.add(key)
      const dist = verticalEdgeDistance(
        elevationsByBuilding.get(a.buildingId)?.[a.floor],
        elevationsByBuilding.get(b.buildingId)?.[b.floor],
      )
      edges.push({
        id: `edge-${idx++}`,
        from: a.id,
        to: b.id,
        type: edgeType,
        distance: dist,
        weight: dist,
      })
    }
  }

  return edges
}
