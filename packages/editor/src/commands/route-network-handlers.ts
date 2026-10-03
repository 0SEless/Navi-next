import { recordChange } from '@navi/core'
import type { CampusDocument, EntityChange, LocalCoord, RouteNetwork, RouteNode, RouteEdge, RouteNodeType, RouteEdgeType } from '@navi/core'
import { isRouteNodeType, isRouteEdgeType } from '@navi/core'
import type { CommandHandler, Command, MutationResult } from './types'
import { genId } from '../id'
import {
  cleanupRouteNodeRoutingReferences,
  collectDoorConnectorEdgeIds,
  restoreRouteNodeRoutingReferences,
  type RouteNodeRelationshipSnapshot,
} from './routing-relationship-cleanup'
import { applyRouteJunctionSplit } from './route-junctions'

// ── P1-T7 (R2.5/R8.1/D3/D10): route-network handlers ──
// The route network is a first-class persisted entity at Floor.routeNetwork,
// authored via polyline-vertex editing. It is NEVER derived from hallway
// geometry (D3): these handlers touch only floor.routeNetwork — rooms and
// hallways stay byte-identical, and hallway edits never touch the network.
//
// Identity (R15.6): ids come from the shared genId with 'route-node' /
// 'route-edge' prefixes — they can never collide with compiler N-*/E-* ids
// or legacy entity ids.
//
// Floor ownership: node.floor is DERIVED from the owning floor's level;
// client payloads cannot override it (the field is denormalized read-only
// data for cross-floor tooling).
//
// Undo: delete handlers are dual-mode — payload with nodeId/edgeId deletes,
// payload with a verbatim network/edge snapshot restores. This keeps each
// handler the single owner of its entity's full lifecycle (same self-inverse
// precedent as poi.update).

function findFloor(document: CampusDocument, buildingId: string, floorId: string) {
  const building = document.buildings.find(b => b.id === buildingId)
  if (!building) return { error: `Building not found: ${buildingId}` }
  const floor = building.floors.find(f => f.id === floorId)
  if (!floor) return { error: `Floor not found: ${floorId}` }
  return { building, floor }
}

/** Get the floor's network, auto-creating an empty one when absent. */
function ensureNetwork(floor: CampusDocument['buildings'][number]['floors'][number]): RouteNetwork {
  if (!floor.routeNetwork) {
    floor.routeNetwork = { nodes: [], edges: [] }
  }
  return floor.routeNetwork
}

interface RoutePathRestorePayload {
  restore: true
  buildingId: string
  floorId: string
  hadNetwork: boolean
  previousNetwork?: RouteNetwork
}

/**
 * Create one multi-click Route path as an atomic graph mutation.
 *
 * The Floor Editor exposes this as the single Route tool. Nodes and edges are
 * deliberately persisted together so one undo removes exactly one authored
 * path, while the existing route.node.* and route.edge.* handlers continue to
 * own lower-level graph maintenance.
 */
