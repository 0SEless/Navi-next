import type {
  Component, ComponentType, NavNode, NavEdge, Building, LatLng,
} from '../types/nav-types'
import { haversine } from './geo-utils'
import { SpatialQueryService } from '@navi/core'

export interface CompileResult {
  nodes: NavNode[]
  edges: NavEdge[]
  polygon?: LatLng[]
}

export interface CompileContext {
  buildings: Map<string, Building>
  existingNodes: NavNode[]
  existingEdges: NavEdge[]
  componentId: string
  campusId?: string
}

// ── Routing-Component Whitelist ──────────────────────────────────────
// Only these node types belong in the NavigationGraph.
// Everything else (room interiors, furniture, walls, corners) stays out.

const ROUTING_NODE_TYPES = new Set<NavNode['type']>([
  // Outdoor
  'outdoor',
  'intersection',
  // Indoor routing
  'building_entrance',
  'hallway',
  'room_door',
  'staircase',
  'elevator',
  'connector_stop',
])

// ── Valid Edge Relationships ─────────────────────────────────────────
// Only these node-type pairs can be connected by edges.
// This enforces the clean topology: outdoor ↔ entrance ↔ hallway ↔ room_door

type NodeTypePair = string // "typeA|typeB" sorted alphabetically

function makeEdgeKey(typeA: string, typeB: string): string {
  return [typeA, typeB].sort().join('|')
}

const VALID_EDGE_RELATIONSHIPS = new Set<NodeTypePair>([
  // Outdoor ↔ Outdoor
  makeEdgeKey('outdoor', 'outdoor'),
  makeEdgeKey('outdoor', 'intersection'),
  makeEdgeKey('intersection', 'intersection'),

  // Outdoor ↔ Entrance
  makeEdgeKey('outdoor', 'building_entrance'),
  makeEdgeKey('intersection', 'building_entrance'),

  // Entrance ↔ Indoor
  makeEdgeKey('building_entrance', 'hallway'),
  makeEdgeKey('building_entrance', 'room_door'),

  // Hallway ↔ Hallway
  makeEdgeKey('hallway', 'hallway'),

  // Hallway ↔ Room Door
  makeEdgeKey('hallway', 'room_door'),

  // Hallway ↔ Vertical
  makeEdgeKey('hallway', 'staircase'),
  makeEdgeKey('hallway', 'elevator'),
  makeEdgeKey('hallway', 'connector_stop'),

  // Vertical ↔ Vertical (same type, different floors)
  makeEdgeKey('staircase', 'staircase'),
  makeEdgeKey('elevator', 'elevator'),
  makeEdgeKey('connector_stop', 'connector_stop'),
])

/**
 * Check if an edge between two node types is valid.
 */
function isValidEdge(fromType: NavNode['type'], toType: NavNode['type']): boolean {
  return VALID_EDGE_RELATIONSHIPS.has(makeEdgeKey(fromType, toType))
}

/**
 * Check if a node type is in the routing whitelist.
 */
function isRoutingNode(type: NavNode['type']): boolean {
  return ROUTING_NODE_TYPES.has(type)
}

let _idCounter = 0
export function genId(prefix: string): string {
  _idCounter++
  return `${prefix}${String(_idCounter).padStart(4, '0')}`
}

function findNearestNode(
  position: LatLng,
  nodes: NavNode[],
  type?: string
): NavNode | null {
  const svc = new SpatialQueryService()
  svc.loadFromNodes(nodes as unknown as Array<{ id: string; position: LatLng; type?: string; floor?: number; buildingId?: string; [key: string]: unknown }>)
  const result = svc.nearestEntity(position, { maxDistance: Infinity, type: type as any })
  if (!result) return null
  return nodes.find(n => n.id === result.entity.id) ?? null
}

/**
 * Compile a room component into the navigation graph.
 *
 * IMPORTANT: Only the room DOOR becomes a routing node. The room interior,
 * corners, and walls are NOT part of the navigation graph — they stay in
 * CampusDocument for rendering/search/POI purposes only.
 *
 * The room_door node connects ONLY to hallway nodes (valid edge relationship).
 * It does NOT connect directly to outdoor nodes or entrances.
 */
