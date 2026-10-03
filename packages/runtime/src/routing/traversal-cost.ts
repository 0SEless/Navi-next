import {
  isValidRoadEdgeRouting,
  type NavEdge,
  type NavigationGraph,
  type RoadRouting,
  type RoadRoutingFeature,
  type RoadSlope,
} from '@navi/core'

export interface TerrainCostProfile {
  readonly version: 'STANDARD_TERRAIN_PROFILE_V1'
  readonly manualSlopePenalty: Readonly<Record<RoadSlope, number>>
  readonly featurePenalty: Readonly<Record<RoadRoutingFeature, number>>
  readonly uphillGradePenaltyRate: number
  readonly uphillGradePenaltyCap: number
  readonly downhillGradePenaltyRate: number
  readonly downhillGradePenaltyCap: number
  readonly manualDownhillScale: number
}

export const STANDARD_TERRAIN_PROFILE_V1: TerrainCostProfile = Object.freeze({
  version: 'STANDARD_TERRAIN_PROFILE_V1',
  manualSlopePenalty: Object.freeze({
    level: 0,
    gentle: 0.04,
    moderate: 0.1,
    steep: 0.2,
  }),
  featurePenalty: Object.freeze({
    normal: 0,
    stairs: 0.2,
    ramp: 0,
    bridge: 0,
  }),
  uphillGradePenaltyRate: 1.5,
  uphillGradePenaltyCap: 0.3,
  downhillGradePenaltyRate: 0.5,
  downhillGradePenaltyCap: 0.1,
  manualDownhillScale: 0.35,
})

export interface RoadTerrainContext {
  readonly totalRoadLengthBySourceRoadId: ReadonlyMap<string, number>
}

export function buildRoadTerrainContext(
  graph: Pick<NavigationGraph, 'edges'>,
): RoadTerrainContext {
  const seenRoadEdgeIds = new Set<string>()
  const totalRoadLengthBySourceRoadId = new Map<string, number>()
  const authoredBySourceRoadId = new Map<string, RoadRouting>()

  for (const edge of graph.edges) {
    if (!isValidRoadEdgeRouting(edge.routing)) continue

    assertFiniteNonNegative(edge.distance, `Road edge ${edge.id} must have a finite non-negative distance`)
    if (seenRoadEdgeIds.has(edge.id)) {
      throw new Error(`Duplicate Road edge id: ${edge.id}`)
    }
    seenRoadEdgeIds.add(edge.id)

    const { sourceRoadId, authored } = edge.routing
    const existingAuthored = authoredBySourceRoadId.get(sourceRoadId)
    if (existingAuthored && !sameRoadRouting(existingAuthored, authored)) {
      throw new Error(`Inconsistent authored routing metadata for source Road ${sourceRoadId}`)
    }
    authoredBySourceRoadId.set(sourceRoadId, authored)
    totalRoadLengthBySourceRoadId.set(
      sourceRoadId,
      (totalRoadLengthBySourceRoadId.get(sourceRoadId) ?? 0) + edge.distance,
    )
  }

  return Object.freeze({
    totalRoadLengthBySourceRoadId: immutableMap(totalRoadLengthBySourceRoadId),
  })
}

export function calculateTraversalCost(
  edge: NavEdge,
  traversalFromNodeId: string,
  profile: TerrainCostProfile,
  context: RoadTerrainContext,
): number {
  assertTraversalEndpoint(edge, traversalFromNodeId)
  validateProfile(profile)

  if (!isValidRoadEdgeRouting(edge.routing)) {
    assertFiniteNonNegative(edge.weight, `Legacy edge ${edge.id} must have a finite non-negative weight`)
    return edge.weight
  }

  assertFiniteNonNegative(edge.distance, `Road edge ${edge.id} must have a finite non-negative distance`)
  const { authored, sourceRoadId } = edge.routing
  const featurePenalty = profile.featurePenalty[authored.feature ?? 'normal']
  const slopePenalty = authored.slope
    ? calculateManualSlopePenalty(edge, traversalFromNodeId, authored, profile)
    : calculateElevationGradePenalty(edge, traversalFromNodeId, authored, sourceRoadId, profile, context)
  const traversalCost = edge.distance * (1 + Math.max(featurePenalty, slopePenalty))

  if (!Number.isFinite(traversalCost) || traversalCost < edge.distance) {
    throw new Error(`Terrain traversal cost for edge ${edge.id} must be finite and no less than distance`)
  }
  return traversalCost
}