export const routePathCreateHandler: CommandHandler = {
  id: 'route.path.create',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const buildingId = payload.buildingId as string
    const floorId = payload.floorId as string
    const loc = findFloor(document, buildingId, floorId)
    if ('error' in loc) return { success: false, error: loc.error }
    const { building, floor } = loc

    const restore = payload as unknown as Partial<RoutePathRestorePayload>
    if (restore.restore === true) {
      if (restore.hadNetwork !== true && restore.hadNetwork !== false) {
        return { success: false, error: 'Route path restore payload must specify hadNetwork' }
      }
      floor.routeNetwork = restore.hadNetwork
        ? JSON.parse(JSON.stringify(restore.previousNetwork ?? { nodes: [], edges: [] })) as RouteNetwork
        : undefined
      return {
        success: true,
        data: { buildingId: building.id, floorId: floor.id, restored: true },
      }
    }

    const points = payload.points
    if (!Array.isArray(points) || points.length < 2) {
      return { success: false, error: 'A Route path requires at least two points' }
    }

    for (let index = 0; index < points.length; index += 1) {
      const point = points[index] as Record<string, unknown> | null
      if (!point || typeof point.x !== 'number' || typeof point.y !== 'number' || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        return { success: false, error: `Route path point ${index + 1} must contain finite building-local coordinates` }
      }
      if (point.existingNodeId !== undefined && typeof point.existingNodeId !== 'string') {
        return { success: false, error: `Route path point ${index + 1} existingNodeId must be a string` }
      }
      const junction = point.junction as Record<string, unknown> | undefined
      if (junction != null) {
        const junctionPosition = junction.position as Record<string, unknown> | undefined
        if (typeof junction.edgeId !== 'string' || !junctionPosition
          || typeof junctionPosition.x !== 'number' || typeof junctionPosition.y !== 'number'
          || !Number.isFinite(junctionPosition.x) || !Number.isFinite(junctionPosition.y)) {
          return { success: false, error: `Route path point ${index + 1} junction must contain an edgeId and finite position` }
        }
      }
      if (index > 0) {
        const previous = points[index - 1] as Record<string, unknown>
        if (point.x === previous.x && point.y === previous.y) {
          return { success: false, error: `Route path points ${index} and ${index + 1} cannot be duplicates` }
        }
      }
    }

    const nodeType = (payload.nodeType as RouteNodeType | undefined) ?? 'waypoint'
    if (!isRouteNodeType(nodeType)) {
      return { success: false, error: `Invalid route node type: ${String(nodeType)}. Must be one of the RouteNodeType enum values.` }
    }
    const edgeType = (payload.edgeType as RouteEdgeType | undefined) ?? 'walk'
    if (!isRouteEdgeType(edgeType)) {
      return { success: false, error: `Invalid route edge type: ${String(edgeType)}. Must be one of the RouteEdgeType enum values.` }
    }

    // Door connector edges are Door-owned stubs. Splitting one would leave the
    // Door's connectorEdgeId pointing at a removed edge, so they are rejected
    // as junction targets before any mutation.
    const doorConnectorEdgeIds = collectDoorConnectorEdgeIds(document)

    // Snapshot before ensureNetwork so an absent network can be restored as
    // absent rather than leaving an empty routeNetwork after undo.
    const hadNetwork = floor.routeNetwork !== undefined
    const previousNetwork = hadNetwork
      ? JSON.parse(JSON.stringify(floor.routeNetwork)) as RouteNetwork
      : undefined
    const network = ensureNetwork(floor)
    const networkBeforeJunctions = JSON.parse(JSON.stringify(network)) as RouteNetwork

    const failWithRestore = (error: string): MutationResult => {
      floor.routeNetwork = hadNetwork ? networkBeforeJunctions : undefined
      return { success: false, error }
    }

    // Resolve only explicitly selected identities before mutating the
    // document. Coincidence/proximity is geometry, not authorization to reuse
    // a node; an ordinary point always plans a fresh waypoint.
    const resolvedNodeIds: string[] = []
    const plannedNewNodes: Array<{ plannedId: string; position: { x: number; y: number } }> = []
    // Buffer split changes so a later resolution failure emits nothing to the
    // journal and never advances document.version.
    const pendingJunctionChanges: EntityChange[] = []
    for (let pointIndex = 0; pointIndex < (points as unknown[]).length; pointIndex += 1) {
      const point = (points as Array<{ x: number; y: number; existingNodeId?: string; junction?: { edgeId: string; position: LocalCoord } }>)[pointIndex]

      if (point.existingNodeId !== undefined) {
        const existingNode = network.nodes.find(node => node.id === point.existingNodeId)
        if (!existingNode) {
          return failWithRestore(`Selected route node not found: ${point.existingNodeId}`)
        }
        resolvedNodeIds.push(point.existingNodeId)
      } else if (point.junction != null) {
        const junctionInput = point.junction as { edgeId: string; position: LocalCoord }
        if (doorConnectorEdgeIds.has(junctionInput.edgeId)) {
          return failWithRestore(`Route edge ${junctionInput.edgeId} is a door connector and cannot be a junction target`)
        }
        const split = applyRouteJunctionSplit(network, junctionInput.edgeId, junctionInput.position, floor.level)
        if (!split.ok) return failWithRestore(split.error)
        resolvedNodeIds.push(split.junctionId)
        if (!split.reusedEndpoint) {
          pendingJunctionChanges.push({ entityId: split.removedEdgeId, entityType: 'route-edge', operation: 'deleted' })
          pendingJunctionChanges.push({ entityId: split.junctionId, entityType: 'route-node', operation: 'created' })
          for (const createdEdgeId of split.createdEdgeIds) {
            pendingJunctionChanges.push({ entityId: createdEdgeId, entityType: 'route-edge', operation: 'created' })
          }
        }
      } else {
        const plannedId = `planned-route-node-${pointIndex}`
        resolvedNodeIds.push(plannedId)
        plannedNewNodes.push({ plannedId, position: { x: point.x, y: point.y } })
      }

      if (pointIndex > 0 && resolvedNodeIds[pointIndex] === resolvedNodeIds[pointIndex - 1]) {
        return failWithRestore(`Route path points ${pointIndex} and ${pointIndex + 1} resolve to the same node`)
      }
    }
    for (const change of pendingJunctionChanges) {
      recordChange(document, change)
    }
    const plannedIdToActualId = new Map<string, string>()
    for (const plannedNode of plannedNewNodes) {
      const id = genId('route-node')
      plannedIdToActualId.set(plannedNode.plannedId, id)
    }
    const nodeIds = resolvedNodeIds.map(resolvedId => plannedIdToActualId.get(resolvedId) ?? resolvedId)
    const edgeIds: string[] = []

    for (const plannedNode of plannedNewNodes) {
      const id = plannedIdToActualId.get(plannedNode.plannedId)!
      network.nodes.push({
        id,
        type: nodeType,
        position: plannedNode.position,
        floor: floor.level,
      })
      recordChange(document, { entityId: id, entityType: 'route-node', operation: 'created' })
    }

    for (let index = 1; index < nodeIds.length; index += 1) {
      const from = network.nodes.find((node) => node.id === nodeIds[index - 1])!
      const to = network.nodes.find((node) => node.id === nodeIds[index])!
      const id = genId('route-edge')
      network.edges.push({
        id,
        from: from.id,
        to: to.id,
        type: edgeType,
        distance: Math.hypot(to.position.x - from.position.x, to.position.y - from.position.y),
      })
      edgeIds.push(id)
      recordChange(document, { entityId: id, entityType: 'route-edge', operation: 'created' })
    }

    return {
      success: true,
      entityId: nodeIds[0],
      data: {
        nodeIds,
        edgeIds,
        buildingId: building.id,
        floorId: floor.id,
        hadNetwork,
        previousNetwork,
      },
    }
  },
  inverse(_payload: Record<string, unknown>, result: MutationResult): Command | null {
    const data = result.data
    if (!data || typeof data.buildingId !== 'string' || typeof data.floorId !== 'string' || typeof data.hadNetwork !== 'boolean') {
      return null
    }
    return {
      id: 'route.path.create',
      label: 'Undo Create Route',
      payload: {
        restore: true,
        buildingId: data.buildingId,
        floorId: data.floorId,
        hadNetwork: data.hadNetwork,
        previousNetwork: data.previousNetwork,
      },
    }
  },
}

