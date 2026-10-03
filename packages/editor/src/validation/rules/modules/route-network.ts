import { isRouteEdgeType, isRouteNodeType } from '@navi/core'
import type { CampusDocument, Floor, RouteEdge, RouteNode } from '@navi/core'
import type { ValidationIssue } from '../../snapshot'
import type { ValidationContext, ValidationProfileId, ValidationRule } from '../types'

type RouteProfile = ValidationProfileId | 'publish'
type RouteLayer = 'navigation' | 'access'

interface RouteIssueScope {
  buildingId: string
  floorId: string
  layer: RouteLayer
}

interface RouteFloorGraph {
  nodes: RouteNode[]
  edges: RouteEdge[]
  nodeById: Map<string, RouteNode>
  adjacency: Map<string, Set<string>>
  componentByNode: Map<string, string>
  components: string[][]
}

function hash(value: string): string {
  let result = 0
  for (let index = 0; index < value.length; index++) {
    result = ((result << 5) - result) + value.charCodeAt(index)
    result |= 0
  }
  return Math.abs(result).toString(36)
}

function severityFor(profile: RouteProfile): 'error' | 'warning' {
  return profile === 'publish' || profile === 'strict' ? 'error' : 'warning'
}

function issue(
  ruleId: string,
  profile: RouteProfile,
  message: string,
  targets: Array<{ entityId: string; entityType: string }>,
  scope?: RouteIssueScope,
): ValidationIssue {
  const targetKey = targets.map((target) => `${target.entityType}:${target.entityId}`).join('|')
  return {
    issueId: `${ruleId}:${hash(`${message}|${targetKey}`)}`,
    ruleId,
    severity: severityFor(profile),
    message,
    targets,
    ...scope,
  }
}

function routeNetworkOf(floor: Floor): { nodes: unknown; edges: unknown } | null {
  const network = floor.routeNetwork as unknown
  if (network === undefined) return null
  if (!network || typeof network !== 'object') return { nodes: undefined, edges: undefined }
  return network as { nodes: unknown; edges: unknown }
}

function buildRouteFloorGraph(floor: Floor): RouteFloorGraph {
  const network = routeNetworkOf(floor)
  const nodes = Array.isArray(network?.nodes) ? network.nodes as RouteNode[] : []
  const edges = Array.isArray(network?.edges) ? network.edges as RouteEdge[] : []
  const nodeById = new Map<string, RouteNode>()
  for (const node of nodes) {
    if (typeof node?.id === 'string' && !nodeById.has(node.id)) nodeById.set(node.id, node)
  }

  const adjacency = new Map<string, Set<string>>()
  for (const node of nodeById.values()) adjacency.set(node.id, new Set())
  for (const edge of edges) {
    if (!nodeById.has(edge?.from) || !nodeById.has(edge?.to) || edge.from === edge.to) continue
    adjacency.get(edge.from)!.add(edge.to)
    adjacency.get(edge.to)!.add(edge.from)
  }

  const componentByNode = new Map<string, string>()
  const components: string[][] = []
  for (const node of nodeById.values()) {
    if (componentByNode.has(node.id)) continue
    const component: string[] = []
    const queue = [node.id]
    while (queue.length > 0) {
      const current = queue.shift()!
      if (componentByNode.has(current)) continue
      componentByNode.set(current, node.id)
      component.push(current)
      for (const neighbor of adjacency.get(current) ?? []) {
        if (!componentByNode.has(neighbor)) queue.push(neighbor)
      }
    }
    components.push(component.sort())
  }

  components.sort((left, right) => right.length - left.length || left[0].localeCompare(right[0]))
  return { nodes, edges, nodeById, adjacency, componentByNode, components }
}

function hasRoutePath(graph: RouteFloorGraph, nodeId: string, rootComponents: ReadonlySet<string>): boolean {
  const componentId = graph.componentByNode.get(nodeId)
  if (!componentId) return false
  const neighbors = graph.adjacency.get(nodeId)
  return (neighbors?.size ?? 0) > 0 && rootComponents.has(componentId)
}

function rootComponents(floor: Floor, graph: RouteFloorGraph): Set<string> {
  const entranceRoots = new Set<string>()
  for (const access of floor.entranceAccess ?? []) {
    const componentId = graph.componentByNode.get(access.indoorRouteNodeId)
    if (componentId) entranceRoots.add(componentId)
  }
  if (entranceRoots.size > 0) return entranceRoots
  return graph.components.length > 0 ? new Set([graph.components[0][0]]) : new Set()
}

