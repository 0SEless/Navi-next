/**
 * RelationshipSuggestionService — advisory suggestions for entity relationships.
 *
 * Given an entrance, produces ranked candidate roads for connection.
 * This is a pure capability — it does not decide *whether* to show suggestions.
 * The caller (ComponentProperties) decides based on relationship state.
 *
 * Responsibilities:
 *   discoverCandidates() — find valid candidate roads via spatial queries
 *   rankCandidates()     — sort by confidence score
 *   suggestEntranceRoad() — full pipeline: discover → rank → return
 *
 * Non-responsibilities:
 *   ✗ connecting, ✗ mutating, ✗ rendering, ✗ caching, ✗ state management
 *
 * @see 02 Engineering/relationship-system.md for architecture.
 * @see spec/SPEC.md for requirements.
 */

import type { Entrance, LatLng } from '@navi/core'
import { SpatialQueryService } from '@navi/core'
import { RelationshipService } from './RelationshipService'

// ── Types ───────────────────────────────────────────────────────────────────

export interface RelationshipSuggestion {
  readonly targetId: string
  readonly targetName: string
  readonly distanceMeters: number
  /** Advisory UI metric — not used for routing, validation, or compilation. */
  readonly confidence: number
}

interface Candidate {
  id: string
  name: string
  distanceMeters: number
}

// ── Constants ───────────────────────────────────────────────────────────────

const MAX_DISTANCE_METERS = 50

// ── RelationshipSuggestionService ────────────────────────────────────────────

export class RelationshipSuggestionService {
  constructor(
    private readonly spatial: SpatialQueryService,
    private readonly relationships: RelationshipService,
    // P1-T4 (D9): entrance positions are building-local; the spatial index works
    // in world coordinates. Optional resolver lets production wire the editor's
    // CoordinateTransformer. Dormant service today — resolver is optional so
    // direct constructions (tests) keep compiling without conversion.
    private readonly resolveWorldPosition?: (entrance: Entrance) => LatLng | null,
  ) {}

  /**
   * Suggest roads for connecting to the given entrance.
   *
   * Returns a ranked list of suggestions, sorted by confidence (highest first).
   * Empty array means no valid candidates exist.
   *
   * This method does NOT check relationship state. The caller decides
   * when to ask for suggestions based on whether the entrance is unresolved.
   */
  suggestEntranceRoad(entranceId: string): RelationshipSuggestion[] {
    const entrance = this.relationships.findEntrance(entranceId)
    if (!entrance) return []

    const candidates = this.discoverCandidates(entrance)
    return this.rankCandidates(candidates)
  }

  // ── Phase 1: Candidate Discovery ───────────────────────────────────────────

  /**
   * Find all valid candidate roads for the given entrance.
   *
   * Uses spatial queries to find nearby roads, then filters out
   * roads that already have an entrance connected.
   */
  private discoverCandidates(entrance: Entrance): Candidate[] {
    if (!entrance.position) return []

    // P1-T4 (D9): resolve the entrance to world coordinates when a resolver is
    // wired; otherwise fall back to the raw position (pre-migration world docs
    // and direct test constructions).
    const world = this.resolveWorldPosition
      ? this.resolveWorldPosition(entrance)
      : (entrance.position as unknown as LatLng)

    // Find nearest road via spatial index
    const result = this.spatial.nearestRoad(world, {
      maxDistance: MAX_DISTANCE_METERS,
    })

    if (!result) return []

    // Filter: exclude roads with connectorEntranceId already set
    const road = this.relationships.findRoad(result.entity.id)
    if (!road) return []
    if (road.connectorEntranceId && road.connectorEntranceId !== entrance.id) {
      return []
    }

    return [{
      id: road.id,
      name: road.name ?? road.id,
      distanceMeters: result.distance,
    }]
  }

  // ── Phase 2: Candidate Ranking ─────────────────────────────────────────────

  /**
   * Rank candidates by confidence score.
   *
   * Confidence is a presentation value — an advisory UI metric.
   * It is not used for routing, validation, or compilation.
   *
   * Formula: confidence = max(0, 1 - distanceMeters / MAX_DISTANCE_METERS)
   */
  private rankCandidates(candidates: Candidate[]): RelationshipSuggestion[] {
    return candidates
      .map(c => ({
        targetId: c.id,
        targetName: c.name,
        distanceMeters: c.distanceMeters,
        confidence: this.computeConfidence(c.distanceMeters),
      }))
      .sort((a, b) => b.confidence - a.confidence)
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /**
   * Compute confidence score from distance.
   * Advisory UI metric only — not used for business logic.
   */
  private computeConfidence(distanceMeters: number): number {
    return Math.max(0, 1 - distanceMeters / MAX_DISTANCE_METERS)
  }
}
