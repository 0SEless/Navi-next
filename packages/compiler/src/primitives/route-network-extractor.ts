import type { LatLng } from '@navi/core'
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
 * Extract primitives directly from a floor's canonical routeNetwork.
 *
 * Transforms RouteNode.position (building-local meters) → world LatLng
 * and emits PrimitiveNode + PrimitiveEdge for the NavigationGraph.
 *
 * Authored IDs pass through with `R-` namespace prefix.
 */
export function extractRouteNetwork(
  document: NormalizedDocument,
): PrimitiveContribution {
  const nodes: PrimitiveNode[] = []
  const edges: PrimitiveEdge[] = []
  const diagnostics: CompilerDiagnostic[] = []

  for (const building of document.buildings) {
    const origin = building.position
    if (!origin) continue

    for (const floor of building.floors) {
      const rn = floor.routeNetwork
      if (!rn || rn.nodes.length === 0) continue

      const nodeIdMap = new Map<string, string>()

      for (const routeNode of rn.nodes) {
        const worldPos = localToLatLng(
          routeNode.position.x,
          routeNode.position.y,
          origin.lat,
          origin.lng,
        )

        const navNodeId = `R-${routeNode.id}`
        nodeIdMap.set(routeNode.id, navNodeId)

        const node: WaypointNode = {
          id: navNodeId,
          kind: 'waypoint',
          position: worldPos,
          floor: floor.level,
          buildingId: building.id,
          source: {
            entityId: routeNode.id,
            entityType: 'route_node',
            field: 'position',
            generatorId: 'builtin:route-network-extractor',
          },
        }
        nodes.push(node)
      }

      for (const routeEdge of rn.edges) {
        const fromId = nodeIdMap.get(routeEdge.from)
        const toId = nodeIdMap.get(routeEdge.to)
        if (!fromId || !toId) continue

        const edge: SkeletonEdge = {
          id: `R-${routeEdge.id}`,
          kind: 'skeleton',
          from: fromId,
          to: toId,
          distance: routeEdge.distance,
          source: {
            entityId: routeEdge.id,
            entityType: 'route_edge',
            field: 'distance',
            generatorId: 'builtin:route-network-extractor',
          },
        }
        edges.push(edge)
      }

      if (rn.nodes.length > 0) {
        diagnostics.push({
          severity: 'info',
          sourceEntityId: floor.id,
          phase: 'primitives',
          code: 'ROUTE_NETWORK_COMPILED',
          message: `Floor "${floor.id}" compiled ${rn.nodes.length} route nodes and ${rn.edges.length} route edges from canonical network`,
        })
      }
    }
  }

  return { nodes, edges, diagnostics }
}
