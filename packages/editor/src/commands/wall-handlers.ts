import { recordChange } from '@navi/core'
import type { CampusDocument, LocalCoord } from '@navi/core'
import type { CommandHandler, Command, MutationResult } from './types'
import { genId } from '../id'

const DEFAULT_WALL_THICKNESS = 0.15
const DEFAULT_WALL_HEIGHT = 3.5

export const wallCreateHandler: CommandHandler = {
  id: 'wall.create',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const buildingId = payload.buildingId as string
    const floorId = payload.floorId as string
    const start = payload.start as LocalCoord
    const end = payload.end as LocalCoord

    if (!buildingId || !floorId) {
      return { success: false, error: 'buildingId and floorId are required' }
    }
    if (!start || !end) {
      return { success: false, error: 'start and end coordinates are required' }
    }
    if (start.x === end.x && start.y === end.y) {
      return { success: false, error: 'wall start and end must be different points' }
    }

    const thickness = (payload.thickness as number) ?? DEFAULT_WALL_THICKNESS
    const height = (payload.height as number) ?? DEFAULT_WALL_HEIGHT
    if (thickness <= 0) {
      return { success: false, error: 'wall thickness must be greater than 0' }
    }
    if (height <= 0) {
      return { success: false, error: 'wall height must be greater than 0' }
    }

    const building = document.buildings.find(b => b.id === buildingId)
    if (!building) return { success: false, error: `Building not found: ${buildingId}` }

    const floor = building.floors.find(f => f.id === floorId)
    if (!floor) return { success: false, error: `Floor not found: ${floorId}` }

    if (!floor.walls) floor.walls = []

    const id = (payload.id as string) || genId('wall')
    const metadata = (payload.metadata as Record<string, unknown>) ?? {}

    const wall = {
      id,
      start,
      end,
      thickness,
      height,
      ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    }

    const existing = floor.walls.findIndex(w => w.id === id)
    if (existing >= 0) {
      floor.walls[existing] = wall
    } else {
      floor.walls.push(wall)
    }

    recordChange(document, { entityId: id, entityType: 'wall', operation: 'created' })
    return { success: true, entityId: id, data: { id, buildingId, floorId } }
  },
  inverse(payload: Record<string, unknown>, result: MutationResult): Command | null {
    return {
      id: 'wall.delete',
      label: 'Undo Create Wall',
      payload: {
        wallId: result.data?.id as string,
        buildingId: result.data?.buildingId as string,
        floorId: result.data?.floorId as string,
      },
    }
  },
}

export const wallUpdateHandler: CommandHandler = {
  id: 'wall.update',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const wallId = payload.wallId as string
    const buildingId = payload.buildingId as string
    const floorId = payload.floorId as string

    if (!wallId) return { success: false, error: 'wallId is required' }

    const building = document.buildings.find(b => b.id === buildingId)
    if (!building) return { success: false, error: `Building not found: ${buildingId}` }

    const floor = building.floors.find(f => f.id === floorId)
    if (!floor) return { success: false, error: `Floor not found: ${floorId}` }

    if (!floor.walls) return { success: false, error: `No walls on floor: ${floorId}` }

    const wall = floor.walls.find(w => w.id === wallId)
    if (!wall) return { success: false, error: `Wall not found: ${wallId}` }

    const patch = payload.patch as Record<string, unknown> | undefined
    if (!patch) return { success: false, error: 'patch is required' }

    const snapshot = {
      start: { ...wall.start },
      end: { ...wall.end },
      thickness: wall.thickness,
      height: wall.height,
      metadata: wall.metadata ? { ...wall.metadata } : undefined,
    }

    if (patch.start !== undefined) wall.start = patch.start as LocalCoord
    if (patch.end !== undefined) wall.end = patch.end as LocalCoord
    if (patch.thickness !== undefined) wall.thickness = patch.thickness as number
    if (patch.height !== undefined) wall.height = patch.height as number
    if (patch.metadata !== undefined) wall.metadata = patch.metadata as Record<string, unknown>

    recordChange(document, { entityId: wallId, entityType: 'wall', operation: 'updated' })
    return { success: true, entityId: wallId, data: { snapshot } }
  },
  inverse(payload: Record<string, unknown>, result: MutationResult): Command | null {
    const snapshot = result.data?.snapshot as {
      start: LocalCoord
      end: LocalCoord
      thickness: number
      height: number
      metadata?: Record<string, unknown>
    }
    if (!snapshot) return null
    return {
      id: 'wall.update',
      label: 'Undo Update Wall',
      payload: {
        wallId: payload.wallId,
        buildingId: payload.buildingId,
        floorId: payload.floorId,
        patch: snapshot,
      },
    }
  },
}

export const wallDeleteHandler: CommandHandler = {
  id: 'wall.delete',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const wallId = payload.wallId as string
    const buildingId = payload.buildingId as string
    const floorId = payload.floorId as string

    if (!wallId) return { success: false, error: 'wallId is required' }

    const building = document.buildings.find(b => b.id === buildingId)
    if (!building) return { success: false, error: `Building not found: ${buildingId}` }

    const floor = building.floors.find(f => f.id === floorId)
    if (!floor) return { success: false, error: `Floor not found: ${floorId}` }

    if (!floor.walls) return { success: false, error: `No walls on floor: ${floorId}` }

    const index = floor.walls.findIndex(w => w.id === wallId)
    if (index === -1) return { success: false, error: `Wall not found: ${wallId}` }

    const removed = floor.walls.splice(index, 1)[0]

    recordChange(document, { entityId: wallId, entityType: 'wall', operation: 'deleted' })
    return { success: true, entityId: wallId, data: { removed, buildingId, floorId } }
  },
  inverse(payload: Record<string, unknown>, result: MutationResult): Command | null {
    const removed = result.data?.removed as { id: string; start: LocalCoord; end: LocalCoord; thickness: number; height: number; metadata?: Record<string, unknown> }
    if (!removed) return null
    return {
      id: 'wall.create',
      label: 'Undo Delete Wall',
      payload: {
        id: removed.id,
        buildingId: result.data?.buildingId as string,
        floorId: result.data?.floorId as string,
        start: removed.start,
        end: removed.end,
        thickness: removed.thickness,
        height: removed.height,
        ...(removed.metadata ? { metadata: removed.metadata } : {}),
      },
    }
  },
}
