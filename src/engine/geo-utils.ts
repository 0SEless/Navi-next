import type { LatLng } from '../types/nav-types'
import { haversine, distanceMeters, lineSegmentIntersection, closestPointOnSegment } from '@navi/core'

export { haversine, distanceMeters }

export { lineSegmentIntersection, closestPointOnSegment }

export function pointToSegmentDistance(p: LatLng, a: LatLng, b: LatLng): number {
  const closest = closestPointOnSegment(p, a, b)
  return haversine(p, closest)
}
