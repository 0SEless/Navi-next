import { haversineDistance, ROUTE_NETWORK_THRESHOLDS, SpatialQueryService } from '@navi/core'
import type {
  PrimitiveGraph,
  PrimitiveNode,
  PrimitiveEdge,
  CompilerDiagnostic,
  DoorSpec,
} from '../types'
import { verticalEdgeDistance, elevationKey } from './vertical-distance'
import type { CanonicalAccessResult } from './canonical-access-compiler'

let seqId = 0
function nextId(prefix: string): string {
  return `${prefix}-${++seqId}`
}

function buildSpatialIndex(nodes: PrimitiveNode[]): SpatialQueryService {
  const svc = new SpatialQueryService()
  svc.loadFromNodes(nodes.map(n => ({
    id: n.id,
    position: n.position,
    type: n.kind,
    floor: n.floor,
    buildingId: n.buildingId,
  })))
  return svc
}

function findNearestWaypoint(
  pos: { lat: number; lng: number },
  nodes: PrimitiveNode[],
  floor: number,
  buildingId: string,
): PrimitiveNode | null {
  const eligibleNodes = nodes.filter(node =>
    node.kind === 'waypoint' && node.floor === floor && node.buildingId === buildingId,
  )
  const svc = buildSpatialIndex(eligibleNodes)
  const result = svc.nearestEntity(pos, {
    type: 'waypoint',
    floorId: String(floor),
    buildingId,
    maxDistance: ROUTE_NETWORK_THRESHOLDS.compilerFallbackMeters,
  })
  if (!result) return null
  return eligibleNodes.find(n => n.id === result.entity.id) ?? null
}

export interface ConnectResult {
  edges: PrimitiveEdge[]
  diagnostics: CompilerDiagnostic[]
}

/** Reverse link map: entranceId → roadId (built from NormalizedRoad.connectorEntranceId). */
export type RoadLinkIndex = Map<string, string>

/**
 * Phase 2.3: Connect & Resolve.
 *
 * This is the ONLY phase that performs spatial search (nearest-neighbor).
 * After this phase, no spatial search ever occurs again.
 *
 * Responsibilities:
 *  - AccessEdge generation: doors → nearest waypoint
 *  - TransitionEdge generation: connector stops → paired edges
 *  - PortalEdge generation: entrance portal → implicit edge
 *  - Entrance-to-road connection: explicit legacy connector link → road waypoint
 *    (unassigned entrances remain unconnected until an author creates
 *    EntranceAccess through the controlled route picker)
 */
/**
 * Authored floor elevations keyed `${buildingId}:${level}` (see elevationKey).
 * Built by the coordinator from the normalized document; when absent, every
 * vertical edge falls back to ROUTE_NETWORK_THRESHOLDS.verticalEdgeFallbackMeters.
 */
export type ElevationIndex = ReadonlyMap<string, number>

