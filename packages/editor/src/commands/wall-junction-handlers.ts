import { recordChange } from '@navi/core'
import type { CampusDocument, LocalCoord, RoomAttributes, Wall } from '@navi/core'
import type { Command, CommandHandler, MutationResult } from './types'
import { buildPlanarGraph, deriveRooms, findEnclosedRegions } from '../geometry/room-derivation'
import { stableFaceIdFromTopology } from '../geometry/face-identity'
import { validateWallGeometry } from '../geometry/wall-editing'
import { wallsToSegments } from '../geometry/wall-to-segment'

type WallEndpointPatch = Partial<Pick<Wall, 'start' | 'end'>>

interface WallJunctionPatch {
  wallId: string
  patch: WallEndpointPatch
}

function findFloor(document: CampusDocument, buildingId: string, floorId: string) {
  const building = document.buildings.find((candidate) => candidate.id === buildingId)
  if (!building) return null
  const floor = building.floors.find((candidate) => candidate.id === floorId)
  return floor ? { building, floor } : null
}

function isLocalCoord(value: unknown): value is LocalCoord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const point = value as Record<string, unknown>
  return typeof point.x === 'number' && Number.isFinite(point.x)
    && typeof point.y === 'number' && Number.isFinite(point.y)
}

function parsePatches(value: unknown): { patches: WallJunctionPatch[] } | { error: string } {
  if (!Array.isArray(value) || value.length === 0) {
    return { error: 'patches must contain at least one wall endpoint patch' }
  }

  const wallIds = new Set<string>()
  const patches: WallJunctionPatch[] = []
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return { error: 'each wall junction patch must be an object' }
    }

    const raw = candidate as Record<string, unknown>
    if (typeof raw.wallId !== 'string' || raw.wallId.length === 0) {
      return { error: 'each wall junction patch requires a wallId' }
    }
    if (wallIds.has(raw.wallId)) {
      return { error: `duplicate wall junction patch: ${raw.wallId}` }
    }
    wallIds.add(raw.wallId)

    if (!raw.patch || typeof raw.patch !== 'object' || Array.isArray(raw.patch)) {
      return { error: `patch is required for wall ${raw.wallId}` }
    }
    const patch = raw.patch as Record<string, unknown>
    const hasStart = patch.start !== undefined
    const hasEnd = patch.end !== undefined
    if (!hasStart && !hasEnd) return { error: `wall ${raw.wallId} has no endpoint changes` }
    if (hasStart && !isLocalCoord(patch.start)) return { error: `wall ${raw.wallId} has invalid start coordinates` }
    if (hasEnd && !isLocalCoord(patch.end)) return { error: `wall ${raw.wallId} has invalid end coordinates` }

    patches.push({
      wallId: raw.wallId,
      patch: {
        ...(hasStart ? { start: { ...(patch.start as LocalCoord) } } : {}),
        ...(hasEnd ? { end: { ...(patch.end as LocalCoord) } } : {}),
      },
    })
  }

  return { patches }
}

function faceIds(walls: Wall[]): Set<string> {
  return new Set(
    deriveRooms(wallsToSegments(walls), [])
      .map((room) => room.faceId)
      .filter((faceId): faceId is string => typeof faceId === 'string' && faceId.length > 0),
  )
}

function pointsCoincide(a: LocalCoord, b: LocalCoord): boolean {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy <= 1e-10
}

function hasClosedDerivedFace(walls: Wall[], faceId: string): boolean {
  if (!faceIds(walls).has(faceId)) return false

  return findEnclosedRegions(buildPlanarGraph(wallsToSegments(walls))).some((region) => {
    const boundaryWallIds = region.boundaryWallIds ?? []
    if (stableFaceIdFromTopology(boundaryWallIds) !== faceId || region.vertices.length < 4) return false
    return pointsCoincide(region.vertices[0], region.vertices[region.vertices.length - 1])
  })
}

function detachedRoom(
  beforeWalls: Wall[],
  afterWalls: Wall[],
  attributes: readonly RoomAttributes[] | undefined,
): RoomAttributes | undefined {
  if (!attributes?.length) return undefined

  const beforeFaces = faceIds(beforeWalls)
  return attributes.find((attribute) => beforeFaces.has(attribute.faceId) && !hasClosedDerivedFace(afterWalls, attribute.faceId))
}

export const wallJunctionUpdateHandler: CommandHandler = {
  id: 'wall.junction.update',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const buildingId = payload.buildingId as string
    const floorId = payload.floorId as string
    if (!buildingId || !floorId) return { success: false, error: 'buildingId and floorId are required' }

    const context = findFloor(document, buildingId, floorId)
    if (!context) return { success: false, error: `Building/floor not found: ${buildingId}/${floorId}` }
    if (!context.floor.walls?.length) return { success: false, error: `No walls on floor: ${floorId}` }

    const parsed = parsePatches(payload.patches)
    if ('error' in parsed) return { success: false, error: parsed.error }

    const currentWalls = context.floor.walls
    const wallsById = new Map(currentWalls.map((wall) => [wall.id, wall]))
    for (const entry of parsed.patches) {
      if (!wallsById.has(entry.wallId)) return { success: false, error: `Wall not found: ${entry.wallId}` }
    }

    const patchesByWallId = new Map(parsed.patches.map((entry) => [entry.wallId, entry.patch]))
    const previousPatches: WallJunctionPatch[] = []
    const nextWalls = currentWalls.map((wall) => {
      const patch = patchesByWallId.get(wall.id)
      if (!patch) return { ...wall, start: { ...wall.start }, end: { ...wall.end } }

      previousPatches.push({
        wallId: wall.id,
        patch: {
          ...(patch.start ? { start: { ...wall.start } } : {}),
          ...(patch.end ? { end: { ...wall.end } } : {}),
        },
      })
      return {
        ...wall,
        start: patch.start ? { ...patch.start } : { ...wall.start },
        end: patch.end ? { ...patch.end } : { ...wall.end },
      }
    })

    const geometry = validateWallGeometry(nextWalls)
    if (!geometry.valid) return { success: false, error: geometry.error }

    const detached = detachedRoom(currentWalls, nextWalls, context.floor.roomAttributes)
    if (detached) {
      const roomLabel = detached.roomId ?? detached.name ?? detached.faceId
      return { success: false, error: `Wall edit would detach semantic Room ${roomLabel} from face ${detached.faceId}` }
    }

    context.floor.walls = nextWalls
    for (const entry of parsed.patches) {
      recordChange(document, { entityId: entry.wallId, entityType: 'wall', operation: 'updated' })
    }

    return {
      success: true,
      entityId: parsed.patches[0].wallId,
      data: { buildingId, floorId, previousPatches },
    }
  },
  inverse(payload: Record<string, unknown>, result: MutationResult): Command | null {
    const previousPatches = result.data?.previousPatches as WallJunctionPatch[] | undefined
    if (!previousPatches?.length) return null
    return {
      id: 'wall.junction.update',
      label: 'Undo Move Wall Junction',
      payload: {
        buildingId: result.data?.buildingId ?? payload.buildingId,
        floorId: result.data?.floorId ?? payload.floorId,
        patches: previousPatches,
      },
    }
  },
}
