import type { CoordinateTransformer } from '@navi/core'

// ── Geographic bridge ──
// Converts between building-local meters and MapLibre screen pixels.

interface MapLibreLike {
  project(lnglat: [number, number]): { x: number; y: number }
  unproject(point: [number, number]): { lng: number; lat: number }
}

export function buildingLocalToMapScreen(
  local: { x: number; y: number },
  buildingId: string,
  map: MapLibreLike,
  transformer: CoordinateTransformer,
): { x: number; y: number } {
  const latlng = transformer.buildingLocalToWorld(local, buildingId)
  if (!latlng) return { x: 0, y: 0 }
  return map.project([latlng.lng, latlng.lat])
}

export function mapScreenToBuildingLocal(
  screen: { x: number; y: number },
  buildingId: string,
  map: MapLibreLike,
  transformer: CoordinateTransformer,
): { x: number; y: number } | null {
  const latlng = map.unproject([screen.x, screen.y])
  return transformer.worldToBuildingLocal(latlng, buildingId)
}
