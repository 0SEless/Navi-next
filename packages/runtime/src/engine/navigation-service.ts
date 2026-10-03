import type { LoadedPackage } from '../loader'
import type { Route } from '../routing/route'
import { RoutingEngine } from '../routing/routing-engine'
import type { DestinationRequest, DestinationRouteResult } from '../routing/destination'
import type { NavNode, LatLng, RoutePreferences, POIIndex } from '@navi/core'
import { SpatialQueryService } from '@navi/core'

export interface NearestNodeResult {
  nodeId: string
  distance: number
}

function findClosestNode(nodes: NavNode[], position: LatLng): NearestNodeResult | null {
  if (nodes.length === 0) return null
  const svc = new SpatialQueryService()
  svc.loadFromNodes(nodes as unknown as Array<{ id: string; position: LatLng; type?: string; floor?: number; buildingId?: string; [key: string]: unknown }>)
  const result = svc.nearestEntity(position)
  if (!result) return null
  return { nodeId: result.entity.id, distance: Math.round(result.distance * 100) / 100 }
}

export class NavigationService {
  private engine: RoutingEngine
  private nodes: NavNode[]
  private poiIndex: POIIndex | undefined

  constructor(pkg: LoadedPackage) {
    this.engine = new RoutingEngine(pkg.graph)
    this.nodes = pkg.graph.nodes
    this.poiIndex = pkg.poiIndex
  }

  /** RoutePreferences.mode remains legacy/passive; Phase 6 is standard pedestrian only. */
  findRoute(fromId: string, toId: string, _preferences?: RoutePreferences): Route | null {
    void _preferences
    return this.engine.findRoute(fromId, toId)
  }

  findDestinationRoute(
    fromId: string,
    request: DestinationRequest,
    poiIndex: POIIndex | undefined = this.poiIndex,
  ): DestinationRouteResult<Route> {
    return this.engine.findRouteToPOI(fromId, request, poiIndex)
  }

  nearestNode(position: LatLng): NearestNodeResult | null {
    return findClosestNode(this.nodes, position)
  }

  nearestEntrance(position: LatLng): NearestNodeResult | null {
    const entrances = this.nodes.filter(n => n.type === 'transition')
    if (entrances.length === 0) return null
    return findClosestNode(entrances, position)
  }

  isReachable(fromId: string, toId: string): boolean {
    return this.engine.findRoute(fromId, toId) !== null
  }
}
