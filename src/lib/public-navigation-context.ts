import type { LatLng } from '@/types/nav-types'
import type { NavRoute, NavRouteStep, NavSegmentType } from '@/types/route-types'
import type { IndoorContext } from '@/store/public-store'

/** Snapshot needed by a public map surface; UI components do not own routing. */
export interface PublicNavigationContext {
  route: Pick<NavRoute, 'path'> | null
  currentNodeId: string | null
  location: LatLng | null
  buildingId?: string
  floor?: number
  activeFloor?: number
  navigationSegment: NavSegmentType
  indoorContext: IndoorContext
}

/** A parent NavigationSession is authoritative whenever one is present. */
export function selectAuthoritativeNavigationContext(
  parent: PublicNavigationContext | null,
  fallback: PublicNavigationContext,
): PublicNavigationContext {
  return parent ?? fallback
}

export function isIndoorContextVisible(context: IndoorContext): boolean {
  return context.active
}

/**
 * Return only an entrance step already selected by the graph route. This seam
 * deliberately has no first/lowest-floor or synthetic fallback behavior.
 */
export function getRouteSelectedEntrance(
  route: Pick<NavRoute, 'steps'> | null,
  buildingId: string,
): NavRouteStep | null {
  return route?.steps.find(
    (step) => step.buildingId === buildingId && step.type === 'entrance',
  ) ?? null
}
