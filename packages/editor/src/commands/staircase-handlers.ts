import { recordChange } from '@navi/core'
import type { CampusDocument, LocalCoord, StaircaseType } from '@navi/core'
import type { CommandHandler, Command, MutationResult } from './types'
import { genId } from '../id'

function findFloor(document: CampusDocument, buildingId: string, floorId: string) {
  const building = document.buildings.find(b => b.id === buildingId)
  if (!building) return null
  const floor = building.floors.find(f => f.id === floorId)
  return floor ? { building, floor } : null
}

export const staircaseCreateHandler: CommandHandler = {
  id: 'staircase.create',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const buildingId = payload.buildingId as string
    const floorId = payload.floorId as string
    const ctx = findFloor(document, buildingId, floorId)
    if (!ctx) return { success: false, error: `Building/floor not found: ${buildingId}/${floorId}` }

    const id = (payload.id as string) || genId('st')
    const name = (payload.name as string) || ''
    const position = payload.position as LocalCoord | undefined
    const fromLevel = (payload.fromLevel as number) ?? ctx.floor.level
    const toLevel = (payload.toLevel as number) ?? (ctx.floor.level + 1)
    const type = (payload.type as StaircaseType) || 'enclosed'

    if (!position) return { success: false, error: 'Staircase position is required' }

    ctx.floor.staircases.push({ id, name, position, fromLevel, toLevel, type })

    recordChange(document, { entityId: id, entityType: 'staircase', operation: 'created' })
    return { success: true, entityId: id, data: { id, buildingId, floorId } }
  },
  inverse(payload: Record<string, unknown>, result: MutationResult): Command | null {
    const id = (result.data?.id as string) || payload.id as string
    return {
      id: 'staircase.delete',
      label: 'Undo Create Staircase',
      payload: { staircaseId: id, buildingId: result.data?.buildingId as string, floorId: result.data?.floorId as string },
    }
  },
}

export const staircaseDeleteHandler: CommandHandler = {
  id: 'staircase.delete',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const staircaseId = payload.staircaseId as string
    for (const bld of document.buildings) {
      for (const flr of bld.floors) {
        const index = flr.staircases.findIndex(s => s.id === staircaseId)
        if (index !== -1) {
          flr.staircases.splice(index, 1)
          recordChange(document, { entityId: staircaseId, entityType: 'staircase', operation: 'deleted' })
          return { success: true, entityId: staircaseId }
        }
      }
    }
    return { success: false, error: `Staircase not found: ${staircaseId}` }
  },
  inverse(): Command | null {
    return null
  },
}