export const routeNodeCreateHandler: CommandHandler = {
  id: 'route.node.create',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const loc = findFloor(document, payload.buildingId as string, payload.floorId as string)
    if ('error' in loc) return { success: false, error: loc.error }
    const { building, floor } = loc

    const input = (payload.node as Record<string, unknown>) ?? {}
    // Validate EVERYTHING before any mutation — a rejected create must not
    // leave an empty network behind (additive-absent contract, D12).
    const type = (input.type as RouteNodeType | undefined) ?? 'waypoint'
    if (!isRouteNodeType(type)) {
      return { success: false, error: `Invalid route node type: ${String(type)}. Must be one of the RouteNodeType enum values.` }
    }
    const position = input.position as LocalCoord | undefined
    if (!position || typeof position.x !== 'number' || typeof position.y !== 'number') {
      return { success: false, error: 'Route node position must be a building-local LocalCoord ({x, y} meters)' }
    }

    const id = (input.id as string) || genId('route-node')
    const network = ensureNetwork(floor)
    const node: RouteNode = {
      id,
      type,
      // Building-local only (R2.5) — same coordinate contract as rooms/doors/pois.
      position: { x: position.x, y: position.y },
      // Floor ownership: derived from the OWNING floor, never the payload.
      floor: floor.level,
    }
    network.nodes.push(node)

    recordChange(document, { entityId: id, entityType: 'route-node', operation: 'created' })
    return { success: true, entityId: id, data: { id, buildingId: building.id, floorId: floor.id } }
  },
  inverse(_payload: Record<string, unknown>, result: MutationResult): Command | null {
    const id = result.entityId ?? undefined
    if (!id) return null
    return {
      id: 'route.node.delete',
      label: 'Undo Create Route Node',
      payload: { nodeId: id },
    }
  },
}