function compileRoom(component: Component, context: CompileContext): CompileResult {
  const { existingNodes, existingEdges } = context
  const w = (component.dimensions?.width ?? 4) / 2
  const h = (component.dimensions?.height ?? 5) / 2
  const metersPerLat = 111320
  const metersPerLng = 111320 * Math.cos((component.position.lat * Math.PI) / 180)
  const dLat = h / metersPerLat
  const dLng = w / metersPerLng

  const roomLabel = component.name

  // Compute room polygon for rendering (stays in CampusDocument, NOT in graph)
  const polygon: LatLng[] = [
    { lat: component.position.lat - dLat, lng: component.position.lng - dLng }, // SW
    { lat: component.position.lat - dLat, lng: component.position.lng + dLng }, // SE
    { lat: component.position.lat + dLat, lng: component.position.lng + dLng }, // NE
    { lat: component.position.lat + dLat, lng: component.position.lng - dLng }, // NW
  ]

  // Only the room DOOR becomes a routing node (type: 'room_door')
  // This is the access point/destination for the room
  const roomDoorNode: NavNode = {
    id: genId('N'),
    label: roomLabel,
    name: roomLabel,
    type: 'room_door',
    buildingId: component.buildingId,
    campusId: context.campusId ?? '',
    floor: component.floor,
    position: component.position,
  }

  const edges: NavEdge[] = []

  // Connect room_door to nearest SAME-FLOOR, SAME-BUILDING hallway ONLY
  // (valid edge: hallway ↔ room_door). The floor/building filter prevents a
  // door on F1 from latching onto an F0 hallway node when floors share world
  // coordinates — that created cross-floor door edges that bypassed stairs.
  // Do NOT connect to outdoor, entrance, or other room nodes
  const hallwayNodes = existingNodes.filter(
    (n) => n.type === 'hallway' && n.floor === component.floor && n.buildingId === component.buildingId
  )
  const nearestHallway = findNearestNode(component.position, hallwayNodes)

  if (nearestHallway) {
    const alreadyConnected = existingEdges.some(
      (e) =>
        (e.from === roomDoorNode.id && e.to === nearestHallway.id) ||
        (e.to === roomDoorNode.id && e.from === nearestHallway.id)
    )
    if (!alreadyConnected && isValidEdge(roomDoorNode.type, nearestHallway.type)) {
      edges.push({
        id: genId('E'),
        from: roomDoorNode.id,
        to: nearestHallway.id,
        type: 'corridor',
        distance: haversine(component.position, nearestHallway.position),
        weight: haversine(component.position, nearestHallway.position),
        campusId: context.campusId ?? '',
      })
    }
  }

  // Return room_door node + polygon for rendering (polygon is NOT added to graph)
  return { nodes: [roomDoorNode], edges, polygon }
}

/**
 * Compile a staircase component into the navigation graph.
 *
 * Vertical transition. Each floor gets one staircase node; nodes are chained
 * across floors (staircase ↔ staircase), and each floor's node connects to the
 * nearest hallway on that floor (hallway ↔ staircase).
 */
