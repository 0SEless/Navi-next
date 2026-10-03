import type maplibregl from 'maplibre-gl'
import { normalizeCaptureHeading } from '@/features/capture/direction'

/**
 * Shared passive current-location rendering for Capture and Navigate.
 *
 * This module owns only MapLibre data, image, layer, and cleanup contracts.
 * It does not acquire location, resolve heading permission, smooth position,
 * compute route progress, record Capture samples, or control the camera.
 */
export const NAVIGATION_HEADING_ARROW_IMAGE_WIDTH_PX = 32
export const NAVIGATION_HEADING_ARROW_IMAGE_HEIGHT_PX = 40

export interface NavigationHeadingArrowCoordinate {
  latitude: number
  longitude: number
}

export interface NavigationHeadingArrowProperties {
  kind: 'navigation-forward-heading-arrow'
  heading: number
}

export type NavigationHeadingArrowGeoJson = GeoJSON.FeatureCollection<GeoJSON.Point, NavigationHeadingArrowProperties>

export interface PassiveLocationArrowProperties {
  kind: string
  heading: number
}

export type PassiveLocationArrowGeoJson = GeoJSON.FeatureCollection<GeoJSON.Point, PassiveLocationArrowProperties>
export type PassiveLocationPositionGeoJson = GeoJSON.FeatureCollection<GeoJSON.Point, GeoJSON.GeoJsonProperties>

export interface PassiveLocationMarkerIds {
  positionSourceId: string
  positionLayerId: string
  directionSourceId: string
  directionLayerId: string
  imageId: string
}

export type NavigationHeadingArrowImage = {
  width: number
  height: number
  data: Uint8Array | Uint8ClampedArray
}

function emptyPositionGeoJson(): PassiveLocationPositionGeoJson {
  return { type: 'FeatureCollection', features: [] }
}

function emptyArrowGeoJson(): PassiveLocationArrowGeoJson {
  return { type: 'FeatureCollection', features: [] }
}

function isValidCoordinate(position: NavigationHeadingArrowCoordinate | null | undefined): position is NavigationHeadingArrowCoordinate {
  return position !== null
    && position !== undefined
    && Number.isFinite(position.latitude)
    && Number.isFinite(position.longitude)
    && position.latitude >= -90
    && position.latitude <= 90
    && position.longitude >= -180
    && position.longitude <= 180
}

/** Build the geographic current-position dot consumed by the shared layer set. */
export function buildPassiveLocationPositionGeoJson(
  position: NavigationHeadingArrowCoordinate | null | undefined,
): PassiveLocationPositionGeoJson {
  if (!isValidCoordinate(position)) return emptyPositionGeoJson()

  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Point',
        coordinates: [position.longitude, position.latitude],
      },
    }],
  }
}

/**
 * Build the compact geographic heading arrow. The caller supplies the display
 * heading; this helper only normalizes it and never adds a second smoothing
 * system.
 */
export function buildPassiveLocationArrowGeoJson(
  position: NavigationHeadingArrowCoordinate | null | undefined,
  heading: number | null | undefined,
  kind = 'navigation-forward-heading-arrow',
): PassiveLocationArrowGeoJson {
  const normalizedHeading = normalizeCaptureHeading(heading)
  if (!isValidCoordinate(position) || normalizedHeading === null) return emptyArrowGeoJson()

  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {
        kind,
        heading: normalizedHeading,
      },
      geometry: {
        type: 'Point',
        coordinates: [position.longitude, position.latitude],
      },
    }],
  }
}

/** Compatibility wrapper for existing Navigate helper consumers. */
export function buildNavigationHeadingArrowGeoJson(
  position: NavigationHeadingArrowCoordinate | null | undefined,
  heading: number | null | undefined,
): NavigationHeadingArrowGeoJson {
  return buildPassiveLocationArrowGeoJson(position, heading) as NavigationHeadingArrowGeoJson
}

