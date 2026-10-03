import type { Point2D } from '../canvas/viewport'
import type { DerivedRoom } from './room-derivation'

/**
 * W6A: Stable Face Identity / Lineage
 *
 * DerivedRoomGeometry ≠ Semantic Room. FaceIdentity establishes the identity
 * layer that W6B will attach metadata to. Each face gets a stable ID that
 * survives geometry changes (wall moves, splits, merges).
 */

export interface FaceIdentity {
  /** Stable ID that survives geometry changes */
  faceId: string
  /** Lineage — which faces merged to create this one */
  sourceFaceIds: string[]
  /** Floor this face was last derived on */
  lastSeenFloor: number
  /** Centroid at last derivation */
  centroid: Point2D
  /** Polygon at last derivation (for overlap calc) */
  polygon: Point2D[]
}

export interface IdentityMatchResult {
  /** The assigned identity for each derived room */
  identities: FaceIdentity[]
  /** Whether any match was ambiguous (overlap with multiple candidates) */
  ambiguous: boolean
  /** Room indices that were flagged as ambiguous */
  ambiguousIndices: number[]
}

const DEFAULT_OVERLAP_THRESHOLD = 0.7

/**
 * Canonicalize a face boundary cycle without using its coordinates.
 *
 * The derivation graph can start a cycle at any edge and can traverse it in
 * either direction depending on authored wall direction. Rotating and
 * reversing the source-wall cycle makes the topology key independent of those
 * incidental choices while still retaining repeated segments from the same
 * authored wall.
 */
export function stableFaceTopologyKey(boundaryWallIds: readonly string[]): string {
  if (boundaryWallIds.length === 0) return 'walls:'

  const values = boundaryWallIds.map((id) => id || 'unknown-wall')
  const rotations: string[] = []
  const reversed = [...values].reverse()
  for (const cycle of [values, reversed]) {
    for (let start = 0; start < cycle.length; start++) {
      rotations.push([...cycle.slice(start), ...cycle.slice(0, start)].join('|'))
    }
  }
  return `walls:${rotations.sort()[0]}`
}

/**
 * Produce a deterministic face identity from authored wall topology.
 * Coordinates are deliberately excluded so wall movement and a document
 * reload do not detach semantic RoomAttributes from the same face.
 */
export function stableFaceIdFromTopology(boundaryWallIds: readonly string[]): string {
  const key = stableFaceTopologyKey(boundaryWallIds)
  let hash = 2166136261
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return `face-${(hash >>> 0).toString(36)}`
}

function computeCentroid(polygon: Point2D[]): Point2D {
  if (polygon.length === 0) return { x: 0, y: 0 }
  let cx = 0
  let cy = 0
  for (const p of polygon) {
    cx += p.x
    cy += p.y
  }
  const n = polygon.length
  return { x: cx / n, y: cy / n }
}

/**
 * Compute the area of a polygon using the Shoelace formula.
 */
function computePolygonArea(polygon: Point2D[]): number {
  const n = polygon.length
  if (n < 3) return 0
  let area = 0
  for (let i = 0; i < n - 1; i++) {
    area += polygon[i].x * polygon[i + 1].y
    area -= polygon[i + 1].x * polygon[i].y
  }
  return Math.abs(area / 2)
}

/**
 * Check if a point is inside a polygon using ray casting.
 */
function pointInPolygon(point: Point2D, polygon: Point2D[]): boolean {
  const n = polygon.length
  if (n < 3) return false
  let inside = false
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x
    const yi = polygon[i].y
    const xj = polygon[j].x
    const yj = polygon[j].y
    if (
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi
    ) {
      inside = !inside
    }
  }
  return inside
}

/**
 * Compute the overlap area between two polygons using Monte Carlo sampling.
 * Returns a value in [0, 1] representing the fraction of the smaller polygon
 * that overlaps with the larger one.
 */
function computeOverlap(a: Point2D[], b: Point2D[]): number {
  const areaA = computePolygonArea(a)
  const areaB = computePolygonArea(b)
  if (areaA < 1e-10 || areaB < 1e-10) return 0

  const bboxA = getBBox(a)
  const bboxB = getBBox(b)

  const minX = Math.min(bboxA.minX, bboxB.minX)
  const maxX = Math.max(bboxA.maxX, bboxB.maxX)
  const minY = Math.min(bboxA.minY, bboxB.minY)
  const maxY = Math.max(bboxA.maxY, bboxB.maxY)

  const rangeX = maxX - minX
  const rangeY = maxY - minY
  if (rangeX < 1e-10 || rangeY < 1e-10) return 0

  const SAMPLES = 500
  let countInBoth = 0

  for (let i = 0; i < SAMPLES; i++) {
    const px = minX + Math.random() * rangeX
    const py = minY + Math.random() * rangeY
    const pt = { x: px, y: py }

    if (pointInPolygon(pt, a) && pointInPolygon(pt, b)) {
      countInBoth++
    }
  }

  const intersectionArea = (countInBoth / SAMPLES) * rangeX * rangeY
  const smallerArea = Math.min(areaA, areaB)
  return intersectionArea / smallerArea
}

