import type { LatLng } from '@/types/nav-types'

export const ROUTE_TARGET_LAYER_IDS = ['floor-route-nodes-circle', 'floor-route-edges-line', 'floor-items-entrance'] as const

export type RouteTargetKind = 'node' | 'edge' | 'entrance'

export interface RouteTargetHit {
  kind: RouteTargetKind
  id: string
  /** World position: geometry for node/entrance hits, the click itself for edges. */
  position: LatLng
}

export type DoorRouteConnectTarget =
  | { doorId: string; routeNodeId: string }
  // Segment picks are building-local (LocalCoord) — the coordinate system
  // door.route.connect validates and every route-network command uses.
  | { doorId: string; segment: { edgeId: string; position: { x: number; y: number } } }

interface FeatureLike {
  layer?: { id?: string }
  properties?: Record<string, unknown>
  geometry?: { type?: string; coordinates?: unknown }
}

function pointFromGeometry(geometry: FeatureLike['geometry']): LatLng | null {
  if (!geometry || geometry.type !== 'Point' || !Array.isArray(geometry.coordinates)) return null
  const [lng, lat] = geometry.coordinates as [unknown, unknown]
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return { lat, lng }
}

/** Exact-hit resolution: nodes win over edges; entrance markers are explicit targets. */
export function resolveRouteTargetHit(features: FeatureLike[], click: LatLng): RouteTargetHit | null {
  const node = features.find(feature => feature.layer?.id === 'floor-route-nodes-circle' && typeof feature.properties?.id === 'string')
  if (node) {
    const position = pointFromGeometry(node.geometry)
    if (position) return { kind: 'node', id: node.properties!.id as string, position }
  }
  const edge = features.find(feature => feature.layer?.id === 'floor-route-edges-line' && typeof feature.properties?.id === 'string')
  if (edge) return { kind: 'edge', id: edge.properties!.id as string, position: { ...click } }
  const entrance = features.find(feature => feature.layer?.id === 'floor-items-entrance' && typeof feature.properties?.id === 'string')
  if (entrance) {
    const position = pointFromGeometry(entrance.geometry)
    if (position) return { kind: 'entrance', id: entrance.properties!.id as string, position }
  }
  return null
}
