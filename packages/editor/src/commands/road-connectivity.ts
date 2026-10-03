/**
 * Phase 3 — Shared Road Connectivity Service
 *
 * Single authority for endpoint snap/connectivity decisions during
 * road creation and vertex editing. Replaces the separate rules that
 * previously lived in road-snap.ts, vertex-editing snap, and graph sync.
 *
 * Core invariant: CampusDocument.roads[] authored geometry is canonical.
 * This service recommends positions; it does not mutate geometry.
 */

import type { LatLng, Road, RoadJunction } from '@navi/core'
import { ROUTE_NETWORK_THRESHOLDS, haversine, lineSegmentIntersection } from '@navi/core'

// ── Types ──────────────────────────────────────────────────────

export type CandidateKind = 'existing-junction' | 'road-endpoint' | 'road-segment'

export interface ConnectivityCandidate {
  /** ID of the target road (for segment/endpoint candidates). */
  targetRoadId?: string
  /** ID of an existing explicit junction (for junction candidates). */
  junctionId?: string
  /** The recommended snap position. */
  position: LatLng
  /** Distance from the query point to the candidate, in meters. */
  distanceMeters: number
  /** What kind of candidate this is. */
  kind: CandidateKind
  /** Display label for preview UI. */
  label: string
}

export interface ConnectivityOptions {
  /** Roads to consider as candidates. */
  roads: Road[]
  /** Existing explicit junctions. */
  junctions?: RoadJunction[]
  /** ID of the road being edited (excluded from self-snap). */
  excludeRoadId?: string
  /** Snap radius in meters. Default: EDITOR_SNAP_RADIUS_METERS. */
  radiusMeters?: number
  /** If true, bypass all snapping (Alt key). */
  bypass?: boolean
}

export interface ConnectivityResult {
  /** All eligible candidates, sorted by distance (nearest first). */
  candidates: ConnectivityCandidate[]
  /** The best candidate (nearest valid), or null. */
  best: ConnectivityCandidate | null
  /** True if the best candidate is ambiguous (tied with another). */
  ambiguous: boolean
  /** The recommended snap position (same as best.position, or original point). */
  position: LatLng
  /** True if snapping was bypassed. */
  bypassed: boolean
}

// ── Constants ──────────────────────────────────────────────────

/**
 * Fix 1: connection discovery radius (0.5 m) — sourced from the central route
 * network thresholds so editor and compiler share one number.
 *
 * This radius only DETECTS intent. Geometry is never mutated and topology is
 * never created before the admin confirms Connect / Keep Separate.
 */
export const EDITOR_SNAP_RADIUS_METERS = ROUTE_NETWORK_THRESHOLDS.snapRadiusMeters

/**
 * Threshold for considering two candidates "ambiguous" — if two candidates
 * are within this distance of each other, the admin must choose.
 */
export const AMBIGUITY_THRESHOLD_METERS = 0.5

// ── Helpers ────────────────────────────────────────────────────

const EARTH_RADIUS = 6371000

function toMeters(p: LatLng, origin: LatLng): { x: number; y: number } {
  const lat0 = (origin.lat * Math.PI) / 180
  const lng0 = (origin.lng * Math.PI) / 180
  const lat = (p.lat * Math.PI) / 180
  const lng = (p.lng * Math.PI) / 180
  const cosMid = Math.cos((lat + lat0) / 2)
  return {
    x: EARTH_RADIUS * (lng - lng0) * cosMid,
    y: EARTH_RADIUS * (lat - lat0),
  }
}

function fromMeters(m: { x: number; y: number }, origin: LatLng): LatLng {
  const lat0 = (origin.lat * Math.PI) / 180
  const lng0 = (origin.lng * Math.PI) / 180
  const lat = m.y / EARTH_RADIUS + lat0
  const cosMid = Math.cos((lat + lat0) / 2)
  return {
    lat: (lat * 180) / Math.PI,
    lng: (m.x / (EARTH_RADIUS * cosMid) + lng0) * (180 / Math.PI),
  }
}

function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS * Math.asin(Math.sqrt(h))
}

