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

export const elevatorCreateHandler: CommandHandler = {
  id: 'elevator.create',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const buildingId = payload.buildingId as string
    const floorId = payload.floorId as string
    const ctx = findFloor(document, buildingId, floorId)
    if (!ctx) return { success: false, error: `Building/floor not found: ${buildingId}/${floorId}` }

    const id = (payload.id as string) || genId('el')
    const name = (payload.name as string) || ''
    const position = payload.position as LocalCoord | undefined
    const fromLevel = (payload.fromLevel as number) ?? ctx.floor.level
    const toLevel = (payload.toLevel as number) ?? (ctx.floor.level + 1)

    if (!position) return { success: false, error: 'Elevator position is required' }

    ctx.floor.elevators.push({ id, name, position, fromLevel, toLevel })

    recordChange(document, { entityId: id, entityType: 'elevator', operation: 'created' })
    return { success: true, entityId: id, data: { id, buildingId, floorId } }
  },
  inverse(payload: Record<string, unknown>, result: MutationResult): Command | null {
    const id = (result.data?.id as string) || payload.id as string
    return {
      id: 'elevator.delete',
      label: 'Undo Create Elevator',
      payload: { elevatorId: id, buildingId: result.data?.buildingId as string, floorId: result.data?.floorId as string },
    }
  },
}

export const elevatorDeleteHandler: CommandHandler = {
  id: 'elevator.delete',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const elevatorId = payload.elevatorId as string
    for (const bld of document.buildings) {
      for (const flr of bld.floors) {
        const index = flr.elevators.findIndex(e => e.id === elevatorId)
        if (index !== -1) {
          flr.elevators.splice(index, 1)
          recordChange(document, { entityId: elevatorId, entityType: 'elevator', operation: 'deleted' })
          return { success: true, entityId: elevatorId }
        }
      }
    }
    return { success: false, error: `Elevator not found: ${elevatorId}` }
  },
  inverse(): Command | null {
    return null
  },
}
