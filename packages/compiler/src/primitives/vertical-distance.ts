import { ROUTE_NETWORK_THRESHOLDS } from '@navi/core'

/**
 * P1-T17 (group-16 item 9 / R8.4): vertical edge distance semantics —
 * THE single implementation, consumed by BOTH compile paths
 * (compileV2 primitives connector + legacy stage-pipeline buildEdges).
 * Risk R7: the rule must live in exactly one place; call sites delegate.
 *
 * Chosen semantics:
 *   1. AUTHORED delta where known — if both connected floors have finite
 *      elevations and the destination is strictly above the origin, the
 *      distance is `toElevation − fromElevation` (elevations are authored
 *      per-floor data derived from floor heights).
 *   2. Documented fallback otherwise — when either elevation is missing,
 *      non-finite, or the delta is not a positive climb (equal/inverted =
 *      corrupt or flat data), the distance is
 *      ROUTE_NETWORK_THRESHOLDS.verticalEdgeFallbackMeters (4 m). A fallback
 *      keeps the edge valid for routing (the edge-integrity validator rejects
 *      zero/negative distances) instead of dropping connectivity.
 *
 * Multi-floor gaps (F0 → F2 with F1 absent) use the full elevation delta of
 * the two CONNECTED floors — the climb the edge represents.
 */
export function verticalEdgeDistance(
  fromElevation: number | undefined,
  toElevation: number | undefined,
): number {
  if (
    fromElevation !== undefined &&
    toElevation !== undefined &&
    Number.isFinite(fromElevation) &&
    Number.isFinite(toElevation) &&
    toElevation > fromElevation
  ) {
    return toElevation - fromElevation
  }
  return ROUTE_NETWORK_THRESHOLDS.verticalEdgeFallbackMeters
}

/**
 * Key format shared by every elevation lookup passed to vertical-edge
 * construction (`${buildingId}:${level}`). Coordinator (compileV2) and
 * parse-stage (legacy pipeline) both build maps with this key so the helper's
 * consumers stay consistent.
 */
export function elevationKey(buildingId: string, level: number): string {
  return `${buildingId}:${level}`
}