/**
 * Closest point on a polyline segment to `p`, in meters.
 * Returns null for degenerate polylines.
 */
export function nearestPointOnPolyline(
  p: LatLng,
  polyline: LatLng[],
  origin: LatLng,
): { point: LatLng; distance: number; segmentIndex: number } | null {
  if (polyline.length < 2) return null
  const mp = toMeters(p, origin)
  let bestPoint: LatLng | null = null
  let bestDist = Infinity
  let bestSeg = 0

  for (let i = 0; i < polyline.length - 1; i++) {
    const a = toMeters(polyline[i], origin)
    const b = toMeters(polyline[i + 1], origin)
    const abx = b.x - a.x
    const aby = b.y - a.y
    const len2 = abx * abx + aby * aby
    if (len2 === 0) continue

    let t = ((mp.x - a.x) * abx + (mp.y - a.y) * aby) / len2
    t = Math.max(0, Math.min(1, t))
    const proj = { x: a.x + t * abx, y: a.y + t * aby }
    const d = Math.sqrt((proj.x - mp.x) ** 2 + (proj.y - mp.y) ** 2)
    if (d < bestDist) {
      bestDist = d
      bestPoint = fromMeters(proj, origin)
      bestSeg = i
    }
  }

  return bestPoint ? { point: bestPoint, distance: bestDist, segmentIndex: bestSeg } : null
}

// ── Main API ───────────────────────────────────────────────────

/**
 * Find connectivity candidates for a point near existing roads.
 *
 * Returns all eligible candidates sorted by distance (nearest first).
 * Existing explicit junctions are preferred over raw road segments.
 * Self-snap is excluded. Ambiguous ties are flagged.
 */
export function findConnectivityCandidates(
  point: LatLng,
  options: ConnectivityOptions,
): ConnectivityResult {
  const {
    roads,
    junctions: rawJunctions,
    excludeRoadId,
    radiusMeters = EDITOR_SNAP_RADIUS_METERS,
    bypass = false,
  } = options
  const junctions = rawJunctions ?? []

  if (bypass || roads.length === 0) {
    return { candidates: [], best: null, ambiguous: false, position: point, bypassed: bypass }
  }

  const origin = point
  const candidates: ConnectivityCandidate[] = []

  // 1. Check existing explicit junctions
  for (const j of junctions) {
    const dist = haversineMeters(point, j.position)
    if (dist <= radiusMeters) {
      // Check if any of the junction's roads are the excluded road
      const hasExcludedRoad = j.roadIds.includes(excludeRoadId ?? '')
      if (hasExcludedRoad && j.roadIds.length <= 1) continue // skip self-only junctions

      candidates.push({
        targetRoadId: j.roadIds[0],
        junctionId: j.id,
        position: j.position,
        distanceMeters: dist,
        kind: 'existing-junction',
        label: `Junction (${j.roadIds.length} roads)`,
      })
    }
  }

  // 2. Check road segments and endpoints
  for (const road of roads) {
    // Self-snap exclusion
    if (excludeRoadId && road.id === excludeRoadId) continue

    // Check endpoint proximity (endpoint-to-endpoint or endpoint-to-segment)
    const hit = nearestPointOnPolyline(point, road.polyline.points, origin)
    if (!hit) continue
    if (hit.distance > radiusMeters) continue

    // Determine if this is an endpoint or segment hit
    const isFirstPoint = hit.segmentIndex === 0 &&
      Math.abs(hit.point.lat - road.polyline.points[0].lat) < 0.00001 &&
      Math.abs(hit.point.lng - road.polyline.points[0].lng) < 0.00001
    const isLastPoint = hit.segmentIndex === road.polyline.points.length - 2 &&
      Math.abs(hit.point.lat - road.polyline.points[road.polyline.points.length - 1].lat) < 0.00001 &&
      Math.abs(hit.point.lng - road.polyline.points[road.polyline.points.length - 1].lng) < 0.00001

    const kind: CandidateKind = (isFirstPoint || isLastPoint) ? 'road-endpoint' : 'road-segment'
    const label = kind === 'road-endpoint'
      ? `Road endpoint: ${road.name || road.id}`
      : `Road segment: ${road.name || road.id}`

    candidates.push({
      targetRoadId: road.id,
      position: hit.point,
      distanceMeters: hit.distance,
      kind,
      label,
    })
  }

  // 3. Sort by distance (nearest first), with junction priority
  candidates.sort((a, b) => {
    // Existing junctions get a slight priority boost (0.1m)
    const aDist = a.kind === 'existing-junction' ? a.distanceMeters - 0.1 : a.distanceMeters
    const bDist = b.kind === 'existing-junction' ? b.distanceMeters - 0.1 : b.distanceMeters
    return aDist - bDist
  })

  // 4. Determine best and ambiguity
  const best = candidates[0] ?? null
  let ambiguous = false
  if (best && candidates.length > 1) {
    const second = candidates[1]
    if (Math.abs(best.distanceMeters - second.distanceMeters) < AMBIGUITY_THRESHOLD_METERS) {
      ambiguous = true
    }
  }

  // 5. Determine final position
  let position = point
  if (best && !ambiguous) {
    position = best.position
  }
  // If ambiguous, position stays at original point (admin must choose)

  return { candidates, best, ambiguous, position, bypassed: false }
}