/** Keep the Capture arrow aligned to the map and rotate it from geographic heading. */
export function createNavigationHeadingArrowLayer(imageId: string) {
  return {
    type: 'symbol' as const,
    layout: {
      'icon-image': imageId,
      'icon-anchor': 'bottom',
      'icon-size': 0.75,
      'icon-rotate': ['get', 'heading'],
      'icon-rotation-alignment': 'map',
      'icon-pitch-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  }
}

/** Return the Capture-compatible dot plus map-aligned arrow layers. */
export function createPassiveLocationMarkerLayers(ids: PassiveLocationMarkerIds) {
  return {
    direction: {
      id: ids.directionLayerId,
      source: ids.directionSourceId,
      ...createNavigationHeadingArrowLayer(ids.imageId),
    },
    position: {
      id: ids.positionLayerId,
      type: 'circle' as const,
      source: ids.positionSourceId,
      paint: {
        'circle-color': '#059669',
        'circle-radius': 8,
        'circle-stroke-color': '#FFFFFF',
        'circle-stroke-width': 3,
      },
    },
  }
}

function pointInPolygon(x: number, y: number, polygon: Array<[number, number]>): boolean {
  let inside = false
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const [currentX, currentY] = polygon[index]
    const [previousX, previousY] = polygon[previous]
    const intersects = ((currentY > y) !== (previousY > y))
      && x < (previousX - currentX) * (y - currentY) / (previousY - currentY) + currentX
    if (intersects) inside = !inside
  }
  return inside
}

/**
 * Create the small green Capture arrow without relying on a DOM canvas. This
 * keeps the MapLibre StyleImageInterface usable in tests and during SSR setup.
 */
export function createNavigationHeadingArrowImage(): NavigationHeadingArrowImage {
  const width = NAVIGATION_HEADING_ARROW_IMAGE_WIDTH_PX
  const height = NAVIGATION_HEADING_ARROW_IMAGE_HEIGHT_PX
  const data = new Uint8ClampedArray(width * height * 4)
  const arrow: Array<[number, number]> = [
    [width / 2, 1],
    [width - 2, 29],
    [width / 2 + 4, 25],
    [width / 2, height - 1],
    [width / 2 - 4, 25],
    [2, 29],
  ]

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!pointInPolygon(x + 0.5, y + 0.5, arrow)) continue
      const offset = (y * width + x) * 4
      data[offset] = 16
      data[offset + 1] = 185
      data[offset + 2] = 129
      data[offset + 3] = 235
    }
  }

  return { width, height, data }
}

/** Register the shared symbol image once per MapLibre map. */
export function ensurePassiveLocationMarkerImage(map: maplibregl.Map, imageId: string): void {
  if (map.hasImage(imageId)) return
  map.addImage(imageId, createNavigationHeadingArrowImage())
}

/** Compatibility wrapper for existing Capture helper consumers. */
export function ensureNavigationHeadingArrowImage(map: maplibregl.Map, imageId: string): void {
  ensurePassiveLocationMarkerImage(map, imageId)
}

/** Remove only the namespaced passive marker resources. */
export function removePassiveLocationMarkerLayers(
  map: maplibregl.Map | null | undefined,
  ids: PassiveLocationMarkerIds,
): void {
  if (!map) return

  try {
    if (typeof map.getLayer === 'function' && typeof map.removeLayer === 'function') {
      ;[ids.directionLayerId, ids.positionLayerId].forEach((layerId) => {
        if (map.getLayer(layerId)) map.removeLayer(layerId)
      })
    }
    if (typeof map.getSource === 'function' && typeof map.removeSource === 'function') {
      ;[ids.directionSourceId, ids.positionSourceId].forEach((sourceId) => {
        if (map.getSource(sourceId)) map.removeSource(sourceId)
      })
    }
    if (typeof map.hasImage === 'function' && typeof map.removeImage === 'function' && map.hasImage(ids.imageId)) {
      map.removeImage(ids.imageId)
    }
  } catch {
    // NavigationMap can tear down its MapLibre instance before child cleanup.
  }
}
