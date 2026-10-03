import type { LocalCoord, LocalPolygon } from '../types/coordinates'

// ── Shared landing derivation (spec micro-decision 3) ──
// ONE implementation, living in packages/core (the shared lowest layer), so
// editor validation and graph derivation can never disagree.

export interface LandingGeometry {
  position: LocalCoord
  rotation?: number
  polygon?: LocalPolygon
}

export interface LandingLevel {
  position: LocalCoord
  rotation: number
  polygon?: LocalPolygon
}

/**
 * The ONE shared landing-derivation rule (verbatim from the approved spec):
 * 1. Authored `landing` present → return it unchanged.
 * 2. Else `level.polygon` present → `{ position: centroid(level.polygon), rotation: level.rotation }`
 *    where centroid = mean of vertices.
 * 3. Else → `{ position: level.position, rotation: level.rotation }`.
 */
export function deriveLanding(
  level: LandingLevel,
  authoredLanding?: LandingGeometry,
): LandingGeometry {
  if (authoredLanding) return authoredLanding
  if (level.polygon) {
    return { position: vertexCentroid(level.polygon), rotation: level.rotation }
  }
  return { position: level.position, rotation: level.rotation }
}

/**
 * Mean-of-vertices centroid; do not confuse with polygon.ts `polygonCentroid`
 * (area-weighted shoelace) — they return different points for non-uniform
 * polygons. For a closed ring (first === last, the LocalPolygon convention)
 * the duplicated closing point is excluded so the first vertex is not
 * double-weighted. Deterministic — no randomness, no iteration-order
 * dependence.
 */
export function vertexCentroid(polygon: LocalPolygon): LocalCoord {
  const pts = polygon.points
  if (pts.length === 0) return { x: 0, y: 0 }
  const first = pts[0]
  const last = pts[pts.length - 1]
  const isClosed =
    pts.length > 1 && first.x === last.x && first.y === last.y
  const count = isClosed ? pts.length - 1 : pts.length
  let sx = 0
  let sy = 0
  for (let i = 0; i < count; i++) {
    sx += pts[i].x
    sy += pts[i].y
  }
  return { x: sx / count, y: sy / count }
}
