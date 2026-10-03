import type { NavigationGraph, NavNode, NavEdge, POIIndex } from '@navi/core'
import { haversine } from '@navi/core'
import { AStar } from './astar'
import type { HeuristicProvider, TraversalCostProvider, TraversalEligibilityProvider } from './astar'
import {
  STANDARD_PEDESTRIAN_ELIGIBILITY_V1,
  isTraversalEligible,
} from './edge-eligibility'
import {
  STANDARD_TERRAIN_PROFILE_V1,
  buildRoadTerrainContext,
  calculateTraversalCost,
} from './traversal-cost'
import { resolvePoiDestination } from './poi-destination-resolver'
import type { DestinationRequest, DestinationRouteResult, PoiOverlayEdgePolicy } from './destination'
import { type Route, type RouteStep, type Instruction, type InstructionType } from './route'

export interface RoutingEngineOptions {
  traversalCost?: TraversalCostProvider
  traversalEligibility?: TraversalEligibilityProvider
  heuristic?: HeuristicProvider
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  const mins = Math.floor(seconds / 60)
  const secs = Math.round(seconds % 60)
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`
}

function bearing(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLng = (b.lng - a.lng) * Math.PI / 180
  const lat1 = a.lat * Math.PI / 180
  const lat2 = b.lat * Math.PI / 180
  const y = Math.sin(dLng) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
}

function turnInstruction(prevBearing: number, currBearing: number): InstructionType | null {
  const diff = ((currBearing - prevBearing + 540) % 360) - 180
  if (diff > 30) return 'turn_right'
  if (diff < -30) return 'turn_left'
  return null
}

export class RoutingEngine {
  private astar: AStar
  private graph: NavigationGraph
  private nodes = new Map<string, NavNode>()
  private edgesById = new Map<string, NavEdge>()

  constructor(graph: NavigationGraph, options: RoutingEngineOptions = {}) {
    this.graph = graph
    const terrainContext = options.traversalCost ? undefined : buildRoadTerrainContext(graph)
    const traversalCost: TraversalCostProvider = options.traversalCost ?? ((edge, traversalFromNodeId) => calculateTraversalCost(
      edge,
      traversalFromNodeId,
      STANDARD_TERRAIN_PROFILE_V1,
      terrainContext!,
    ))
    const traversalEligibility: TraversalEligibilityProvider = options.traversalEligibility ?? ((edge, traversalFromNodeId) => isTraversalEligible(
      edge,
      traversalFromNodeId,
      STANDARD_PEDESTRIAN_ELIGIBILITY_V1,
    ))
    this.astar = new AStar(graph, {
      traversalCost,
      traversalEligibility,
      heuristic: options.heuristic ?? ((node, goal) => haversine(node.position, goal.position)),
    })
    for (const node of graph.nodes) {
      this.nodes.set(node.id, node)
    }
    for (const edge of graph.edges) {
      this.edgesById.set(edge.id, edge)
    }
  }

  findRoute(fromId: string, toId: string): Route | null {
    const result = this.astar.findPath(fromId, toId)
    if (!result) return null

    const fromNode = this.nodes.get(fromId)
    const toNode = this.nodes.get(toId)
    if (!fromNode || !toNode) return null

    const path: RouteStep[] = result.path.map((id, index) => {
      const n = this.nodes.get(id)!
      return {
        nodeId: id,
        ...(index > 0 ? { edgeId: result.edgeIds[index - 1] } : {}),
        label: n.label,
        position: n.position,
        floor: n.floor,
        buildingId: n.buildingId,
      }
    })

    const instructions: Instruction[] = []
    let prevBearing: number | null = null

    for (let i = 0; i < result.path.length - 1; i++) {
      const curr = this.nodes.get(result.path[i])!
      const next = this.nodes.get(result.path[i + 1])!
      const edge = this.edgesById.get(result.edgeIds[i])

      if (i < result.path.length - 2) {
        const currBearing = bearing(curr.position, next.position)
        if (prevBearing !== null) {
          const turn = turnInstruction(prevBearing, currBearing)
          if (turn) {
            instructions.push({ type: turn, text: turn === 'turn_left' ? 'Turn left' : 'Turn right', distance: 0, fromNode: curr.id, toNode: next.id })
          }
        }
        // Track bearing of this segment for comparison on the next iteration
        prevBearing = currBearing
      }

      const edgeTypeMap: Record<string, InstructionType> = { stairs: 'stairs', elevator: 'elevator', walk: 'walk', transition: 'walk' }
      const instType = edge ? edgeTypeMap[edge.type] ?? 'walk' : 'walk'
      const dist = edge ? edge.distance : haversine(curr.position, next.position)
      const edgeLabel = edge ? `${instType === 'stairs' ? 'stairs' : 'walk'} to ${next.label}` : `Walk to ${next.label}`
      instructions.push({ type: instType, text: edgeLabel, distance: dist, fromNode: curr.id, toNode: next.id })
    }

    instructions.push({ type: 'arrive', text: 'You have arrived', distance: 0, fromNode: toId, toNode: toId })

    const totalDistance = instructions.reduce((sum, i) => sum + i.distance, 0)
    const totalDuration = totalDistance / 1.4
    const travelTime = { seconds: Math.round(totalDuration), minutes: Math.round(totalDuration / 60), formatted: formatDuration(totalDuration) }

    return {
      path,
      instructions,
      totalDistance,
      generalizedCost: result.cost,
      totalDuration,
      fromLabel: fromNode.label,
      toLabel: toNode.label,
      travelTime,
    }
  }

  findRouteToPOI(
    fromId: string,
    request: DestinationRequest,
    poiIndex: POIIndex | undefined,
  ): DestinationRouteResult<Route> {
    const poi = poiIndex?.points.find((point) => point.id === request.poiId)
    if (!poi) return {
      ok: false,
      code: 'POI_NOT_FOUND',
      message: `POI ${request.poiId} was not found`,
    }

    if (poi.nodeId) {
      const route = this.findRoute(fromId, poi.nodeId)
      if (!route) return this.unreachablePoi(request.poiId)
      const node = this.nodes.get(poi.nodeId)
      return {
        ok: true,
        route: {
          ...route,
          destination: {
            entityType: 'poi',
            entityId: poi.id,
            ...(node
              ? {
                  resolvedApproach: {
                    kind: 'node' as const,
                    networkId: node.id,
                    position: node.position,
                    distanceMeters: 0,
                    floor: node.floor,
                    buildingId: node.buildingId,
                  },
                }
              : {}),
          },
        },
      }
    }

    const resolution = resolvePoiDestination(this.graph, poiIndex, request)
    if (!resolution.ok) return resolution

    const baseTerrainContext = buildRoadTerrainContext(this.graph)
    const baseEdges = this.edgesById
    const overlay = resolution.resolution.overlay
    const overlayEngine = new RoutingEngine(overlay.graph, {
      traversalCost: (edge, traversalFromNodeId) => this.overlayTraversalCost(
        edge,
        traversalFromNodeId,
        overlay.edgePolicies,
        baseEdges,
        baseTerrainContext,
      ),
      traversalEligibility: (edge, traversalFromNodeId) => this.overlayTraversalEligibility(
        edge,
        traversalFromNodeId,
        overlay.edgePolicies,
        baseEdges,
      ),
      heuristic: (node, goal) => haversine(node.position, goal.position),
    })
    const route = overlayEngine.findRoute(fromId, overlay.temporaryRoutingTargetId)
    if (!route) return this.unreachablePoi(request.poiId)

    const candidate = resolution.resolution.candidate
    return {
      ok: true,
      route: {
        ...route,
        destination: {
          entityType: 'poi',
          entityId: poi.id,
          resolvedApproach: {
            kind: candidate.kind,
            networkId: candidate.networkId,
            position: candidate.position,
            distanceMeters: candidate.distanceMeters,
            floor: candidate.floor,
            buildingId: candidate.buildingId,
          },
        },
      },
      resolution: resolution.resolution,
    }
  }

  private overlayTraversalCost(
    edge: NavEdge,
    traversalFromNodeId: string,
    policies: ReadonlyMap<string, PoiOverlayEdgePolicy>,
    baseEdges: ReadonlyMap<string, NavEdge>,
    terrainContext: ReturnType<typeof buildRoadTerrainContext>,
  ): number {
    const policy = policies.get(edge.id)
    if (policy) {
      const originalFrom = this.mapOverlayTraversalOrigin(policy, traversalFromNodeId)
      if (!originalFrom) return edge.weight
      return calculateTraversalCost(
        policy.originalEdge,
        originalFrom,
        STANDARD_TERRAIN_PROFILE_V1,
        terrainContext,
      ) * policy.ratio
    }

    const baseEdge = baseEdges.get(edge.id)
    if (!baseEdge) return edge.weight
    return calculateTraversalCost(
      baseEdge,
      traversalFromNodeId,
      STANDARD_TERRAIN_PROFILE_V1,
      terrainContext,
    )
  }

  private overlayTraversalEligibility(
    edge: NavEdge,
    traversalFromNodeId: string,
    policies: ReadonlyMap<string, PoiOverlayEdgePolicy>,
    baseEdges: ReadonlyMap<string, NavEdge>,
  ): boolean {
    const policy = policies.get(edge.id)
    if (policy) {
      const originalFrom = this.mapOverlayTraversalOrigin(policy, traversalFromNodeId)
      return originalFrom !== null && isTraversalEligible(
        policy.originalEdge,
        originalFrom,
        STANDARD_PEDESTRIAN_ELIGIBILITY_V1,
      )
    }

    const baseEdge = baseEdges.get(edge.id)
    if (!baseEdge) return true
    return isTraversalEligible(baseEdge, traversalFromNodeId, STANDARD_PEDESTRIAN_ELIGIBILITY_V1)
  }

  private mapOverlayTraversalOrigin(
    policy: PoiOverlayEdgePolicy,
    traversalFromNodeId: string,
  ): string | null {
    if (traversalFromNodeId === policy.segmentFromNodeId) return policy.originalEdge.from
    if (traversalFromNodeId === policy.segmentToNodeId) return policy.originalEdge.to
    return null
  }

  private unreachablePoi(poiId: string): { ok: false; code: 'POI_DESTINATION_UNREACHABLE'; message: string } {
    return {
      ok: false,
      code: 'POI_DESTINATION_UNREACHABLE',
      message: `POI ${poiId} is not reachable from the requested origin`,
    }
  }
}
