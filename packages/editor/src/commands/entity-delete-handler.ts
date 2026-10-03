import { recordChange } from '@navi/core'
import type { CampusDocument } from '@navi/core'
import type { CommandHandler, MutationResult } from './types'
import { detectEntityType } from './entity-update-handler'
import { cleanupRoadReferences } from './road-handlers'
import {
  cleanupBuildingRoutingReferences,
  cleanupEntranceRoutingReferences,
  cleanupFloorRoutingReferences,
} from './routing-relationship-cleanup'

function removeEntity(document: CampusDocument, entityId: string): boolean {
  let idx = document.buildings.findIndex((b) => b.id === entityId)
  if (idx !== -1) {
    const building = document.buildings[idx]
    cleanupBuildingRoutingReferences(document, building)
    document.buildings.splice(idx, 1)
    document.panoramas = document.panoramas.filter(panorama => panorama.buildingId !== building.id)
    document.qrCheckpoints = document.qrCheckpoints.filter(checkpoint => checkpoint.buildingId !== building.id)
    return true
  }

  idx = document.roads.findIndex((r) => r.id === entityId)
  if (idx !== -1) {
    document.roads.splice(idx, 1)
    cleanupRoadReferences(document, entityId)
    return true
  }

  idx = document.panoramas.findIndex((p) => p.id === entityId)
  if (idx !== -1) {
    document.panoramas.splice(idx, 1)
    return true
  }

  idx = document.qrCheckpoints.findIndex((q) => q.id === entityId)
  if (idx !== -1) {
    document.qrCheckpoints.splice(idx, 1)
    return true
  }

  for (const bld of document.buildings) {
    idx = bld.floors.findIndex((f) => f.id === entityId)
    if (idx !== -1) {
      const floor = bld.floors[idx]
      cleanupFloorRoutingReferences(document, bld, floor)
      bld.floors.splice(idx, 1)
      document.panoramas = document.panoramas.filter(
        panorama => panorama.buildingId !== bld.id || panorama.floor !== floor.level,
      )
      document.qrCheckpoints = document.qrCheckpoints.filter(
        checkpoint => checkpoint.buildingId !== bld.id || checkpoint.floor !== floor.level,
      )
      return true
    }
    for (const flr of bld.floors) {
      idx = flr.rooms.findIndex((r) => r.id === entityId)
      if (idx !== -1) {
        flr.rooms.splice(idx, 1)
        return true
      }
      idx = flr.hallways.findIndex((h) => h.id === entityId)
      if (idx !== -1) {
        flr.hallways.splice(idx, 1)
        return true
      }
      idx = flr.staircases.findIndex((s) => s.id === entityId)
      if (idx !== -1) {
        flr.staircases.splice(idx, 1)
        return true
      }
      idx = flr.elevators.findIndex((e) => e.id === entityId)
      if (idx !== -1) {
        flr.elevators.splice(idx, 1)
        return true
      }
      idx = flr.entrances.findIndex((e) => e.id === entityId)
      if (idx !== -1) {
        flr.entrances.splice(idx, 1)
        cleanupEntranceRoutingReferences(document, entityId)
        return true
      }
    }
  }

  return false
}

export const entityDeleteHandler: CommandHandler = {
  id: 'entity.delete',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const entityId = payload.entityId as string
    if (!entityId) return { success: false, error: 'entityId is required' }

    const entityType = detectEntityType(document, entityId)
    if (entityType === 'unknown') return { success: false, error: `Entity not found: ${entityId}` }

    const removed = removeEntity(document, entityId)
    if (!removed) return { success: false, error: `Entity not found: ${entityId}` }

    recordChange(document, { entityId, entityType, operation: 'deleted' })
    return { success: true, entityId, data: { entityType } }
  },
  inverse(): null {
    return null
  },
}
