'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Compass, LocateFixed, Navigation } from 'lucide-react'
import NavigationMap, { useNavigationMap, useNavigationMapScene, type NavigationMapSceneState } from '@/components/map/NavigationMap'
import { FloorSelector } from '@/components/map/FloorSelector'
import NavigationCamera, { type NavigationCameraConfig } from '@/components/map/NavigationCamera'
import {
  NavigationProvider,
  useOptionalNavigationContext,
} from '@/components/map/NavigationContext'
import { usePublicStore } from '@/store/public-store'
import type { CampusBundle } from '@/types/nav-types'
import {
  getExploreFloors,
  resolveExploreContext,
  type ExploreContext,
} from '@/lib/explore-contracts'
import { NAVIGATION_POV_PREFERRED_PITCH } from '@/lib/navigation-camera-policy'

// ── Props ──────────────────────────────────────────────────────

export interface ExploreMapProps {
  bundle: CampusBundle
  /** Optional active route — seam for the Navigate phase (null in Explore). */
  route?: { path: string[]; cost: number } | null
  /** Route-backed visual emphasis; does not activate Explore indoor context. */
  navigationTargetBuildingId?: string
  /** Opt-in canonical camera bridge; absent keeps the legacy Explore controls. */
  camera?: NavigationCameraConfig
}

function ExploreScenePublisher({
  bundle,
  route,
  navigationTargetBuildingId,
  fitCamera,
}: {
  bundle: CampusBundle
  route?: { path: string[]; cost: number } | null
  navigationTargetBuildingId?: string
  fitCamera: boolean
}) {
  const navigationContext = useOptionalNavigationContext()
  const { publish, clear } = useNavigationMapScene()
  const ownerRef = useRef(Symbol('explore-scene-owner'))

  useEffect(() => {
    const state: NavigationMapSceneState = {
      bundle,
      route: route ?? null,
      navigationTargetBuildingId,
      navigationContext,
      fitCamera,
    }
    publish(ownerRef.current, state)
  }, [bundle, fitCamera, navigationContext, navigationTargetBuildingId, publish, route])

  useEffect(() => () => clear(ownerRef.current), [clear])

  return null
}
// ── Floor selector ─────────────────────────────────────────────

function ExploreFloorSelector({
  bundle,
  context,
  activeFloor,
}: {
  bundle: CampusBundle
  context: ExploreContext
  activeFloor: number
}) {
  const setActiveFloor = usePublicStore((s) => s.setActiveFloor)

  const floors = useMemo(() => {
    if (context.surface !== 'building') return []
    return getExploreFloors(bundle, context.buildingId)
  }, [bundle, context.buildingId, context.surface])

  if (context.surface !== 'building' || !context.indoorActive) return null

  return (
    <FloorSelector floors={floors} activeFloor={activeFloor} onChange={setActiveFloor} />
  )
}

function ExploreMapControls({
  bounds,
}: {
  bounds: CampusBundle['boundingBox']
}) {
  const { map } = useNavigationMap()
  const [viewIdx, setViewIdx] = useState(0)

  const cycleView = () => {
    if (!map || !map.isStyleLoaded()) return
    const next = (viewIdx + 1) % 2
    setViewIdx(next)
    if (next === 0) {
      // TOP
      map.easeTo({ pitch: 0, bearing: 0, zoom: Math.max(map.getZoom(), 17), duration: 300 })
    } else {
      // FOLLOW
      map.easeTo({ pitch: 60, duration: 300 })
    }
  }

  const recenter = () => {
    if (!map || !bounds || !map.isStyleLoaded()) return
    map.fitBounds(
      [[bounds.minLng, bounds.minLat], [bounds.maxLng, bounds.maxLat]],
      { padding: 48, duration: 0, maxZoom: 18 },
    )
  }

  const resetView = () => {
    if (!map || !map.isStyleLoaded()) return
    setViewIdx(0)
    map.easeTo({ bearing: 0, pitch: 0, duration: 0 })
  }

  const viewIcons = [
    <span key="top" className="text-[10px] font-bold leading-none">TOP</span>,
    <Navigation key="follow" className="h-4 w-4" aria-hidden="true" />,
  ]

  return (
    <div className="absolute right-4 top-20 z-20 flex flex-col gap-1.5">
      <button
        type="button"
        onClick={cycleView}
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--navi-border)] bg-[var(--navi-card)] text-[var(--navi-text)] shadow-lg"
        aria-label="Cycle camera view"
        title="Cycle view"
      >
        {viewIcons[viewIdx]}
      </button>
      <button
        type="button"
        onClick={recenter}
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--navi-border)] bg-[var(--navi-card)] text-[var(--navi-text)] shadow-lg"
        aria-label="Recenter map"
        title="Recenter map"
      >
        <LocateFixed className="h-4 w-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={resetView}
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--navi-border)] bg-[var(--navi-card)] text-[var(--navi-text)] shadow-lg"
        aria-label="Reset map view"
        title="Reset map view"
      >
        <Compass className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────

