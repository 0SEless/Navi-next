import type { LocalCoord, LocalPolygon } from '@navi/core'
import type { RectGeometry } from '../types/parametric-types'

/**
 * Convert a RectGeometry primitive into a 4-corner closed LocalPolygon.
 *
 * Convention (matches the parametric definitions' own geometry() math — see the
 * elevator door-edge midpoints in `ElevatorDefinition.geometry`, which prove
 * center anchoring): `rect.x`/`rect.y` is the CENTER of the rect, `width` and
 * `height` are full extents, and `rotation` (degrees) rotates the rect about
 * its center. The rotation matrix applied here is the exact same transform the
 * frozen definitions use, so the polygon corners land precisely where the
 * definition draws its rect. Deterministic — pure math, no randomness.
 */
export function polygonizeRect(rect: RectGeometry): LocalPolygon {
  const rad = (rect.rotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const hw = rect.width / 2
  const hh = rect.height / 2
  const corners: LocalCoord[] = [
    { x: rect.x + hw * cos - hh * sin, y: rect.y + hw * sin + hh * cos },
    { x: rect.x - hw * cos - hh * sin, y: rect.y - hw * sin + hh * cos },
    { x: rect.x - hw * cos + hh * sin, y: rect.y - hw * sin - hh * cos },
    { x: rect.x + hw * cos + hh * sin, y: rect.y + hw * sin - hh * cos },
  ]
  corners.push({ ...corners[0] })
  return { points: corners }
}