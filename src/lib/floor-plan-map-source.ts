import type { LatLng } from '@/types/nav-types'
import type { PlanAlignment } from '@navi/core'
import { computeFloorPlanCoords } from './floor-plan-coords'

export interface FloorPlanMapSource {
  url?: string
  setCoordinates?: (coordinates: [[number, number], [number, number], [number, number], [number, number]]) => unknown
  updateImage?: (options: {
    url: string
    coordinates: [[number, number], [number, number], [number, number], [number, number]]
  }) => unknown
}

export interface FloorPlanMapLike {
  getSource: (sourceId: string) => FloorPlanMapSource | undefined
  getLayer: (layerId: string) => unknown
  addSource: (sourceId: string, source: {
    type: 'image'
    url: string
    coordinates: [[number, number], [number, number], [number, number], [number, number]]
  }) => void
  addLayer: (layer: {
    id: string
    type: 'raster'
    source: string
    layout: { visibility: 'visible' | 'none' }
    paint: { 'raster-opacity': number }
  }, beforeLayerId?: string) => void
  setLayoutProperty: (layerId: string, property: 'visibility', value: 'visible' | 'none') => void
  setPaintProperty?: (layerId: string, property: 'raster-opacity', value: number) => void
}

export interface SyncFloorPlanImageLayerArgs {
  sourceId: string
  layerId: string
  imageUrl?: string
  footprint: readonly LatLng[]
  alignment?: PlanAlignment | null
  opacity?: number
  beforeLayerId?: string
}

function setVisibility(map: FloorPlanMapLike, layerId: string, visibility: 'visible' | 'none'): void {
  if (!map.getLayer(layerId)) return
  try {
    map.setLayoutProperty(layerId, 'visibility', visibility)
  } catch {
    // MapLibre can briefly report a layer before its style is ready.
  }
}

/**
 * Reconcile one MapLibre image source/layer with the current floor-plan
 * metadata. Geometry changes update coordinates in place; pixel data is
 * reloaded only when the image URL changes. Invalid metadata always hides the
 * existing layer, which prevents a stale plan from surviving a floor switch.
 */
export function syncFloorPlanImageLayer(
  map: FloorPlanMapLike,
  args: SyncFloorPlanImageLayerArgs,
): boolean {
  const { sourceId, layerId, imageUrl, footprint } = args
  const valid = Boolean(imageUrl) && footprint.length >= 3
  if (!valid) {
    setVisibility(map, layerId, 'none')
    return false
  }

  const coordinates = computeFloorPlanCoords([...footprint], args.alignment ?? undefined)
  const opacity = args.opacity ?? args.alignment?.opacity ?? 0.7
  let source = map.getSource(sourceId)

  if (!source) {
    map.addSource(sourceId, { type: 'image', url: imageUrl!, coordinates })
    if (!map.getLayer(layerId)) {
      map.addLayer({
        id: layerId,
        type: 'raster',
        source: sourceId,
        layout: { visibility: 'visible' },
        paint: { 'raster-opacity': opacity },
      }, args.beforeLayerId)
    }
    source = map.getSource(sourceId)
  } else {
    const existingUrl = source.url ?? (source as FloorPlanMapSource & { options?: { url?: string } }).options?.url
    if (existingUrl !== imageUrl && source.updateImage) {
      source.updateImage({ url: imageUrl!, coordinates })
    } else if (!existingUrl && source.updateImage && !source.setCoordinates) {
      // Test doubles and older adapters may not expose setCoordinates; keep
      // their source geometry in sync while preserving the same URL.
      source.updateImage({ url: imageUrl!, coordinates })
    }
    if (source.setCoordinates) source.setCoordinates(coordinates)
  }

  if (!map.getLayer(layerId)) {
    map.addLayer({
      id: layerId,
      type: 'raster',
      source: sourceId,
      layout: { visibility: 'visible' },
      paint: { 'raster-opacity': opacity },
    }, args.beforeLayerId)
  }

  setVisibility(map, layerId, 'visible')
  if (map.getLayer(layerId) && map.setPaintProperty) {
    try {
      map.setPaintProperty(layerId, 'raster-opacity', opacity)
    } catch {
      // A style update can race layer creation; the next reconciliation retries.
    }
  }
  return true
}
