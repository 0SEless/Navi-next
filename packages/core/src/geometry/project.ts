import type { LatLng, LocalCoord } from '../types'
import { wgs84ToWebMercator, webMercatorToWgs84 } from '../coordinates/crs'

// ── Utility: LatLng ↔ Euclidean (Web Mercator) ──

export function latLngToEuclidean(latlng: LatLng): { x: number; y: number } {
  return wgs84ToWebMercator(latlng)
}

export function euclideanToLatLng(x: number, y: number): LatLng {
  return webMercatorToWgs84(x, y)
}
