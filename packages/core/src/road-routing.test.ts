import { describe, expect, it } from 'vitest'
import {
  deserializeDocument,
  getEffectiveRoadRouting,
  getRoadElevationDeltaMeters,
  getRoadGradePercent,
  getRoadPolylineLengthMeters,
  normalizeRoadRouting,
  serializeDocument,
} from './index'
import type {
  CampusDocument,
  Road,
  RoadDirection,
  RoadRouting,
  RoadRoutingFeature,
  RoadSlope,
} from './types'

function makeRoad(overrides: Partial<Road> = {}): Road {
  return {
    id: 'road-1',
    name: 'Campus walk',
    polyline: {
      points: [
        { lat: 11.7210, lng: 122.3770 },
        { lat: 11.7220, lng: 122.3780 },
      ],
    },
    width: 2,
    surface: 'concrete',
    type: 'pedestrian',
    metadata: { color: '#64748b' },
    ...overrides,
  }
}

function makeDocument(road: Road): CampusDocument {
  return {
    schemaVersion: 1,
    version: 7,
    metadata: {
      campusId: 'campus-1',
      name: 'Test Campus',
      description: '',
      lastModified: '2026-09-10T00:00:00.000Z',
      editorVersion: 'test',
    },
    buildings: [],
    roads: [road],
    panoramas: [],
    qrCheckpoints: [],
  }
}

describe('Road routing metadata', () => {
  it('normalizes all valid authored members without materializing defaults', () => {
    expect(normalizeRoadRouting({
      feature: 'stairs',
      slope: 'steep',
      direction: 'reverse',
      startElevationMeters: 0,
      endElevationMeters: -4.5,
      walkable: false,
      wheelchairAccessible: false,
    })).toEqual({
      feature: 'stairs',
      slope: 'steep',
      direction: 'reverse',
      startElevationMeters: 0,
      endElevationMeters: -4.5,
      walkable: false,
      wheelchairAccessible: false,
    })
  })

  it('keeps valid siblings while discarding malformed and non-finite members', () => {
    expect(normalizeRoadRouting({
      feature: 'ramp',
      slope: 'cliff',
      direction: 'forward',
      startElevationMeters: Number.NaN,
      endElevationMeters: -2,
      walkable: 'yes',
      wheelchairAccessible: true,
    })).toEqual({
      feature: 'ramp',
      direction: 'forward',
      endElevationMeters: -2,
      wheelchairAccessible: true,
    })
  })

  it.each([undefined, null, 'stairs', [], {}, { feature: 'unknown' }])(
    'normalizes empty or malformed routing %o to semantic absence',
    (routing) => {
      expect(normalizeRoadRouting(routing)).toBeUndefined()
    },
  )

  it('applies legacy defaults without mutating the Road', () => {
    const road = makeRoad()
    const before = structuredClone(road)

    expect(getEffectiveRoadRouting(road)).toEqual({
      feature: 'normal',
      slope: 'level',
      direction: 'both',
      startElevationMeters: undefined,
      endElevationMeters: undefined,
      walkable: true,
      wheelchairAccessible: undefined,
    })
    expect(road).toEqual(before)
    expect(road).not.toHaveProperty('routing')
  })

  it.each<RoadRoutingFeature>(['normal', 'stairs', 'ramp', 'bridge'])(
    'preserves the %s feature',
    (feature) => {
      expect(getEffectiveRoadRouting(makeRoad({ routing: { feature } })).feature).toBe(feature)
    },
  )

  it.each<RoadSlope>(['level', 'gentle', 'moderate', 'steep'])(
    'preserves the %s slope',
    (slope) => {
      expect(getEffectiveRoadRouting(makeRoad({ routing: { slope } })).slope).toBe(slope)
    },
  )

  it.each<RoadDirection>(['both', 'forward', 'reverse'])(
    'preserves the %s direction',
    (direction) => {
      expect(getEffectiveRoadRouting(makeRoad({ routing: { direction } })).direction).toBe(direction)
    },
  )

  it.each([true, false])('preserves walkable=%s', (walkable) => {
    expect(getEffectiveRoadRouting(makeRoad({ routing: { walkable } })).walkable).toBe(walkable)
  })

  it.each([true, false, undefined])(
    'preserves wheelchairAccessible=%s without collapsing unknown',
    (wheelchairAccessible) => {
      expect(
        getEffectiveRoadRouting(makeRoad({ routing: { wheelchairAccessible } }))
          .wheelchairAccessible,
      ).toBe(wheelchairAccessible)
    },
  )

  it('falls back safely for malformed optional runtime metadata', () => {
    const road = makeRoad({
      routing: {
        feature: 'tunnel',
        slope: 'vertical',
        direction: 'sideways',
        walkable: 'yes',
        wheelchairAccessible: 1,
        startElevationMeters: '12',
        endElevationMeters: Number.POSITIVE_INFINITY,
      } as unknown as RoadRouting,
    })

    expect(getEffectiveRoadRouting(road)).toEqual({
      feature: 'normal',
      slope: 'level',
      direction: 'both',
      startElevationMeters: undefined,
      endElevationMeters: undefined,
      walkable: true,
      wheelchairAccessible: undefined,
    })
  })
})

