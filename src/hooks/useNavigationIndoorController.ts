'use client'

import { useEffect, useRef } from 'react'
import { useOptionalNavigationContext } from '@/components/map/NavigationContext'
import { usePublicStore } from '@/store/public-store'
import type { NavigationSegment } from '@/components/map/NavigationContext'
import type { NavRouteStep } from '@/types/route-types'

/**
 * W16E — Navigation-Driven Indoor Context controller.
 *
 * Bridges navigation state (segment, building, floor) to IndoorContext.
 * IndoorContext remains authoritative; this hook only requests transitions.
 *
 * Presentation decisions:
 *   OUTDOOR        → Campus Mode (indoorContext.active = false)
 *   ENTRANCE       → enterIndoorContext(buildingId, entryFloor)
 *   INDOOR         → Indoor Mode, correct building/floor
 *   FLOOR_TRANSITION → switch floor
 *   DESTINATION    → remain on destination floor
 *   EXIT BUILDING  → Campus Mode
 *
 * Does NOT create another indoor/floor state system.
 * Does NOT own a copy of active/buildingId/floorId.
 */
export function useNavigationIndoorController() {
  const navCtx = useOptionalNavigationContext()
  const enterIndoorContext = usePublicStore(s => s.enterIndoorContext)
  const exitIndoorContext = usePublicStore(s => s.exitIndoorContext)
  const setActiveFloor = usePublicStore(s => s.setActiveFloor)

  // Use individual primitive selectors to avoid object-reference re-renders
  const isActive = usePublicStore(s => s.indoorContext.active)
  const ctxBuildingId = usePublicStore(s => s.indoorContext.buildingId)
  const ctxFloorId = usePublicStore(s => s.indoorContext.floorId)
  const activeFloor = usePublicStore(s => s.activeFloor)

  const prevSegmentRef = useRef<NavigationSegment | null>(null)
  const prevBuildingRef = useRef<string | undefined>(undefined)

  const segment = navCtx?.navigationSegment ?? null
  const route = navCtx?.route ?? null

  // ---- Indoor context transitions driven by navigation segment ----
  useEffect(() => {
    if (!segment) return

    const prevSegment = prevSegmentRef.current
    const buildingId = navCtx?.buildingId

    switch (segment) {
      case 'outdoor': {
        // EXIT BUILDING → Campus Mode
        if (prevSegment !== 'outdoor' && isActive) {
          exitIndoorContext()
        }
        break
      }
      case 'entrance': {
        // ENTRANCE → enterIndoorContext(buildingId, entryFloor)
        if (buildingId) {
          const floor = navCtx?.floor ?? 0
          enterIndoorContext(buildingId, floor)
        }
        break
      }
      case 'indoor': {
        // INDOOR → Indoor Mode, correct building/floor
        if (buildingId) {
          const floor = navCtx?.floor ?? 0
          if (!isActive || ctxBuildingId !== buildingId) {
            enterIndoorContext(buildingId, floor)
          } else if (ctxFloorId !== floor) {
            setActiveFloor(floor)
          }
        }
        break
      }
      case 'floor-transition': {
        // FLOOR TRANSITION → switch floor
        const floor = navCtx?.floor
        if (floor !== undefined && isActive) {
          setActiveFloor(floor)
        }
        break
      }
    }

    prevSegmentRef.current = segment
    prevBuildingRef.current = navCtx?.buildingId
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segment, navCtx?.buildingId, navCtx?.floor])

  // ---- Route start: set context based on starting segment ----
  const prevRouteRef = useRef<typeof route>(null)

  useEffect(() => {
    const routeChanged = route !== null && prevRouteRef.current === null

    if (routeChanged && segment) {
      // Route START — only enter indoor context if not already in one
      if (segment !== 'outdoor' && navCtx?.buildingId && !isActive) {
        const floor = navCtx?.floor ?? 0
        enterIndoorContext(navCtx.buildingId, floor)
      }
    }

    prevRouteRef.current = route
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, segment, navCtx?.buildingId, navCtx?.floor])

  // ---- Route segment filtering for presentation ----
  const filteredSteps = filterStepsForPresentation(
    route?.steps ?? [],
    segment,
    isActive,
    ctxBuildingId,
    ctxFloorId,
    activeFloor,
  )

  const inCampusMode = segment === 'outdoor' || !isActive

  return {
    /** Whether we are in Campus Mode (outdoor/no indoor context). */
    inCampusMode,
    /** The active building from IndoorContext (set by navigation). */
    activeBuildingId: ctxBuildingId ?? null,
    /** The active floor from IndoorContext (set by navigation). */
    activeFloorId: ctxFloorId ?? null,
    /** Current navigation segment. */
    navigationSegment: segment,
    /** Route steps filtered to the active floor/context. */
    filteredSteps,
  }
}

/**
 * Filter route steps to only those relevant for the active presentation context.
 *
 * - Campus Mode (outdoor/no indoor context): outdoor segments only
 * - Indoor Mode: steps matching the active building + floor
 * - Floor transition: steps matching the current navigation floor
 */
function filterStepsForPresentation(
  steps: NavRouteStep[],
  segment: NavigationSegment | null,
  isActive: boolean,
  buildingId: string | undefined,
  floorId: number | undefined,
  activeFloor: number,
): NavRouteStep[] {
  if (steps.length === 0) return []

  // Campus Mode: show outdoor steps only
  if (segment === 'outdoor' || !isActive) {
    return steps.filter(s => !s.buildingId || s.buildingId === '')
  }

  // Floor transition: steps on the target floor
  if (segment === 'floor-transition') {
    return steps.filter(s => s.floor === activeFloor)
  }

  // Indoor/Entrance: steps matching active building + floor
  if (buildingId !== undefined && floorId !== undefined) {
    return steps.filter(s => s.buildingId === buildingId && s.floor === floorId)
  }

  return steps
}
