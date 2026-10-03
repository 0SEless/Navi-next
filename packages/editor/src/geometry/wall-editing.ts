import type { LocalCoord, Wall } from '@navi/core'
import { snapPoint } from './snapping'
import type { SnapConfig, SnapResult } from './snapping'

/**
 * Endpoints this close are treated as one editable wall junction.
 * This matches the endpoint tolerance used by the trace drawing mode.
 */
export const DEFAULT_WALL_JUNCTION_TOLERANCE = 0.5

export type WallEndpointName = 'start' | 'end'

export interface WallEndpointRef {
  wallId: string
  endpoint: WallEndpointName
}

export interface WallJunction {
  /** Deterministic identity derived from the participating wall endpoints. */
  id: string
  position: LocalCoord
  endpoints: WallEndpointRef[]
}

interface WallEndpoint {
  ref: WallEndpointRef
  position: LocalCoord
}

function distanceSquared(a: LocalCoord, b: LocalCoord): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

function endpointKey(ref: WallEndpointRef): string {
  return `${ref.wallId}:${ref.endpoint}`
}

function compareEndpointRefs(a: WallEndpointRef, b: WallEndpointRef): number {
  return endpointKey(a).localeCompare(endpointKey(b))
}

function unionFind(size: number): { find(index: number): number; union(a: number, b: number): void } {
  const parents = Array.from({ length: size }, (_, index) => index)
  const ranks = Array.from({ length: size }, () => 0)

  function find(index: number): number {
    let root = index
    while (parents[root] !== root) root = parents[root]
    while (parents[index] !== index) {
      const parent = parents[index]
      parents[index] = root
      index = parent
    }
    return root
  }

  function union(a: number, b: number): void {
    const rootA = find(a)
    const rootB = find(b)
    if (rootA === rootB) return

    if (ranks[rootA] < ranks[rootB]) {
      parents[rootA] = rootB
    } else if (ranks[rootA] > ranks[rootB]) {
      parents[rootB] = rootA
    } else {
      parents[rootB] = rootA
      ranks[rootA] += 1
    }
  }

  return { find, union }
}

function collectEndpoints(walls: readonly Wall[]): WallEndpoint[] {
  return walls.flatMap((wall) => [
    { ref: { wallId: wall.id, endpoint: 'start' as const }, position: wall.start },
    { ref: { wallId: wall.id, endpoint: 'end' as const }, position: wall.end },
  ])
}

/**
 * Groups coincident or near-coincident wall endpoints into editable junctions.
 * Grouping is transitive so a short chain of endpoints still represents one
 * physical corner even when the outer endpoints are slightly farther apart.
 */
export function getWallJunctions(
  walls: readonly Wall[],
  tolerance = DEFAULT_WALL_JUNCTION_TOLERANCE,
): WallJunction[] {
  if (!Number.isFinite(tolerance) || tolerance < 0) return []

  const endpoints = collectEndpoints(walls)
  const groups = unionFind(endpoints.length)
  const toleranceSquared = tolerance * tolerance

  for (let i = 0; i < endpoints.length; i += 1) {
    for (let j = i + 1; j < endpoints.length; j += 1) {
      if (distanceSquared(endpoints[i].position, endpoints[j].position) <= toleranceSquared) {
        groups.union(i, j)
      }
    }
  }

  const grouped = new Map<number, WallEndpoint[]>()
  endpoints.forEach((endpoint, index) => {
    const root = groups.find(index)
    const group = grouped.get(root) ?? []
    group.push(endpoint)
    grouped.set(root, group)
  })

  return Array.from(grouped.values())
    .map((group) => {
      const endpoints = group.map(({ ref }) => ref).sort(compareEndpointRefs)
      const position = group.reduce(
        (sum, endpoint) => ({
          x: sum.x + endpoint.position.x / group.length,
          y: sum.y + endpoint.position.y / group.length,
        }),
        { x: 0, y: 0 },
      )

      return {
        id: `junction-${endpoints.map(endpointKey).join('|')}`,
        position,
        endpoints,
      }
    })
    .sort((a, b) => a.id.localeCompare(b.id))
}

function isFiniteCoord(point: LocalCoord): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y)
}

/** Validates persisted wall geometry before a multi-wall edit is committed. */
export function validateWallGeometry(
  walls: readonly Wall[],
): { valid: true } | { valid: false; error: string } {
  for (const wall of walls) {
    if (!isFiniteCoord(wall.start) || !isFiniteCoord(wall.end)) {
      return { valid: false, error: `Wall ${wall.id} has non-finite coordinates` }
    }
    if (distanceSquared(wall.start, wall.end) <= Number.EPSILON) {
      return { valid: false, error: `Wall ${wall.id} must have a non-zero length` }
    }
  }

  return { valid: true }
}

/**
 * Applies a junction move to every incident wall endpoint. The source array
 * and wall objects are never mutated; invalid geometry returns null.
 */
export function moveWallJunction(
  walls: readonly Wall[],
  junctionId: string,
  position: LocalCoord,
  tolerance = DEFAULT_WALL_JUNCTION_TOLERANCE,
): Wall[] | null {
  if (!isFiniteCoord(position)) return null

  const junction = getWallJunctions(walls, tolerance).find(({ id }) => id === junctionId)
  if (!junction) return null

  const refsByWallId = new Map<string, WallEndpointRef[]>()
  for (const endpoint of junction.endpoints) {
    const refs = refsByWallId.get(endpoint.wallId) ?? []
    refs.push(endpoint)
    refsByWallId.set(endpoint.wallId, refs)
  }

  const moved = walls.map((wall) => {
    const refs = refsByWallId.get(wall.id)
    if (!refs) return { ...wall, start: { ...wall.start }, end: { ...wall.end } }

    const updated: Wall = { ...wall, start: { ...wall.start }, end: { ...wall.end } }
    for (const ref of refs) {
      updated[ref.endpoint] = { ...position }
    }
    return updated
  })

  return validateWallGeometry(moved).valid ? moved : null
}

/** Snaps a junction while ignoring the endpoints that move with it. */
export function snapWallJunctionPosition(
  position: LocalCoord,
  walls: readonly Wall[],
  junctionId: string,
  config: SnapConfig,
  tolerance = DEFAULT_WALL_JUNCTION_TOLERANCE,
): SnapResult {
  const junction = getWallJunctions(walls, tolerance).find(({ id }) => id === junctionId)
  if (!junction) return { position: { ...position }, snapType: 'none' }

  const movingEndpoints = new Set(junction.endpoints.map(endpointKey))
  const existingPoints = collectEndpoints(walls)
    .filter(({ ref }) => !movingEndpoints.has(endpointKey(ref)))
    .map(({ position: endpoint }) => endpoint)

  return snapPoint(position, config, existingPoints, junction.position)
}
