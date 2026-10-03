import { describe, expect, it } from 'vitest'
import type { NavEdge, RoadRouting, RoadRoutingFeature, RoadSlope } from '@navi/core'
import {
  TERRAIN_COST_CONFIGS,
  buildRoadLengthIndex,
  calculateOutdoorTraversalCost,
  type TerrainCostConfig,
  type TerrainSensitivity,
} from './outdoor-terrain-cost-model.experimental'

function makeEdge(
  id: string,
  distance: number,
  authored?: RoadRouting,
  sourceRoadId = id,
): NavEdge {
  return {
    id,
    from: `${id}-from`,
    to: `${id}-to`,
    type: 'walk',
    distance,
    weight: distance,
    ...(authored
      ? {
          routing: {
            sourceRoadId,
            authoredOrientation: 'forward' as const,
            authored,
          },
        }
      : {}),
  }
}

function cost(
  distance: number,
  authored: RoadRouting | undefined,
  sensitivity: TerrainSensitivity = 'medium',
  reverse = false,
): number {
  const edge = makeEdge('road-edge', distance, authored)
  const roadLengthsBySourceRoadId = buildRoadLengthIndex([edge])
  return calculateOutdoorTraversalCost(
    edge,
    reverse ? edge.to : edge.from,
    TERRAIN_COST_CONFIGS[sensitivity],
    { roadLengthsBySourceRoadId },
  )
}

describe('Phase 5 outdoor terrain traversal-cost contract', () => {
  it('preserves an unannotated legacy edge weight exactly', () => {
    const legacy = { ...makeEdge('legacy', 100), weight: 137 }

    expect(calculateOutdoorTraversalCost(legacy, legacy.from)).toBe(137)
  })

  it('uses summed source-Road length so Road-level elevation is not repeated per segment', () => {
    const authored: RoadRouting = {
      startElevationMeters: 20,
      endElevationMeters: 30,
    }
    const first = makeEdge('segment-1', 25, authored, 'road-1')
    const second = makeEdge('segment-2', 75, authored, 'road-1')
    const lengths = buildRoadLengthIndex([first, second])

    expect(lengths.get('road-1')).toBe(100)
    expect(
      calculateOutdoorTraversalCost(first, first.from, TERRAIN_COST_CONFIGS.medium, {
        roadLengthsBySourceRoadId: lengths,
      }),
    ).toBeCloseTo(28.75, 10)
    expect(
      calculateOutdoorTraversalCost(second, second.from, TERRAIN_COST_CONFIGS.medium, {
        roadLengthsBySourceRoadId: lengths,
      }),
    ).toBeCloseTo(86.25, 10)
    expect(
      calculateOutdoorTraversalCost(first, first.to, TERRAIN_COST_CONFIGS.medium, {
        roadLengthsBySourceRoadId: lengths,
      }) +
        calculateOutdoorTraversalCost(second, second.to, TERRAIN_COST_CONFIGS.medium, {
          roadLengthsBySourceRoadId: lengths,
        }),
    ).toBeCloseTo(105, 10)
  })

  it('uses manual slope as severity and elevations only as its direction signal', () => {
    const steepWithExtremeGrade: RoadRouting = {
      slope: 'steep',
      startElevationMeters: 0,
      endElevationMeters: 100,
    }
    const uphill = cost(100, steepWithExtremeGrade)
    const downhill = cost(100, steepWithExtremeGrade, 'medium', true)

    expect(uphill).toBe(120)
    expect(downhill).toBe(107)
  })

  it('uses the larger feature or slope penalty instead of stacking both', () => {
    const steepStairs = cost(100, { feature: 'stairs', slope: 'steep' })

    expect(steepStairs).toBe(120)
  })

  it('does not derive grade unless both elevations and a positive whole-Road length exist', () => {
    const edge = makeEdge('missing-length', 100, {
      startElevationMeters: 20,
      endElevationMeters: 30,
    })

    expect(calculateOutdoorTraversalCost(edge, edge.from)).toBe(100)
  })

  it('rejects invalid arithmetic instead of returning NaN or infinity', () => {
    const invalidDistance = { ...makeEdge('bad', 100, { slope: 'gentle' }), distance: Number.NaN }
    const invalidConfig: TerrainCostConfig = {
      ...TERRAIN_COST_CONFIGS.medium,
      uphillGradeRate: Number.POSITIVE_INFINITY,
    }

    expect(() => calculateOutdoorTraversalCost(invalidDistance, invalidDistance.from)).toThrow(
      RangeError,
    )
    expect(() =>
      calculateOutdoorTraversalCost(
        makeEdge('valid', 100, { slope: 'gentle' }),
        'valid-from',
        invalidConfig,
      ),
    ).toThrow(RangeError)
  })

  it.each(Object.entries(TERRAIN_COST_CONFIGS))(
    '%s configuration is finite, nonnegative, and monotonic',
    (_name, config) => {
      const manual = config.manualSlopePenalty
      expect(manual.level).toBeGreaterThanOrEqual(0)
      expect(manual.gentle).toBeGreaterThanOrEqual(manual.level)
      expect(manual.moderate).toBeGreaterThanOrEqual(manual.gentle)
      expect(manual.steep).toBeGreaterThanOrEqual(manual.moderate)

      for (const coefficient of [
        ...Object.values(manual),
        ...Object.values(config.featurePenalty),
        config.uphillGradeRate,
        config.uphillGradeCap,
        config.downhillGradeRate,
        config.downhillGradeCap,
        config.manualDownhillScale,
      ]) {
        expect(Number.isFinite(coefficient)).toBe(true)
        expect(coefficient).toBeGreaterThanOrEqual(0)
      }
    },
  )

  it.each(
    (Object.keys(TERRAIN_COST_CONFIGS) as TerrainSensitivity[]).flatMap((sensitivity) =>
      (['normal', 'stairs', 'ramp', 'bridge'] as RoadRoutingFeature[]).flatMap((feature) =>
        (['level', 'gentle', 'moderate', 'steep'] as RoadSlope[]).flatMap((slope) => [
          { sensitivity, feature, slope, reverse: false },
          { sensitivity, feature, slope, reverse: true },
        ]),
      ),
    ),
  )('always returns finite cost >= distance for $sensitivity $feature $slope reverse=$reverse', (row) => {
    const result = cost(
      100,
      {
        feature: row.feature,
        slope: row.slope,
        startElevationMeters: 20,
        endElevationMeters: 30,
      },
      row.sensitivity,
      row.reverse,
    )

    expect(Number.isFinite(result)).toBe(true)
    expect(result).toBeGreaterThanOrEqual(100)
  })
})

