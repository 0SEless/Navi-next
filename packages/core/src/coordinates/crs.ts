import type { LatLng } from '../types'

// ── Earth constants ──
export const EARTH_RADIUS = 6378137  // WGS84 semi-major axis in meters
const MAX_LAT = 85.05112878  // Web Mercator max latitude

export type CRSName = 'wgs84' | 'web_mercator' | 'utm'

export interface CRSDefinition {
  name: CRSName
  epsg: string
  description: string
}

export const CRS: Record<CRSName, CRSDefinition> = {
  wgs84: { name: 'wgs84', epsg: 'EPSG:4326', description: 'WGS84 geographic (lat/lng)' },
  web_mercator: { name: 'web_mercator', epsg: 'EPSG:3857', description: 'Web Mercator projected (meters)' },
  utm: { name: 'utm', epsg: 'EPSG:32651', description: 'UTM zone 51N (Philippines)' },
}

// ── Projection functions ──

export function wgs84ToWebMercator(latlng: LatLng): { x: number; y: number } {
  const λ = (latlng.lng * Math.PI) / 180
  const φ = Math.max(-MAX_LAT, Math.min(MAX_LAT, latlng.lat)) * (Math.PI / 180)
  return {
    x: EARTH_RADIUS * λ,
    y: EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + φ / 2)),
  }
}

export function webMercatorToWgs84(x: number, y: number): LatLng {
  const lng = (x / EARTH_RADIUS) * (180 / Math.PI)
  const lat = (2 * Math.atan(Math.exp(y / EARTH_RADIUS)) - Math.PI / 2) * (180 / Math.PI)
  return { lat, lng }
}

// ── Equirectangular approximation (fast, campus-accurate) ──

export function distanceMeters(a: LatLng, b: LatLng): number {
  const dLat = (a.lat - b.lat) * 111320
  const avgLat = ((a.lat + b.lat) / 2) * (Math.PI / 180)
  const dLng = (a.lng - b.lng) * 111320 * Math.cos(avgLat)
  return Math.hypot(dLat, dLng)
}

// ── Haversine for direct WGS84 distance ──

export function haversine(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const sinDLat = Math.sin(dLat / 2)
  const sinDLng = Math.sin(dLng / 2)
  const h = sinDLat * sinDLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinDLng * sinDLng
  return EARTH_RADIUS * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}
