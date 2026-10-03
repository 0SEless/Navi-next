import { distanceMeters } from '@navi/core'
import type { LatLng } from '@/types/nav-types'

/** Maximum world distance from an Entrance at which the first Route click is accepted. */
export const ENTRANCE_ROUTE_START_TOLERANCE_METERS = 3

export interface EntranceRouteAnchor {
  entranceId: string
  outdoorNodeId: string
  position: LatLng
  outdoorRouteId?: string
}

export type RouteStartResult =
  | { accepted: true; position: LatLng; distanceMeters: number }
  | { accepted: false; reason: string; distanceMeters: number }

/**
 * Make the first Route vertex authoritative to the selected Entrance. The
 * click is only a hit-test; persisted geometry uses the exact Entrance point.
 */
export function snapRouteStartToEntrance(
  clicked: LatLng,
  anchor: EntranceRouteAnchor,
  toleranceMeters: number = ENTRANCE_ROUTE_START_TOLERANCE_METERS,
): RouteStartResult {
  const distance = distanceMeters(clicked, anchor.position)
  if (distance > toleranceMeters) {
    return {
      accepted: false,
      distanceMeters: distance,
      reason: 'Start the Route at the selected Entrance before adding more points.',
    }
  }
  return { accepted: true, position: { ...anchor.position }, distanceMeters: distance }
}

export function routeStartError({ hasExistingRoute, hasEntranceAnchor }: { hasExistingRoute: boolean; hasEntranceAnchor: boolean }): string | null {
  if (hasExistingRoute || hasEntranceAnchor) return null
  return 'Select an Entrance, connect it to an outdoor route point, then start the first Route there.'
}

export interface EntranceFinishAccess {
  kind: 'existing'
  outdoorNodeId: string
  outdoorRouteId?: string
  outdoorPosition?: { lat: number; lng: number }
}

export function resolveEntranceFinishAccess(
  floor: { entranceAccess?: Array<{ entranceId: string; outdoorNodeId: string; outdoorRouteId?: string; outdoorPosition?: { lat: number; lng: number } }> },
  entranceId: string,
): EntranceFinishAccess | { kind: 'required' } {
  const record = floor.entranceAccess?.find(access => access.entranceId === entranceId)
  if (!record) return { kind: 'required' }
  return {
    kind: 'existing',
    outdoorNodeId: record.outdoorNodeId,
    ...(record.outdoorRouteId !== undefined ? { outdoorRouteId: record.outdoorRouteId } : {}),
    ...(record.outdoorPosition !== undefined ? { outdoorPosition: record.outdoorPosition } : {}),
  }
}
