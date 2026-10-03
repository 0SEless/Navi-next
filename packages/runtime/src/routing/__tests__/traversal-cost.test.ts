import type { NavEdge, NavigationGraph, RoadRouting } from '@navi/core'
import { describe, expect, it } from 'vitest'
import {
  STANDARD_TERRAIN_PROFILE_V1,
  buildRoadTerrainContext,
  calculateTraversalCost,
  type TerrainCostProfile,
} from '../index'

function roadEdge(
  id: string,
  distance: number,
  authored: RoadRouting,
  sourceRoadId = 'road-1',
  from = 'a',
  to = 'b',
): NavEdge {
  return {
    id,
    from,
    to,
    type: authored.feature === 'stairs' ? 'stairs' : 'walk',
    distance,
    weight: distance,
    routing: {
      sourceRoadId,
      authoredOrientation: 'forward',
      authored,
    },
  }
}

function graph(edges: NavEdge[]): Pick<NavigationGraph, 'edges'> {
  return { edges }
}

function cost(
  edge: NavEdge,
  traversalFromNodeId = edge.from,
  edges = [edge],
  profile: TerrainCostProfile = STANDARD_TERRAIN_PROFILE_V1,
): number {
  return calculateTraversalCost(
    edge,
    traversalFromNodeId,
    profile,
    buildRoadTerrainContext(graph(edges)),
  )
}

describe('STANDARD_TERRAIN_PROFILE_V1', () => {
  it('locks the approved MEDIUM terrain coefficients', () => {
    expect(STANDARD_TERRAIN_PROFILE_V1).toEqual({
      version: 'STANDARD_TERRAIN_PROFILE_V1',
      manualSlopePenalty: {
        level: 0,
        gentle: 0.04,
        moderate: 0.1,
        steep: 0.2,
      },
      featurePenalty: {
        normal: 0,
        stairs: 0.2,
        ramp: 0,
        bridge: 0,
      },
      uphillGradePenaltyRate: 1.5,
      uphillGradePenaltyCap: 0.3,
      downhillGradePenaltyRate: 0.5,
      downhillGradePenaltyCap: 0.1,
      manualDownhillScale: 0.35,
    })
  })
})

describe('buildRoadTerrainContext', () => {
  it('sums all compiled segments once for each source Road', () => {
    const edges = [
      roadEdge('r-1:0', 25, { startElevationMeters: 20, endElevationMeters: 30 }),
      roadEdge('r-1:1', 75, { startElevationMeters: 20, endElevationMeters: 30 }),
      roadEdge('r-2:0', 40, { feature: 'normal' }, 'road-2'),
    ]

    const context = buildRoadTerrainContext(graph(edges))

    expect(context.totalRoadLengthBySourceRoadId.get('road-1')).toBe(100)
    expect(context.totalRoadLengthBySourceRoadId.get('road-2')).toBe(40)
  })

  it('rejects duplicate compiled Road edge IDs instead of double-counting', () => {
    const edge = roadEdge('duplicate', 50, { feature: 'normal' })
    expect(() => buildRoadTerrainContext(graph([edge, { ...edge }]))).toThrow(
      /duplicate Road edge id/i,
    )
  })

  it('rejects inconsistent Road-level authored metadata across segments', () => {
    const edges = [
      roadEdge('r-1:0', 50, { slope: 'gentle' }),
      roadEdge('r-1:1', 50, { slope: 'steep' }),
    ]
    expect(() => buildRoadTerrainContext(graph(edges))).toThrow(
      /inconsistent authored routing metadata/i,
    )
  })

  it('rejects invalid Road segment distances', () => {
    expect(() =>
      buildRoadTerrainContext(graph([roadEdge('bad', Number.NaN, { feature: 'normal' })])),
    ).toThrow(/finite non-negative distance/i)
  })

  it('ignores invalid persisted routing and exposes no mutable map API', () => {
    const invalid = roadEdge('invalid-routing', 25, {})
    invalid.routing = {
      sourceRoadId: 'road-1',
      authoredOrientation: 'forward',
      authored: {},
    }

    const context = buildRoadTerrainContext(graph([invalid]))

    expect(context.totalRoadLengthBySourceRoadId.size).toBe(0)
    expect('set' in context.totalRoadLengthBySourceRoadId).toBe(false)
  })
})

