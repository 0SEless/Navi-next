import type { LatLng } from '@navi/core'
import { haversineDistance, ROUTE_NETWORK_THRESHOLDS } from '@navi/core'
import type {
  NormalizedDocument,
  PrimitiveContribution,
  PrimitiveNode,
  PrimitiveEdge,
  CompilerDiagnostic,
  WaypointNode,
  SkeletonEdge,
} from '../types'

const METER_PER_DEG = 111320

function isValidLatLng(value: unknown): value is LatLng {
  if (!value || typeof value !== 'object') return false
  const position = value as Partial<LatLng>
  return Number.isFinite(position.lat) && Number.isFinite(position.lng)
}

function localToLatLng(
  x: number,
  y: number,
  originLat: number,
  originLng: number,
): LatLng {
  return {
    lat: originLat + y / METER_PER_DEG,
    lng: originLng + x / (METER_PER_DEG * Math.cos((originLat * Math.PI) / 180)),
  }
}

/**
 * Resolve a canonical route node authored ID to its compiled NavNode ID.
 * All canonical relationship compilers MUST use this same resolver.
 *
 * @param authoredId - The authored route node ID (e.g. 'rn-1')
 * @returns The compiled NavNode ID with 'R-' prefix (e.g. 'R-rn-1')
 */
export function resolveCompiledRouteNodeId(authoredId: string): string {
  return `R-${authoredId}`
}

/**
 * Canonical access compilation result — exported for legacy suppression tracking.
 */
export interface CanonicalAccessResult {
  /** Room IDs that have canonical RoomAccess (legacy door→waypoint suppressed) */
  canonicalRoomIds: Set<string>
  /** Entrance IDs that have canonical EntranceAccess (legacy portal suppressed) */
  canonicalEntranceIds: Set<string>
  /** Feature IDs that have canonical VerticalTransition (legacy connector/feature edges suppressed) */
  canonicalFeatureIds: Set<string>
}

/**
 * Compile RoomAccess relationships from Floor.roomAttributes[].accessPoints[].
 *
 * For each access point:
 *   - Creates edge: room POI NavNode → compiled RouteNode (R-{routeNodeId})
 *   - Edge type: 'walk', distance = haversine between positions
 *   - If multiple access points: preserves all, uses primary for destination resolution
 *
 * On canonical floor: suppresses legacy door→nearest-waypoint for rooms with RoomAccess.
 */
