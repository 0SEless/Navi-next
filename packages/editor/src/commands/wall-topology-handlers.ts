import { recordChange } from '@navi/core'
import type { CampusDocument, LocalCoord, Wall, Opening } from '@navi/core'
import { migrateOpeningsOnSplit, migrateOpeningsOnMerge } from '../geometry/opening-position'
import type { CommandHandler, Command, MutationResult } from './types'
import { genId } from '../id'
import {
  splitWallAtPoint,
  findIntersections,
  splitAtTJunction,
  mergeWalls,
  type WallSegment,
} from '../geometry/wall-topology'

// ── Helpers ──

function wallToSegment(wall: Wall): WallSegment {
  return { id: wall.id, start: wall.start, end: wall.end }
}

function segmentToWall(seg: WallSegment, template: Wall): Wall {
  return {
    id: seg.id,
    start: seg.start,
    end: seg.end,
    thickness: template.thickness,
    height: template.height,
    ...(template.metadata ? { metadata: { ...template.metadata } } : {}),
  }
}

function getFloor(document: CampusDocument, buildingId: string, floorId: string) {
  const building = document.buildings.find(b => b.id === buildingId)
  if (!building) return { error: `Building not found: ${buildingId}` }
  const floor = building.floors.find(f => f.id === floorId)
  if (!floor) return { error: `Floor not found: ${floorId}` }
  if (!floor.walls) floor.walls = []
  return { floor }
}

function findWall(floor: { walls?: Wall[] }, wallId: string) {
  if (!floor.walls) return { error: 'No walls on floor' }
  const idx = floor.walls.findIndex(w => w.id === wallId)
  if (idx === -1) return { error: `Wall not found: ${wallId}` }
  return { wall: floor.walls[idx], index: idx }
}

// ── wall.split ──

export const wallSplitHandler: CommandHandler = {
  id: 'wall.split',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const buildingId = payload.buildingId as string
    const floorId = payload.floorId as string
    const wallId = payload.wallId as string
    const point = payload.point as LocalCoord

    if (!buildingId || !floorId) return { success: false, error: 'buildingId and floorId are required' }
    if (!wallId) return { success: false, error: 'wallId is required' }
    if (!point) return { success: false, error: 'point is required' }

    const floorResult = getFloor(document, buildingId, floorId)
    if ('error' in floorResult) return { success: false, error: floorResult.error }
    const floor = floorResult.floor

    const wallResult = findWall(floor, wallId)
    if ('error' in wallResult) return { success: false, error: wallResult.error }
    const { wall, index } = wallResult

    const segment: WallSegment = wallToSegment(wall)
    const splitResult = splitWallAtPoint(segment, point)
    if (!splitResult) {
      return { success: false, error: 'Cannot split: point is at endpoint or not on wall' }
    }

    const [leftSeg, rightSeg] = splitResult
    const left = segmentToWall(leftSeg, wall)
    const right = segmentToWall(rightSeg, wall)

    // Replace original with two segments
    floor.walls!.splice(index, 1, left, right)

    // Record lineage metadata
    left.metadata = { ...(left.metadata || {}), sourceWallId: wallId }
    right.metadata = { ...(right.metadata || {}), sourceWallId: wallId }

    // W7A: migrate openings on the split wall
    const splitOffset = Math.sqrt(
      (point.x - wall.start.x) ** 2 + (point.y - wall.start.y) ** 2,
    )
    let preSplitOpenings: Opening[] | undefined
    if (floor.openings && floor.openings.length > 0) {
      preSplitOpenings = JSON.parse(JSON.stringify(floor.openings))
      floor.openings = migrateOpeningsOnSplit(
        floor.openings, wallId, left.id, right.id, splitOffset,
      )
    }

    recordChange(document, { entityId: wallId, entityType: 'wall', operation: 'updated' })

    return {
      success: true,
      entityId: wallId,
      data: {
        buildingId,
        floorId,
        leftId: left.id,
        rightId: right.id,
        originalWall: {
          id: wall.id,
          start: { ...wall.start },
          end: { ...wall.end },
          thickness: wall.thickness,
          height: wall.height,
          metadata: wall.metadata ? { ...wall.metadata } : undefined,
        },
        ...(preSplitOpenings !== undefined ? { preSplitOpenings } : {}),
      },
    }
  },
  inverse(payload: Record<string, unknown>, result: MutationResult): Command | null {
    const originalWall = result.data?.originalWall as {
      id: string; start: LocalCoord; end: LocalCoord; thickness: number; height: number; metadata?: Record<string, unknown>
    }
    if (!originalWall) return null

    const buildingId = result.data?.buildingId as string
    const floorId = result.data?.floorId as string
    const leftId = result.data?.leftId as string
    const rightId = result.data?.rightId as string

    return {
      id: 'wall.split.undo',
      label: 'Undo Split Wall',
      payload: {
        buildingId,
        floorId,
        leftId,
        rightId,
        originalWall,
        ...(result.data?.preSplitOpenings !== undefined ? { preSplitOpenings: result.data.preSplitOpenings } : {}),
      },
    }
  },
}

