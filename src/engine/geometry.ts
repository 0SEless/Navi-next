import type { LatLng } from '../types/nav-types'

function cross(o: LatLng, a: LatLng, b: LatLng): number {
  return (a.lng - o.lng) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lng - o.lng)
}

export function convexHull(points: LatLng[]): LatLng[] {
  if (points.length < 3) return [...points]

  const sorted = [...points].sort((a, b) => a.lng - b.lng || a.lat - b.lat)

  const lower: LatLng[] = []
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop()
    }
    lower.push(p)
  }

  const upper: LatLng[] = []
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop()
    }
    upper.push(p)
  }

  lower.pop()
  upper.pop()
  return lower.concat(upper)
}

export function polygonCentroid(polygon: LatLng[]): LatLng {
  let lat = 0, lng = 0
  for (const p of polygon) {
    lat += p.lat
    lng += p.lng
  }
  return { lat: lat / polygon.length, lng: lng / polygon.length }
}