/**
 * Legacy-compatible snap function.
 * Uses the shared connectivity service but returns the simplified SnapResult
 * format expected by roadCreateHandler.
 */
export function snapRoadEndpoints(
  points: LatLng[],
  roads: Road[],
  junctions?: RoadJunction[],
  radiusMeters = EDITOR_SNAP_RADIUS_METERS,
): { points: LatLng[]; snapped: boolean; snapCount: number } {
  if (points.length < 2 || roads.length === 0) {
    return { points, snapped: false, snapCount: 0 }
  }

  const snapped = [...points]
  let snapCount = 0

  const snapIndex = (index: number) => {
    const result = findConnectivityCandidates(snapped[index], {
      roads,
      junctions,
      radiusMeters,
    })
    if (result.best && !result.ambiguous) {
      snapped[index] = result.best.position
      snapCount++
    }
  }

  snapIndex(0)
  const last = snapped[snapped.length - 1]
  const isLoop = last.lat === points[0].lat && last.lng === points[0].lng
  if (!isLoop) {
    snapIndex(snapped.length - 1)
  }

  return { points: snapped, snapped: snapCount > 0, snapCount }
}

/**
 * Legacy-compatible single-point snap.
 */
export function snapPoint(
  p: LatLng,
  roads: Road[],
  junctions?: RoadJunction[],
  radiusMeters = EDITOR_SNAP_RADIUS_METERS,
): LatLng {
  const result = findConnectivityCandidates(p, { roads, junctions, radiusMeters })
  return result.best && !result.ambiguous ? result.best.position : p
}

// ── Crossing Operations ────────────────────────────────────────

import type { CampusDocument, SeparatedCrossing as SeparatedCrossingType } from '@navi/core'
import { genId } from '../id'

/**
 * Mark a crossing between two roads as "Keep Separate".
 * The roads may still visually cross, but routing will not connect them.
 *
 * @returns The SeparatedCrossing record, or null if the crossing already exists.
 */
export function markCrossingSeparate(
  document: CampusDocument,
  roadIdA: string,
  roadIdB: string,
  position: { lat: number; lng: number },
): SeparatedCrossingType | null {
  if (!document.separatedCrossings) document.separatedCrossings = []

  // Check if already separated (order-independent)
  const exists = document.separatedCrossings.some(sc =>
    sc.roadIds.includes(roadIdA) && sc.roadIds.includes(roadIdB)
  )
  if (exists) return null

  // Also remove any existing junction at this crossing
  if (document.roadJunctions) {
    document.roadJunctions = document.roadJunctions.filter(j =>
      !(j.roadIds.includes(roadIdA) && j.roadIds.includes(roadIdB))
    )
  }

  const record: SeparatedCrossingType = {
    id: genId('sc'),
    roadIds: [roadIdA, roadIdB],
    position,
  }
  document.separatedCrossings.push(record)
  return record
}