export function connectPrimitives(
  graph: PrimitiveGraph,
  doorSpecs: DoorSpec[],
  roadLinks: RoadLinkIndex = new Map(),
  _maxRoadDistance = 50,
  elevations?: ElevationIndex,
  canonicalAccess?: CanonicalAccessResult,
): ConnectResult {
  const edges: PrimitiveEdge[] = []
  const diagnostics: CompilerDiagnostic[] = []
  const nodes = graph.nodes

  // Build lookup: connectorId → [TransitionNode] grouped and sorted by floor
  const connectorGroups = new Map<string, PrimitiveNode[]>()
  for (const node of nodes) {
    if (node.kind === 'transition') {
      const group = connectorGroups.get(node.connectorId) || []
      group.push(node)
      connectorGroups.set(node.connectorId, group)
    }
  }

  // Build lookup: entrance portal nodes by id
  const portalNodes = new Map<string, PrimitiveNode>()
  for (const node of nodes) {
    if (node.kind === 'entrance_portal') {
      portalNodes.set(node.id, node)
    }
  }

  // 1. AccessEdge generation (door → nearest waypoint)
  // W15D: Suppress legacy door→waypoint for rooms with canonical RoomAccess
  for (const spec of doorSpecs) {
    if (canonicalAccess?.canonicalRoomIds.has(spec.roomId)) continue

    const waypoint = findNearestWaypoint(spec.position, nodes, spec.floor, spec.buildingId)
    if (!waypoint) {
      diagnostics.push({
        severity: 'warning',
        sourceEntityId: spec.doorId,
        phase: 'primitives',
        code: 'DOOR_ORPHANED',
        message: `Door "${spec.doorId}" (room ${spec.roomId}) has no waypoint on floor ${spec.floor}`,
      })
      continue
    }

    // Find the room's POI node
    const poiNode = nodes.find(
      n => n.kind === 'poi' && n.source.entityId === spec.roomId && n.floor === spec.floor,
    )
    if (!poiNode) continue // shouldn't happen if room-extractor ran

    edges.push({
      id: nextId('AE'),
      kind: 'access',
      from: poiNode.id,
      to: waypoint.id,
      distance: haversineDistance(spec.position, waypoint.position),
      accessType: 'door',
      width: spec.width,
      source: {
        entityId: spec.doorId,
        entityType: 'room_door',
        generatorId: 'builtin:connector',
      },
    })
  }

  // 2. TransitionEdge generation (connector stop → paired edges)
  // W15D: Suppress legacy transition edges for features with canonical VerticalTransitions
  for (const [connectorId, stops] of connectorGroups) {
    if (canonicalAccess?.canonicalFeatureIds.has(connectorId)) continue

    // Sort by floor ascending
    stops.sort((a, b) => a.floor - b.floor)

    for (let i = 0; i < stops.length - 1; i++) {
      const upper = stops[i]
      const lower = stops[i + 1]
      const gap = lower.floor - upper.floor

      if (gap > 1) {
        diagnostics.push({
          severity: 'info',
          sourceEntityId: connectorId,
          phase: 'primitives',
          code: 'VERTICAL_GAP',
          message: `Connector "${connectorId}" skips floor ${upper.floor + 1} between stops at ${upper.floor} and ${lower.floor}`,
          relatedNodeIds: [upper.id, lower.id],
        })
      }

      const tUpper = upper as import('../types').TransitionNode
      const tLower = lower as import('../types').TransitionNode
      edges.push({
        id: nextId('TE'),
        kind: 'transition',
        from: upper.id,
        to: lower.id,
        // P1-T17: authored floor-elevation delta where both floors are
        // known; documented fallback constant otherwise. Single source:
        // vertical-distance.ts (risk R7). The old haversine here measured
        // the HORIZONTAL offset between per-floor placements (~0 for
        // stacked placements) — never the vertical travel distance.
        distance: verticalEdgeDistance(
          elevations?.get(elevationKey(upper.buildingId, upper.floor)),
          elevations?.get(elevationKey(lower.buildingId, lower.floor)),
        ),
        behavior: tUpper.behavior,
        baseCost: tUpper.baseCost,
        source: {
          entityId: connectorId,
          entityType: 'vertical_connector',
          generatorId: 'builtin:connector',
        },
      })
    }

    // Single stop → paired
    if (stops.length === 1) {
      diagnostics.push({
        severity: 'warning',
        sourceEntityId: connectorId,
        phase: 'primitives',
        code: 'STOP_UNPAIRED',
        message: `Connector "${connectorId}" has only one stop — no transition edge created`,
        relatedNodeIds: [stops[0].id],
      })
    }
  }

  // 3. Connect transition nodes to nearest waypoint on same floor
  // W15D: Suppress for features with canonical VerticalTransitions
  for (const node of nodes) {
    if (node.kind !== 'transition') continue
    const tNode = node as import('../types').TransitionNode
    if (canonicalAccess?.canonicalFeatureIds.has(tNode.connectorId)) continue
    const nearest = findNearestWaypoint(node.position, nodes, node.floor, node.buildingId)
    if (nearest) {
      edges.push({
        id: nextId('AE'),
        kind: 'access',
        from: node.id,
        to: nearest.id,
        distance: haversineDistance(node.position, nearest.position),
        accessType: 'transition',
        width: 2,
        source: {
          entityId: (node as import('../types').TransitionNode).connectorId,
          entityType: 'vertical_connector',
          generatorId: 'builtin:connector',
        },
      })
    }
  }

  // 4. PortalEdge generation
  // W15D: Suppress for entrances with canonical EntranceAccess
  for (const node of portalNodes.values()) {
    if (node.kind !== 'entrance_portal') continue
    const portalNode = node as import('../types').EntrancePortalNode
    if (canonicalAccess?.canonicalEntranceIds.has(portalNode.entranceId)) continue
    const d = haversineDistance(portalNode.outdoorPosition, portalNode.indoorPosition)
    edges.push({
      id: nextId('PE'),
      kind: 'portal',
      nodeId: portalNode.id,
      distance: d,
      source: {
        entityId: portalNode.entranceId,
        entityType: 'entrance',
        generatorId: 'builtin:connector',
      },
    })
  }

  // 5. Connect entrance portals to indoor waypoints
  // W15D: Suppress for entrances with canonical EntranceAccess
  for (const node of portalNodes.values()) {
    if (node.kind !== 'entrance_portal') continue
    const portalNode = node as import('../types').EntrancePortalNode
    if (canonicalAccess?.canonicalEntranceIds.has(portalNode.entranceId)) continue
    const indoorWp = findNearestWaypoint(
      portalNode.indoorPosition,
      nodes,
      portalNode.floor,
      portalNode.buildingId,
    )
    if (indoorWp) {
      edges.push({
        id: nextId('AE'),
        kind: 'access',
        from: portalNode.id,
        to: indoorWp.id,
        distance: haversineDistance(portalNode.indoorPosition, indoorWp.position),
        accessType: 'entrance',
        width: 2,
        source: {
          entityId: portalNode.entranceId,
          entityType: 'entrance',
          generatorId: 'builtin:connector',
        },
      })
    } else {
      diagnostics.push({
        severity: 'warning',
        sourceEntityId: portalNode.entranceId,
        phase: 'primitives',
        code: 'ENTRANCE_UNCONNECTED',
        message: `Entrance "${portalNode.entranceId}" has no waypoint on floor ${portalNode.floor}`,
        relatedNodeIds: [portalNode.id],
      })
    }
  }

  // 6. Entrance-to-road connection
  // W15D: Suppress for entrances with canonical EntranceAccess
  //
  // Pre-group floor-0 waypoints by road ID for explicit link search
  const roadWaypointsByRoad = new Map<string, PrimitiveNode[]>()
  for (const n of nodes) {
    if (n.kind !== 'waypoint' || n.floor !== 0) continue
    const roadId = n.source.entityId
    const group = roadWaypointsByRoad.get(roadId) || []
    group.push(n)
    roadWaypointsByRoad.set(roadId, group)
  }

  for (const node of portalNodes.values()) {
    if (node.kind !== 'entrance_portal') continue
    const portalNode = node as import('../types').EntrancePortalNode
    if (canonicalAccess?.canonicalEntranceIds.has(portalNode.entranceId)) continue

    // Resolve target road id: explicit forward link, then reverse link, then null
    const explicitRoadId =
      portalNode.connectorRoadId || roadLinks.get(portalNode.entranceId) || null

    let roadWaypoint: PrimitiveNode | null = null
    let explicit = false

    if (explicitRoadId) {
      // Nearest waypoint belonging to the explicit road (floor 0 only)
      // Build a dedicated spatial index from just this road's waypoints
      const roadNodes = roadWaypointsByRoad.get(explicitRoadId) || []
      if (roadNodes.length > 0) {
        const roadOnlySvc = buildSpatialIndex(roadNodes)
        const result = roadOnlySvc.nearestEntity(portalNode.outdoorPosition)
        if (result) roadWaypoint = roadNodes.find(n => n.id === result.entity.id) ?? null
      }
      explicit = true

      if (!roadWaypoint) {
        diagnostics.push({
          severity: 'warning',
          sourceEntityId: portalNode.entranceId,
          phase: 'primitives',
          code: 'ROAD_LINK_BROKEN',
          message: `Entrance "${portalNode.entranceId}" is linked to road "${explicitRoadId}" but that road has no floor-0 waypoints (was it deleted?)`,
          relatedNodeIds: [portalNode.id],
        })
      }
    }

    if (roadWaypoint) {
      edges.push({
        id: nextId('AE'),
        kind: 'access',
        from: portalNode.id,
        to: roadWaypoint.id,
        distance: haversineDistance(portalNode.outdoorPosition, roadWaypoint.position),
        accessType: explicit ? 'entrance_road_link' : 'entrance',
        width: 2,
        source: {
          entityId: portalNode.entranceId,
          entityType: 'entrance',
          generatorId: 'builtin:connector',
        },
      })
    } else {
      diagnostics.push({
        severity: 'info',
        sourceEntityId: portalNode.entranceId,
        phase: 'primitives',
        code: 'ENTRANCE_NO_ROAD',
        message: `Entrance "${portalNode.entranceId}" has no explicit outdoor route assignment`,
        relatedNodeIds: [portalNode.id],
      })
    }
  }

  return { edges, diagnostics }
}