function compileRoomAccess(
  document: NormalizedDocument,
  existingNodes: PrimitiveNode[],
): PrimitiveContribution & { canonicalRoomIds: Set<string> } {
  const nodes: PrimitiveNode[] = []
  const edges: PrimitiveEdge[] = []
  const diagnostics: CompilerDiagnostic[] = []
  const canonicalRoomIds = new Set<string>()

  for (const building of document.buildings) {
    const origin = building.position
    if (!origin) continue

    for (const floor of building.floors) {
      const ra = floor.roomAttributes
      if (!ra || ra.length === 0) continue
      let compiledOnFloor = 0

      for (const roomAttr of ra) {
        const accessPoints = roomAttr.accessPoints
        if (!accessPoints || accessPoints.length === 0) continue
        // The record itself is authoritative. A broken dependency must not
        // reopen legacy door→nearest-waypoint substitution for this room.
        canonicalRoomIds.add(roomAttr.faceId)

        // Find the room's POI node from existing nodes
        let roomPoi = existingNodes.find(
          n => n.kind === 'poi' && n.source.entityId === roomAttr.faceId && n.floor === floor.level && n.buildingId === building.id,
        )
        if (!roomPoi) {
          // Also try matching by name if faceId doesn't match
          roomPoi = existingNodes.find(
            n => n.kind === 'poi' && n.label.includes(roomAttr.name) && n.floor === floor.level && n.buildingId === building.id,
          )
          if (!roomPoi) {
            diagnostics.push({
              severity: 'warning',
              sourceEntityId: roomAttr.faceId,
              phase: 'primitives',
              code: 'ROOM_ACCESS_NO_POI',
              message: `RoomAccess for "${roomAttr.name}" — no POI node found on floor ${floor.level}`,
            })
            continue
          }
        }
        canonicalRoomIds.add(roomPoi.source.entityId)

        // Try to compile all access points — only mark canonical if ALL succeed
        let allCompiled = true
        const compiledEdges: PrimitiveEdge[] = []

        for (const ap of accessPoints) {
          const compiledRouteNodeId = resolveCompiledRouteNodeId(ap.routeNodeId)
          const routeNode = existingNodes.find(n => n.id === compiledRouteNodeId)
          if (!routeNode) {
            diagnostics.push({
              severity: 'warning',
              sourceEntityId: ap.routeNodeId,
              phase: 'primitives',
              code: 'ROOM_ACCESS_ROUTE_NODE_MISSING',
              message: `RoomAccess references route node "${ap.routeNodeId}" (compiled: ${compiledRouteNodeId}) — not found`,
            })
            allCompiled = false
            continue
          }

          const dist = haversineDistance(roomPoi.position, routeNode.position)
          compiledEdges.push({
            id: `CA-RA-${roomAttr.faceId}-${ap.routeNodeId}`,
            kind: 'access',
            from: roomPoi.id,
            to: routeNode.id,
            distance: dist,
            accessType: 'room_access',
            source: {
              entityId: ap.routeNodeId,
              entityType: 'route_node',
              field: 'distance',
              generatorId: 'builtin:canonical-access-compiler',
            },
          })
        }

        // Emit only when the complete explicit record compiles successfully.
        if (allCompiled && compiledEdges.length > 0) {
          edges.push(...compiledEdges)
          compiledOnFloor++
        }
      }

      if (compiledOnFloor > 0) {
        diagnostics.push({
          severity: 'info',
          sourceEntityId: floor.id,
          phase: 'primitives',
          code: 'ROOM_ACCESS_COMPILED',
          message: `Floor "${floor.id}" compiled ${compiledOnFloor} canonical RoomAccess relationships`,
        })
      }
    }
  }

  return { nodes, edges, diagnostics, canonicalRoomIds }
}

/**
 * Compile EntranceAccess relationships from Floor.entranceAccess[].
 *
 * For each entrance access:
 *   - outdoorNodeId → resolve against compiled OUTDOOR graph (NOT Floor.routeNetwork)
 *   - indoorRouteNodeId → resolve via R-{indoorRouteNodeId}
 *   - Creates bridge edge between outdoor and indoor nodes
 *
 * On canonical floor: suppresses legacy entrance portal logic for entrances with EntranceAccess.
 */
