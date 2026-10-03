'use client'

import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { LatLng } from '@/types/nav-types'
import type { NavRoute, NavRouteDestination, NavSegmentType, RouteProgress } from '@/types/route-types'
import type { CaptureDirectionSource, CaptureDirectionStatus } from '@/features/capture/direction'

/** The four continuous-navigation segments from the approved visual-language spec (§2.1). */
export type NavigationSegment = NavSegmentType

/**
 * Navigation context — carries the user's current navigation state.
 *
 * Owned by the navigation session provider (NavigationSession.tsx) on the
 * Navigate surface. ExploreMap uses a simpler static wiring.
 */
export interface NavigationContextValue {
  location: LatLng | null
  /** Resolved presentation heading; never used to compute route progress. */
  heading: number | null
  headingSource: CaptureDirectionSource
  headingStatus: CaptureDirectionStatus
  canRequestHeadingPermission: boolean
  enableHeading: () => Promise<void>
  buildingId?: string
  floor?: number
  navigationSegment: NavigationSegment
  /** The enriched route (ADR 020). Consumed by deriveNavigationSegment + layers. */
  route: NavRoute | null
  /** Stable destination identity carried by the active route, if present. */
  destination: NavRouteDestination | null
  /** The current route-node id (derived from progress snapping). */
  currentNodeId: string | null
  /** Authoritative projection result; null when the session is not active. */
  routeProgress: RouteProgress | null
  /** True only after the explicit Start Navigation action. */
  sessionActive: boolean
  /** Current GPS position is outside the active route threshold. */
  isOffRoute: boolean
  /** Positional/session arrival state for the active route. */
  arrived: boolean
  /** Last geolocation error, if the browser could not provide a position. */
  geoError: string | null
}

export interface NavigationProviderProps {
  location?: LatLng | null
  heading?: number | null
  headingSource?: CaptureDirectionSource
  headingStatus?: CaptureDirectionStatus
  canRequestHeadingPermission?: boolean
  enableHeading?: () => Promise<void>
  buildingId?: string
  floor?: number
  route?: NavRoute | null
  currentNodeId?: string | null
  routeProgress?: RouteProgress | null
  sessionActive?: boolean
  isOffRoute?: boolean
  arrived?: boolean
  geoError?: string | null
  children: ReactNode
}

/**
 * Derive the current navigation segment from real data.
 *
 * Logic:
 * - No route or no currentNode → outdoor
 * - currentNode at stair/elevator step → floor-transition
 * - currentNode floor ≠ active floor → floor-transition
 * - currentNode at entrance step → entrance
 * - Otherwise → indoor
 */
export function deriveNavigationSegment(input: {
  route: NavRoute | null | undefined
  currentNodeId: string | null | undefined
  floor?: number
  activeFloor?: number
}): NavigationSegment {
  const { route, currentNodeId, floor, activeFloor } = input

  if (!route || !currentNodeId) return 'outdoor'

  // Find the current step in the route
  const currentStep = route.steps.find(s => s.nodeId === currentNodeId)
  if (!currentStep) return 'outdoor'

  // A building-less route step is still on the campus/outdoor network. The
  // route cannot enter indoor presentation until an authored building-backed
  // step is reached.
  if (!currentStep.buildingId) return 'outdoor'

  // Stair/elevator → floor-transition
  if (currentStep.type === 'stairs' || currentStep.type === 'elevator') {
    return 'floor-transition'
  }

  // Floor mismatch → floor-transition (user is on a different floor than expected)
  if (floor !== undefined && activeFloor !== undefined && floor !== activeFloor) {
    return 'floor-transition'
  }

  // Entrance → entrance
  if (currentStep.type === 'entrance') {
    return 'entrance'
  }

  // Default → indoor
  return 'indoor'
}

const NavigationContext = createContext<NavigationContextValue | null>(null)
const NOOP_ENABLE_HEADING = async (): Promise<void> => undefined

export function NavigationProvider({
  location = null,
  heading = null,
  headingSource = 'none',
  headingStatus = 'location-only',
  canRequestHeadingPermission = false,
  enableHeading = NOOP_ENABLE_HEADING,
  buildingId,
  floor,
  route = null,
  currentNodeId = null,
  routeProgress = null,
  sessionActive = false,
  isOffRoute = false,
  arrived = false,
  geoError = null,
  children,
}: NavigationProviderProps) {
  // Memoized to keep a stable reference (prevents React #185 update loops).
  const navigationSegment = useMemo(
    () => deriveNavigationSegment({ route, currentNodeId, floor, activeFloor: floor }),
    [route, currentNodeId, floor],
  )
  const value = useMemo<NavigationContextValue>(
    () => ({
      location,
      heading,
      headingSource,
      headingStatus,
      canRequestHeadingPermission,
      enableHeading,
      buildingId,
      floor,
      navigationSegment,
      route,
      destination: route?.destination ?? null,
      currentNodeId,
      routeProgress,
      sessionActive,
      isOffRoute,
      arrived,
      geoError,
    }),
    [
      location,
      heading,
      headingSource,
      headingStatus,
      canRequestHeadingPermission,
      enableHeading,
      buildingId,
      floor,
      navigationSegment,
      route,
      route?.destination,
      currentNodeId,
      routeProgress,
      sessionActive,
      isOffRoute,
      arrived,
      geoError,
    ],
  )
  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>
}

export function useNavigationContext(): NavigationContextValue {
  const ctx = useContext(NavigationContext)
  if (!ctx) {
    throw new Error('useNavigationContext must be used within a NavigationProvider')
  }
  return ctx
}

/** Safe variant — returns null when outside a NavigationProvider (no throw). */
export function useOptionalNavigationContext(): NavigationContextValue | null {
  return useContext(NavigationContext)
}