/**
 * Convert a separated crossing back into a connected junction.
 * Removes the separation record and creates/reuses a junction.
 *
 * @returns The RoadJunction record, or null if no separation existed.
 */
export function createJunctionAtCrossing(
  document: CampusDocument,
  roadIdA: string,
  roadIdB: string,
  position: { lat: number; lng: number },
): import('@navi/core').RoadJunction | null {
  if (!document.separatedCrossings) return null

  // Remove the separation record
  const idx = document.separatedCrossings.findIndex(sc =>
    sc.roadIds.includes(roadIdA) && sc.roadIds.includes(roadIdB)
  )
  if (idx === -1) return null
  document.separatedCrossings.splice(idx, 1)

  // Create or reuse a junction
  if (!document.roadJunctions) document.roadJunctions = []

  let junction = document.roadJunctions.find(j =>
    j.roadIds.includes(roadIdA) && j.roadIds.includes(roadIdB)
  )

  if (!junction) {
    junction = {
      id: genId('j'),
      position,
      roadIds: [roadIdA, roadIdB],
      source: 'authored',
    }
    document.roadJunctions.push(junction)
  }

  return junction
}

/**
 * Check if a crossing between two roads is separated.
 */
export function isCrossingSeparated(
  document: CampusDocument,
  roadIdA: string,
  roadIdB: string,
): boolean {
  return (document.separatedCrossings ?? []).some(sc =>
    sc.roadIds.includes(roadIdA) && sc.roadIds.includes(roadIdB)
  )
}

// ── Fix 1: Atomic connection authoring ─────────────────────────
//
// Connection discovery (0.5 m) only DETECTS intent. These helpers apply the
// admin's explicit decision at commit time:
//   Connect        → project the point onto the target + create/merge an
//                    authored RoadJunction in the same command as road.create.
//   Keep Separate  → keep the raw coordinate; persist a SeparatedCrossing
//                    only for genuine crossings.
//
// Explicit authored junction = connected. No authored junction = not
// connected. No geometric inference, no proximity merging.

export type RoadConnectionAction = 'connect' | 'separate'

/** Commit-time decision produced from a discovered ConnectivityCandidate. */
export interface RoadConnectionRequest {
  /** Index in the new/edited road polyline the decision applies to. */
  pointIndex: number
  action: RoadConnectionAction
  kind: CandidateKind
  /** Target road (for existing-junction this is the junction's owning road). */
  targetRoadId: string
  /** Present when kind === 'existing-junction'. */
  junctionId?: string
  /** Candidate position captured at decision time. */
  position: LatLng
}

/** A junction at practically the same spot on the same road is the same authority. */
const AUTHORED_JUNCTION_MATCH_METERS = 0.05

/** An SC only documents a real geometric intersection near the decision point. */
const SEPARATED_CROSSING_MATCH_METERS = 0.5

/**
 * Map a discovered candidate into a commit-time decision request.
 */
export function toRoadConnectionRequest(
  pointIndex: number,
  candidate: ConnectivityCandidate,
  action: RoadConnectionAction = 'connect',
): RoadConnectionRequest {
  return {
    pointIndex,
    action,
    kind: candidate.kind,
    targetRoadId: candidate.targetRoadId ?? '',
    ...(candidate.junctionId ? { junctionId: candidate.junctionId } : {}),
    position: { ...candidate.position },
  }
}

function findRoadById(document: CampusDocument, roadId: string): Road | undefined {
  return document.roads.find(r => r.id === roadId)
}

/**
 * Resolve the exact position on the target the endpoint must adopt.
 */
function resolveConnectionTargetPosition(
  document: CampusDocument,
  request: RoadConnectionRequest,
): LatLng | null {
  if (request.kind === 'existing-junction' && request.junctionId) {
    const junction = (document.roadJunctions ?? []).find(j => j.id === request.junctionId)
    if (junction) return { ...junction.position }
  }

  const target = findRoadById(document, request.targetRoadId)
  if (!target || target.polyline.points.length === 0) return { ...request.position }

  if (request.kind === 'road-endpoint') {
    const points = target.polyline.points
    const first = points[0]
    const last = points[points.length - 1]
    return haversine(request.position, first) <= haversine(request.position, last)
      ? { ...first }
      : { ...last }
  }

  const hit = nearestPointOnPolyline(request.position, target.polyline.points, request.position)
  return hit ? { ...hit.point } : { ...request.position }
}