// ── wall.split.undo ──

export const wallSplitUndoHandler: CommandHandler = {
  id: 'wall.split.undo',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const buildingId = payload.buildingId as string
    const floorId = payload.floorId as string
    const leftId = payload.leftId as string
    const rightId = payload.rightId as string
    const originalWall = payload.originalWall as {
      id: string; start: LocalCoord; end: LocalCoord; thickness: number; height: number; metadata?: Record<string, unknown>
    }

    if (!buildingId || !floorId) return { success: false, error: 'buildingId and floorId are required' }

    const floorResult = getFloor(document, buildingId, floorId)
    if ('error' in floorResult) return { success: false, error: floorResult.error }
    const floor = floorResult.floor

    // Remove the two split segments
    if (!floor.walls) return { success: false, error: 'No walls on floor' }

    const leftIdx = floor.walls.findIndex(w => w.id === leftId)
    const rightIdx = floor.walls.findIndex(w => w.id === rightId)

    // Remove right first (higher index) then left to avoid index shifting
    const indices = [leftIdx, rightIdx].filter(i => i >= 0).sort((a, b) => b - a)
    for (const idx of indices) {
      floor.walls.splice(idx, 1)
    }

    // Restore original wall
    const restored: Wall = {
      id: originalWall.id,
      start: originalWall.start,
      end: originalWall.end,
      thickness: originalWall.thickness,
      height: originalWall.height,
      ...(originalWall.metadata ? { metadata: originalWall.metadata } : {}),
    }
    floor.walls.push(restored)

    // W7A: restore pre-split openings
    const preSplitOpenings = payload.preSplitOpenings as Opening[] | undefined
    if (preSplitOpenings !== undefined) {
      floor.openings = preSplitOpenings
    }

    recordChange(document, { entityId: originalWall.id, entityType: 'wall', operation: 'updated' })

    return {
      success: true,
      entityId: originalWall.id,
      data: { buildingId, floorId },
    }
  },
}

// ── wall.crossingSplit ──