function structureIssues(
  buildingId: string,
  floor: Floor,
  profile: RouteProfile,
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const network = routeNetworkOf(floor)
  if (!network) return issues
  const scope: RouteIssueScope = { buildingId, floorId: floor.id, layer: 'navigation' }
  const addIssue = (ruleId: string, message: string, targets: Array<{ entityId: string; entityType: string }>) => {
    issues.push(issue(ruleId, profile, message, targets, scope))
  }

  if (!Array.isArray(network.nodes)) {
    addIssue('route-network-structure', `Floor "${floor.label || floor.id}" route network nodes must be an array`, [{ entityId: floor.id, entityType: 'floor' }])
  }
  if (!Array.isArray(network.edges)) {
    addIssue('route-network-structure', `Floor "${floor.label || floor.id}" route network edges must be an array`, [{ entityId: floor.id, entityType: 'floor' }])
  }

  const graph = buildRouteFloorGraph(floor)
  const nodeIds = new Set<string>()
  for (const [index, node] of graph.nodes.entries()) {
    const nodeId = typeof node?.id === 'string' && node.id.length > 0 ? node.id : `${floor.id}:node:${index}`
    const target = { entityId: nodeId, entityType: 'route-node' }
    if (nodeIds.has(nodeId)) {
      addIssue('route-network-structure', `Route node "${nodeId}" is duplicated on floor "${floor.label || floor.id}"`, [target])
    }
    nodeIds.add(nodeId)
    if (typeof node?.id !== 'string' || node.id.length === 0) {
      addIssue('route-network-structure', `Route node at index ${index} has no valid id`, [target])
    }
    if (!isRouteNodeType(node?.type)) {
      addIssue('route-network-structure', `Route node "${nodeId}" has an invalid type`, [target])
    }
    if (!Number.isFinite(node?.position?.x) || !Number.isFinite(node?.position?.y)) {
      addIssue('route-network-structure', `Route node "${nodeId}" has an invalid local position`, [target])
    }
  }

  const edgeIds = new Set<string>()
  for (const [index, edge] of graph.edges.entries()) {
    const edgeId = typeof edge?.id === 'string' && edge.id.length > 0 ? edge.id : `${floor.id}:edge:${index}`
    const edgeTarget = { entityId: edgeId, entityType: 'route-edge' }
    if (edgeIds.has(edgeId)) {
      addIssue('route-network-structure', `Route edge "${edgeId}" is duplicated on floor "${floor.label || floor.id}"`, [edgeTarget])
    }
    edgeIds.add(edgeId)
    if (typeof edge?.id !== 'string' || edge.id.length === 0) {
      addIssue('route-network-structure', `Route edge at index ${index} has no valid id`, [edgeTarget])
    }
    if (!isRouteEdgeType(edge?.type)) {
      addIssue('route-network-structure', `Route edge "${edgeId}" has an invalid type`, [edgeTarget])
    }
    if (!Number.isFinite(edge?.distance) || edge.distance < 0) {
      addIssue('route-network-structure', `Route edge "${edgeId}" has an invalid distance`, [edgeTarget])
    }
    for (const endpoint of [edge?.from, edge?.to]) {
      if (typeof endpoint !== 'string' || endpoint.length === 0) {
        addIssue('route-network-structure', `Route edge "${edgeId}" has a missing endpoint`, [edgeTarget])
      } else if (!graph.nodeById.has(endpoint)) {
        addIssue('route-network-structure', `Route edge "${edgeId}" references missing route node "${endpoint}"`, [edgeTarget, { entityId: endpoint, entityType: 'route-node' }])
      }
    }
    if (edge?.from === edge?.to && typeof edge?.from === 'string') {
      addIssue('route-network-structure', `Route edge "${edgeId}" cannot connect a node to itself`, [edgeTarget, { entityId: edge.from, entityType: 'route-node' }])
    }
  }

  return issues
}

function disconnectedIssues(
  buildingId: string,
  floor: Floor,
  graph: RouteFloorGraph,
  profile: RouteProfile,
): ValidationIssue[] {
  if (graph.nodes.length === 0) return []
  const issues: ValidationIssue[] = []
  const scope: RouteIssueScope = { buildingId, floorId: floor.id, layer: 'navigation' }
  const disconnected = graph.components.length > 1
    ? graph.components
    : graph.components.filter((component) => component.every((nodeId) => (graph.adjacency.get(nodeId)?.size ?? 0) === 0))

  for (const component of disconnected) {
    const first = component[0]
    const message = component.length === 1
      ? `Route node "${first}" is isolated from the hallway route on floor "${floor.label || floor.id}"`
      : `Route component on floor "${floor.label || floor.id}" is disconnected from the main route (${component.join(', ')})`
    issues.push(issue('route-network-disconnected', profile, message, component.map((nodeId) => ({ entityId: nodeId, entityType: 'route-node' })), scope))
  }
  return issues
}