function getBBox(polygon: Point2D[]) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of polygon) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return { minX, minY, maxX, maxY }
}

/**
 * Face identity tracker.
 *
 * Maintains a registry of known face identities and matches new derived rooms
 * to existing identities by spatial overlap.
 */
export class FaceIdentityTracker {
  private identities: FaceIdentity[] = []
  private nextId = 0
  private readonly overlapThreshold: number

  constructor(overlapThreshold = DEFAULT_OVERLAP_THRESHOLD) {
    this.overlapThreshold = overlapThreshold
  }

  /**
   * Generate a new unique face ID.
   */
  private newFaceId(): string {
    return `face-${this.nextId++}`
  }

  /**
   * Get all known identities (for inspection).
   */
  getIdentities(): readonly FaceIdentity[] {
    return this.identities
  }

  /**
   * Reset the tracker (clear all identities).
   */
  reset(): void {
    this.identities = []
    this.nextId = 0
  }

  /**
   * Match new derived rooms to existing identities.
   *
   * For each new room:
   *   - Compute overlap with all existing identities
   *   - If overlap > threshold with exactly one → preserve identity
   *   - If overlap > threshold with multiple → ambiguous (flag it)
   *   - If overlap < threshold with all → create new identity
   */
  matchIdentities(
    rooms: DerivedRoom[],
    floor: number,
  ): IdentityMatchResult {
    const result: IdentityMatchResult = {
      identities: [],
      ambiguous: false,
      ambiguousIndices: [],
    }

    const matchedIdentityIds = new Set<string>()

    for (let i = 0; i < rooms.length; i++) {
      const room = rooms[i]
      const roomPolygon = room.polygon.points.map((p) => ({ x: p.x, y: p.y }))
      const roomCentroid = computeCentroid(roomPolygon)

      // Find all identities with overlap > threshold
      const candidates: { identity: FaceIdentity; overlap: number }[] = []

      for (const identity of this.identities) {
        const overlap = computeOverlap(roomPolygon, identity.polygon)
        if (overlap > this.overlapThreshold) {
          candidates.push({ identity, overlap })
        }
      }

      if (candidates.length === 1) {
        // Exact match — preserve identity
        const identity = candidates[0].identity
        matchedIdentityIds.add(identity.faceId)
        const updated: FaceIdentity = {
          ...identity,
          lastSeenFloor: floor,
          centroid: roomCentroid,
          polygon: roomPolygon,
        }
        result.identities.push(updated)
        // Update the registry immediately so subsequent rooms see the new polygon
        const idx = this.identities.findIndex((id) => id.faceId === identity.faceId)
        if (idx >= 0) this.identities[idx] = updated
      } else if (candidates.length > 1) {
        // Ambiguous — multiple overlaps
        result.ambiguous = true
        result.ambiguousIndices.push(i)

        // Pick the best match (highest overlap) but flag ambiguity
        candidates.sort((a, b) => b.overlap - a.overlap)
        const best = candidates[0]
        matchedIdentityIds.add(best.identity.faceId)

        const sourceFaceIds = candidates.map((c) => c.identity.faceId)
        const newIdentity: FaceIdentity = {
          faceId: this.newFaceId(),
          sourceFaceIds,
          lastSeenFloor: floor,
          centroid: roomCentroid,
          polygon: roomPolygon,
        }
        result.identities.push(newIdentity)
        // Remove consumed identities from registry and add the new merged one
        for (const c of candidates) {
          const idx = this.identities.findIndex((id) => id.faceId === c.identity.faceId)
          if (idx >= 0) this.identities.splice(idx, 1)
        }
        this.identities.push(newIdentity)
      } else {
        // No match — new identity
        const newIdentity: FaceIdentity = {
          faceId: this.newFaceId(),
          sourceFaceIds: [],
          lastSeenFloor: floor,
          centroid: roomCentroid,
          polygon: roomPolygon,
        }
        result.identities.push(newIdentity)
        this.identities.push(newIdentity)
      }
    }

    // Final registry sync (incremental updates should already be correct)
    this.identities = result.identities

    return result
  }
}

/**
 * Convenience: match identities for a single derivation cycle.
 * Creates a tracker, matches, and returns the result.
 */
export function matchDerivedRoomIdentities(
  rooms: DerivedRoom[],
  floor: number,
  previousIdentities?: readonly FaceIdentity[],
  overlapThreshold = DEFAULT_OVERLAP_THRESHOLD,
): IdentityMatchResult {
  const tracker = new FaceIdentityTracker(overlapThreshold)
  if (previousIdentities) {
    for (const id of previousIdentities) {
      tracker['identities'].push(id)
    }
  }
  return tracker.matchIdentities(rooms, floor)
}