/**
 * Explore campus map — composable architecture using NavigationMap + shared layers.
 *
 * Replaces the legacy public/CampusMap.tsx with the same rendering primitives
 * used by Navigate, ensuring visual consistency across the app.
 *
 * Interaction contract (preserved from legacy):
 *  - hover building → pointer cursor + highlight
 *  - click building → selectBuilding + sheet
 *  - floor selector → filters indoor layers by floor
 */
export default function ExploreMap({ bundle, route, navigationTargetBuildingId, camera }: ExploreMapProps) {
  // Route-local UI derives its current context; the shared scene receives only
  // a snapshot and remains mounted independently of this component.
  const selectedBuilding = usePublicStore((s) => s.selectedBuilding)
  const activeFloor = usePublicStore((s) => s.activeFloor)
  const indoorContext = usePublicStore((s) => s.indoorContext)
  const parentNavigationContext = useOptionalNavigationContext()
  const exploreContext = useMemo(
    () => resolveExploreContext({
      parentContext: parentNavigationContext,
      selectedBuildingId: selectedBuilding?.id,
      indoorContext,
      activeFloor,
    }),
    [activeFloor, indoorContext, parentNavigationContext, selectedBuilding?.id],
  )
  const effectiveFloor = exploreContext.floor ?? activeFloor

  const cameraWithContext = camera && parentNavigationContext
    ? {
        ...camera,
        heading: camera.heading ?? parentNavigationContext.heading,
        headingStatus: camera.headingStatus ?? parentNavigationContext.headingStatus,
        canRequestHeadingPermission: camera.canRequestHeadingPermission
          ?? parentNavigationContext.canRequestHeadingPermission,
        onRequestHeadingPermission: camera.onRequestHeadingPermission
          ?? (() => { void parentNavigationContext.enableHeading() }),
      }
    : camera

  const hasLiveCameraPosition = Boolean(
    cameraWithContext?.position
    && Number.isFinite(cameraWithContext.position[0])
    && Number.isFinite(cameraWithContext.position[1]),
  ) || Boolean(
    parentNavigationContext?.location
    && Number.isFinite(parentNavigationContext.location.lat)
    && Number.isFinite(parentNavigationContext.location.lng),
  )

  const initialPitch = camera?.mode === 'POV'
    ? NAVIGATION_POV_PREFERRED_PITCH
    : camera?.mode === 'FOLLOW' ? 55 : 0

  return (
    <NavigationMap
      bounds={bundle.boundingBox}
      className="h-full w-full"
      pitch={initialPitch}
      maxPitch={camera ? NAVIGATION_POV_PREFERRED_PITCH : undefined}
      showZoomControls={false}
      fitBoundsOnChange={camera?.surface === 'explore'
        || !camera
        || (camera?.surface === 'active' && !camera.routeBounds && !hasLiveCameraPosition)}
    >
      {parentNavigationContext ? (
        <ExploreScenePublisher
          bundle={bundle}
          route={route}
          navigationTargetBuildingId={navigationTargetBuildingId}
          fitCamera={!camera}
        />
      ) : (
        <NavigationProvider buildingId={exploreContext.buildingId} floor={effectiveFloor}>
          <ExploreScenePublisher
            bundle={bundle}
            route={route}
            navigationTargetBuildingId={navigationTargetBuildingId}
            fitCamera={!camera}
          />
        </NavigationProvider>
      )}
      {cameraWithContext ? (
        <NavigationCamera {...cameraWithContext} />
      ) : <ExploreMapControls bounds={bundle.boundingBox} />}
      <ExploreFloorSelector bundle={bundle} context={exploreContext} activeFloor={activeFloor} />
    </NavigationMap>
  )
}