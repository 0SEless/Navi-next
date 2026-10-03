'use client'

import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import type maplibregl from 'maplibre-gl'
import { BuildingLayer } from '@/components/map/layers/BuildingLayer'
import { RoomLayer } from '@/components/map/layers/RoomLayer'
import { HallwayLayer } from '@/components/map/layers/HallwayLayer'
import { StaircaseLayer } from '@/components/map/layers/StaircaseLayer'
import { ElevatorLayer } from '@/components/map/layers/ElevatorLayer'
import { DoorLayer } from '@/components/map/layers/DoorLayer'
import { WallLayer } from '@/components/map/layers/WallLayer'
import { OpeningLayer } from '@/components/map/layers/OpeningLayer'
import { EntranceLayer } from '@/components/map/layers/EntranceLayer'
import { POILayer } from '@/components/map/layers/POILayer'
import { RouteLine } from '@/components/map/RouteLine'
import NavigationPositionMarker from '@/components/map/NavigationPositionMarker'
import { NavigationProvider, useNavigationContext } from '@/components/map/NavigationContext'
import {
  getCachedNavigationRenderModel,
  type NavigationRenderModel,
} from '@/components/map/NavigationRenderModel'
import { resolveExploreBuildingColor, resolveExploreContext } from '@/lib/explore-contracts'
import { usePublicStore } from '@/store/public-store'
import type { CampusBundle } from '@/types/nav-types'
import { useNavigationMap, useNavigationMapScene } from './NavigationMap'

