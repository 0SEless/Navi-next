import { recordChange } from '@navi/core'
import type { CampusDocument, RoomCategory, LocalCoord } from '@navi/core'
import type { CommandHandler, Command, MutationResult } from './types'
import { genId } from '../id'

function findFloor(document: CampusDocument, buildingId: string, floorId: string) {
  const building = document.buildings.find(b => b.id === buildingId)
  if (!building) return null
  const floor = building.floors.find(f => f.id === floorId)
  return floor ? { building, floor } : null
}

export const roomCreateHandler: CommandHandler = {
  id: 'room.create',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const buildingId = payload.buildingId as string
    const floorId = payload.floorId as string
    const ctx = findFloor(document, buildingId, floorId)
    if (!ctx) return { success: false, error: `Building/floor not found: ${buildingId}/${floorId}` }

    const id = (payload.id as string) || genId('rm')
    const name = (payload.name as string) || ''
    const number = (payload.number as string) || ''
    const category = (payload.category as RoomCategory) || 'other'
    const points = payload.points as LocalCoord[] | undefined

    if (!points || points.length < 3) {
      return { success: false, error: 'Room polygon must have at least 3 points' }
    }

    ctx.floor.rooms.push({
      id, name, number, category,
      polygon: { points },
      roomDoors: [],
      metadata: {},
    })

    recordChange(document, { entityId: id, entityType: 'room', operation: 'created' })
    return { success: true, entityId: id, data: { id, buildingId, floorId } }
  },
  inverse(payload: Record<string, unknown>, result: MutationResult): Command | null {
    const id = (result.data?.id as string) || payload.id as string
    return {
      id: 'room.delete',
      label: 'Undo Create Room',
      payload: { roomId: id, buildingId: result.data?.buildingId as string, floorId: result.data?.floorId as string },
    }
  },
}

export const roomRenameHandler: CommandHandler = {
  id: 'room.rename',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const roomId = payload.roomId as string
    const newName = payload.name as string
    for (const bld of document.buildings) {
      for (const flr of bld.floors) {
        const room = flr.rooms.find(r => r.id === roomId)
        if (room) {
          const oldName = room.name
          room.name = newName
          recordChange(document, { entityId: roomId, entityType: 'room', operation: 'updated' })
          return { success: true, entityId: roomId, data: { oldName } }
        }
      }
    }
    return { success: false, error: `Room not found: ${roomId}` }
  },
  inverse(payload: Record<string, unknown>, result: MutationResult): Command | null {
    return {
      id: 'room.rename',
      label: 'Undo Rename Room',
      payload: { roomId: payload.roomId as string, name: result.data?.oldName as string },
    }
  },
}

export const roomDeleteHandler: CommandHandler = {
  id: 'room.delete',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const roomId = payload.roomId as string
    for (const bld of document.buildings) {
      for (const flr of bld.floors) {
        const index = flr.rooms.findIndex(r => r.id === roomId)
        if (index !== -1) {
          flr.rooms.splice(index, 1)
          recordChange(document, { entityId: roomId, entityType: 'room', operation: 'deleted' })
          return { success: true, entityId: roomId }
        }
      }
    }
    return { success: false, error: `Room not found: ${roomId}` }
  },
  inverse(): Command | null {
    return null
  },
}
