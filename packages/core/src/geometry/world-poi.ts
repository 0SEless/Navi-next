import type { LatLng } from '../types'
import { haversine } from '../coordinates/crs'

/**
 * World-space POI geometry helpers shared by the Studio authoring surfaces
 * (preview + commit) and the MapLibre projection. Outdoor POIs use world
 * LatLng only; these helpers keep the geometry contract identical to the
 * indoor circle/rectangle builders without a class of wasted code.
 */

const METERS_PER_DEGREE_LAT = 111_320

function metersPerDegreeLng(latitude: number): number {
  return Math.max(Math.cos((latitude * Math.PI) / 180) * METERS_PER_DEGREE_LAT, 1)
}

/** Great-circle distance in meters — same unit the authored circle radius uses. */
export function worldDistanceMeters(a: LatLng, b: LatLng): number {
  return haversine(a, b)
}

/** Open ring approximating a world-space circle of `radiusMeters` around `center`. */
export function worldCirclePoints(center: LatLng, radiusMeters: number, segments = 32): LatLng[] {
  const count = Math.max(3, Math.floor(segments))
  const metersLng = metersPerDegreeLng(center.lat)
  return Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 2
    return {
      lat: center.lat + (Math.cos(angle) * radiusMeters) / METERS_PER_DEGREE_LAT,
      lng: center.lng + (Math.sin(angle) * radiusMeters) / metersLng,
    }
  })
}

/**
 * Four world corners (SW, SE, NE, NW) for a drag between two world positions.
 * Axis-aligned in lat/lng; order is counter-clockwise in screen space, which
 * matches the indoor rectangle builder's corner order.
 */
export function worldRectangleCorners(first: LatLng, current: LatLng): LatLng[] {
  const minLat = Math.min(first.lat, current.lat)
  const maxLat = Math.max(first.lat, current.lat)
  const minLng = Math.min(first.lng, current.lng)
  const maxLng = Math.max(first.lng, current.lng)
  return [
    { lat: minLat, lng: minLng },
    { lat: minLat, lng: maxLng },
    { lat: maxLat, lng: maxLng },
    { lat: maxLat, lng: minLng },
  ]
}

/** Average of the supplied world points — deterministic representative anchor. */
export function worldPointsCentroid(points: LatLng[]): LatLng {
  let lat = 0
  let lng = 0
  for (const point of points) {
    lat += point.lat
    lng += point.lng
  }
  return { lat: lat / points.length, lng: lng / points.length }
}
