import type { Building, CampusBundle, LatLng, NavNode } from '@/types/nav-types'

/**
 * Pure campus geometry helpers — no MapLibre imports, fully unit-testable.
 *
 * The compiler's building-index does not emit footprint polygons for the demo
 * campus, so building outlines are derived from graph nodes (`buildingId` +
 * `position`). When a building DOES carry a footprint, it is used as-is.
 */

/** Half-width (degrees) of the fallback padding around degenerate node sets. */
const PAD_DEG = 0.0005

function isValidLatLng(p: unknown): p is LatLng {
  return (
    typeof p === 'object' &&
    p !== null &&
    typeof (p as LatLng).lat === 'number' &&
    Number.isFinite((p as LatLng).lat) &&
    typeof (p as LatLng).lng === 'number' &&
    Number.isFinite((p as LatLng).lng)
  )
}

/**
 * Normalize a footprint that may be `{lat,lng}` objects or `[lat,lng]` pairs.
 * Invalid entries are dropped; an empty array means "no usable footprint".
 */
function normalizeFootprint(points: unknown): LatLng[] {
  if (!Array.isArray(points)) return []
  const out: LatLng[] = []
  for (const p of points) {
    if (isValidLatLng(p)) {
      out.push({ lat: p.lat, lng: p.lng })
    } else if (
      Array.isArray(p) &&
      p.length >= 2 &&
      typeof p[0] === 'number' &&
      typeof p[1] === 'number' &&
      Number.isFinite(p[0]) &&
      Number.isFinite(p[1])
    ) {
      out.push({ lat: p[0], lng: p[1] })
    }
  }
  return out
}

/** Cross product of (o->a) x (o->b) in lat/lng plane space. */
function cross(o: LatLng, a: LatLng, b: LatLng): number {
  return (a.lng - o.lng) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lng - o.lng)
}

/**
 * Andrew's monotone chain convex hull. Returns the hull ring (CCW, unclosed).
 * Collinear points are dropped. May return < 3 points for degenerate inputs.
 */
function convexHull(points: LatLng[]): LatLng[] {
  const pts = [...points].sort((a, b) => a.lng - b.lng || a.lat - b.lat)
  if (pts.length < 3) return []
  const lower: LatLng[] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop()
    }
    lower.push(p)
  }
  const upper: LatLng[] = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop()
    }
    upper.push(p)
  }
  lower.pop()
  upper.pop()
  return [...lower, ...upper]
}

/**
 * Close a ring by appending the first point (if not already closed). MapLibre's
 * line/outline layer draws only explicit segments, so an unclosed ring would
 * leave the final edge missing; fills close implicitly.
 */
function closeRing(ring: LatLng[]): LatLng[] {
  if (ring.length === 0) return ring
  const first = ring[0]
  const last = ring[ring.length - 1]
  if (first.lat === last.lat && first.lng === last.lng) return ring
  return [...ring, first]
}

/** 4-corner padded bounding box ring around the given points. */
function paddedBoundingBox(points: LatLng[]): LatLng[] {
  let minLat = Infinity
  let maxLat = -Infinity
  let minLng = Infinity
  let maxLng = -Infinity
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat
    if (p.lat > maxLat) maxLat = p.lat
    if (p.lng < minLng) minLng = p.lng
    if (p.lng > maxLng) maxLng = p.lng
  }
  if (!Number.isFinite(minLat)) return []
  minLat -= PAD_DEG
  maxLat += PAD_DEG
  minLng -= PAD_DEG
  maxLng += PAD_DEG
  return [
    { lat: minLat, lng: minLng },
    { lat: minLat, lng: maxLng },
    { lat: maxLat, lng: maxLng },
    { lat: maxLat, lng: minLng },
  ]
}

/**
 * Building outline for the map rendering. Priority:
 *  1. `building.footprint` from compiled buildingIndex artifacts (used as-is).
 *  2. Convex hull of all nodes with `buildingId === building.id` (defensive fallback for incomplete data).
 *  3. Padded bounding box (fallback for 1-2 nodes or collinear points).
 * Returns null when the building has no footprint and no nodes.
 */
export function deriveBuildingFootprint(building: Building, nodes: NavNode[]): LatLng[] | null {
  const footprint = normalizeFootprint(building.footprint)
  let ring: LatLng[] | null = null
  if (footprint.length >= 3) {
    ring = footprint
  } else {
    const ownNodes = nodes.filter((n) => n.buildingId === building.id)
    if (ownNodes.length === 0) return null
    const positions = ownNodes.map((n) => n.position)
    if (positions.length >= 3) {
      const hull = convexHull(positions)
      ring = hull.length >= 3 ? hull : paddedBoundingBox(positions)
    } else {
      ring = paddedBoundingBox(positions)
    }
  }
  return closeRing(ring)
}

export interface BuildingStats {
  floors: number
  rooms: number
  entrances: number
}

/**
 * Stats for the building detail panel.
 * - floors: count of levels from the building's floor list; falls back to the
 *   number of unique floors among the building's graph nodes.
 * - rooms: search entries typed `room` that belong to the building.
 * - entrances: count of declared `building.entrances`.
 */
export function buildingStats(bundle: CampusBundle, buildingId: string): BuildingStats {
  const building = bundle.buildings.find((b) => b.id === buildingId)
  let floors = building?.floors?.length ?? 0
  if (floors === 0) {
    const uniqueFloors = new Set(
      bundle.nodes.filter((n) => n.buildingId === buildingId).map((n) => n.floor),
    )
    floors = uniqueFloors.size
  }
  const rooms = bundle.searchEntries.filter(
    (e) => e.type === 'room' && e.buildingId === buildingId,
  ).length
  const entrances = building?.entrances?.length ?? 0
  return { floors, rooms, entrances }
}

/**
 * Best graph node to route to for a building ("Navigate here"). Priority:
 *  1. Building search entry (`type === 'building'` with matching `buildingId`) → its nodeId.
 *  2. First graph node of the building with `type === 'building_entrance'`.
 *  3. First graph node of the building.
 * Returns null when no node references the building.
 */
export function resolveBuildingEntranceNode(bundle: CampusBundle, buildingId: string): string | null {
  const entry = bundle.searchEntries.find(
    (e) => e.type === 'building' && e.buildingId === buildingId,
  )
  if (entry?.nodeId) return entry.nodeId

  const entranceNode = bundle.nodes.find(
    (n) => n.buildingId === buildingId && n.type === 'building_entrance',
  )
  if (entranceNode) return entranceNode.id

  const firstNode = bundle.nodes.find((n) => n.buildingId === buildingId)
  return firstNode ? firstNode.id : null
}
