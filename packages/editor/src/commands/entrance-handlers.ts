import { recordChange } from '@navi/core'
import type { CampusDocument, LocalCoord, EntranceType } from '@navi/core'
import type { CommandHandler, Command, MutationResult } from './types'
import { genId } from '../id'
import { cleanupEntranceRoutingReferences } from './routing-relationship-cleanup'

function findFloor(document: CampusDocument, buildingId: string, floorId: string) {
  const building = document.buildings.find(b => b.id === buildingId)
  if (!building) return null
  const floor = building.floors.find(f => f.id === floorId)
  return floor ? { building, floor } : null
}

export const entranceCreateHandler: CommandHandler = {
  id: 'entrance.create',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const buildingId = payload.buildingId as string
    const floorId = payload.floorId as string
    const ctx = findFloor(document, buildingId, floorId)
    if (!ctx) return { success: false, error: `Building/floor not found: ${buildingId}/${floorId}` }

    const id = (payload.id as string) || genId('ent')
    const label = (payload.label as string) || ''
    // P1-T4 (D9): entrance positions are building-local — the caller converts
    // world clicks via CoordinateTransformer before dispatching (useEntrancePlacer).
    const position = payload.position as LocalCoord | undefined
    const level = (payload.level as number) ?? ctx.floor.level
    const type = (payload.type as EntranceType) || 'side'
    const hasQR = (payload.hasQR as boolean) ?? true
    const hasPanorama = (payload.hasPanorama as boolean) ?? false
    const connectorRoadId = payload.connectorRoadId as string | undefined

    if (!position) return { success: false, error: 'Entrance position is required' }

    ctx.floor.entrances.push({ id, label, position, level, type, hasQR, hasPanorama, connectorRoadId })

    recordChange(document, { entityId: id, entityType: 'entrance', operation: 'created' })
    return { success: true, entityId: id, data: { id, buildingId, floorId } }
  },
  inverse(payload: Record<string, unknown>, result: MutationResult): Command | null {
    const id = (result.data?.id as string) || payload.id as string
    return {
      id: 'entrance.delete',
      label: 'Undo Create Entrance',
      payload: { entranceId: id, buildingId: result.data?.buildingId as string, floorId: result.data?.floorId as string },
    }
  },
}

export const entranceDeleteHandler: CommandHandler = {
  id: 'entrance.delete',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const entranceId = payload.entranceId as string
    for (const bld of document.buildings) {
      for (const flr of bld.floors) {
        const index = flr.entrances.findIndex(e => e.id === entranceId)
        if (index !== -1) {
          flr.entrances.splice(index, 1)
          cleanupEntranceRoutingReferences(document, entranceId)
          recordChange(document, { entityId: entranceId, entityType: 'entrance', operation: 'deleted' })
          return { success: true, entityId: entranceId }
        }
      }
    }
    return { success: false, error: `Entrance not found: ${entranceId}` }
  },
  inverse(): Command | null {
    return null
  },
}
