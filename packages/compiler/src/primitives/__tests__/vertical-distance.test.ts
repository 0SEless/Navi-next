import { describe, it, expect } from 'vitest'
import { verticalEdgeDistance } from '../vertical-distance'
import { ROUTE_NETWORK_THRESHOLDS } from '@navi/core'

// P1-T17 (group-16 item 9 / R8.4): vertical edge distance semantics.
//
// CHOSEN SEMANTICS (single source — risk R7): a derived vertical edge's
// distance is the AUTHORED floor-elevation delta between the two connected
// floors where both elevations are known and the delta is positive;
// otherwise the documented fallback constant
// ROUTE_NETWORK_THRESHOLDS.verticalEdgeFallbackMeters applies.
// Both compile paths (legacy stage pipeline + compileV2 primitives) call
// this one helper — no hardcoded 3/4 m literals remain at call sites.

describe('P1-T17: verticalEdgeDistance semantics', () => {
  it('uses the authored elevation delta when both floors are known', () => {
    expect(verticalEdgeDistance(0, 4)).toBe(4)
    expect(verticalEdgeDistance(0, 3.5)).toBe(3.5)
    // Multi-floor gap: F0 → F2 climbs the full elevation difference
    expect(verticalEdgeDistance(0, 7)).toBe(7)
    expect(verticalEdgeDistance(4, 11.5)).toBeCloseTo(7.5, 10)
  })

  it('falls back to the documented constant when an elevation is missing', () => {
    expect(verticalEdgeDistance(undefined, 4)).toBe(ROUTE_NETWORK_THRESHOLDS.verticalEdgeFallbackMeters)
    expect(verticalEdgeDistance(0, undefined)).toBe(ROUTE_NETWORK_THRESHOLDS.verticalEdgeFallbackMeters)
    expect(verticalEdgeDistance(undefined, undefined)).toBe(ROUTE_NETWORK_THRESHOLDS.verticalEdgeFallbackMeters)
  })

  it('falls back for non-finite elevations (NaN/Infinity)', () => {
    expect(verticalEdgeDistance(Number.NaN, 4)).toBe(ROUTE_NETWORK_THRESHOLDS.verticalEdgeFallbackMeters)
    expect(verticalEdgeDistance(0, Number.NaN)).toBe(ROUTE_NETWORK_THRESHOLDS.verticalEdgeFallbackMeters)
    expect(verticalEdgeDistance(Number.POSITIVE_INFINITY, 4)).toBe(ROUTE_NETWORK_THRESHOLDS.verticalEdgeFallbackMeters)
  })

  it('falls back for degenerate deltas (zero or inverted)', () => {
    // Same elevation → not a climb; inverted → corrupt data. Both fall back
    // rather than emitting a zero/negative distance (edge-integrity validator
    // rejects negative distances).
    expect(verticalEdgeDistance(4, 4)).toBe(ROUTE_NETWORK_THRESHOLDS.verticalEdgeFallbackMeters)
    expect(verticalEdgeDistance(4, 0)).toBe(ROUTE_NETWORK_THRESHOLDS.verticalEdgeFallbackMeters)
  })

  it('the fallback resolves to the single definitions module value (4 m)', () => {
    expect(ROUTE_NETWORK_THRESHOLDS.verticalEdgeFallbackMeters).toBe(4)
    expect(verticalEdgeDistance(undefined, undefined)).toBe(ROUTE_NETWORK_THRESHOLDS.verticalEdgeFallbackMeters)
  })
})
