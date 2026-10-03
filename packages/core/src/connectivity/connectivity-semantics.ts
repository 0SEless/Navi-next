/**
 * Canonical Connectivity Semantics Contract (v1)
 *
 * This module defines the single source of truth for authored road connectivity
 * intent in NAVI. It derives deterministic semantics from CampusDocument without
 * mutating the authored source.
 *
 * ## Architectural Rule
 *
 *   GEOMETRY answers: "Where are the roads?"
 *   SEMANTICS answer:  "Are these roads connected?"
 *
 * A geometric crossing alone is NOT sufficient evidence of connectivity when an
 * explicit authored semantic decision exists.
 *
 * ## Source of Truth
 *
 * CampusDocument is the authored source of truth. This module produces a
 * normalized, deterministic projection of that intent. GraphAdapter, Compiler V2,
 * and any future graph producer must consume these semantics rather than
 * independently reconstructing connectivity from raw geometry.
 *
 * ## Precedence
 *
 *   1. SeparatedCrossing(A, B) → DO NOT CONNECT
 *   2. RoadJunction(A, B, ...) → CONNECT at authored junction
 *   3. Geometric crossing with no explicit semantic → legacy inference
 *
 * When both RoadJunction and SeparatedCrossing exist for the same road pair,
 * SeparatedCrossing wins (mutual exclusivity enforced during normalization).
 *
 * ## Version History
 *
 *   v1 (2026-09-05) — Initial contract. Normalizes RoadJunction and
 *   SeparatedCrossing from CampusDocument. Defines identity rules,
 *   participation rules, and deterministic materialization boundary.
 */

import type { CampusDocument, RoadJunction, SeparatedCrossing } from '../types/document'
import { haversine } from '../coordinates/crs'
import { ROUTE_NETWORK_THRESHOLDS } from '../route-network/definitions'

// ── Contract Types ──────────────────────────────────────────────

/** Contract version identifier. */
export const CONNECTIVITY_CONTRACT_VERSION = '1.0.0' as const

/**
 * A canonical junction — the normalized, deterministic representation of
 * "these roads are connected at this point."
 */
export interface CanonicalJunction {
  /** Stable semantic ID. Never regenerated. Never merged by proximity. */
  id: string
  /** Authored geographic position (world coordinates). */
  position: { lat: number; lng: number }
  /** Participating road IDs. Length >= 2 after normalization. */
  roadIds: string[]
  /** Provenance: 'authored' (explicit) or 'legacy-inferred' (geometric). */
  source: 'authored' | 'legacy-inferred'
}

/**
 * A canonical separated crossing — the normalized, deterministic representation
 * of "these roads cross but MUST NOT be connected."
 */
export interface CanonicalSeparatedCrossing {
  /** Stable semantic ID. Never regenerated. */
  id: string
  /** Geographic position of the crossing. */
  position: { lat: number; lng: number }
  /** The two road IDs that must not be connected (order-independent). */
  roadIds: [string, string]
}

/**
 * The complete canonical connectivity semantics for a CampusDocument.
 * Deterministic: same input → same output, regardless of road array order.
 */
export interface ConnectivitySemantics {
  /** Contract version. */
  version: typeof CONNECTIVITY_CONTRACT_VERSION
  /** Campus ID this semantics was derived from. */
  campusId: string
  /** Normalized junctions. All participating roads exist in the document. */
  junctions: CanonicalJunction[]
  /** Normalized separated crossings. All participating roads exist. */
  separatedCrossings: CanonicalSeparatedCrossing[]
}

/** The repository-wide tolerance for treating two connectivity positions as equal. */
export const CONNECTIVITY_POSITION_TOLERANCE_METERS = ROUTE_NETWORK_THRESHOLDS.dedupeMergeMeters

/** The position/road shape required by the shared separation predicate. */
export interface SeparatedCrossingLike {
  position: { lat: number; lng: number }
  roadIds: readonly [string, string]
}

// ── Normalization ───────────────────────────────────────────────

/**
 * Extract canonical connectivity semantics from a CampusDocument.
 *
 * This is a PURE function — it never mutates the input document.
 * It produces a deterministic result regardless of:
 *   - road array order
 *   - junction array order
 *   - crossing array order
 *
 * Normalization rules:
 *   1. Only junctions with >= 2 valid (existing) road IDs are included.
 *   2. Duplicate road IDs within a junction are deduplicated.
 *   3. References to non-existent roads are removed.
 *   4. Junctions that fall below 2 valid roads after cleanup are excluded.
 *   5. SeparatedCrossing wins over RoadJunction for the same road pair.
 *   6. Stable IDs are preserved — never regenerated or merged by proximity.
 *   7. Input order does not affect output.
 */
export function extractConnectivitySemantics(document: CampusDocument): ConnectivitySemantics {
  const campusId = document.metadata.campusId
  const existingRoadIds = new Set(document.roads.map(r => r.id))

  // Step 1: Normalize separated crossings (they take precedence)
  const separatedCrossings = normalizeSeparatedCrossings(
    document.separatedCrossings ?? [],
    existingRoadIds,
  )

  // Step 2: Normalize junctions
  const junctions = normalizeJunctions(
    document.roadJunctions ?? [],
    existingRoadIds,
    separatedCrossings,
  )

  return {
    version: CONNECTIVITY_CONTRACT_VERSION,
    campusId,
    junctions,
    separatedCrossings,
  }
}

// ── Internal Normalization Helpers ──────────────────────────────

