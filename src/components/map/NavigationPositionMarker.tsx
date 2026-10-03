'use client'

import { useEffect } from 'react'
import type maplibregl from 'maplibre-gl'
import {
  buildPassiveLocationArrowGeoJson,
  buildPassiveLocationPositionGeoJson,
  createPassiveLocationMarkerLayers,
  ensurePassiveLocationMarkerImage,
  removePassiveLocationMarkerLayers,
  type PassiveLocationMarkerIds,
} from '@/lib/navigation-heading-arrow'
import { useNavigationMap } from './NavigationMap'
import { useOptionalNavigationContext } from './NavigationContext'

export const NAVIGATION_DIRECTION_ARROW_IMAGE_ID = 'navigate-direction-arrow-icon'
export const NAVIGATION_DIRECTION_ARROW_SOURCE_ID = 'navigate-current-direction'
export const NAVIGATION_DIRECTION_ARROW_LAYER_ID = 'navigate-current-direction-arrow'
export const NAVIGATION_POSITION_MARKER_SOURCE_ID = 'navigate-current-position'
export const NAVIGATION_POSITION_MARKER_LAYER_ID = 'navigate-current-position-point'

// Retained only to clean maps created by the superseded Navigate beam renderer.
export const NAVIGATION_DIRECTION_BEAM_LAYER_ID = 'navigate-current-direction-beam'
export const NAVIGATION_DIRECTION_BEAM_CORE_LAYER_ID = 'navigate-current-direction-core'
export const NAVIGATION_DIRECTION_ARROW_LAYER_OUTER_ID = 'navigate-current-direction-outer'
export const NAVIGATION_DIRECTION_ARROW_LAYER_INNER_ID = 'navigate-current-direction-inner'

const NAVIGATION_PASSIVE_MARKER_IDS: PassiveLocationMarkerIds = {
  positionSourceId: NAVIGATION_POSITION_MARKER_SOURCE_ID,
  positionLayerId: NAVIGATION_POSITION_MARKER_LAYER_ID,
  directionSourceId: NAVIGATION_DIRECTION_ARROW_SOURCE_ID,
  directionLayerId: NAVIGATION_DIRECTION_ARROW_LAYER_ID,
  imageId: NAVIGATION_DIRECTION_ARROW_IMAGE_ID,
}

const LEGACY_NAVIGATION_DIRECTION_LAYER_IDS = [
  NAVIGATION_DIRECTION_BEAM_LAYER_ID,
  NAVIGATION_DIRECTION_BEAM_CORE_LAYER_ID,
  NAVIGATION_DIRECTION_ARROW_LAYER_OUTER_ID,
  NAVIGATION_DIRECTION_ARROW_LAYER_INNER_ID,
] as const

function removeLegacyNavigationDirectionResources(map: maplibregl.Map): void {
  try {
    if (typeof map.getLayer === 'function' && typeof map.removeLayer === 'function') {
      LEGACY_NAVIGATION_DIRECTION_LAYER_IDS.forEach((layerId) => {
        if (map.getLayer(layerId)) map.removeLayer(layerId)
      })
    }
    if (typeof map.getSource === 'function' && typeof map.removeSource === 'function' && map.getSource(NAVIGATION_DIRECTION_ARROW_SOURCE_ID)) {
      map.removeSource(NAVIGATION_DIRECTION_ARROW_SOURCE_ID)
    }
  } catch {
    // NavigationMap can tear down its MapLibre instance before child cleanup.
  }
}

function isValidPosition(position: { lat: number; lng: number } | null | undefined): position is { lat: number; lng: number } {
  return position !== null
    && position !== undefined
    && Number.isFinite(position.lat)
    && Number.isFinite(position.lng)
}

/**
 * Passive current-position rendering. NavigationSession owns acquisition and
 * heading resolution; this component only mirrors those values into the
 * shared Capture-style MapLibre dot/arrow primitive.
 */
export function NavigationPositionMarker() {
  const { map, isReady } = useNavigationMap()
  const navigationContext = useOptionalNavigationContext()
  const position = navigationContext?.location ?? null
  const heading = navigationContext?.heading ?? null

  useEffect(() => {
    if (!map || !isReady) return undefined

    removeLegacyNavigationDirectionResources(map)

    if (!map.getSource(NAVIGATION_PASSIVE_MARKER_IDS.positionSourceId)) {
      map.addSource(NAVIGATION_PASSIVE_MARKER_IDS.positionSourceId, {
        type: 'geojson',
        data: buildPassiveLocationPositionGeoJson(null),
      })
    }
    if (!map.getSource(NAVIGATION_PASSIVE_MARKER_IDS.directionSourceId)) {
      map.addSource(NAVIGATION_PASSIVE_MARKER_IDS.directionSourceId, {
        type: 'geojson',
        data: buildPassiveLocationArrowGeoJson(null, null),
      })
    }

    ensurePassiveLocationMarkerImage(map, NAVIGATION_PASSIVE_MARKER_IDS.imageId)
    const layers = createPassiveLocationMarkerLayers(NAVIGATION_PASSIVE_MARKER_IDS)
    if (!map.getLayer(layers.direction.id)) map.addLayer(layers.direction as never)
    if (!map.getLayer(layers.position.id)) map.addLayer(layers.position as never)

    return () => removePassiveLocationMarkerLayers(map, NAVIGATION_PASSIVE_MARKER_IDS)
  }, [isReady, map])

  useEffect(() => {
    if (!map || !isReady) return

    const positionSource = map.getSource(NAVIGATION_PASSIVE_MARKER_IDS.positionSourceId) as maplibregl.GeoJSONSource | undefined
    const directionSource = map.getSource(NAVIGATION_PASSIVE_MARKER_IDS.directionSourceId) as maplibregl.GeoJSONSource | undefined
    const markerPosition = isValidPosition(position)
      ? { latitude: position.lat, longitude: position.lng }
      : null

    positionSource?.setData(buildPassiveLocationPositionGeoJson(markerPosition))
    directionSource?.setData(buildPassiveLocationArrowGeoJson(markerPosition, heading))
  }, [heading, isReady, map, position])

  return null
}

export default NavigationPositionMarker