function compileEntranceAccess(
  document: NormalizedDocument,
  existingNodes: PrimitiveNode[],
): PrimitiveContribution & { canonicalEntranceIds: Set<string> } {
  const nodes: PrimitiveNode[] = []
  const edges: PrimitiveEdge[] = []
  const diagnostics: CompilerDiagnostic[] = []
  const canonicalEntranceIds = new Set<string>()

  for (const building of document.buildings) {
    for (const floor of building.floors) {
      const ea = floor.entranceAccess
      if (!ea || ea.length === 0) continue
      let compiledOnFloor = 0

      for (const access of ea) {
        // Presence establishes authority even if either endpoint is invalid.
        canonicalEntranceIds.add(access.entranceId)
        const hasOutdoorRouteId = access.outdoorRouteId !== undefined
        const hasOutdoorPosition = access.outdoorPosition !== undefined
        const hasSegmentTarget = hasOutdoorRouteId || hasOutdoorPosition
        if (hasSegmentTarget && (
          typeof access.outdoorRouteId !== 'string' ||
          access.outdoorRouteId.trim().length === 0 ||
          !isValidLatLng(access.outdoorPosition)
        )) {
          diagnostics.push({
            severity: 'warning',
            sourceEntityId: access.entranceId,
            phase: 'primitives',
            code: 'ENTRANCE_ACCESS_OUTDOOR_ANCHOR_INVALID',
            message: `EntranceAccess for entrance "${access.entranceId}" — outdoor route assignment must include a valid route ID and position`,
          })
          continue
        }

        let pendingOutdoorNode: PrimitiveNode | null = null
        let outdoorNode = existingNodes.find(
          n => n.id === access.outdoorNodeId && n.floor === 0,
        ) ?? null

        // A segment target is authored as a stable access node plus the road
        // ID and exact position. Materialize that node before skeletonization;
        // the skeleton generator receives the same position as a forced point
        // and the connectivity normalizer merges the two nodes on the road.
        if (hasSegmentTarget) {
          const route = document.roads.find((road) => road.id === access.outdoorRouteId)
          if (!route) {
            diagnostics.push({
              severity: 'warning',
              sourceEntityId: access.entranceId,
              phase: 'primitives',
              code: 'ENTRANCE_ACCESS_OUTDOOR_ROUTE_MISSING',
              message: `EntranceAccess for entrance "${access.entranceId}" — outdoor route "${access.outdoorRouteId}" not found`,
            })
            continue
          }

          if (typeof access.outdoorNodeId !== 'string' || access.outdoorNodeId.trim().length === 0) {
            diagnostics.push({
              severity: 'warning',
              sourceEntityId: access.entranceId,
              phase: 'primitives',
              code: 'ENTRANCE_ACCESS_OUTDOOR_MISSING',
              message: `EntranceAccess for entrance "${access.entranceId}" — segment target has no stable access node ID`,
            })
            continue
          }

          if (!outdoorNode) {
            pendingOutdoorNode = {
              id: access.outdoorNodeId,
              kind: 'waypoint',
              position: access.outdoorPosition!,
              floor: 0,
              buildingId: '__outdoor__',
              source: {
                entityId: access.outdoorRouteId,
                entityType: 'road_access_anchor',
                field: 'outdoorPosition',
                generatorId: 'builtin:canonical-access-compiler',
              },
            }
            outdoorNode = pendingOutdoorNode
          }
        }

        if (!outdoorNode) {
          diagnostics.push({
            severity: 'warning',
            sourceEntityId: access.entranceId,
            phase: 'primitives',
            code: 'ENTRANCE_ACCESS_OUTDOOR_MISSING',
            message: `EntranceAccess for entrance "${access.entranceId}" — outdoor node "${access.outdoorNodeId}" not found in graph`,
          })
          continue
        }

        // Resolve indoor route node
        const compiledIndoorId = resolveCompiledRouteNodeId(access.indoorRouteNodeId)
        const indoorNode = existingNodes.find(n => n.id === compiledIndoorId)
        if (!indoorNode) {
          diagnostics.push({
            severity: 'warning',
            sourceEntityId: access.entranceId,
            phase: 'primitives',
            code: 'ENTRANCE_ACCESS_INDOOR_MISSING',
            message: `EntranceAccess for entrance "${access.entranceId}" — indoor route node "${compiledIndoorId}" not found`,
          })
          continue
        }

        if (pendingOutdoorNode) nodes.push(pendingOutdoorNode)

        // Create bridge edge
        const dist = haversineDistance(outdoorNode.position, indoorNode.position)
        edges.push({
          id: `CA-EA-${access.entranceId}`,
          kind: 'access',
          from: outdoorNode.id,
          to: indoorNode.id,
          distance: dist,
          accessType: 'entrance_bridge',
          source: {
            entityId: access.entranceId,
            entityType: 'entrance',
            field: 'distance',
            generatorId: 'builtin:canonical-access-compiler',
          },
        })
        compiledOnFloor++
      }

      if (compiledOnFloor > 0) {
        diagnostics.push({
          severity: 'info',
          sourceEntityId: floor.id,
          phase: 'primitives',
          code: 'ENTRANCE_ACCESS_COMPILED',
          message: `Floor "${floor.id}" compiled ${compiledOnFloor} canonical EntranceAccess relationships`,
        })
      }
    }
  }

  return { nodes, edges, diagnostics, canonicalEntranceIds }
}