interface SceneDataSnapshot {
  bundle: CampusBundle
  mapAppearance: ReturnType<typeof usePublicStore.getState>['preferences']['mapAppearance']
  selectedBuildingId?: string
  activeFloor: number
  indoorContext: ReturnType<typeof usePublicStore.getState>['indoorContext']
  revealedPoiIds: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function authoredPoiPosition(bundle: CampusBundle, id: string): { lat: number; lng: number } | undefined {
  const poi = bundle.poi.find((value) => isRecord(value) && value.id === id)
  if (!isRecord(poi)) return undefined
  const geometry = isRecord(poi.geometry) ? poi.geometry : undefined
  const candidate = geometry?.type === 'point'
    ? geometry.position
    : geometry?.type === 'circle'
      ? geometry.center
      : Array.isArray(geometry?.points) ? geometry.points[0] : poi.position
  if (!isRecord(candidate) || typeof candidate.lat !== 'number' || typeof candidate.lng !== 'number') return undefined
  return { lat: candidate.lat, lng: candidate.lng }
}

/**
 * Owns the common campus scene for the lazy MapLibre runtime. It remains
 * mounted when Home/Profile hide the canvas, but freezes presentation inputs
 * until a map surface becomes visible again.
 */
export default function PersistentCampusScene() {
  const { map, isReady, hostRequested } = useNavigationMap()
  const [styleGeneration, setStyleGeneration] = useState(0)

  useEffect(() => {
    if (!map || !isReady) return undefined
    const handleStyleLoad = () => setStyleGeneration((generation) => generation + 1)
    map.on('style.load', handleStyleLoad)
    return () => {
      try { map.off('style.load', handleStyleLoad) } catch {}
    }
  }, [isReady, map])

  if (!hostRequested || !map || !isReady) return null

  return <PersistentCampusSceneContent key={styleGeneration} map={map} />
}

function PersistentCampusSceneContent({ map }: { map: maplibregl.Map }) {
  const { isActive } = useNavigationMap()
  const { state: publishedScene } = useNavigationMapScene()
  const campus = usePublicStore((state) => state.campus)
  const mapAppearance = usePublicStore((state) => state.preferences.mapAppearance)
  const selectedBuildingId = usePublicStore((state) => state.selectedBuilding?.id)
  const activeFloor = usePublicStore((state) => state.activeFloor)
  const indoorContext = usePublicStore((state) => state.indoorContext)
  const revealedPoiIds = usePublicStore((state) => state.revealedPoiIds)

  const [lastVisibleSnapshot, setLastVisibleSnapshot] = useState<SceneDataSnapshot | null>(null)
  const currentSnapshot = useMemo<SceneDataSnapshot | null>(() => campus ? ({
    bundle: campus,
    mapAppearance,
    selectedBuildingId,
    activeFloor,
    indoorContext,
    revealedPoiIds,
  }) : null, [activeFloor, campus, indoorContext, mapAppearance, revealedPoiIds, selectedBuildingId])

  if (currentSnapshot && (isActive || lastVisibleSnapshot === null) && currentSnapshot !== lastVisibleSnapshot) {
    setLastVisibleSnapshot(currentSnapshot)
  }
  const snapshot = isActive
    ? currentSnapshot ?? lastVisibleSnapshot
    : lastVisibleSnapshot ?? currentSnapshot
  const bundle = snapshot?.bundle
  const sceneState = isActive && publishedScene?.bundle === bundle ? publishedScene : null

  const baseModel = useMemo(
    () => bundle ? getCachedNavigationRenderModel(bundle) : null,
    [bundle],
  )
  const model = useMemo(() => {
    if (!bundle || !baseModel) return null
    return {
      ...baseModel,
      buildings: baseModel.buildings.map((renderBuilding) => {
        const sourceBuilding = bundle.buildings.find((building) => building.id === renderBuilding.id)
        return {
          ...renderBuilding,
          color: resolveExploreBuildingColor(
            { color: sourceBuilding?.color ?? renderBuilding.color },
            snapshot?.mapAppearance ?? 'department',
          ),
        }
      }),
    }
  }, [baseModel, bundle, snapshot?.mapAppearance])

  const navigation = sceneState?.navigationContext ?? null
  const exploreContext = useMemo(() => resolveExploreContext({
    parentContext: navigation,
    selectedBuildingId: snapshot?.selectedBuildingId,
    indoorContext: snapshot?.indoorContext,
    activeFloor: snapshot?.activeFloor,
  }), [navigation, snapshot?.activeFloor, snapshot?.indoorContext, snapshot?.selectedBuildingId])
  const effectiveFloor = exploreContext.floor ?? snapshot?.activeFloor ?? 0
  const effectiveIndoorContext = exploreContext.surface === 'outdoors'
    ? { active: false }
    : {
        active: exploreContext.indoorActive,
        buildingId: exploreContext.buildingId,
        floorId: effectiveFloor,
      }

  if (!bundle || !model || !snapshot) return null

  return (
    <NavigationProvider
      location={navigation?.location ?? null}
      heading={navigation?.heading ?? null}
      headingSource={navigation?.headingSource}
      headingStatus={navigation?.headingStatus}
      canRequestHeadingPermission={navigation?.canRequestHeadingPermission}
      enableHeading={navigation?.enableHeading}
      buildingId={navigation?.buildingId}
      floor={navigation?.floor}
      route={navigation?.route ?? null}
      currentNodeId={navigation?.currentNodeId ?? null}
      routeProgress={navigation?.routeProgress ?? null}
      sessionActive={navigation?.sessionActive ?? false}
      isOffRoute={navigation?.isOffRoute ?? false}
      arrived={navigation?.arrived ?? false}
      geoError={navigation?.geoError ?? null}
    >
      <ExploreLayers
        map={map}
        model={model}
        bundle={bundle}
        route={sceneState?.route ?? null}
        indoorContext={effectiveIndoorContext}
        activeFloor={effectiveFloor}
        selectedBuildingId={exploreContext.buildingId}
        navigationTargetBuildingId={sceneState?.navigationTargetBuildingId}
        fitCamera={sceneState?.fitCamera ?? false}
        revealedPoiIds={snapshot.revealedPoiIds}
      />
      <NavigationPositionMarker />
    </NavigationProvider>
  )
}

const ExploreLayers = memo(function ExploreLayers({
  map,
  model,
  bundle,
  route,
  indoorContext,
  activeFloor,
  selectedBuildingId,
  navigationTargetBuildingId,
  fitCamera,
  revealedPoiIds,
}: {
  map: maplibregl.Map
  model: NavigationRenderModel
  bundle: CampusBundle
  route: { path: string[]; cost: number } | null
  indoorContext: { active: boolean; buildingId?: string; floorId?: number }
  activeFloor: number
  selectedBuildingId?: string
  navigationTargetBuildingId?: string
  fitCamera: boolean
  revealedPoiIds: string[]
}) {
  const navigationSegment = useNavigationContext().navigationSegment
  const selectBuilding = usePublicStore((state) => state.selectBuilding)
  const setSheet = usePublicStore((state) => state.setSheet)
  const handleBuildingClick = useCallback((buildingId: string) => {
    const building = bundle.buildings.find((candidate) => candidate.id === buildingId)
    if (!building) return
    selectBuilding(building)
    setSheet('half')
  }, [bundle, selectBuilding, setSheet])
  const getNodePosition = useCallback((id: string) => {
    const node = bundle.nodes.find((candidate) => candidate.id === id)
    return node ? { lat: node.position.lat, lng: node.position.lng } : authoredPoiPosition(bundle, id)
  }, [bundle])
  const getNodeFloor = useCallback((id: string) => {
    const node = bundle.nodes.find((candidate) => candidate.id === id)
    if (node) return node.floor
    const poi = bundle.poi.find((value) => isRecord(value) && value.id === id)
    return isRecord(poi) && typeof poi.floor === 'number' ? poi.floor : undefined
  }, [bundle])
  const entrances = useMemo(() => indoorContext.active
    ? model.entrances.filter((entrance) => entrance.floor === activeFloor
        && (!indoorContext.buildingId || entrance.buildingId === indoorContext.buildingId))
    : [], [activeFloor, indoorContext.active, indoorContext.buildingId, model.entrances])

  return (
    <div data-nav-segment={navigationSegment}>
      <BuildingLayer
        map={map}
        buildings={model.buildings}
        selectedBuildingId={navigationTargetBuildingId ?? selectedBuildingId}
        onBuildingClick={handleBuildingClick}
      />
      <RoomLayer map={map} rooms={model.indoor.rooms} floor={activeFloor} indoorContext={indoorContext} />
      <HallwayLayer map={map} hallways={model.indoor.hallways} floor={activeFloor} indoorContext={indoorContext} />
      <WallLayer map={map} walls={model.indoor.walls} floor={activeFloor} indoorContext={indoorContext} />
      <StaircaseLayer map={map} stairs={model.indoor.stairs} floor={activeFloor} indoorContext={indoorContext} />
      <ElevatorLayer map={map} elevators={model.indoor.elevators} floor={activeFloor} indoorContext={indoorContext} />
      <DoorLayer map={map} doors={model.indoor.doors} floor={activeFloor} indoorContext={indoorContext} />
      <OpeningLayer map={map} openings={model.indoor.openings} walls={model.indoor.walls} floor={activeFloor} indoorContext={indoorContext} />
      <EntranceLayer map={map} entrances={entrances} />
      <POILayer
        map={map}
        pois={indoorContext.active ? model.indoor.pois : []}
        buildingId={indoorContext.buildingId}
        floor={activeFloor}
        revealedIds={revealedPoiIds}
      />
      <RouteLine
        map={map}
        route={route}
        getNodePosition={getNodePosition}
        getNodeFloor={getNodeFloor}
        activeFloor={activeFloor}
        navigationSegment={navigationSegment}
        fitCamera={fitCamera}
      />
    </div>
  )
})