function floorConsistencyIssues(
  buildingId: string,
  floor: Floor,
  graph: RouteFloorGraph,
  profile: RouteProfile,
): ValidationIssue[] {
  return graph.nodes
    .filter((node) => node.floor !== floor.level)
    .map((node) => issue(
      'route-floor-consistency',
      profile,
      `Route node "${node.id}" declares floor ${node.floor}, but it belongs to floor ${floor.level}`,
      [{ entityId: node.id, entityType: 'route-node' }, { entityId: floor.id, entityType: 'floor' }],
      { buildingId, floorId: floor.id, layer: 'navigation' },
    ))
}

function roomAccessIssues(
  buildingId: string,
  floor: Floor,
  graph: RouteFloorGraph,
  profile: RouteProfile,
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const scope: RouteIssueScope = { buildingId, floorId: floor.id, layer: 'access' }
  const roots = rootComponents(floor, graph)
  for (const attributes of floor.roomAttributes ?? []) {
    const roomId = attributes.roomId ?? attributes.faceId
    const roomName = attributes.name || attributes.code || roomId
    for (const access of attributes.accessPoints ?? []) {
      const roomTarget = { entityId: roomId, entityType: 'room' }
      if (!access || typeof access.routeNodeId !== 'string' || access.routeNodeId.length === 0) {
        issues.push(issue('route-room-access', profile, `Room "${roomName}" has an access point without a route node`, [roomTarget], scope))
        continue
      }
      const routeTarget = { entityId: access.routeNodeId, entityType: 'route-node' }
      if (!graph.nodeById.has(access.routeNodeId)) {
        issues.push(issue('route-room-access', profile, `Room "${roomName}" access point references missing route node "${access.routeNodeId}"`, [roomTarget, routeTarget], scope))
        continue
      }
      if (!hasRoutePath(graph, access.routeNodeId, roots)) {
        issues.push(issue('route-room-access', profile, `Room "${roomName}" access point is not connected to the hallway route`, [roomTarget, routeTarget], scope))
      }
    }
  }
  return issues
}

function entranceAccessIssues(
  buildingId: string,
  floor: Floor,
  graph: RouteFloorGraph,
  profile: RouteProfile,
  roadIds: ReadonlySet<string>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const scope: RouteIssueScope = { buildingId, floorId: floor.id, layer: 'access' }
  const roots = rootComponents(floor, graph)
  const entranceIds = new Set(floor.entrances.map((entrance) => entrance.id))
  const assignedEntranceIds = new Set(
    (floor.entranceAccess ?? [])
      .map((access) => access.entranceId)
      .filter((entranceId): entranceId is string => typeof entranceId === 'string' && entranceId.trim().length > 0),
  )

  for (const entrance of floor.entrances) {
    const legacyConnectorRoadId = entrance.metadata?.connectorRoadId
    const hasLegacyExplicitConnector = typeof legacyConnectorRoadId === 'string' && legacyConnectorRoadId.trim().length > 0
    if (!assignedEntranceIds.has(entrance.id) && !hasLegacyExplicitConnector) {
      issues.push(issue(
        'route-entrance-access',
        profile,
        `Entrance "${entrance.id}" has no explicit outdoor route assignment`,
        [{ entityId: entrance.id, entityType: 'entrance' }],
        scope,
      ))
    }
  }

  for (const access of floor.entranceAccess ?? []) {
    const entranceTarget = { entityId: access.entranceId, entityType: 'entrance' }
    const indoorTarget = { entityId: access.indoorRouteNodeId, entityType: 'route-node' }
    if (!entranceIds.has(access.entranceId)) {
      issues.push(issue('route-entrance-access', profile, `Entrance access references missing entrance "${access.entranceId}"`, [entranceTarget], scope))
    }
    if (typeof access.outdoorNodeId !== 'string' || access.outdoorNodeId.trim().length === 0) {
      issues.push(issue('route-entrance-access', profile, `Entrance "${access.entranceId}" has no outdoor navigation node`, [entranceTarget], scope))
    }

    const hasOutdoorRouteId = access.outdoorRouteId !== undefined
    const hasOutdoorPosition = access.outdoorPosition !== undefined
    if (hasOutdoorRouteId !== hasOutdoorPosition) {
      issues.push(issue(
        'route-entrance-access',
        profile,
        `Entrance "${access.entranceId}" outdoor route assignment must include both a route ID and an exact position`,
        [entranceTarget],
        scope,
      ))
    } else if (hasOutdoorRouteId && hasOutdoorPosition) {
      if (typeof access.outdoorRouteId !== 'string' || access.outdoorRouteId.trim().length === 0) {
        issues.push(issue('route-entrance-access', profile, `Entrance "${access.entranceId}" has no valid outdoor route ID`, [entranceTarget], scope))
      } else if (!roadIds.has(access.outdoorRouteId)) {
        issues.push(issue('route-entrance-access', profile, `Entrance "${access.entranceId}" references missing outdoor route "${access.outdoorRouteId}"`, [entranceTarget, { entityId: access.outdoorRouteId, entityType: 'road' }], scope))
      }
      if (!Number.isFinite(access.outdoorPosition?.lat) || !Number.isFinite(access.outdoorPosition?.lng)) {
        issues.push(issue('route-entrance-access', profile, `Entrance "${access.entranceId}" has an invalid outdoor route position`, [entranceTarget], scope))
      }
    }

    if (typeof access.indoorRouteNodeId !== 'string' || access.indoorRouteNodeId.length === 0 || !graph.nodeById.has(access.indoorRouteNodeId)) {
      issues.push(issue('route-entrance-access', profile, `Entrance "${access.entranceId}" references missing indoor route node "${access.indoorRouteNodeId}"`, [entranceTarget, indoorTarget], scope))
      continue
    }
    if (!hasRoutePath(graph, access.indoorRouteNodeId, roots)) {
      issues.push(issue('route-entrance-access', profile, `Entrance "${access.entranceId}" indoor access is not connected to the hallway route`, [entranceTarget, indoorTarget], scope))
    }
  }
  return issues
}

