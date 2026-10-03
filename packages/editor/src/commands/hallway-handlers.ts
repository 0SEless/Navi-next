import { recordChange } from '@navi/core'
import type { CampusDocument, LocalCoord } from '@navi/core'
import type { CommandHandler, Command, MutationResult } from './types'
import { genId } from '../id'

function findFloor(document: CampusDocument, buildingId: string, floorId: string) {
  const building = document.buildings.find(b => b.id === buildingId)
  if (!building) return null
  const floor = building.floors.find(f => f.id === floorId)
  return floor ? { building, floor } : null
}

export const hallwayCreateHandler: CommandHandler = {
  id: 'hallway.create',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const buildingId = payload.buildingId as string
    const floorId = payload.floorId as string
    const ctx = findFloor(document, buildingId, floorId)
    if (!ctx) return { success: false, error: `Building/floor not found: ${buildingId}/${floorId}` }

    const id = (payload.id as string) || genId('hw')
    const name = (payload.name as string) || ''
    const points = payload.points as LocalCoord[] | undefined
    const width = (payload.width as number) || 3

    if (!points || points.length < 2) {
      return { success: false, error: 'Hallway polyline must have at least 2 points' }
    }

    ctx.floor.hallways.push({ id, name, polyline: { points }, width })

    recordChange(document, { entityId: id, entityType: 'hallway', operation: 'created' })
    return { success: true, entityId: id, data: { id, buildingId, floorId } }
  },
  inverse(payload: Record<string, unknown>, result: MutationResult): Command | null {
    const id = (result.data?.id as string) || payload.id as string
    return {
      id: 'hallway.delete',
      label: 'Undo Create Hallway',
      payload: { hallwayId: id, buildingId: result.data?.buildingId as string, floorId: result.data?.floorId as string },
    }
  },
}

export const hallwayRenameHandler: CommandHandler = {
  id: 'hallway.rename',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const hallwayId = payload.hallwayId as string
    const newName = payload.name as string
    for (const bld of document.buildings) {
      for (const flr of bld.floors) {
        const hw = flr.hallways.find(h => h.id === hallwayId)
        if (hw) {
          const oldName = hw.name
          hw.name = newName
          recordChange(document, { entityId: hallwayId, entityType: 'hallway', operation: 'updated' })
          return { success: true, entityId: hallwayId, data: { oldName } }
        }
      }
    }
    return { success: false, error: `Hallway not found: ${hallwayId}` }
  },
  inverse(payload: Record<string, unknown>, result: MutationResult): Command | null {
    return {
      id: 'hallway.rename',
      label: 'Undo Rename Hallway',
      payload: { hallwayId: payload.hallwayId as string, name: result.data?.oldName as string },
    }
  },
}

export const hallwayDeleteHandler: CommandHandler = {
  id: 'hallway.delete',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const hallwayId = payload.hallwayId as string
    for (const bld of document.buildings) {
      for (const flr of bld.floors) {
        const index = flr.hallways.findIndex(h => h.id === hallwayId)
        if (index !== -1) {
          flr.hallways.splice(index, 1)
          recordChange(document, { entityId: hallwayId, entityType: 'hallway', operation: 'deleted' })
          return { success: true, entityId: hallwayId }
        }
      }
    }
    return { success: false, error: `Hallway not found: ${hallwayId}` }
  },
  inverse(): Command | null {
    return null
  },
}
