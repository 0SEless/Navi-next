import type { LatLng, NavEdge, NavigationGraph, POI } from '@navi/core'

export interface DestinationRequest {
  destinationType: 'poi'
  poiId: string
}

export type PoiDestinationFailureCode =
  | 'POI_NOT_FOUND'
  | 'POI_INVALID_DESTINATION_GEOMETRY'
  | 'POI_NO_ELIGIBLE_APPROACH'
  | 'POI_APPROACH_TOO_FAR'
  | 'POI_DESTINATION_UNREACHABLE'

export interface PoiDestinationFailure {
  ok: false
  code: PoiDestinationFailureCode
  message: string
}

export interface PoiApproachCandidate {
  kind: 'node' | 'edge'
  networkId: string
  position: LatLng
  distanceMeters: number
  floor: number
  buildingId: string
  projection?: number
  edge?: NavEdge
}

export interface PoiOverlayEdgePolicy {
  originalEdge: NavEdge
  /** Fraction of the original edge represented by this overlay segment. */
  ratio: number
  /** First endpoint of the overlay segment in the original edge orientation. */
  segmentFromNodeId: string
  /** Second endpoint of the overlay segment in the original edge orientation. */
  segmentToNodeId: string
}

export interface PoiDestinationOverlay {
  graph: NavigationGraph
  temporaryRoutingTargetId: string
  candidate: PoiApproachCandidate
  edgePolicies: ReadonlyMap<string, PoiOverlayEdgePolicy>
}

export interface ResolvedPoiDestination {
  poi: POI
  referencePosition: LatLng
  candidate: PoiApproachCandidate
  temporaryRoutingTargetId: string
  overlay: PoiDestinationOverlay
}

export type PoiDestinationResolution =
  | { ok: true; resolution: ResolvedPoiDestination }
  | PoiDestinationFailure

export type DestinationRouteResult<T> =
  | { ok: true; route: T; resolution?: ResolvedPoiDestination }
  | PoiDestinationFailure