describe('required numerical scenarios and sensitivity', () => {
  const expected = {
    low: {
      level100: 100,
      steep100: 112,
      steepUphill120: 134.4,
      stairsUphill100: 112,
      uphill100: 110,
      downhill100: 102.5,
      gentleRamp100: 102,
    },
    medium: {
      level100: 100,
      steep100: 120,
      steepUphill120: 144,
      stairsUphill100: 120,
      uphill100: 115,
      downhill100: 105,
      gentleRamp100: 104,
    },
    high: {
      level100: 100,
      steep100: 135,
      steepUphill120: 162,
      stairsUphill100: 135,
      uphill100: 125,
      downhill100: 107.5,
      gentleRamp100: 108,
    },
  } as const

  it.each(Object.keys(expected) as TerrainSensitivity[])(
    'calculates all required %s-sensitivity route comparisons',
    (sensitivity) => {
      const actual = {
        level100: cost(100, { feature: 'normal', slope: 'level' }, sensitivity),
        steep100: cost(100, { feature: 'normal', slope: 'steep' }, sensitivity),
        steepUphill120: cost(
          120,
          {
            feature: 'normal',
            slope: 'steep',
            startElevationMeters: 0,
            endElevationMeters: 12,
          },
          sensitivity,
        ),
        stairsUphill100: cost(
          100,
          { feature: 'stairs', startElevationMeters: 0, endElevationMeters: 10 },
          sensitivity,
        ),
        uphill100: cost(
          100,
          { feature: 'normal', startElevationMeters: 20, endElevationMeters: 30 },
          sensitivity,
        ),
        downhill100: cost(
          100,
          { feature: 'normal', startElevationMeters: 20, endElevationMeters: 30 },
          sensitivity,
          true,
        ),
        gentleRamp100: cost(100, { feature: 'ramp', slope: 'gentle' }, sensitivity),
      }

      for (const [name, expectedCost] of Object.entries(expected[sensitivity])) {
        expect(actual[name as keyof typeof actual]).toBeCloseTo(expectedCost, 10)
      }

      // Scenario 1: 100 m level always beats 100 m steep.
      expect(actual.level100).toBeLessThan(actual.steep100)
      // Scenario 2: sensitivity makes the 120 m steep route cross the 150 m flat route.
      expect(actual.steepUphill120 < 150).toBe(sensitivity !== 'high')
      // Scenario 3: the 100 m stairs route crosses the 130 m flat route only at HIGH.
      expect(actual.stairsUphill100 < 130).toBe(sensitivity !== 'high')
      // Scenario 4: 100 m stairs never causes a pathological 200 m detour.
      expect(actual.stairsUphill100).toBeLessThan(200)
      // Scenario 5: both directions retain the physical-distance lower bound.
      expect(actual.uphill100).toBeGreaterThanOrEqual(100)
      expect(actual.downhill100).toBeGreaterThanOrEqual(100)
      expect(actual.uphill100).toBeGreaterThan(actual.downhill100)
      // Scenario 6: a gentle 100 m ramp remains cheaper than a 110 m level route.
      expect(actual.gentleRamp100).toBeLessThan(110)
      // Scenario 7: a level bridge and normal walkway are equal.
      expect(cost(100, { feature: 'bridge', slope: 'level' }, sensitivity)).toBe(100)
      expect(cost(100, { feature: 'normal', slope: 'level' }, sensitivity)).toBe(100)
      // Scenario 8: missing routing metadata remains exact legacy behavior.
      const legacy = makeEdge('legacy-scenario', 100)
      expect(calculateOutdoorTraversalCost(legacy, legacy.from)).toBe(100)
    },
  )
})