export const wallCrossingSplitHandler: CommandHandler = {
  id: 'wall.crossingSplit',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const buildingId = payload.buildingId as string
    const floorId = payload.floorId as string
    const wallIdA = payload.wallIdA as string
    const wallIdB = payload.wallIdB as string

    if (!buildingId || !floorId) return { success: false, error: 'buildingId and floorId are required' }
    if (!wallIdA || !wallIdB) return { success: false, error: 'wallIdA and wallIdB are required' }
    if (wallIdA === wallIdB) return { success: false, error: 'Cannot cross-split a wall with itself' }

    const floorResult = getFloor(document, buildingId, floorId)
    if ('error' in floorResult) return { success: false, error: floorResult.error }
    const floor = floorResult.floor

    const wallAResult = findWall(floor, wallIdA)
    if ('error' in wallAResult) return { success: false, error: wallAResult.error }
    const wallBResult = findWall(floor, wallIdB)
    if ('error' in wallBResult) return { success: false, error: wallBResult.error }

    const wallA = wallAResult.wall
    const wallB = wallBResult.wall

    // Find intersection
    const segments: WallSegment[] = [wallToSegment(wallA), wallToSegment(wallB)]
    const intersections = findIntersections(segments)
    if (intersections.length === 0) {
      return { success: false, error: 'Walls do not cross' }
    }

    const intersection = intersections[0]
    const point = intersection.point

    // Split both walls at the intersection point
    const segA = wallToSegment(wallA)
    const segB = wallToSegment(wallB)

    const splitA = splitWallAtPoint(segA, point)
    const splitB = splitWallAtPoint(segB, point)

    if (!splitA || !splitB) {
      return { success: false, error: 'Cannot split at intersection point' }
    }

    const [leftA, rightA] = splitA
    const [leftB, rightB] = splitB

    const newWallA1 = segmentToWall(leftA, wallA)
    const newWallA2 = segmentToWall(rightA, wallA)
    const newWallB1 = segmentToWall(leftB, wallB)
    const newWallB2 = segmentToWall(rightB, wallB)

    // Add lineage
    newWallA1.metadata = { ...(newWallA1.metadata || {}), sourceWallId: wallIdA }
    newWallA2.metadata = { ...(newWallA2.metadata || {}), sourceWallId: wallIdA }
    newWallB1.metadata = { ...(newWallB1.metadata || {}), sourceWallId: wallIdB }
    newWallB2.metadata = { ...(newWallB2.metadata || {}), sourceWallId: wallIdB }

    // Remove originals (higher index first)
    const indices = [wallAResult.index, wallBResult.index].sort((a, b) => b - a)
    for (const idx of indices) {
      floor.walls!.splice(idx, 1)
    }

    // Add new segments
    floor.walls!.push(newWallA1, newWallA2, newWallB1, newWallB2)

    // W7A: migrate openings for both split walls
    let preSplitOpeningsA: Opening[] | undefined
    let preSplitOpeningsB: Opening[] | undefined
    if (floor.openings && floor.openings.length > 0) {
      const splitOffsetA = Math.sqrt(
        (point.x - wallA.start.x) ** 2 + (point.y - wallA.start.y) ** 2,
      )
      const splitOffsetB = Math.sqrt(
        (point.x - wallB.start.x) ** 2 + (point.y - wallB.start.y) ** 2,
      )
      preSplitOpeningsA = JSON.parse(JSON.stringify(floor.openings))
      floor.openings = migrateOpeningsOnSplit(
        floor.openings, wallIdA, newWallA1.id, newWallA2.id, splitOffsetA,
      )
      preSplitOpeningsB = JSON.parse(JSON.stringify(floor.openings))
      floor.openings = migrateOpeningsOnSplit(
        floor.openings, wallIdB, newWallB1.id, newWallB2.id, splitOffsetB,
      )
    }

    recordChange(document, { entityId: wallIdA, entityType: 'wall', operation: 'updated' })
    recordChange(document, { entityId: wallIdB, entityType: 'wall', operation: 'updated' })

    return {
      success: true,
      entityId: wallIdA,
      data: {
        buildingId,
        floorId,
        wallIdA,
        wallIdB,
        newIds: [newWallA1.id, newWallA2.id, newWallB1.id, newWallB2.id],
        originalA: {
          id: wallA.id, start: { ...wallA.start }, end: { ...wallA.end },
          thickness: wallA.thickness, height: wallA.height, metadata: wallA.metadata ? { ...wallA.metadata } : undefined,
        },
        originalB: {
          id: wallB.id, start: { ...wallB.start }, end: { ...wallB.end },
          thickness: wallB.thickness, height: wallB.height, metadata: wallB.metadata ? { ...wallB.metadata } : undefined,
        },
        ...(preSplitOpeningsA !== undefined ? { preSplitOpenings: preSplitOpeningsA } : {}),
      },
    }
  },
  inverse(payload: Record<string, unknown>, result: MutationResult): Command | null {
    const originalA = result.data?.originalA as {
      id: string; start: LocalCoord; end: LocalCoord; thickness: number; height: number; metadata?: Record<string, unknown>
    }
    const originalB = result.data?.originalB as {
      id: string; start: LocalCoord; end: LocalCoord; thickness: number; height: number; metadata?: Record<string, unknown>
    }
    if (!originalA || !originalB) return null

    const newIds = result.data?.newIds as string[]

    return {
      id: 'wall.crossingSplit.undo',
      label: 'Undo Crossing Split',
      payload: {
        buildingId: result.data?.buildingId,
        floorId: result.data?.floorId,
        newIds,
        originalA,
        originalB,
        ...(result.data?.preSplitOpenings !== undefined ? { preSplitOpenings: result.data.preSplitOpenings } : {}),
      },
    }
  },
}

