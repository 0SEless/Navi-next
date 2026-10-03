/**
 * Road endpoint snapping — backward-compatible re-exports.
 *
 * Phase 3: The actual snap logic now lives in road-connectivity.ts
 * (the shared connectivity service). This file re-exports the API
 * for existing consumers.
 */

import type { LatLng, Road, RoadJunction } from '@navi/core'
import { ROUTE_NETWORK_THRESHOLDS } from '@navi/core'
import {
  findConnectivityCandidates,
  snapRoadEndpoints as _snapRoadEndpoints,
  snapPoint as _snapPoint,
  nearestPointOnPolyline as _nearestPointOnPolyline,
  EDITOR_SNAP_RADIUS_METERS,
} from './road-connectivity'
import type { ConnectivityCandidate, ConnectivityResult, ConnectivityOptions } from './road-connectivity'

// Re-export the shared service types and functions
export { findConnectivityCandidates, EDITOR_SNAP_RADIUS_METERS }
export type { ConnectivityCandidate, ConnectivityResult, ConnectivityOptions }

/** Default snap radius in meters. */
export const ROAD_SNAP_RADIUS_METERS: number = EDITOR_SNAP_RADIUS_METERS

/** Re-export nearestPointOnPolyline for backward compatibility. */
export const nearestPointOnPolyline = _nearestPointOnPolyline

export interface SnapResult {
  /** The snapped polyline (identical to input when nothing snapped). */
  points: LatLng[]
  /** Whether any endpoint was moved. */
  snapped: boolean
  /** Number of endpoints snapped (0, 1, or 2). */
  snapCount: number
}

/**
 * Snap the first and last points of a new road polyline onto the closest
 * existing road when they fall within `radiusMeters`.
 */
export function snapRoadEndpoints(
  points: LatLng[],
  roads: Road[],
  junctions?: RoadJunction[],
  radiusMeters = ROAD_SNAP_RADIUS_METERS,
): SnapResult {
  const result = _snapRoadEndpoints(points, roads, junctions, radiusMeters)
  return { points: result.points, snapped: result.snapped, snapCount: result.snapCount }
}

/**
 * Snap a single point onto the nearest existing road.
 */
export function snapPoint(p: LatLng, roads: Road[], junctions?: RoadJunction[], radiusMeters = ROAD_SNAP_RADIUS_METERS): LatLng {
  return _snapPoint(p, roads, junctions, radiusMeters)
}