/**
 * Find the authored junction authority this connection belongs to:
 * an explicit junction id, or a junction already recorded on the target road
 * at (practically) the same position. Never matches by geometry across roads.
 */
export function findAuthoredJunction(
  document: CampusDocument,
  request: RoadConnectionRequest,
): RoadJunction | undefined {
  const existing = document.roadJunctions ?? []
  if (request.junctionId) {
    const byId = existing.find(j => j.id === request.junctionId)
    if (byId) return byId
  }
  return existing.find(j =>
    j.roadIds.includes(request.targetRoadId) &&
    haversine(j.position, request.position) <= AUTHORED_JUNCTION_MATCH_METERS,
  )
}

/**
 * Apply a Connect decision for an existing road (used by road.create and the
 * legacy recovery workflow).
 *
 * - Projects `road.polyline.points[pointIndex]` exactly onto the target.
 * - Creates an authored RoadJunction or merges into an existing one.
 *
 * Returns the junction, or null when the decision could not be applied.
 */
export function applyAuthoredConnection(
  document: CampusDocument,
  roadId: string,
  request: RoadConnectionRequest,
): RoadJunction | null {
  if (request.action !== 'connect') return null
  const road = findRoadById(document, roadId)
  if (!road) return null

  const targetPosition = resolveConnectionTargetPosition(document, request)
  if (!targetPosition) return null

  if (request.pointIndex >= 0 && request.pointIndex < road.polyline.points.length) {
    road.polyline.points[request.pointIndex] = { ...targetPosition }
  }

  const matched = findAuthoredJunction(document, request)
  if (matched) {
    const merged = new Set([...matched.roadIds, roadId])
    matched.roadIds = [...merged]
    if (!matched.source) matched.source = 'authored'
    return matched
  }

  const created: RoadJunction = {
    id: genId('j'),
    position: { ...targetPosition },
    roadIds: [roadId, request.targetRoadId],
    source: 'authored',
  }
  if (!document.roadJunctions) document.roadJunctions = []
  document.roadJunctions.push(created)
  return created
}

function roadsIntersectNear(
  roadA: Road,
  roadB: Road,
  position: LatLng,
): boolean {
  const a = roadA.polyline.points
  const b = roadB.polyline.points
  for (let i = 0; i < a.length - 1; i++) {
    for (let j = 0; j < b.length - 1; j++) {
      const hit = lineSegmentIntersection(a[i], a[i + 1], b[j], b[j + 1])
      if (hit && haversine(hit, position) <= SEPARATED_CROSSING_MATCH_METERS) return true
    }
  }
  return false
}

/**
 * Apply a Keep Separate decision for an existing road.
 *
 * - Never creates a junction.
 * - Persists a SeparatedCrossing only when the two roads genuinely intersect
 *   near the decision position.
 */
export function applyKeepSeparate(
  document: CampusDocument,
  roadId: string,
  request: RoadConnectionRequest,
): import('@navi/core').SeparatedCrossing | null {
  if (request.action !== 'separate') return null
  if (request.kind !== 'road-segment') return null
  const road = findRoadById(document, roadId)
  const target = findRoadById(document, request.targetRoadId)
  if (!road || !target) return null
  if (!roadsIntersectNear(road, target, request.position)) return null

  if (!document.separatedCrossings) document.separatedCrossings = []
  const exists = document.separatedCrossings.some(
    sc => sc.roadIds.includes(roadId) && sc.roadIds.includes(request.targetRoadId),
  )
  if (exists) return null

  const record: import('@navi/core').SeparatedCrossing = {
    id: genId('sc'),
    roadIds: [roadId, request.targetRoadId],
    position: { ...request.position },
  }
  document.separatedCrossings.push(record)
  return record
}