export const routeNodeUpdateHandler: CommandHandler = {
  id: 'route.node.update',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const nodeId = payload.nodeId as string
    const patch = (payload.patch as Record<string, unknown>) ?? {}

    const found = findRouteNode(document, nodeId)
    if (!found) return { success: false, error: `Route node not found: ${nodeId}` }
    const { node } = found

    if (patch.type !== undefined && !isRouteNodeType(patch.type)) {
      return { success: false, error: `Invalid route node type: ${String(patch.type)}. Must be one of the RouteNodeType enum values.` }
    }
    if (patch.position !== undefined) {
      const pos = patch.position as LocalCoord
      if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') {
        return { success: false, error: 'Route node position must be a building-local LocalCoord ({x, y} meters)' }
      }
    }

    const old: {
      type: RouteNodeType
      position: LocalCoord
      // P1-T8 (R8.2): snapshot of incident-edge distances BEFORE a position
      // move — the inverse restores them VERBATIM (authored distances are
      // never recomputed on undo; recomputing would corrupt explicit values).
      restoreDistances?: Array<{ id: string; distance: number }>
    } = {
      type: node.type,
      position: { ...node.position },
    }

    if (patch.type != null) node.type = patch.type as RouteNodeType
    if (patch.position != null) {
      const pos = patch.position as LocalCoord
      node.position = { x: pos.x, y: pos.y }
      // P1-T8 (R8.2): moving a node refreshes incident edge distances to the
      // new geometry — O(degree). Edge endpoints and identity are untouched;
      // only the derived `distance` field mutates. Non-incident edges are
      // never visited.
      const network = found.network
      old.restoreDistances = []
      for (const e of network.edges) {
        if (e.from !== nodeId && e.to !== nodeId) continue
        old.restoreDistances.push({ id: e.id, distance: e.distance })
        const otherId = e.from === nodeId ? e.to : e.from
        const other = network.nodes.find(n => n.id === otherId)
        if (other) {
          e.distance = Math.hypot(other.position.x - node.position.x, other.position.y - node.position.y)
        }
      }
    }
    // P1-T8: undo-only restore contract — applies the snapshot distances
    // verbatim AFTER the position patch (so the final state is byte-exact).
    const restore = patch.restoreDistances as Array<{ id: string; distance: number }> | undefined
    if (restore) {
      for (const r of restore) {
        const e = found.network.edges.find(x => x.id === r.id)
        if (e) e.distance = r.distance
      }
    }
    // NOTE: node.floor is immutable here (ownership).

    recordChange(document, { entityId: nodeId, entityType: 'route-node', operation: 'updated' })
    return { success: true, entityId: nodeId, data: { old } }
  },
  inverse(payload: Record<string, unknown>, result: MutationResult): Command | null {
    const old = result.data?.old as { type: RouteNodeType; position: LocalCoord; restoreDistances?: Array<{ id: string; distance: number }> } | undefined
    if (!old) return null
    return {
      id: 'route.node.update',
      label: 'Undo Route Node Update',
      payload: { nodeId: payload.nodeId as string, patch: old },
    }
  },
}