// ── wall.crossingSplit.undo ──

export const wallCrossingSplitUndoHandler: CommandHandler = {
  id: 'wall.crossingSplit.undo',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const buildingId = payload.buildingId as string
    const floorId = payload.floorId as string
    const newIds = payload.newIds as string[]
    const originalA = payload.originalA as Wall
    const originalB = payload.originalB as Wall

    if (!buildingId || !floorId) return { success: false, error: 'buildingId and floorId are required' }

    const floorResult = getFloor(document, buildingId, floorId)
    if ('error' in floorResult) return { success: false, error: floorResult.error }
    const floor = floorResult.floor
    if (!floor.walls) return { success: false, error: 'No walls on floor' }

    // Remove split segments (sort indices descending to avoid shifting)
    const indicesToRemove = newIds
      .map(id => floor.walls!.findIndex(w => w.id === id))
      .filter(i => i >= 0)
      .sort((a, b) => b - a)
    for (const idx of indicesToRemove) {
      floor.walls!.splice(idx, 1)
    }

    // Restore originals
    floor.walls!.push(
      { id: originalA.id, start: originalA.start, end: originalA.end, thickness: originalA.thickness, height: originalA.height, ...(originalA.metadata ? { metadata: originalA.metadata } : {}) },
      { id: originalB.id, start: originalB.start, end: originalB.end, thickness: originalB.thickness, height: originalB.height, ...(originalB.metadata ? { metadata: originalB.metadata } : {}) },
    )

    // W7A: restore pre-split openings
    const preSplitOpenings = payload.preSplitOpenings as Opening[] | undefined
    if (preSplitOpenings !== undefined) {
      floor.openings = preSplitOpenings
    }

    recordChange(document, { entityId: originalA.id, entityType: 'wall', operation: 'updated' })
    recordChange(document, { entityId: originalB.id, entityType: 'wall', operation: 'updated' })

    return { success: true, entityId: originalA.id, data: { buildingId, floorId } }
  },
}

// ── wall.tJunctionSplit ──