/**
 * Compile VerticalTransition relationships from Building.verticalTransitions[].
 *
 * For each transition:
 *   - Resolve each routeNodeId via R-{routeNodeId}
 *   - Create edges between consecutive connections
 *   - Edge type: 'stairs' or 'elevator' (matching transition type)
 *   - Adjacent-floor connections preferred (F1↔F2, F2↔F3, not all-pairs)
 */
function compileVerticalTransitions(
  document: NormalizedDocument,
  existingNodes: PrimitiveNode[],
): PrimitiveContribution & { canonicalFeatureIds: Set<string> } {
  const edges: PrimitiveEdge[] = []
  const diagnostics: CompilerDiagnostic[] = []
  const canonicalFeatureIds = new Set<string>()

  for (const building of document.buildings) {
    const vts = building.verticalTransitions
    if (!vts || vts.length === 0) continue

    for (const vt of vts) {
      // Presence of the explicit relationship establishes canonical authority,
      // even when one of its references is malformed.
      canonicalFeatureIds.add(vt.featureId)

      // Resolve each connection's route node
      const resolvedConnections: Array<{
        floorId: string
        routeNodeId: string
        compiledNodeId: string
        node: PrimitiveNode
      }> = []

      for (const conn of vt.connections) {
        const compiledNodeId = resolveCompiledRouteNodeId(conn.routeNodeId)
        const node = existingNodes.find(n => n.id === compiledNodeId)
        if (!node) {
          diagnostics.push({
            severity: 'warning',
            sourceEntityId: vt.id,
            phase: 'primitives',
            code: 'VERTICAL_TRANSITION_NODE_MISSING',
            message: `VerticalTransition "${vt.id}" — route node "${compiledNodeId}" not found for floor "${conn.floorId}"`,
          })
          continue
        }
        resolvedConnections.push({
          floorId: conn.floorId,
          routeNodeId: conn.routeNodeId,
          compiledNodeId,
          node,
        })
      }

      // Fail the authored chain closed. Filtering a missing middle connection
      // and joining the survivors would invent connectivity (for example,
      // F0→F2 after F1 disappears).
      if (resolvedConnections.length !== vt.connections.length) continue

      // Create edges between consecutive connections (adjacent-floor preferred)
      // Sort by floor level for deterministic ordering
      resolvedConnections.sort((a, b) => {
        const levelA = building.floors.find(f => f.id === a.floorId)?.level ?? 0
        const levelB = building.floors.find(f => f.id === b.floorId)?.level ?? 0
        return levelA - levelB
      })

      for (let i = 0; i < resolvedConnections.length - 1; i++) {
        const from = resolvedConnections[i]!
        const to = resolvedConnections[i + 1]!

        const fromLevel = building.floors.find(f => f.id === from.floorId)?.level ?? 0
        const toLevel = building.floors.find(f => f.id === to.floorId)?.level ?? 0
        const gap = Math.abs(toLevel - fromLevel)

        if (gap > 1) {
          diagnostics.push({
            severity: 'info',
            sourceEntityId: vt.id,
            phase: 'primitives',
            code: 'VERTICAL_TRANSITION_FLOOR_GAP',
            message: `VerticalTransition "${vt.id}" skips floor between ${fromLevel} and ${toLevel}`,
            relatedNodeIds: [from.compiledNodeId, to.compiledNodeId],
          })
        }

        const edgeType: 'stairs' | 'elevator' = vt.type === 'staircase' ? 'stairs' : 'elevator'
        const baseCost = vt.type === 'staircase' ? 15 : 20

        // Use haversine for distance (vertical travel approximation)
        const dist = haversineDistance(from.node.position, to.node.position)
        const effectiveDist = Math.max(dist, ROUTE_NETWORK_THRESHOLDS.verticalEdgeFallbackMeters)

        edges.push({
          id: `CA-VT-${vt.id}-${from.floorId}-${to.floorId}`,
          kind: 'transition',
          from: from.compiledNodeId,
          to: to.compiledNodeId,
          distance: effectiveDist,
          behavior: edgeType,
          baseCost,
          source: {
            entityId: vt.id,
            entityType: 'vertical_transition',
            field: 'distance',
            generatorId: 'builtin:canonical-access-compiler',
          },
        })
      }
    }

    if (canonicalFeatureIds.size > 0) {
      diagnostics.push({
        severity: 'info',
        sourceEntityId: building.id,
        phase: 'primitives',
        code: 'VERTICAL_TRANSITION_COMPILED',
        message: `Building "${building.id}" compiled ${canonicalFeatureIds.size} canonical VerticalTransition relationships`,
      })
    }
  }

  return { edges, diagnostics, canonicalFeatureIds }
}