export const routeNodeDeleteHandler: CommandHandler = {
  id: 'route.node.delete',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    // Dual-mode: restore (payload.network present) or delete (payload.nodeId).
    const networkPayload = payload.network as RouteNetwork | undefined
    if (networkPayload) {
      const loc = findFloor(document, payload.buildingId as string, payload.floorId as string)
      if ('error' in loc) return { success: false, error: loc.error }
      // Wholesale verbatim replace — restores the deleted node AND every
      // incident edge removed with it, byte-for-byte.
      loc.floor.routeNetwork = JSON.parse(JSON.stringify(networkPayload)) as RouteNetwork
      const relationshipSnapshot = payload.relationshipSnapshot as RouteNodeRelationshipSnapshot | undefined
      if (relationshipSnapshot) {
        restoreRouteNodeRoutingReferences(
          document,
          payload.buildingId as string,
          payload.floorId as string,
          relationshipSnapshot,
        )
      }
      recordChange(document, { entityId: payload.nodeId as string, entityType: 'route-node', operation: 'restored' })
      return { success: true, entityId: payload.nodeId as string }
    }

    const nodeId = payload.nodeId as string
    const found = findRouteNode(document, nodeId)
    if (!found) return { success: false, error: `Route node not found: ${nodeId}` }
    const { building, floor, network, node } = found

    // Snapshot the WHOLE network verbatim BEFORE mutation — the inverse
    // restores node + all incident edges in one step (no dangling refs).
    const snapshot = JSON.parse(JSON.stringify(network)) as RouteNetwork

    // P1-T8 (R8.2): topology-preserving delete.
    //   degree 0/1 → node (+ its single edge) removed
    //   degree 2   → node removed, the two edges MERGED (same neighbor →
    //                parallel edges, no self-loop merge)
    //   degree 3+  → BLOCKED until `confirmed: true` (disconnects the
    //                neighborhood); cancel leaves the network untouched
    const incident = network.edges.filter(e => e.from === nodeId || e.to === nodeId)
    const degree = incident.length
    if (degree >= 3 && payload.confirmed !== true) {
      return {
        success: false,
        error: `Deleting route node ${nodeId} disconnects ${degree} edges — confirmation required (confirmed: true)`,
      }
    }

    network.nodes = network.nodes.filter(n => n.id !== nodeId)
    if (degree === 2) {
      const [e1, e2] = incident
      const neighborA = e1.from === nodeId ? e1.to : e1.from
      const neighborB = e2.from === nodeId ? e2.to : e2.from
      network.edges = network.edges.filter(e => e.id !== e1.id && e.id !== e2.id)
      if (neighborA !== neighborB) {
        const na = network.nodes.find(n => n.id === neighborA)
        const nb = network.nodes.find(n => n.id === neighborB)
        const mergedId = genId('route-edge')
        network.edges.push({
          id: mergedId,
          from: neighborA,
          to: neighborB,
          // Deterministic merge rule: common type preserved, differing
          // types fall back to 'walk'.
          type: e1.type === e2.type ? e1.type : 'walk',
          // Derived distance — euclidean between the surviving neighbors.
          distance: na && nb
            ? Math.hypot(nb.position.x - na.position.x, nb.position.y - na.position.y)
            : 0,
        })
        recordChange(document, { entityId: mergedId, entityType: 'route-edge', operation: 'created' })
      }
    } else {
      network.edges = network.edges.filter(e => e.from !== nodeId && e.to !== nodeId)
    }

    const relationshipSnapshot = cleanupRouteNodeRoutingReferences(
      document,
      building.id,
      floor.id,
      nodeId,
    )

    recordChange(document, { entityId: nodeId, entityType: 'route-node', operation: 'deleted' })
    return {
      success: true,
      entityId: nodeId,
      data: { network: snapshot, relationshipSnapshot, deletedNode: JSON.parse(JSON.stringify(node)), buildingId: building.id, floorId: floor.id },
    }
  },
  inverse(_payload: Record<string, unknown>, result: MutationResult): Command | null {
    const network = result.data?.network as RouteNetwork | undefined
    if (!network) return null
    return {
      id: 'route.node.delete',
      label: 'Undo Delete Route Node',
      payload: {
        nodeId: result.entityId as string,
        buildingId: result.data?.buildingId as string,
        floorId: result.data?.floorId as string,
        network,
        relationshipSnapshot: result.data?.relationshipSnapshot as RouteNodeRelationshipSnapshot | undefined,
      },
    }
  },
}

