import { distanceMeters } from '@navi/core'
import type { Building, LatLng, NavEdge, NavNode } from '@/types/nav-types'

export const DEFAULT_OUTDOOR_ROUTE_RADIUS_METERS = 250

export interface OutdoorRouteCandidate {
  id: string
  label: string
  type: NavNode['type']
  position: LatLng
  distanceMeters: number
  /** A node reuses an existing target; a segment creates an explicit junction on confirmation. */
  targetKind: 'node' | 'segment'
  /** Authored road/trace identity used to rebuild a segment junction. */
  routeId?: string
  /** Editor graph edge that was clicked; transient UI evidence, not persisted. */
  edgeId?: string
}

export interface OutdoorRoutePick {
  candidate: OutdoorRouteCandidate
  source: 'node' | 'edge'
}

export interface OutdoorRoutePickerOptions {
  localRadiusMeters?: number
  includeAll?: boolean
}

export type OutdoorRouteAnchor = { position: LatLng } | LatLng | null | undefined

export type OutdoorRoutePickRequest =
  | { kind: 'node'; nodeId: string }
  | { kind: 'edge'; edgeId: string; lngLat: LatLng; anchor?: LatLng }

const CAMPUS_NAVIGATION_NODE_TYPES = new Set<NavNode['type']>([
  'outdoor',
  'building_entrance',
])

function isFiniteLatLng(position: LatLng | undefined): position is LatLng {
  return !!position
    && Number.isFinite(position.lat)
    && Number.isFinite(position.lng)
    && position.lat >= -90
    && position.lat <= 90
    && position.lng >= -180
    && position.lng <= 180
}

function labelForNode(node: NavNode): string {
  const named = [node.name, node.label].find((value) => typeof value === 'string' && value.trim().length > 0)
  return named?.trim() ?? 'Outdoor route point'
}

function traceIdsForNode(node: NavNode | undefined): string[] {
  if (!node) return []
  const metadata = node.metadata
  const ids = [
    ...(typeof metadata?.traceId === 'string' ? [metadata.traceId] : []),
    ...(Array.isArray(metadata?.traceIds) ? metadata.traceIds.filter((id): id is string => typeof id === 'string') : []),
  ]
  return [...new Set(ids)].sort()
}

/**
 * Outer targets are authored outdoor points or nodes produced by the trace
 * topology pass. Building entrances and indoor route nodes are never target
 * candidates: the selected Entrance is the source of the explicit bridge.
 */
export function isSelectableOutdoorRouteNode(node: NavNode): boolean {
  if (!isFiniteLatLng(node.position)) return false
  if (node.type === 'outdoor') return true
  return node.type === 'intersection' && traceIdsForNode(node).length > 0
}

export function traceIdForOutdoorRouteNode(node: NavNode | undefined): string | undefined {
  return traceIdsForNode(node)[0]
}

function traceIdForEdge(edge: NavEdge, nodesById: Map<string, NavNode>): string | undefined {
  const fromIds = traceIdsForNode(nodesById.get(edge.from))
  const toIds = traceIdsForNode(nodesById.get(edge.to))
  const common = fromIds.filter((id) => toIds.includes(id))
  return common[0] ?? fromIds[0] ?? toIds[0]
}

function footprintPoints(building: Building): LatLng[] {
  return (building.outline ?? building.footprint ?? []).filter(isFiniteLatLng)
}

/**
 * Return the campus-level navigation graph without leaking indoor route nodes
 * into the outdoor connection picker. Road traces and their intersections
 * are identified by trace metadata; building entrances remain visible as
 * context markers, while indoor route intersections are excluded.
 */
export function buildCampusNavigationNodes(nodes: NavNode[]): NavNode[] {
  return nodes.filter((node) => {
    if (!isFiniteLatLng(node.position)) return false
    if (CAMPUS_NAVIGATION_NODE_TYPES.has(node.type)) return true
    return node.type === 'intersection' && traceIdsForNode(node).length > 0
  })
}

export function buildCampusNavigationEdges(nodes: NavNode[], edges: NavEdge[]): NavEdge[] {
  const nodeIds = new Set(nodes.map((node) => node.id))
  return edges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to))
}