/** Pure route checks shared by the validation engine and the Floor Editor panel. */
export function validateRouteNetwork(document: CampusDocument, profile: RouteProfile = 'publish'): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const roadIds = new Set((document.roads ?? []).map((road) => road.id))
  for (const building of document.buildings ?? []) {
    for (const floor of building.floors ?? []) {
      if (!routeNetworkOf(floor)) continue
      const graph = buildRouteFloorGraph(floor)
      issues.push(...structureIssues(building.id, floor, profile))
      issues.push(...disconnectedIssues(building.id, floor, graph, profile))
      issues.push(...floorConsistencyIssues(building.id, floor, graph, profile))
      issues.push(...roomAccessIssues(building.id, floor, graph, profile))
      issues.push(...entranceAccessIssues(building.id, floor, graph, profile, roadIds))
    }
  }
  return issues
}

function rule(ruleId: string, description: string, select: (issues: ValidationIssue[]) => ValidationIssue[]): ValidationRule {
  return {
    ruleId,
    description,
    category: 'navigation',
    defaultSeverity: 'error',
    profiles: ['draft', 'publish', 'strict'],
    affinity: 'global',
    execute: (context: ValidationContext) => select(validateRouteNetwork(context.document, context.profile)),
  }
}

export const routeNetworkStructureRule = rule(
  'route-network-structure',
  'Route nodes and edges have valid identifiers, types, coordinates, endpoints, and distances',
  (issues) => issues.filter((issue) => issue.ruleId === 'route-network-structure'),
)

export const routeNetworkDisconnectedRule = rule(
  'route-network-disconnected',
  'Authored route nodes form one connected navigable network',
  (issues) => issues.filter((issue) => issue.ruleId === 'route-network-disconnected'),
)

export const routeRoomAccessRule = rule(
  'route-room-access',
  'Semantic Room access points resolve to reachable route nodes',
  (issues) => issues.filter((issue) => issue.ruleId === 'route-room-access'),
)

export const routeEntranceAccessRule = rule(
  'route-entrance-access',
  'Entrance bridges resolve to reachable indoor route nodes and an outdoor reference',
  (issues) => issues.filter((issue) => issue.ruleId === 'route-entrance-access'),
)

export const routeFloorConsistencyRule = rule(
  'route-floor-consistency',
  'Route nodes declare the floor that owns them',
  (issues) => issues.filter((issue) => issue.ruleId === 'route-floor-consistency'),
)

export const routeNetworkRules: ReadonlyArray<ValidationRule> = [
  routeNetworkStructureRule,
  routeNetworkDisconnectedRule,
  routeRoomAccessRule,
  routeEntranceAccessRule,
  routeFloorConsistencyRule,
]