describe('Road elevation and geographic grade helpers', () => {
  it.each([
    [{ startElevationMeters: 10 }, undefined],
    [{ endElevationMeters: 15 }, undefined],
    [{ startElevationMeters: 10, endElevationMeters: 15 }, 5],
    [{ startElevationMeters: 15, endElevationMeters: 10 }, -5],
    [{ startElevationMeters: 10, endElevationMeters: 10 }, 0],
  ] as const)('derives a signed elevation delta for %o', (routing, expected) => {
    expect(getRoadElevationDeltaMeters(makeRoad({ routing }))).toBe(expected)
  })

  it.each([
    [Number.NaN, 10],
    [Number.POSITIVE_INFINITY, 10],
    [10, Number.NEGATIVE_INFINITY],
    ['10', 20],
  ])('rejects invalid elevations %s -> %s', (start, end) => {
    const road = makeRoad({
      routing: {
        startElevationMeters: start,
        endElevationMeters: end,
      } as unknown as RoadRouting,
    })

    expect(getRoadElevationDeltaMeters(road)).toBeUndefined()
  })

  it('sums every geographic segment rather than using endpoint distance', () => {
    const road = makeRoad({
      polyline: {
        points: [
          { lat: 0, lng: 0 },
          { lat: 0.001, lng: 0 },
          { lat: 0.001, lng: 0.001 },
        ],
      },
    })

    expect(getRoadPolylineLengthMeters(road)).toBeCloseTo(222.39, 1)
  })

  it.each([
    [],
    [{ lat: 0, lng: 0 }],
    [{ lat: 0, lng: 0 }, { lat: 0, lng: 0 }],
    [{ lat: Number.NaN, lng: 0 }, { lat: 0, lng: 1 }],
    [{ lat: 91, lng: 0 }, { lat: 0, lng: 1 }],
    [{ lat: 0, lng: -181 }, { lat: 0, lng: 1 }],
    [{ lat: '0', lng: 0 }, { lat: 0, lng: 1 }],
  ])('returns unavailable for invalid or zero-length geometry %o', (points) => {
    const road = makeRoad({ polyline: { points } as Road['polyline'] })
    expect(getRoadPolylineLengthMeters(road)).toBeUndefined()
  })

  it('calculates grade from signed elevation delta and summed length', () => {
    const road = makeRoad({
      polyline: {
        points: [
          { lat: 0, lng: 0 },
          { lat: 0.001, lng: 0 },
          { lat: 0.001, lng: 0.001 },
        ],
      },
      routing: { startElevationMeters: 5, endElevationMeters: 15 },
    })

    expect(getRoadGradePercent(road)).toBeCloseTo(4.4966, 3)
  })

  it('never returns non-finite grade for unavailable data', () => {
    const roads = [
      makeRoad(),
      makeRoad({ routing: { startElevationMeters: 1 } }),
      makeRoad({
        polyline: { points: [{ lat: 0, lng: 0 }, { lat: 0, lng: 0 }] },
        routing: { startElevationMeters: 1, endElevationMeters: 2 },
      }),
    ]

    for (const road of roads) {
      expect(getRoadGradePercent(road)).toBeUndefined()
    }
  })
})

describe('Road routing serialization compatibility', () => {
  it('round-trips all typed routing metadata through the core serializer', () => {
    const road = makeRoad({
      routing: {
        feature: 'stairs',
        slope: 'steep',
        direction: 'forward',
        startElevationMeters: 3.25,
        endElevationMeters: 8.75,
        walkable: true,
        wheelchairAccessible: false,
      },
    })
    const source = makeDocument(road)
    const before = structuredClone(source)

    const restored = deserializeDocument(serializeDocument(source))

    expect(restored.roads[0]).toEqual(road)
    expect(source).toEqual(before)
  })

  it('keeps an old Road valid and does not materialize routing defaults', () => {
    const road = makeRoad()
    const source = makeDocument(road)

    const restored = deserializeDocument(serializeDocument(source))

    expect(restored.roads[0]).toEqual(road)
    expect(restored.roads[0]).not.toHaveProperty('routing')
  })

  it('preserves explicit wheelchair unknown as semantic absence', () => {
    const road = makeRoad({
      routing: {
        feature: 'ramp',
        wheelchairAccessible: undefined,
      },
    })

    const restored = deserializeDocument(serializeDocument(makeDocument(road)))

    expect(restored.roads[0].routing?.feature).toBe('ramp')
    expect(restored.roads[0].routing?.wheelchairAccessible).toBeUndefined()
  })
})