function compileStair(component: Component, context: CompileContext): CompileResult {
  const nodes: NavNode[] = []
  const edges: NavEdge[] = []

  if (component.featureId) {
    const f = component.floor
    const node: NavNode = {
      id: `N-stair-${component.featureId}-${f}`,
      label: `${component.name} (F${f})`,
      name: `${component.name} (F${f})`,
      type: 'staircase',
      buildingId: component.buildingId,
      campusId: context.campusId ?? '',
      floor: f,
      position: component.position,
    }
    nodes.push(node)

    // Vertical chain edge to previous access floor for this feature
    const existingStairNodes = context.existingNodes.filter(
      (n) => n.type === 'staircase' && n.id.startsWith(`N-stair-${component.featureId}-`)
    )
    if (existingStairNodes.length > 0) {
      existingStairNodes.sort((a, b) => a.floor - b.floor)
      const prevNode = existingStairNodes.filter((n) => n.floor < f).pop()
      if (prevNode) {
        edges.push({
          id: `E-stair-${component.featureId}-${prevNode.floor}-${f}`,
          from: prevNode.id,
          to: node.id,
          type: 'stairs',
          distance: 4,
          weight: 4,
          campusId: context.campusId ?? '',
        })
      }
    }

    // Connect to nearest hallway on this floor (valid: hallway ↔ staircase)
    const hallwayNodes = context.existingNodes.filter(
      (n) => n.type === 'hallway' && n.floor === f && n.buildingId === component.buildingId
    )
    const nearestHallway = findNearestNode(component.position, hallwayNodes)
    if (nearestHallway && isValidEdge(node.type, nearestHallway.type)) {
      const alreadyConnected = context.existingEdges.some(
        (e) =>
          (e.from === node.id && e.to === nearestHallway.id) ||
          (e.to === node.id && e.from === nearestHallway.id)
      )
      if (!alreadyConnected) {
        edges.push({
          id: `E-stair-hall-${component.featureId}-${f}`,
          from: node.id,
          to: nearestHallway.id,
          type: 'stairs',
          distance: haversine(component.position, nearestHallway.position),
          weight: haversine(component.position, nearestHallway.position),
          campusId: context.campusId ?? '',
        })
      }
    }

    return { nodes, edges }
  }

  // Legacy per-floor record fallback
  const range = component.range ?? { from: component.floor, to: component.floor + 1 }

  for (let f = range.from; f <= range.to; f++) {
    const node: NavNode = {
      id: genId('N'),
      label: `${component.name} (F${f})`,
      name: `${component.name} (F${f})`,
      type: 'staircase',
      buildingId: component.buildingId,
      campusId: context.campusId ?? '',
      floor: f,
      position: component.position,
    }
    nodes.push(node)
    if (nodes.length > 1) {
      edges.push({
        id: genId('E'),
        from: nodes[nodes.length - 2].id,
        to: node.id,
        type: 'stairs',
        distance: 4,
        weight: 4,
        campusId: context.campusId ?? '',
      })
    }

    // Connect to nearest hallway on this floor (valid: hallway ↔ staircase)
    const hallwayNodes = context.existingNodes.filter(
      (n) => n.type === 'hallway' && n.floor === f && n.buildingId === component.buildingId
    )
    const nearestHallway = findNearestNode(component.position, hallwayNodes)
    if (nearestHallway && isValidEdge(node.type, nearestHallway.type)) {
      const alreadyConnected = context.existingEdges.some(
        (e) =>
          (e.from === node.id && e.to === nearestHallway.id) ||
          (e.to === node.id && e.from === nearestHallway.id)
      )
      if (!alreadyConnected) {
        edges.push({
          id: genId('E'),
          from: node.id,
          to: nearestHallway.id,
          type: 'stairs',
          distance: haversine(component.position, nearestHallway.position),
          weight: haversine(component.position, nearestHallway.position),
          campusId: context.campusId ?? '',
        })
      }
    }
  }

  return { nodes, edges }
}

/**
 * Compile an elevator component into the navigation graph.
 *
 * Vertical transition. Each floor gets one elevator node; nodes are chained
 * across floors (elevator ↔ elevator), and each floor's node connects to the
 * nearest hallway on that floor (hallway ↔ elevator).
 */