describe('calculateTraversalCost', () => {
  it('preserves legacy and non-Road edge weight exactly', () => {
    const legacy: NavEdge = {
      id: 'legacy',
      from: 'a',
      to: 'b',
      type: 'walk',
      distance: 100,
      weight: 137,
    }
    expect(cost(legacy)).toBe(137)
  })

  it('uses exact legacy weight for malformed or empty Road routing wrappers', () => {
    const invalid = roadEdge('invalid-routing', 10, {})
    invalid.weight = 17

    expect(cost(invalid)).toBe(17)
  })

  it('uses zero derived slope when a complete elevation pair has no positive Road length', () => {
    const zeroLength = roadEdge('zero-length', 0, {
      startElevationMeters: 0,
      endElevationMeters: 10,
    })

    expect(cost(zeroLength)).toBe(0)
  })

  it.each([
    ['level', 100],
    ['gentle', 104],
    ['moderate', 110],
    ['steep', 120],
  ] as const)('applies the %s manual slope penalty', (slope, expected) => {
    expect(cost(roadEdge(`manual-${slope}`, 100, { slope }))).toBeCloseTo(expected, 10)
  })

  it('uses the maximum, not the sum, when stairs and slope compose', () => {
    expect(cost(roadEdge('stairs-level', 100, { feature: 'stairs', slope: 'level' }))).toBe(120)
    expect(cost(roadEdge('stairs-steep', 100, { feature: 'stairs', slope: 'steep' }))).toBe(120)
  })

  it('keeps ramp and bridge feature penalties neutral', () => {
    expect(cost(roadEdge('ramp', 100, { feature: 'ramp' }))).toBe(100)
    expect(cost(roadEdge('bridge', 100, { feature: 'bridge' }))).toBe(100)
  })

  it('derives uphill and downhill grade from total Road length', () => {
    const edges = [
      roadEdge('r-1:0', 25, { startElevationMeters: 20, endElevationMeters: 30 }, 'road-1', 'a', 'm'),
      roadEdge('r-1:1', 75, { startElevationMeters: 20, endElevationMeters: 30 }, 'road-1', 'm', 'b'),
    ]
    const context = buildRoadTerrainContext(graph(edges))

    const uphill = edges.reduce(
      (sum, edge) => sum + calculateTraversalCost(edge, edge.from, STANDARD_TERRAIN_PROFILE_V1, context),
      0,
    )
    const downhill = [...edges].reverse().reduce(
      (sum, edge) => sum + calculateTraversalCost(edge, edge.to, STANDARD_TERRAIN_PROFILE_V1, context),
      0,
    )

    expect(uphill).toBeCloseTo(115, 10)
    expect(downhill).toBeCloseTo(105, 10)
  })

  it('caps derived uphill and downhill penalties', () => {
    const edge = roadEdge('capped', 100, {
      startElevationMeters: 0,
      endElevationMeters: 100,
    })
    expect(cost(edge, edge.from)).toBe(130)
    expect(cost(edge, edge.to)).toBeCloseTo(110, 10)
  })

  it('uses elevation only for direction when a manual slope is present', () => {
    const edge = roadEdge('manual-direction', 100, {
      slope: 'steep',
      startElevationMeters: 0,
      endElevationMeters: 100,
    })
    expect(cost(edge, edge.from)).toBe(120)
    expect(cost(edge, edge.to)).toBe(107)
  })

  it('lets explicit level override conflicting elevation for cost', () => {
    const edge = roadEdge('explicit-level', 100, {
      slope: 'level',
      startElevationMeters: 0,
      endElevationMeters: 100,
    })
    expect(cost(edge)).toBe(100)
  })

  it('uses the larger stairs penalty when derived grade is smaller', () => {
    const edge = roadEdge('stairs-derived', 100, {
      feature: 'stairs',
      startElevationMeters: 0,
      endElevationMeters: 10,
    })
    expect(cost(edge)).toBe(120)
  })

  it('uses the larger derived grade penalty when it exceeds stairs', () => {
    const edge = roadEdge('stairs-derived-larger', 100, {
      feature: 'stairs',
      startElevationMeters: 0,
      endElevationMeters: 16.666666666666668,
    })
    expect(cost(edge)).toBeCloseTo(125, 10)
  })

  it('returns finite Road costs no lower than physical distance', () => {
    const cases = [
      roadEdge('normal', 100, {}),
      roadEdge('manual', 100, { slope: 'moderate' }),
      roadEdge('numeric', 100, { startElevationMeters: 20, endElevationMeters: 30 }),
      roadEdge('stairs', 100, { feature: 'stairs', slope: 'steep' }),
    ]
    for (const edge of cases) {
      const result = cost(edge)
      expect(Number.isFinite(result)).toBe(true)
      expect(result).toBeGreaterThanOrEqual(edge.distance)
    }
  })

  it('rejects traversal from a node outside the edge', () => {
    const edge = roadEdge('bad-direction', 100, {})
    expect(() => cost(edge, 'not-an-endpoint')).toThrow(/edge endpoint/i)
  })

  it('rejects non-finite legacy weights and invalid profile coefficients', () => {
    const legacy: NavEdge = {
      id: 'bad-legacy',
      from: 'a',
      to: 'b',
      type: 'walk',
      distance: 100,
      weight: Number.POSITIVE_INFINITY,
    }
    expect(() => cost(legacy)).toThrow(/finite non-negative weight/i)

    const invalidProfile: TerrainCostProfile = {
      ...STANDARD_TERRAIN_PROFILE_V1,
      uphillGradePenaltyCap: -1,
    }
    expect(() => cost(roadEdge('bad-profile', 100, {}), 'a', undefined, invalidProfile)).toThrow(
      /profile coefficient/i,
    )

    const unsupportedProfile = {
      ...STANDARD_TERRAIN_PROFILE_V1,
      version: 'STANDARD_TERRAIN_PROFILE_V2',
    } as unknown as TerrainCostProfile
    expect(() => cost(roadEdge('bad-version', 100, { slope: 'level' }), 'a', undefined, unsupportedProfile)).toThrow(
      /unsupported terrain profile/i,
    )
  })
})
