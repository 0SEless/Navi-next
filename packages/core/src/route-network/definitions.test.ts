import { describe, it, expect } from 'vitest'
import { ROUTE_NETWORK_THRESHOLDS } from './definitions'

// P1-T8 (R8.3): the route-network thresholds are centralized here as
// configurable constants — risk R7 (magic thresholds encoded twice with
// divergent defaults) is a defect. Editor and compiler must import from this
// single module; never re-declare the literals. P1-T17 added the sixth
// constant: the derived vertical-edge fallback distance.

describe('ROUTE_NETWORK_THRESHOLDS (R8.3)', () => {
  it('centralizes all thresholds as configurable constants', () => {
    expect(ROUTE_NETWORK_THRESHOLDS).toEqual({
      snapRadiusMeters: 0.5,        // connection discovery radius (intent check only)
      dedupeMergeMeters: 0.5,       // connectivity normalizer merge threshold
      entranceRoadLinkMeters: 200,  // max entrance→road link distance
      compilerFallbackMeters: 50,   // compiler fallback (maxEntranceRoadDistance default, room-link cutoff)
      nodeIntervalMeters: 10,       // compiler node spacing along hallways/roads
      verticalEdgeFallbackMeters: 4, // P1-T17: vertical-edge fallback when no authored elevation delta
    })
  })

  it('is immutable (frozen)', () => {
    expect(Object.isFrozen(ROUTE_NETWORK_THRESHOLDS)).toBe(true)
  })
})