/**
 * W15D: Canonical Access + Vertical Connector Compilation
 *
 * Compiles RoomAccess, EntranceAccess, and VerticalTransitions into
 * NavigationGraph connectivity on canonical floors.
 *
 * MUST run AFTER extractRouteNetwork (needs compiled R- nodes).
 * Returns canonicalRoomIds, canonicalEntranceIds, canonicalFeatureIds
 * for legacy suppression in connector.ts.
 *
 * IMPORTANT: Only returns canonical sets for entries that were SUCCESSFULLY
 * compiled (all dependencies resolved). Entries that reference missing nodes
 * are NOT included in the canonical sets, allowing legacy fallback to handle them.
 */
export function compileCanonicalAccess(
  document: NormalizedDocument,
  existingNodes: PrimitiveNode[],
): PrimitiveContribution & { canonicalAccess: CanonicalAccessResult } {
  const allNodes: PrimitiveNode[] = []
  const allEdges: PrimitiveEdge[] = []
  const allDiagnostics: CompilerDiagnostic[] = []
  const canonicalRoomIds = new Set<string>()
  const canonicalEntranceIds = new Set<string>()
  const canonicalFeatureIds = new Set<string>()

  // 1. RoomAccess compilation
  const roomAccess = compileRoomAccess(document, existingNodes)
  if (roomAccess.edges) allEdges.push(...roomAccess.edges)
  if (roomAccess.diagnostics) allDiagnostics.push(...roomAccess.diagnostics)
  if (roomAccess.canonicalRoomIds) {
    for (const id of roomAccess.canonicalRoomIds) canonicalRoomIds.add(id)
  }

  // 2. EntranceAccess compilation
  const entranceAccess = compileEntranceAccess(document, existingNodes)
  if (entranceAccess.nodes) allNodes.push(...entranceAccess.nodes)
  if (entranceAccess.edges) allEdges.push(...entranceAccess.edges)
  if (entranceAccess.diagnostics) allDiagnostics.push(...entranceAccess.diagnostics)
  if (entranceAccess.canonicalEntranceIds) {
    for (const id of entranceAccess.canonicalEntranceIds) canonicalEntranceIds.add(id)
  }

  // 3. VerticalTransition compilation
  const verticalTransitions = compileVerticalTransitions(document, existingNodes)
  if (verticalTransitions.edges) allEdges.push(...verticalTransitions.edges)
  if (verticalTransitions.diagnostics) allDiagnostics.push(...verticalTransitions.diagnostics)
  if (verticalTransitions.canonicalFeatureIds) {
    for (const id of verticalTransitions.canonicalFeatureIds) canonicalFeatureIds.add(id)
  }

  return {
    nodes: allNodes,
    edges: allEdges,
    diagnostics: allDiagnostics,
    canonicalAccess: {
      canonicalRoomIds,
      canonicalEntranceIds,
      canonicalFeatureIds,
    },
  }
}
