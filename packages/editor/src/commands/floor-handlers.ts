import { recordChange } from '@navi/core'
import type { CampusDocument, Building } from '@navi/core'
import type { CommandHandler, Command, MutationResult } from './types'
import { genId } from '../id'
import { cleanupFloorRoutingReferences } from './routing-relationship-cleanup'

const DEFAULT_FLOOR_HEIGHT = 3.5

export function recalculateBuilding(building: Building): void {
  const sorted = [...building.floors].sort((a, b) => a.level - b.level)
  let accum = 0
  for (const floor of sorted) {
    floor.elevation = accum
    accum += floor.height ?? DEFAULT_FLOOR_HEIGHT
  }
}

export const floorCreateHandler: CommandHandler = {
  id: 'floor.create',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const buildingId = payload.buildingId as string
    const building = document.buildings.find(b => b.id === buildingId)
    if (!building) return { success: false, error: `Building not found: ${buildingId}` }

    const id = (payload.id as string) || genId('flr')
    const label = (payload.label as string) || `Floor ${building.floors.length + 1}`
    const level = (payload.level as number) ?? building.floors.length
    const height = (payload.height as number) ?? DEFAULT_FLOOR_HEIGHT

    building.floors.push({ id, level, label, height, elevation: 0, visible: true, locked: false, rooms: [], hallways: [], staircases: [], elevators: [], entrances: [], connectorStops: [], metadata: {} })
    recalculateBuilding(building)

    recordChange(document, { entityId: id, entityType: 'floor', operation: 'created' })
    return { success: true, entityId: id, data: { id, buildingId } }
  },
  inverse(payload: Record<string, unknown>, result: MutationResult): Command | null {
    const id = (result.data?.id as string) || payload.id as string
    return { id: 'floor.delete', label: 'Undo Create Floor', payload: { floorId: id, buildingId: result.data?.buildingId as string } }
  },
}

export const floorRenameHandler: CommandHandler = {
  id: 'floor.rename',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const floorId = payload.floorId as string
    const newLabel = payload.label as string
    for (const bld of document.buildings) {
      const floor = bld.floors.find(f => f.id === floorId)
      if (floor) {
        const oldLabel = floor.label
        floor.label = newLabel
        recordChange(document, { entityId: floorId, entityType: 'floor', operation: 'updated' })
        return { success: true, entityId: floorId, data: { oldLabel } }
      }
    }
    return { success: false, error: `Floor not found: ${floorId}` }
  },
  inverse(payload: Record<string, unknown>, result: MutationResult): Command | null {
    return {
      id: 'floor.rename',
      label: 'Undo Rename Floor',
      payload: { floorId: payload.floorId as string, label: result.data?.oldLabel as string },
    }
  },
}

export const floorDeleteHandler: CommandHandler = {
  id: 'floor.delete',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const floorId = payload.floorId as string
    for (const bld of document.buildings) {
      const index = bld.floors.findIndex(f => f.id === floorId)
      if (index !== -1) {
        const floor = bld.floors[index]
        cleanupFloorRoutingReferences(document, bld, floor)
        bld.floors.splice(index, 1)
        // Cascade: remove panoramas and QR checkpoints on this floor
        document.panoramas = document.panoramas.filter(
          p => !(p.buildingId === bld.id && p.floor === floor.level)
        )
        document.qrCheckpoints = document.qrCheckpoints.filter(
          q => !(q.buildingId === bld.id && q.floor === floor.level)
        )
        recalculateBuilding(bld)
        recordChange(document, { entityId: floorId, entityType: 'floor', operation: 'deleted' })
        return { success: true, entityId: floorId }
      }
    }
    return { success: false, error: `Floor not found: ${floorId}` }
  },
  inverse(): Command | null {
    return null
  },
}

export const floorReorderHandler: CommandHandler = {
  id: 'floor.reorder',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const buildingId = payload.buildingId as string
    const floorIds = payload.floorIds as string[]
    if (!buildingId || !Array.isArray(floorIds) || floorIds.length === 0) {
      return { success: false, error: 'Invalid payload: buildingId and floorIds required' }
    }
    const building = document.buildings.find(b => b.id === buildingId)
    if (!building) return { success: false, error: `Building not found: ${buildingId}` }
    if (floorIds.length !== building.floors.length) {
      return { success: false, error: 'floorIds must match existing floor count' }
    }
    const allExist = floorIds.every(fid => building.floors.some(f => f.id === fid))
    if (!allExist) {
      return { success: false, error: 'One or more floorIds not found in building' }
    }
    const originalFloorIds = building.floors.map(f => f.id)
    const floorMap = new Map(building.floors.map(f => [f.id, f]))
    building.floors = floorIds.map((fid, idx) => {
      const floor = floorMap.get(fid)!
      floor.level = idx
      return floor
    })
    recalculateBuilding(building)
    recordChange(document, { entityId: buildingId, entityType: 'floor', operation: 'updated' })
    return { success: true, entityId: buildingId, data: { originalFloorIds } }
  },
  inverse(payload: Record<string, unknown>, result: MutationResult): Command | null {
    const orig = result.data?.originalFloorIds as string[] | undefined
    if (!orig) return null
    return {
      id: 'floor.reorder',
      label: 'Undo Reorder Floors',
      payload: { buildingId: payload.buildingId as string, floorIds: orig },
    }
  },
}

export const floorDuplicateHandler: CommandHandler = {
  id: 'floor.duplicate',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const floorId = payload.floorId as string
    for (const bld of document.buildings) {
      const sourceFloor = bld.floors.find(f => f.id === floorId)
      if (sourceFloor) {
        const newId = genId('flr')
        const newLevel = bld.floors.length
        bld.floors.push({
          id: newId,
          level: newLevel,
          label: `${sourceFloor.label} (copy)`,
          height: sourceFloor.height ?? DEFAULT_FLOOR_HEIGHT,
          elevation: 0,
          visible: true, locked: false,
          rooms: JSON.parse(JSON.stringify(sourceFloor.rooms.map(r => ({ ...r, id: genId('rm') })))),
          hallways: JSON.parse(JSON.stringify(sourceFloor.hallways.map(h => ({ ...h, id: genId('hw') })))),
          staircases: JSON.parse(JSON.stringify(sourceFloor.staircases.map(s => ({ ...s, id: genId('st') })))),
          elevators: JSON.parse(JSON.stringify(sourceFloor.elevators.map(e => ({ ...e, id: genId('el') })))),
          entrances: JSON.parse(JSON.stringify(sourceFloor.entrances.map(e => ({ ...e, id: genId('ent') })))),
          connectorStops: JSON.parse(JSON.stringify((sourceFloor.connectorStops || []).map(cs => ({ ...cs, id: genId('cs') })))),
          metadata: {},
        })
        recalculateBuilding(bld)
        recordChange(document, { entityId: newId, entityType: 'floor', operation: 'created' })
        return { success: true, entityId: newId, data: { id: newId } }
      }
    }
    return { success: false, error: `Floor not found: ${floorId}` }
  },
  inverse(payload: Record<string, unknown>, result: MutationResult): Command | null {
    const id = (result.data?.id as string) || payload.id as string
    return { id: 'floor.delete', label: 'Undo Duplicate Floor', payload: { floorId: id } }
  },
}