function calculateManualSlopePenalty(
  edge: NavEdge,
  traversalFromNodeId: string,
  authored: RoadRouting,
  profile: TerrainCostProfile,
): number {
  const basePenalty = profile.manualSlopePenalty[authored.slope!]
  const elevationDelta = getTraversalElevationDelta(edge, traversalFromNodeId, authored)
  return elevationDelta !== undefined && elevationDelta < 0
    ? basePenalty * profile.manualDownhillScale
    : basePenalty
}

function calculateElevationGradePenalty(
  edge: NavEdge,
  traversalFromNodeId: string,
  authored: RoadRouting,
  sourceRoadId: string,
  profile: TerrainCostProfile,
  context: RoadTerrainContext,
): number {
  const elevationDelta = getTraversalElevationDelta(edge, traversalFromNodeId, authored)
  if (elevationDelta === undefined || elevationDelta === 0) return 0

  const totalRoadLength = context.totalRoadLengthBySourceRoadId.get(sourceRoadId)
  if (totalRoadLength === undefined || totalRoadLength <= 0) return 0
  assertFinite(totalRoadLength, `Source Road ${sourceRoadId} total Road length must be finite`)

  const absoluteGrade = Math.abs(elevationDelta) / totalRoadLength
  return elevationDelta > 0
    ? Math.min(absoluteGrade * profile.uphillGradePenaltyRate, profile.uphillGradePenaltyCap)
    : Math.min(absoluteGrade * profile.downhillGradePenaltyRate, profile.downhillGradePenaltyCap)
}

function getTraversalElevationDelta(
  edge: NavEdge,
  traversalFromNodeId: string,
  authored: RoadRouting,
): number | undefined {
  const { startElevationMeters, endElevationMeters } = authored
  if (startElevationMeters === undefined || endElevationMeters === undefined) return undefined
  assertFinite(startElevationMeters, `Road ${edge.routing!.sourceRoadId} start elevation must be finite`)
  assertFinite(endElevationMeters, `Road ${edge.routing!.sourceRoadId} end elevation must be finite`)

  const authoredDelta = endElevationMeters - startElevationMeters
  return traversalFromNodeId === edge.from ? authoredDelta : -authoredDelta
}

function assertTraversalEndpoint(edge: NavEdge, traversalFromNodeId: string): void {
  if (traversalFromNodeId !== edge.from && traversalFromNodeId !== edge.to) {
    throw new Error(`Traversal origin must be an edge endpoint for edge ${edge.id}`)
  }
}

function validateProfile(profile: TerrainCostProfile): void {
  if (profile.version !== 'STANDARD_TERRAIN_PROFILE_V1') {
    throw new Error(`Unsupported terrain profile: ${String(profile.version)}`)
  }
  const coefficients = [
    ...Object.values(profile.manualSlopePenalty),
    ...Object.values(profile.featurePenalty),
    profile.uphillGradePenaltyRate,
    profile.uphillGradePenaltyCap,
    profile.downhillGradePenaltyRate,
    profile.downhillGradePenaltyCap,
    profile.manualDownhillScale,
  ]
  if (coefficients.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error('Every terrain profile coefficient must be finite and non-negative')
  }
}

function immutableMap<K, V>(source: ReadonlyMap<K, V>): ReadonlyMap<K, V> {
  const snapshot = new Map(source)
  const view = {
    get size() { return snapshot.size },
    get: (key: K) => snapshot.get(key),
    has: (key: K) => snapshot.has(key),
    entries: () => snapshot.entries(),
    keys: () => snapshot.keys(),
    values: () => snapshot.values(),
    forEach: (
      callback: (value: V, key: K, map: ReadonlyMap<K, V>) => void,
      thisArg?: unknown,
    ) => snapshot.forEach((value, key) => callback.call(thisArg, value, key, view)),
    [Symbol.iterator]: () => snapshot[Symbol.iterator](),
  } satisfies ReadonlyMap<K, V>
  return Object.freeze(view)
}

function sameRoadRouting(left: RoadRouting, right: RoadRouting): boolean {
  return left.feature === right.feature
    && left.slope === right.slope
    && left.direction === right.direction
    && left.startElevationMeters === right.startElevationMeters
    && left.endElevationMeters === right.endElevationMeters
    && left.walkable === right.walkable
    && left.wheelchairAccessible === right.wheelchairAccessible
}

function assertFiniteNonNegative(value: number, message: string): void {
  assertFinite(value, message)
  if (value < 0) throw new Error(message)
}

function assertFinite(value: number, message: string): void {
  if (!Number.isFinite(value)) throw new Error(message)
}
