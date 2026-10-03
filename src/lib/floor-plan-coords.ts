import type { LatLng } from '@/types/nav-types'
import type { PlanAlignment } from '@navi/core'
import {
  getFootprintFrameMeters,
  resolvePlanAlignment,
  transformLocalPoint,
} from './floor-plan-transform'

export type { PlanAlignment }

/**
 * Compute the four plan-image corner coordinates (lat/lng) for a footprint.
 *
 * The transform chain (shared editor↔runtime semantics, W12B):
 *   1. footprint bbox corners in true building-local meters
 *   2. scale in image-local X/Y axes
 *   3. rotate clockwise around the image frame origin
 *   4. translate by true building-local meter offset
 *   5. project back to lat/lng
 *
 * Offset invariant: offset.x = 1, offset.y = 0 moves the plan exactly
 * 1 building-local meter east. There is one meter conversion authority in
 * floor-plan-transform.ts; this adapter only converts the final local points
 * back to geographic coordinates.
 *
 * So each corner is: transformLocalPoint(corner-in-frame, alignment).
 * Absent alignment (or < 3 footprint points) → corners equal the footprint
 * bbox ("stretch to bbox", equivalent to scale=1/rotation=0/offset=0).
 * Full semantics: docs/architecture/floor-plan-alignment.md (P1-T16, W12B).
 */
export function computeFloorPlanCoords(
  footprint: LatLng[],
  alignment?: PlanAlignment,
): [[number, number], [number, number], [number, number], [number, number]] {
  if (!footprint || footprint.length === 0) {
    return [[0, 0], [0, 0], [0, 0], [0, 0]]
  }

  const frame = getFootprintFrameMeters(footprint)

  if (footprint.length < 3 || frame.width <= 0 || frame.height <= 0) {
    // Default: stretch to footprint bounding box
    const valid = footprint.filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng))
    if (valid.length === 0) return [[0, 0], [0, 0], [0, 0], [0, 0]]
    const minLng = Math.min(...valid.map((point) => point.lng))
    const maxLng = Math.max(...valid.map((point) => point.lng))
    const minLat = Math.min(...valid.map((point) => point.lat))
    const maxLat = Math.max(...valid.map((point) => point.lat))
    return [[minLng, maxLat], [maxLng, maxLat], [maxLng, minLat], [minLng, minLat]]
  }

  const resolved = resolvePlanAlignment(alignment)
  const metersPerLat = 6371000 * Math.PI / 180
  const metersPerLng = metersPerLat * Math.cos(frame.center.lat * Math.PI / 180)
  const cornersLatLng: LatLng[] = frame.corners.map((corner) => {
    const point = transformLocalPoint(corner, resolved)
    return {
      lat: frame.center.lat + point.y / metersPerLat,
      lng: frame.center.lng + point.x / metersPerLng,
    }
  })

  return [
    [cornersLatLng[0].lng, cornersLatLng[0].lat],
    [cornersLatLng[1].lng, cornersLatLng[1].lat],
    [cornersLatLng[2].lng, cornersLatLng[2].lat],
    [cornersLatLng[3].lng, cornersLatLng[3].lat],
  ]
}