export const routeEdgeCreateHandler: CommandHandler = {
  id: 'route.edge.create',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const loc = findFloor(document, payload.buildingId as string, payload.floorId as string)
    if ('error' in loc) return { success: false, error: loc.error }
    const { building, floor } = loc

    const input = (payload.edge as Record<string, unknown>) ?? {}
    const type = (input.type as RouteEdgeType | undefined) ?? 'walk'
    if (!isRouteEdgeType(type)) {
      return { success: false, error: `Invalid route edge type: ${String(type)}. Must be one of the RouteEdgeType enum values.` }
    }

    const network = floor.routeNetwork
    const fromId = input.from as string
    const toId = input.to as string
    const from = network?.nodes.find(n => n.id === fromId)
    if (!from) return { success: false, error: `Route node not found: ${String(fromId)}` }
    const to = network?.nodes.find(n => n.id === toId)
    if (!to) return { success: false, error: `Route node not found: ${String(toId)}` }

    let distance: number
    if (input.distance !== undefined) {
      if (typeof input.distance !== 'number' || !Number.isFinite(input.distance) || input.distance < 0) {
        return { success: false, error: `Invalid route edge distance: ${String(input.distance)}. Must be a finite non-negative number (meters).` }
      }
      distance = input.distance
    } else {
      // Default: straight-line euclidean distance between endpoints.
      distance = Math.hypot(to.position.x - from.position.x, to.position.y - from.position.y)
    }

    const id = (input.id as string) || genId('route-edge')
    const edge: RouteEdge = { id, from: fromId, to: toId, type, distance }
    ensureNetwork(floor).edges.push(edge)

    recordChange(document, { entityId: id, entityType: 'route-edge', operation: 'created' })
    return { success: true, entityId: id, data: { id, buildingId: building.id, floorId: floor.id } }
  },
  inverse(_payload: Record<string, unknown>, result: MutationResult): Command | null {
    const id = result.entityId ?? undefined
    if (!id) return null
    return {
      id: 'route.edge.delete',
      label: 'Undo Create Route Edge',
      payload: { edgeId: id },
    }
  },
}

export const routeEdgeDeleteHandler: CommandHandler = {
  id: 'route.edge.delete',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    // Dual-mode: restore (payload.edge present) or delete (payload.edgeId).
    const edgePayload = payload.edge as RouteEdge | undefined
    if (edgePayload) {
      const loc = findFloor(document, payload.buildingId as string, payload.floorId as string)
      if ('error' in loc) return { success: false, error: loc.error }
      const network = ensureNetwork(loc.floor)
      // Verbatim re-insertion — same id/type/distance/endpoints.
      network.edges.push(JSON.parse(JSON.stringify(edgePayload)) as RouteEdge)
      recordChange(document, { entityId: edgePayload.id, entityType: 'route-edge', operation: 'restored' })
      return { success: true, entityId: edgePayload.id }
    }

    const edgeId = payload.edgeId as string
    const found = findRouteEdge(document, edgeId)
    if (!found) return { success: false, error: `Route edge not found: ${edgeId}` }
    const { building, floor, edge } = found

    const snapshot = JSON.parse(JSON.stringify(edge)) as RouteEdge
    const network = found.network
    network.edges = network.edges.filter(e => e.id !== edgeId)

    recordChange(document, { entityId: edgeId, entityType: 'route-edge', operation: 'deleted' })
    return {
      success: true,
      entityId: edgeId,
      data: { edge: snapshot, buildingId: building.id, floorId: floor.id },
    }
  },
  inverse(_payload: Record<string, unknown>, result: MutationResult): Command | null {
    const edge = result.data?.edge as RouteEdge | undefined
    if (!edge) return null
    return {
      id: 'route.edge.delete',
      label: 'Undo Delete Route Edge',
      payload: {
        buildingId: result.data?.buildingId as string,
        floorId: result.data?.floorId as string,
        edge,
      },
    }
  },
}

// ── shared lookups ──

function findRouteNode(document: CampusDocument, nodeId: string):
  | { building: CampusDocument['buildings'][number]; floor: CampusDocument['buildings'][number]['floors'][number]; network: RouteNetwork; node: RouteNode }
  | null {
  for (const building of document.buildings) {
    for (const floor of building.floors) {
      const network = floor.routeNetwork
      const node = network?.nodes.find(n => n.id === nodeId)
      if (network && node) return { building, floor, network, node }
    }
  }
  return null
}

function findRouteEdge(document: CampusDocument, edgeId: string):
  | { building: CampusDocument['buildings'][number]; floor: CampusDocument['buildings'][number]['floors'][number]; network: RouteNetwork; edge: RouteEdge }
  | null {
  for (const building of document.buildings) {
    for (const floor of building.floors) {
      const network = floor.routeNetwork
      const edge = network?.edges.find(e => e.id === edgeId)
      if (network && edge) return { building, floor, network, edge }
    }
  }
  return null
}
