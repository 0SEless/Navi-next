import type {
  NavEdge,
  RoadRoutingFeature,
  RoadSlope,
} from '@navi/core'

export type TerrainSensitivity = 'low' | 'medium' | 'high'

export interface TerrainCostConfig {
  manualSlopePenalty: Readonly<Record<RoadSlope, number>>
  featurePenalty: Readonly<Record<RoadRoutingFeature, number>>
  uphillGradeRate: number
  uphillGradeCap: number
  downhillGradeRate: number
  downhillGradeCap: number
  manualDownhillScale: number
}

export interface TerrainTraversalContext {
  roadLengthsBySourceRoadId?: ReadonlyMap<string, number>
}

export const TERRAIN_COST_CONFIGS: Readonly<
  Record<TerrainSensitivity, TerrainCostConfig>
> = {
  low: {
    manualSlopePenalty: { level: 0, gentle: 0.02, moderate: 0.06, steep: 0.12 },
    featurePenalty: { normal: 0, stairs: 0.12, ramp: 0, bridge: 0 },
    uphillGradeRate: 1,
    uphillGradeCap: 0.2,
    downhillGradeRate: 0.25,
    downhillGradeCap: 0.05,
    manualDownhillScale: 0.35,
  },
  medium: {
    manualSlopePenalty: { level: 0, gentle: 0.04, moderate: 0.1, steep: 0.2 },
    featurePenalty: { normal: 0, stairs: 0.2, ramp: 0, bridge: 0 },
    uphillGradeRate: 1.5,
    uphillGradeCap: 0.3,
    downhillGradeRate: 0.5,
    downhillGradeCap: 0.1,
    manualDownhillScale: 0.35,
  },
  high: {
    manualSlopePenalty: { level: 0, gentle: 0.08, moderate: 0.18, steep: 0.35 },
    featurePenalty: { normal: 0, stairs: 0.35, ramp: 0, bridge: 0 },
    uphillGradeRate: 2.5,
    uphillGradeCap: 0.5,
    downhillGradeRate: 0.75,
    downhillGradeCap: 0.15,
    manualDownhillScale: 0.35,
  },
}

const ROAD_SLOPES: readonly RoadSlope[] = [
  'level',
  'gentle',
  'moderate',
  'steep',
]

const ROAD_FEATURES: readonly RoadRoutingFeature[] = [
  'normal',
  'stairs',
  'ramp',
  'bridge',
]

function assertFiniteNonnegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be finite and nonnegative`)
  }
}

function validateConfig(config: TerrainCostConfig): void {
  for (const slope of ROAD_SLOPES) {
    assertFiniteNonnegative(config.manualSlopePenalty[slope], `manual ${slope} penalty`)
  }

  if (
    config.manualSlopePenalty.level > config.manualSlopePenalty.gentle ||
    config.manualSlopePenalty.gentle > config.manualSlopePenalty.moderate ||
    config.manualSlopePenalty.moderate > config.manualSlopePenalty.steep
  ) {
    throw new RangeError('manual slope penalties must be monotonic')
  }

  for (const feature of ROAD_FEATURES) {
    assertFiniteNonnegative(config.featurePenalty[feature], `${feature} feature penalty`)
  }

  assertFiniteNonnegative(config.uphillGradeRate, 'uphill grade rate')
  assertFiniteNonnegative(config.uphillGradeCap, 'uphill grade cap')
  assertFiniteNonnegative(config.downhillGradeRate, 'downhill grade rate')
  assertFiniteNonnegative(config.downhillGradeCap, 'downhill grade cap')
  assertFiniteNonnegative(config.manualDownhillScale, 'manual downhill scale')
}

function assertOptionalFinite(value: number | undefined, label: string): void {
  if (value !== undefined && !Number.isFinite(value)) {
    throw new RangeError(`${label} must be finite when present`)
  }
}

export function buildRoadLengthIndex(
  edges: readonly NavEdge[],
): ReadonlyMap<string, number> {
  const result = new Map<string, number>()

  for (const edge of edges) {
    if (!edge.routing) continue

    assertFiniteNonnegative(edge.distance, `edge ${edge.id} distance`)
    const sourceRoadId = edge.routing.sourceRoadId
    const total = (result.get(sourceRoadId) ?? 0) + edge.distance
    assertFiniteNonnegative(total, `Road ${sourceRoadId} total length`)
    result.set(sourceRoadId, total)
  }

  return result
}

export function calculateOutdoorTraversalCost(
  edge: NavEdge,
  traversalFromNodeId: string,
  config: TerrainCostConfig = TERRAIN_COST_CONFIGS.medium,
  context: TerrainTraversalContext = {},
): number {
  assertFiniteNonnegative(edge.distance, `edge ${edge.id} distance`)

  if (!edge.routing) {
    assertFiniteNonnegative(edge.weight, `legacy edge ${edge.id} weight`)
    return edge.weight
  }

  validateConfig(config)

  if (traversalFromNodeId !== edge.from && traversalFromNodeId !== edge.to) {
    throw new RangeError(`traversal origin must be an endpoint of edge ${edge.id}`)
  }

  const authored = edge.routing.authored
  assertOptionalFinite(authored.startElevationMeters, 'start elevation')
  assertOptionalFinite(authored.endElevationMeters, 'end elevation')

  const feature = authored.feature ?? 'normal'
  const featurePenalty = config.featurePenalty[feature]
  assertFiniteNonnegative(featurePenalty, `${feature} feature penalty`)

  const traversesForward = traversalFromNodeId === edge.from
  const hasCompleteElevation =
    authored.startElevationMeters !== undefined &&
    authored.endElevationMeters !== undefined

  let slopePenalty = 0
  if (authored.slope !== undefined) {
    const manualSeverity = config.manualSlopePenalty[authored.slope]
    assertFiniteNonnegative(manualSeverity, `${authored.slope} slope penalty`)

    if (hasCompleteElevation) {
      const authoredDelta = authored.endElevationMeters! - authored.startElevationMeters!
      if (!Number.isFinite(authoredDelta)) {
        throw new RangeError('authored elevation delta must be finite')
      }

      const traversalDelta = traversesForward ? authoredDelta : -authoredDelta
      slopePenalty =
        traversalDelta < 0
          ? manualSeverity * config.manualDownhillScale
          : manualSeverity
    } else {
      slopePenalty = manualSeverity
    }
  } else if (hasCompleteElevation) {
    const roadLength = context.roadLengthsBySourceRoadId?.get(
      edge.routing.sourceRoadId,
    )

    if (roadLength !== undefined) {
      if (!Number.isFinite(roadLength) || roadLength <= 0) {
        throw new RangeError('source Road length must be finite and positive')
      }

      const authoredDelta = authored.endElevationMeters! - authored.startElevationMeters!
      if (!Number.isFinite(authoredDelta)) {
        throw new RangeError('authored elevation delta must be finite')
      }

      const signedGrade = (traversesForward ? authoredDelta : -authoredDelta) / roadLength
      if (!Number.isFinite(signedGrade)) {
        throw new RangeError('derived Road grade must be finite')
      }

      slopePenalty =
        signedGrade >= 0
          ? Math.min(config.uphillGradeCap, signedGrade * config.uphillGradeRate)
          : Math.min(
              config.downhillGradeCap,
              -signedGrade * config.downhillGradeRate,
            )
    }
  }

  assertFiniteNonnegative(slopePenalty, 'resolved slope penalty')
  const terrainPenaltyRatio = Math.max(featurePenalty, slopePenalty)
  const result = edge.distance * (1 + terrainPenaltyRatio)

  if (!Number.isFinite(result) || result < edge.distance) {
    throw new RangeError(`edge ${edge.id} traversal cost violated its lower bound`)
  }

  return result
}
