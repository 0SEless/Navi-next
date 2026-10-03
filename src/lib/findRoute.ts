/**
 * Production routing entry point — wraps canonical runtime routing + `buildNavRoute`.
 *
 * Returns the enriched `NavRoute` (ADR 020) instead of the lean `PathResult`.
 * The standalone `findRoute` in public-store.ts is deprecated in favor of this.
 */

import type { NavNode, NavEdge } from '../types/nav-types'
import type { NavRoute, NavRouteDestination, NavRouteStep } from '../types/route-types'
import type { POI, POIIndex, RuntimePOIGeometry } from '@navi/core'
import type { Route as RuntimeRoute } from '@navi/runtime/routing'
import { findCanonicalPoiRoute, findCanonicalRoutePath } from '../engine/canonical-routing-adapter'
import { buildNavRoute } from './nav-route-helpers'

/**
 * Compute a route from `fromId` to `toId` and return the enriched `NavRoute`.
 *
 * Returns `null` if no path exists or start/end nodes are missing.
 */
export function findNavRoute(
  nodes: NavNode[],
  edges: NavEdge[],
  fromId: string,
  toId: string,
): NavRoute | null {
  const pathResult = findCanonicalRoutePath(nodes, edges, fromId, toId)
  if (!pathResult) return null
  return buildNavRoute(pathResult, nodes, edges)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isLatLng(value: unknown): value is { lat: number; lng: number } {
  return isRecord(value)
    && typeof value.lat === 'number'
    && Number.isFinite(value.lat)
    && typeof value.lng === 'number'
    && Number.isFinite(value.lng)
}

function normalizeGeometry(value: unknown): RuntimePOIGeometry | undefined {
  if (!isRecord(value) || typeof value.type !== 'string') return undefined
  if (value.type === 'point' && isLatLng(value.position)) {
    return { type: 'point', position: value.position }
  }
  if (value.type === 'circle' && isLatLng(value.center) && typeof value.radius === 'number') {
    return { type: 'circle', center: value.center, radius: value.radius }
  }
  if ((value.type === 'rectangle' || value.type === 'polygon')
    && Array.isArray(value.points)
    && value.points.every(isLatLng)) {
    return { type: value.type, points: value.points }
  }
  return undefined
}

function normalizePublicPoi(value: unknown): POI | null {
  if (!isRecord(value) || typeof value.id !== 'string' || value.id === '') return null
  if (typeof value.label !== 'string' || !isLatLng(value.position)) return null
  const poi: POI = {
    id: value.id,
    label: value.label,
    category: typeof value.category === 'string' ? value.category : 'poi',
    position: value.position,
    properties: isRecord(value.properties) ? value.properties : {},
  }
  if (typeof value.buildingId === 'string') poi.buildingId = value.buildingId
  if (typeof value.floor === 'number') poi.floor = value.floor
  if (typeof value.floorId === 'string') poi.floorId = value.floorId
  if (value.nodeId === undefined || typeof value.nodeId === 'string') poi.nodeId = value.nodeId
  if (value.source === 'authored' || value.source === 'graph-derived') poi.source = value.source
  if (typeof value.sourceId === 'string') poi.sourceId = value.sourceId
  const geometry = normalizeGeometry(value.geometry)
  if (geometry) poi.geometry = geometry
  return poi
}

/** Normalize one published POI for transient navigation-session evaluation. */
export function findPublicPoi(values: unknown[], poiId: string): POI | null {
  if (!Array.isArray(values) || !poiId) return null
  return values
    .map(normalizePublicPoi)
    .find((poi): poi is POI => poi?.id === poiId) ?? null
}

function corePoiIndex(values: unknown[]): POIIndex {
  return {
    version: 'public-poi-adapter-v1',
    points: values.map(normalizePublicPoi).filter((poi): poi is POI => poi !== null),
  }
}

function publicStepType(node: NavNode | undefined, edge: NavEdge | undefined): NavRouteStep['type'] {
  if (node?.type === 'stair' || node?.type === 'staircase') return 'stairs'
  if (node?.type === 'elevator') return 'elevator'
  if (node?.type === 'entrance' || node?.type === 'building_entrance') return 'entrance'
  if (edge?.type === 'door') return 'door'
  return 'walk'
}

function mapRuntimeId(id: string, temporaryTargetId: string | undefined, poiId: string): string {
  return id === temporaryTargetId ? poiId : id
}

function toPublicDestination(destination: RuntimeRoute['destination']): NavRouteDestination | undefined {
  if (!destination) return undefined
  return {
    entityType: destination.entityType,
    entityId: destination.entityId,
    ...(destination.resolvedApproach ? { resolvedApproach: destination.resolvedApproach } : {}),
  }
}

function buildPublicPoiRoute(
  runtimeRoute: RuntimeRoute,
  nodes: NavNode[],
  edges: NavEdge[],
  poi: POI,
  temporaryTargetId: string | undefined,
): NavRoute {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const edgeById = new Map(edges.map((edge) => [edge.id, edge]))
  const path = runtimeRoute.path.map((step) => mapRuntimeId(step.nodeId, temporaryTargetId, poi.id))
  const steps: NavRouteStep[] = runtimeRoute.path.map((runtimeStep) => {
    const isPoiTarget = runtimeStep.nodeId === temporaryTargetId
    const node = nodeById.get(runtimeStep.nodeId)
    const edge = runtimeStep.edgeId ? edgeById.get(runtimeStep.edgeId) : undefined
    return {
      nodeId: mapRuntimeId(runtimeStep.nodeId, temporaryTargetId, poi.id),
      ...(edge ? { edgeId: edge.id } : {}),
      label: isPoiTarget ? poi.label : node?.label ?? runtimeStep.label,
      position: isPoiTarget ? runtimeStep.position : node?.position ?? runtimeStep.position,
      floor: isPoiTarget ? poi.floor ?? runtimeStep.floor : node?.floor ?? runtimeStep.floor,
      buildingId: isPoiTarget ? poi.buildingId ?? runtimeStep.buildingId : node?.buildingId ?? runtimeStep.buildingId,
      type: publicStepType(node, edge),
    }
  })
  const destinationStep = steps.at(-1)
  const destination = toPublicDestination(runtimeRoute.destination)
  return {
    path,
    steps,
    instructions: runtimeRoute.instructions.map((instruction) => ({
      type: instruction.type,
      text: instruction.type === 'arrive' ? `Arrive at ${poi.label}` : instruction.text,
      distance: instruction.distance,
      fromNode: mapRuntimeId(instruction.fromNode, temporaryTargetId, poi.id),
      toNode: mapRuntimeId(instruction.toNode, temporaryTargetId, poi.id),
    })),
    totalDistance: runtimeRoute.totalDistance,
    ...(runtimeRoute.generalizedCost === undefined ? {} : { generalizedCost: runtimeRoute.generalizedCost }),
    totalDuration: runtimeRoute.totalDuration,
    fromLabel: runtimeRoute.fromLabel,
    toLabel: poi.label,
    arrival: {
      nodeId: poi.id,
      label: poi.label,
      position: destinationStep?.position ?? poi.position,
      remainingDistance: 0,
    },
    nodeFloors: [...new Set(steps.map((step) => step.floor))].sort((left, right) => right - left),
    ...(destination ? { destination } : {}),
  }
}

/** Resolve an authored POI into a preview route without creating a public node. */
export function findPoiNavRoute(
  nodes: NavNode[],
  edges: NavEdge[],
  pois: unknown[],
  fromId: string,
  poiId: string,
): NavRoute | null {
  const poiIndex = corePoiIndex(pois)
  const result = findCanonicalPoiRoute(nodes, edges, poiIndex, fromId, poiId)
  if (!result.ok) return null
  const poi = poiIndex.points.find((point) => point.id === poiId)
  if (!poi) return null
  return buildPublicPoiRoute(
    result.route,
    nodes,
    edges,
    poi,
    result.resolution?.temporaryRoutingTargetId,
  )
}
