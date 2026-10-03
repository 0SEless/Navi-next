/**
 * P1-T8 (R8.3): centralized, configurable route-network thresholds.
 *
 * The five thresholds are OWNED by the route network and must never be
 * re-declared as literals elsewhere (risk R7 — magic thresholds encoded
 * twice with divergent defaults is a defect). Editor and compiler paths
 * import these values; changing a threshold here changes behavior in both.
 */
export const ROUTE_NETWORK_THRESHOLDS: Readonly<{
  snapRadiusMeters: 0.5
  dedupeMergeMeters: 0.5
  entranceRoadLinkMeters: 200
  compilerFallbackMeters: 50
  nodeIntervalMeters: 10
  verticalEdgeFallbackMeters: 4
}> = Object.freeze({
  /**
   * 0.5 m — connection discovery radius for authoring. This is an INTENT
   * check only: being within the radius never mutates geometry and never
   * creates topology by itself. The admin must confirm Connect / Keep
   * Separate. (Was 2 m; reduced so roads no longer magnetically snap from
   * far away.)
   */
  snapRadiusMeters: 0.5,
  /** 0.5 m — connectivity normalizer dedupe/merge threshold. */
  dedupeMergeMeters: 0.5,
  /** 200 m — max entrance→road/corridor link distance (artifact generator). */
  entranceRoadLinkMeters: 200,
  /** 50 m — compiler fallback (maxEntranceRoadDistance default; same-floor room-link cutoff). */
  compilerFallbackMeters: 50,
  /** 10 m — compiler node spacing interval along hallways/roads. */
  nodeIntervalMeters: 10,
  /**
   * P1-T17 (group-16 item 9): 4 m — fallback distance for DERIVED vertical
   * (stairs/elevator) edges when the authored floor-elevation delta is not
   * resolvable (a connected floor is absent from the document, or its
   * elevation is missing/non-finite/non-increasing). When elevations ARE
   * known, the authored delta is used instead (see the compiler's
   * verticalEdgeDistance helper — the single implementation of this rule).
   */
  verticalEdgeFallbackMeters: 4,
})

export type RouteNetworkThresholds = typeof ROUTE_NETWORK_THRESHOLDS