/**
 * Normalize a list of RoadJunctions into canonical junctions.
 *
 * Rules:
 *   - Junctions with < 2 valid road IDs after cleanup are excluded.
 *   - Duplicate road IDs are deduplicated.
 *   - References to non-existent roads are removed.
 *   - Junctions that conflict with a SeparatedCrossing are excluded.
 *   - Stable IDs are preserved.
 *   - Source defaults to 'legacy-inferred' if not specified.
 */
function normalizeJunctions(
  junctions: RoadJunction[],
  existingRoadIds: Set<string>,
  separatedCrossings: CanonicalSeparatedCrossing[],
): CanonicalJunction[] {
  const result: CanonicalJunction[] = []

  for (const j of junctions) {
    // Deduplicate road IDs and filter to existing roads only
    const validRoadIds = dedupeStrings(
      j.roadIds.filter(id => existingRoadIds.has(id)),
    )

    // Must have at least 2 valid participating roads
    if (validRoadIds.length < 2) continue

    // Separation is position-specific: a separated pair at P1 must not suppress
    // a junction for the same pair at P2.
    let hasSeparatedPairAtPosition = false
    for (let i = 0; i < validRoadIds.length && !hasSeparatedPairAtPosition; i++) {
      for (let k = i + 1; k < validRoadIds.length && !hasSeparatedPairAtPosition; k++) {
        if (hasSeparatedCrossingAtPosition(
          separatedCrossings,
          validRoadIds[i],
          validRoadIds[k],
          j.position,
        )) {
          hasSeparatedPairAtPosition = true
        }
      }
    }
    if (hasSeparatedPairAtPosition) {
      continue
    }

    result.push({
      id: j.id,
      position: { lat: j.position.lat, lng: j.position.lng },
      roadIds: validRoadIds,
      source: j.source ?? 'legacy-inferred',
    })
  }

  // Deterministic output: sort by ID for stable ordering
  result.sort((a, b) => a.id.localeCompare(b.id))
  return result
}

/**
 * Normalize a list of SeparatedCrossings into canonical separated crossings.
 *
 * Rules:
 *   - Both road IDs must exist in the document.
 *   - Stable IDs are preserved.
 *   - Duplicate records with the same stable ID are deduplicated (first wins).
 *   - Multiple positions for the same road pair are preserved.
 */
function normalizeSeparatedCrossings(
  crossings: SeparatedCrossing[],
  existingRoadIds: Set<string>,
): CanonicalSeparatedCrossing[] {
  const seen = new Set<string>()
  const result: CanonicalSeparatedCrossing[] = []

  for (const sc of crossings) {
    // Both roads must exist
    if (!existingRoadIds.has(sc.roadIds[0]) || !existingRoadIds.has(sc.roadIds[1])) continue

    // Stable IDs identify records. Do not deduplicate by road pair: one pair
    // may legitimately cross at P1 and P2 with different authored decisions.
    if (seen.has(sc.id)) continue
    seen.add(sc.id)

    result.push({
      id: sc.id,
      position: { lat: sc.position.lat, lng: sc.position.lng },
      roadIds: [sc.roadIds[0], sc.roadIds[1]],
    })
  }

  // Deterministic output: sort by ID for stable ordering
  result.sort((a, b) => a.id.localeCompare(b.id))
  return result
}

// ── Utility Functions ───────────────────────────────────────────

/**
 * Deduplicate an array of strings, preserving first-occurrence order.
 */
function dedupeStrings(arr: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const s of arr) {
    if (!seen.has(s)) {
      seen.add(s)
      result.push(s)
    }
  }
  return result
}

// ── Query Helpers ───────────────────────────────────────────────

/**
 * Check if two roads are connected through any canonical junction.
 */
export function areRoadsConnected(
  semantics: ConnectivitySemantics,
  roadIdA: string,
  roadIdB: string,
): boolean {
  for (const j of semantics.junctions) {
    if (j.roadIds.includes(roadIdA) && j.roadIds.includes(roadIdB)) {
      return true
    }
  }
  return false
}

/**
 * Check if two roads are explicitly separated.
 */
export function areRoadsSeparated(
  semantics: ConnectivitySemantics,
  roadIdA: string,
  roadIdB: string,
): boolean {
  return semantics.separatedCrossings.some(sc =>
    (sc.roadIds[0] === roadIdA && sc.roadIds[1] === roadIdB) ||
    (sc.roadIds[0] === roadIdB && sc.roadIds[1] === roadIdA),
  )
}

/**
 * Check whether a specific road pair is separated at a specific position.
 * Road order is symmetric; position comparison uses the shared route-network
 * tolerance rather than degree-space component thresholds.
 */
export function hasSeparatedCrossingAtPosition(
  crossings: readonly SeparatedCrossingLike[],
  roadIdA: string,
  roadIdB: string,
  position: { lat: number; lng: number },
  toleranceMeters = CONNECTIVITY_POSITION_TOLERANCE_METERS,
): boolean {
  return crossings.some(sc =>
    ((sc.roadIds[0] === roadIdA && sc.roadIds[1] === roadIdB) ||
      (sc.roadIds[0] === roadIdB && sc.roadIds[1] === roadIdA)) &&
    haversine(sc.position, position) <= toleranceMeters,
  )
}

/**
 * Get all junctions that a specific road participates in.
 */
export function junctionsForRoad(
  semantics: ConnectivitySemantics,
  roadId: string,
): CanonicalJunction[] {
  return semantics.junctions.filter(j => j.roadIds.includes(roadId))
}
