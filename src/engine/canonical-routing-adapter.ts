import type {
  NavEdge as CoreNavEdge,
  NavEdgeType as CoreNavEdgeType,
  NavNode as CoreNavNode,
  NavNodeType as CoreNavNodeType,
  NavigationGraph,
  POIIndex,
} from '@navi/core'
import { RoutingEngine } from '@navi/runtime/routing'
import type { DestinationRouteResult, Route } from '@navi/runtime/routing'
import type { NavEdge, NavNode, PathResult } from '../types/nav-types'

function coreNodeType(type: NavNode['type']): CoreNavNodeType {
  if (type === 'room') return 'space'
  if (type === 'walkway' || type === 'hallway') return 'corridor'
  if (type === 'stair' || type === 'staircase' || type === 'elevator' || type === 'connector_stop') {
    return 'transition'
  }
  if (type === 'entrance' || type === 'building_entrance') return 'entrance'
  if (type === 'intersection') return 'intersection'
  if (type === 'qr_marker') return 'poi'
  if (type === 'outdoor') return 'outdoor'
  return 'waypoint'
}

function coreEdgeType(type: NavEdge['type']): CoreNavEdgeType {
  if (type === 'stair' || type === 'stairs') return 'stairs'
  if (type === 'elevator') return 'elevator'
  if (type === 'transition') return 'transition'
  return 'walk'
}

function toCoreNode(node: NavNode): CoreNavNode {
  return {
    id: node.id,
    label: node.label,
    type: coreNodeType(node.type),
    position: node.position,
    floor: node.floor,
    buildingId: node.buildingId,
    properties: node.metadata ?? {},
  }
}

function toCoreEdge(edge: NavEdge): CoreNavEdge {
  return {
    id: edge.id,
    from: edge.from,
    to: edge.to,
    type: coreEdgeType(edge.type),
    distance: edge.distance,
    weight: edge.weight ?? edge.distance,
    ...(edge.routing ? { routing: edge.routing } : {}),
  }
}

function toCoreGraph(nodes: NavNode[], edges: NavEdge[]): NavigationGraph {
  const coreNodes = nodes.map(toCoreNode)
  const coreEdges = edges.map(toCoreEdge)
  const lngs = coreNodes.map((node) => node.position.lng)
  const lats = coreNodes.map((node) => node.position.lat)
  return {
    version: 'studio-canonical-adapter-v1',
    campusId: nodes[0]?.campusId ?? '',
    createdAt: '',
    checksum: '',
    nodes: coreNodes,
    edges: coreEdges,
    metadata: {
      nodeCount: coreNodes.length,
      edgeCount: coreEdges.length,
      buildings: new Set(coreNodes.map((node) => node.buildingId).filter(Boolean)).size,
      floors: new Set(coreNodes.map((node) => `${node.buildingId}:${node.floor}`)).size,
      boundingBox: {
        minLng: lngs.length > 0 ? Math.min(...lngs) : 0,
        maxLng: lngs.length > 0 ? Math.max(...lngs) : 0,
        minLat: lats.length > 0 ? Math.min(...lats) : 0,
        maxLat: lats.length > 0 ? Math.max(...lats) : 0,
      },
    },
  }
}

/**
 * Narrow bridge from the Studio/public graph shape to canonical runtime
 * routing. Route selection is terrain-aware; returned cost remains physical
 * distance because existing UI contracts display it as meters.
 */
export function findCanonicalRoutePath(
  nodes: NavNode[],
  edges: NavEdge[],
  fromId: string,
  toId: string,
): PathResult | null {
  const route = new RoutingEngine(toCoreGraph(nodes, edges)).findRoute(fromId, toId)
  if (!route) return null

  const path = route.path.map((step) => step.nodeId)
  const segmentInstructions = route.instructions.filter(
    (instruction) => instruction.type !== 'arrive'
      && instruction.type !== 'turn_left'
      && instruction.type !== 'turn_right',
  )
  const steps = path.map((nodeId, index) => {
    const previousNodeId = index > 0 ? path[index - 1] : undefined
    const segment = index > 0 ? segmentInstructions[index - 1] : undefined
    const instruction = index === 0
      ? 'Start here'
      : index === path.length - 1
        ? 'Destination reached'
        : route.instructions.find((item) => item.fromNode === previousNodeId && item.toNode === nodeId)?.text
          ?? 'Continue'
    return {
      nodeId,
      ...(route.path[index]?.edgeId ? { edgeId: route.path[index].edgeId } : {}),
      instruction,
      distance: segment?.distance ?? 0,
    }
  })

  return {
    path,
    cost: route.totalDistance,
    ...(route.generalizedCost === undefined ? {} : { generalizedCost: route.generalizedCost }),
    steps,
  }
}

/** Additive canonical route boundary for authored POIs; the ordinary path API
 * above remains node-to-node and unchanged for existing callers. */
export function findCanonicalPoiRoute(
  nodes: NavNode[],
  edges: NavEdge[],
  poiIndex: POIIndex,
  fromId: string,
  poiId: string,
): DestinationRouteResult<Route> {
  return new RoutingEngine(toCoreGraph(nodes, edges)).findRouteToPOI(
    fromId,
    { destinationType: 'poi', poiId },
    poiIndex,
  )
}