function compileElevator(component: Component, context: CompileContext): CompileResult {
  const nodes: NavNode[] = []
  const edges: NavEdge[] = []

  if (component.featureId) {
    const f = component.floor
    const node: NavNode = {
      id: `N-elevator-${component.featureId}-${f}`,
      label: `${component.name} (F${f})`,
      name: `${component.name} (F${f})`,
      type: 'elevator',
      buildingId: component.buildingId,
      campusId: context.campusId ?? '',
      floor: f,
      position: component.position,
    }
    nodes.push(node)

    // Vertical chain edge to previous access floor for this elevator feature
    const existingElevNodes = context.existingNodes.filter(
      (n) => n.type === 'elevator' && n.id.startsWith(`N-elevator-${component.featureId}-`)
    )
    if (existingElevNodes.length > 0) {
      existingElevNodes.sort((a, b) => a.floor - b.floor)
      const prevNode = existingElevNodes.filter((n) => n.floor < f).pop()
      if (prevNode) {
        edges.push({
          id: `E-elevator-${component.featureId}-${prevNode.floor}-${f}`,
          from: prevNode.id,
          to: node.id,
          type: 'elevator',
          distance: 3,
          weight: 3,
          campusId: context.campusId ?? '',
        })
      }
    }

    // Connect to nearest hallway on this floor (valid: hallway ↔ elevator)
    const hallwayNodes = context.existingNodes.filter(
      (n) => n.type === 'hallway' && n.floor === f && n.buildingId === component.buildingId
    )
    const nearestHallway = findNearestNode(component.position, hallwayNodes)
    if (nearestHallway && isValidEdge(node.type, nearestHallway.type)) {
      const alreadyConnected = context.existingEdges.some(
        (e) =>
          (e.from === node.id && e.to === nearestHallway.id) ||
          (e.to === node.id && e.from === nearestHallway.id)
      )
      if (!alreadyConnected) {
        edges.push({
          id: `E-elevator-hall-${component.featureId}-${f}`,
          from: node.id,
          to: nearestHallway.id,
          type: 'elevator',
          distance: haversine(component.position, nearestHallway.position),
          weight: haversine(component.position, nearestHallway.position),
          campusId: context.campusId ?? '',
        })
      }
    }

    return { nodes, edges }
  }

  // Legacy per-floor record fallback
  const range = component.range ?? { from: component.floor, to: component.floor + 1 }

  for (let f = range.from; f <= range.to; f++) {
    const node: NavNode = {
      id: genId('N'),
      label: `${component.name} (F${f})`,
      name: `${component.name} (F${f})`,
      type: 'elevator',
      buildingId: component.buildingId,
      campusId: context.campusId ?? '',
      floor: f,
      position: component.position,
    }
    nodes.push(node)
    if (nodes.length > 1) {
      edges.push({
        id: genId('E'),
        from: nodes[nodes.length - 2].id,
        to: node.id,
        type: 'elevator',
        distance: 3,
        weight: 3,
        campusId: context.campusId ?? '',
      })
    }

    // Connect to nearest hallway on this floor (valid: hallway ↔ elevator)
    const hallwayNodes = context.existingNodes.filter(
      (n) => n.type === 'hallway' && n.floor === f && n.buildingId === component.buildingId
    )
    const nearestHallway = findNearestNode(component.position, hallwayNodes)
    if (nearestHallway && isValidEdge(node.type, nearestHallway.type)) {
      const alreadyConnected = context.existingEdges.some(
        (e) =>
          (e.from === node.id && e.to === nearestHallway.id) ||
          (e.to === node.id && e.from === nearestHallway.id)
      )
      if (!alreadyConnected) {
        edges.push({
          id: genId('E'),
          from: node.id,
          to: nearestHallway.id,
          type: 'elevator',
          distance: haversine(component.position, nearestHallway.position),
          weight: haversine(component.position, nearestHallway.position),
          campusId: context.campusId ?? '',
        })
      }
    }
  }

  return { nodes, edges }
}

/**
 * Compile a hallway component into the navigation graph.
 *
 * Hallway nodes are the primary indoor routing space. They connect to:
 * - Other hallway nodes (hallway ↔ hallway)
 * - Room door nodes (hallway ↔ room_door)
 * - Entrance nodes (entrance ↔ hallway)
 * - Stair/elevator nodes (hallway ↔ staircase, hallway ↔ elevator)
 */