export function outdoorRoutePickerCenter(building: Building, entrance?: OutdoorRouteAnchor): LatLng {
  const entrancePosition = entrance && 'position' in entrance ? entrance.position : entrance
  if (isFiniteLatLng(entrancePosition)) return { ...entrancePosition }
  if (isFiniteLatLng(building.center)) return { ...building.center }

  const points = footprintPoints(building)
  if (points.length > 0) {
    return points.reduce(
      (center, point) => ({ lat: center.lat + point.lat / points.length, lng: center.lng + point.lng / points.length }),
      { lat: 0, lng: 0 },
    )
  }

  return { lat: 0, lng: 0 }
}

function candidateForNode(node: NavNode, distanceFrom: LatLng): OutdoorRouteCandidate {
  return {
    id: node.id,
    label: labelForNode(node),
    type: node.type,
    position: { ...node.position },
    distanceMeters: distanceMeters(distanceFrom, node.position),
    targetKind: 'node',
    ...(traceIdForOutdoorRouteNode(node) ? { routeId: traceIdForOutdoorRouteNode(node) } : {}),
  }
}

export function buildOutdoorRouteCandidates(
  nodes: NavNode[],
  building: Building,
  entrance?: OutdoorRouteAnchor,
  options: OutdoorRoutePickerOptions = {},
): OutdoorRouteCandidate[] {
  const anchor = outdoorRoutePickerCenter(building, entrance)
  const radius = options.localRadiusMeters ?? DEFAULT_OUTDOOR_ROUTE_RADIUS_METERS
  const candidates = nodes
    .filter(isSelectableOutdoorRouteNode)
    .filter((node) => isFiniteLatLng(node.position))
    .map((node) => candidateForNode(node, anchor))
    .filter((candidate) => options.includeAll === true || candidate.distanceMeters <= radius)

  return candidates.sort((left, right) => left.distanceMeters - right.distanceMeters || left.label.localeCompare(right.label) || left.id.localeCompare(right.id))
}

export function resolveOutdoorRoutePick(
  pick: OutdoorRoutePickRequest,
  nodes: NavNode[],
  edges: NavEdge[],
): OutdoorRoutePick | null {
  const eligibleNodes = nodes.filter(isSelectableOutdoorRouteNode)
  const nodesById = new Map(nodes.map((node) => [node.id, node]))

  if (pick.kind === 'node') {
    const node = eligibleNodes.find((candidate) => candidate.id === pick.nodeId)
    return node ? { candidate: candidateForNode(node, node.position), source: 'node' } : null
  }

  const edge = edges.find((candidate) => candidate.id === pick.edgeId)
  if (!edge) return null
  const from = nodesById.get(edge.from)
  const to = nodesById.get(edge.to)
  if (!from || !to || !isSelectableOutdoorRouteNode(from) || !isSelectableOutdoorRouteNode(to)) return null

  const routeId = traceIdForEdge(edge, nodesById)
  if (!routeId) return null

  const anchor = pick.anchor ?? pick.lngLat
  return {
    source: 'edge',
    candidate: {
      id: `segment:${edge.id}`,
      label: `New junction on ${routeId}`,
      type: 'intersection',
      position: { ...pick.lngLat },
      distanceMeters: distanceMeters(anchor, pick.lngLat),
      targetKind: 'segment',
      routeId,
      edgeId: edge.id,
    },
  }
}

export function buildingPickerBounds(
  building: Building,
  paddingMeters: number,
): [[number, number], [number, number]] {
  const points = footprintPoints(building)
  const center = outdoorRoutePickerCenter(building)
  const padding = Math.max(0, Number.isFinite(paddingMeters) ? paddingMeters : 0)
  const latPadding = padding / 111_320
  const lngPadding = padding / (111_320 * Math.max(0.01, Math.abs(Math.cos((center.lat * Math.PI) / 180))))

  if (points.length === 0) {
    const fallbackPadding = Math.max(latPadding, 0.00025)
    return [
      [center.lng - Math.max(lngPadding, 0.00025), center.lat - fallbackPadding],
      [center.lng + Math.max(lngPadding, 0.00025), center.lat + fallbackPadding],
    ]
  }

  const minLng = Math.min(...points.map((point) => point.lng)) - lngPadding
  const maxLng = Math.max(...points.map((point) => point.lng)) + lngPadding
  const minLat = Math.min(...points.map((point) => point.lat)) - latPadding
  const maxLat = Math.max(...points.map((point) => point.lat)) + latPadding
  return [[minLng, minLat], [maxLng, maxLat]]
}