export const wallTJunctionSplitHandler: CommandHandler = {
  id: 'wall.tJunctionSplit',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const buildingId = payload.buildingId as string
    const floorId = payload.floorId as string
    const hostWallId = payload.hostWallId as string
    const junctionPoint = payload.junctionPoint as LocalCoord

    if (!buildingId || !floorId) return { success: false, error: 'buildingId and floorId are required' }
    if (!hostWallId) return { success: false, error: 'hostWallId is required' }
    if (!junctionPoint) return { success: false, error: 'junctionPoint is required' }

    const floorResult = getFloor(document, buildingId, floorId)
    if ('error' in floorResult) return { success: false, error: floorResult.error }
    const floor = floorResult.floor

    const hostResult = findWall(floor, hostWallId)
    if ('error' in hostResult) return { success: false, error: hostResult.error }
    const hostWall = hostResult.wall

    // Build segments for T-junction detection (all walls on this floor)
    const allSegments: WallSegment[] = floor.walls!.map(wallToSegment)
    const segmentsAfterSplit = splitAtTJunction(allSegments, junctionPoint)

    // Find which new segments came from the host wall
    const hostSegment = wallToSegment(hostWall)
    const splitResult = splitWallAtPoint(hostSegment, junctionPoint)

    if (!splitResult) {
      return { success: false, error: 'Cannot split host wall at junction point' }
    }

    const [leftSeg, rightSeg] = splitResult
    const left = segmentToWall(leftSeg, hostWall)
    const right = segmentToWall(rightSeg, hostWall)

    left.metadata = { ...(left.metadata || {}), sourceWallId: hostWallId }
    right.metadata = { ...(right.metadata || {}), sourceWallId: hostWallId }

    // Replace host wall
    floor.walls!.splice(hostResult.index, 1, left, right)

    recordChange(document, { entityId: hostWallId, entityType: 'wall', operation: 'updated' })

    return {
      success: true,
      entityId: hostWallId,
      data: {
        buildingId,
        floorId,
        leftId: left.id,
        rightId: right.id,
        originalWall: {
          id: hostWall.id, start: { ...hostWall.start }, end: { ...hostWall.end },
          thickness: hostWall.thickness, height: hostWall.height,
          metadata: hostWall.metadata ? { ...hostWall.metadata } : undefined,
        },
      },
    }
  },
  inverse(payload: Record<string, unknown>, result: MutationResult): Command | null {
    const originalWall = result.data?.originalWall as {
      id: string; start: LocalCoord; end: LocalCoord; thickness: number; height: number; metadata?: Record<string, unknown>
    }
    if (!originalWall) return null

    return {
      id: 'wall.split.undo',
      label: 'Undo T-Junction Split',
      payload: {
        buildingId: result.data?.buildingId,
        floorId: result.data?.floorId,
        leftId: result.data?.leftId,
        rightId: result.data?.rightId,
        originalWall,
      },
    }
  },
}

// ── wall.merge ──