function compileHallway(component: Component, context: CompileContext): CompileResult {
  // Use polygon points as drawn polyline when available
  if (component.polygon && component.polygon.length >= 2) {
    const nodes: NavNode[] = component.polygon.map((pos, i) => ({
      id: genId('N'),
      label: `${component.name} ${i === 0 ? 'Start' : i === component.polygon!.length - 1 ? 'End' : `Pt${i}`}`,
      name: `${component.name} ${i === 0 ? 'Start' : i === component.polygon!.length - 1 ? 'End' : `Pt${i}`}`,
      type: 'hallway' as const,
      buildingId: component.buildingId,
      campusId: context.campusId ?? '',
      floor: component.floor,
      position: pos,
    }))

    // Connect hallway points sequentially (hallway ↔ hallway is valid)
    const edges: NavEdge[] = nodes.slice(1).map((node, i) => ({
      id: genId('E'),
      from: nodes[i].id,
      to: node.id,
      type: 'corridor',
      distance: haversine(nodes[i].position, node.position),
      weight: haversine(nodes[i].position, node.position),
      campusId: context.campusId ?? '',
    }))

    return { nodes, edges }
  }

  // Fallback: legacy linear generation from position + width
  const length = component.dimensions?.width ?? 10
  const segmentCount = Math.max(2, Math.floor(length / 5))
  const dLngPerSegment = (length / segmentCount) / (111320 * Math.cos((component.position.lat * Math.PI) / 180))

  const nodes: NavNode[] = []
  const edges: NavEdge[] = []

  for (let i = 0; i <= segmentCount; i++) {
    const pos: LatLng = {
      lat: component.position.lat,
      lng: component.position.lng + dLngPerSegment * i,
    }
    const node: NavNode = {
      id: genId('N'),
      label: `${component.name} ${i === 0 ? 'Start' : i === segmentCount ? 'End' : `Pt${i}`}`,
      name: `${component.name} ${i === 0 ? 'Start' : i === segmentCount ? 'End' : `Pt${i}`}`,
      type: 'hallway' as const,
      buildingId: component.buildingId,
      campusId: context.campusId ?? '',
      floor: component.floor,
      position: pos,
    }
    nodes.push(node)
    if (i > 0) {
      edges.push({
        id: genId('E'),
        from: nodes[i - 1].id,
        to: node.id,
        type: 'corridor',
        distance: haversine(nodes[i - 1].position, pos),
        weight: haversine(nodes[i - 1].position, pos),
        campusId: context.campusId ?? '',
      })
    }
  }

  return { nodes, edges }
}

/**
 * Compile an entrance component into the navigation graph.
 *
 * Entrance nodes are the architectural source for an explicit access bridge.
 * Proximity does not author navigation relationships: the editor projects
 * Floor.entranceAccess only after the author selects and confirms both sides.
 * NEVER connect an entrance directly to a room door / room interior here.
 */
function compileEntrance(component: Component, context: CompileContext): CompileResult {
  const node: NavNode = {
    id: genId('N'),
    label: component.name,
    name: component.name,
    type: 'building_entrance',
    buildingId: component.buildingId,
    campusId: context.campusId ?? '',
    floor: component.floor,
    position: component.position,
    hasQr: (component.metadata as Record<string, boolean>)?.hasQr === true,
    hasPanorama: (component.metadata as Record<string, boolean>)?.hasPanorama === true,
  }

  // The graph node is available for selection, but its edges are intentionally
  // projected later from an explicit EntranceAccess assignment.
  return { nodes: [node], edges: [] }
}

const COMPILERS: Record<ComponentType, (c: Component, ctx: CompileContext) => CompileResult> = {
  room: compileRoom,
  stair: compileStair,
  elevator: compileElevator,
  hallway: compileHallway,
  entrance: compileEntrance,
  restroom: compileRoom, // restroom compiles same as room
}

export function compileComponent(
  component: Component,
  context: CompileContext
): CompileResult {
  const compiler = COMPILERS[component.type]
  if (!compiler) {
    return { nodes: [], edges: [] }
  }
  const result = compiler(component, context)

  // Final validation pass: drop any node not in the routing whitelist and any
  // edge that violates the valid-connection model. This guards against
  // geometry-derived or legacy connections sneaking back into the graph.
  const routingNodes = result.nodes.filter((n) => isRoutingNode(n.type))
  const routingNodeIds = new Set(routingNodes.map((n) => n.id))
  // Edge endpoints may live in the existing graph (e.g. room_door → existing
  // hallway), so validate against both new + existing nodes.
  const knownNodes = [...routingNodes, ...context.existingNodes]
  const validEdges = result.edges.filter((e) => {
    const fromNode = knownNodes.find((n) => n.id === e.from)
    const toNode = knownNodes.find((n) => n.id === e.to)
    if (!fromNode || !toNode) return false
    if (!routingNodeIds.has(e.from) && !routingNodeIds.has(e.to)) return false
    return isValidEdge(fromNode.type, toNode.type)
  })

  return {
    nodes: routingNodes.map((n) => ({ ...n, componentId: context.componentId })),
    edges: validEdges,
    ...(result.polygon ? { polygon: result.polygon } : {}),
  }
}