export const wallMergeHandler: CommandHandler = {
  id: 'wall.merge',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const buildingId = payload.buildingId as string
    const floorId = payload.floorId as string
    const wallIds = payload.wallIds as string[]

    if (!buildingId || !floorId) return { success: false, error: 'buildingId and floorId are required' }
    if (!wallIds || wallIds.length < 2) return { success: false, error: 'At least two wallIds required for merge' }

    const floorResult = getFloor(document, buildingId, floorId)
    if ('error' in floorResult) return { success: false, error: floorResult.error }
    const floor = floorResult.floor

    // Find all walls to merge
    const wallsToMerge: { wall: Wall; index: number }[] = []
    for (const id of wallIds) {
      const result = findWall(floor, id)
      if ('error' in result) return { success: false, error: result.error }
      wallsToMerge.push({ wall: result.wall, index: result.index })
    }

    // Convert to segments for merge algorithm
    const segments: WallSegment[] = wallsToMerge.map(({ wall }) => wallToSegment(wall))
    const merged = mergeWalls(segments)

    if (merged.length === segments.length) {
      return { success: false, error: 'Walls are not collinear or do not share endpoints — merge not possible' }
    }

    // The merged result should be fewer segments — find the surviving merged wall
    // Remove all original walls (sort indices descending)
    const indicesToRemove = wallsToMerge
      .map(w => w.index)
      .sort((a, b) => b - a)
    for (const idx of indicesToRemove) {
      floor.walls!.splice(idx, 1)
    }

    // Use the first wall's ID for the merged result, keep its metadata
    const firstWall = wallsToMerge[0].wall
    const mergedSegment = merged[0] // mergeWalls returns a single segment for collinear chains

    const mergedWall: Wall = {
      id: firstWall.id,
      start: mergedSegment.start,
      end: mergedSegment.end,
      thickness: firstWall.thickness,
      height: firstWall.height,
      ...(firstWall.metadata ? { metadata: { ...firstWall.metadata } } : {}),
    }

    // Track lineage
    mergedWall.metadata = {
      ...(mergedWall.metadata || {}),
      sourceWallIds: wallIds,
    }

    floor.walls!.push(mergedWall)

    // W7A: migrate openings from removed walls to the merged wall
    const removedIds = wallIds.slice(1)
    let preMergeOpenings: Opening[] | undefined
    if (floor.openings && floor.openings.length > 0) {
      preMergeOpenings = JSON.parse(JSON.stringify(floor.openings))
      const wallsBefore = wallsToMerge.map(({ wall }) => ({
        id: wall.id, start: wall.start, end: wall.end,
      }))
      floor.openings = migrateOpeningsOnMerge(
        floor.openings, removedIds, firstWall.id, wallsBefore,
      )
    }

    recordChange(document, { entityId: firstWall.id, entityType: 'wall', operation: 'updated' })

    return {
      success: true,
      entityId: firstWall.id,
      data: {
        buildingId,
        floorId,
        mergedId: firstWall.id,
        removedIds,
        originalWalls: wallsToMerge.map(({ wall }) => ({
          id: wall.id, start: { ...wall.start }, end: { ...wall.end },
          thickness: wall.thickness, height: wall.height,
          metadata: wall.metadata ? { ...wall.metadata } : undefined,
        })),
        ...(preMergeOpenings !== undefined ? { preMergeOpenings } : {}),
      },
    }
  },
  inverse(payload: Record<string, unknown>, result: MutationResult): Command | null {
    const originalWalls = result.data?.originalWalls as Array<{
      id: string; start: LocalCoord; end: LocalCoord; thickness: number; height: number; metadata?: Record<string, unknown>
    }>
    if (!originalWalls || originalWalls.length < 2) return null

    return {
      id: 'wall.merge.undo',
      label: 'Undo Merge Walls',
      payload: {
        buildingId: result.data?.buildingId,
        floorId: result.data?.floorId,
        mergedId: result.data?.mergedId,
        removedIds: result.data?.removedIds,
        originalWalls,
        ...(result.data?.preMergeOpenings !== undefined ? { preMergeOpenings: result.data.preMergeOpenings } : {}),
      },
    }
  },
}

// ── wall.merge.undo ──

export const wallMergeUndoHandler: CommandHandler = {
  id: 'wall.merge.undo',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const buildingId = payload.buildingId as string
    const floorId = payload.floorId as string
    const mergedId = payload.mergedId as string
    const originalWalls = payload.originalWalls as Array<{
      id: string; start: LocalCoord; end: LocalCoord; thickness: number; height: number; metadata?: Record<string, unknown>
    }>

    if (!buildingId || !floorId) return { success: false, error: 'buildingId and floorId are required' }

    const floorResult = getFloor(document, buildingId, floorId)
    if ('error' in floorResult) return { success: false, error: floorResult.error }
    const floor = floorResult.floor
    if (!floor.walls) return { success: false, error: 'No walls on floor' }

    // Remove merged wall
    const mergedIdx = floor.walls.findIndex(w => w.id === mergedId)
    if (mergedIdx >= 0) {
      floor.walls.splice(mergedIdx, 1)
    }

    // Restore originals
    for (const orig of originalWalls) {
      floor.walls.push({
        id: orig.id,
        start: orig.start,
        end: orig.end,
        thickness: orig.thickness,
        height: orig.height,
        ...(orig.metadata ? { metadata: orig.metadata } : {}),
      })
    }

    // W7A: restore pre-merge openings
    const preMergeOpenings = payload.preMergeOpenings as Opening[] | undefined
    if (preMergeOpenings !== undefined) {
      floor.openings = preMergeOpenings
    }

    recordChange(document, { entityId: mergedId, entityType: 'wall', operation: 'updated' })

    return { success: true, entityId: mergedId, data: { buildingId, floorId } }
  },
}
