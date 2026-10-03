import { recordChange } from '@navi/core'
import type { CampusDocument } from '@navi/core'
import type { CommandHandler, MutationResult } from './types'
import { recalculateBuilding } from './floor-handlers'
import { buildRoadJunctionMovePlan } from './road-junction-geometry'
import type { RoadJunctionMoveRequest } from './road-junction-geometry'

export function detectEntityType(document: CampusDocument, id: string): string {
  for (const bld of document.buildings) {
    if (bld.id === id) return 'building'
    for (const flr of bld.floors) {
      if (flr.id === id) return 'floor'
      for (const rm of flr.rooms) if (rm.id === id) return 'room'
      for (const hw of flr.hallways) if (hw.id === id) return 'hallway'
      for (const st of flr.staircases) if (st.id === id) return 'staircase'
      for (const el of flr.elevators) if (el.id === id) return 'elevator'
      for (const ent of flr.entrances) if (ent.id === id) return 'entrance'
    }
  }
  for (const rd of document.roads) if (rd.id === id) return 'road'
  for (const pan of document.panoramas) if (pan.id === id) return 'panorama'
  for (const qr of document.qrCheckpoints) if (qr.id === id) return 'checkpoint'
  return 'unknown'
}

function resolveEntity(document: CampusDocument, id: string): Record<string, any> | null {
  for (const bld of document.buildings) {
    if (bld.id === id) return bld as any
    for (const flr of bld.floors) {
      if (flr.id === id) return flr as any
      for (const rm of flr.rooms) if (rm.id === id) return rm as any
      for (const hw of flr.hallways) if (hw.id === id) return hw as any
      for (const st of flr.staircases) if (st.id === id) return st as any
      for (const el of flr.elevators) if (el.id === id) return el as any
      for (const ent of flr.entrances) if (ent.id === id) return ent as any
    }
  }
  for (const rd of document.roads) if (rd.id === id) return rd as any
  for (const pan of document.panoramas) if (pan.id === id) return pan as any
  for (const qr of document.qrCheckpoints) if (qr.id === id) return qr as any
  return null
}

export const entityUpdateHandler: CommandHandler = {
  id: 'entity.update',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const entityId = payload.entityId as string
    const changes = payload.changes as Record<string, unknown> | undefined
    if (!entityId) return { success: false, error: 'entityId is required' }
    if (!changes) return { success: false, error: 'changes are required' }

    const entity = resolveEntity(document, entityId)
    if (!entity) return { success: false, error: `Entity not found: ${entityId}` }

    const hasJunctionMove = payload.junctionMove !== undefined
    const junctionMovePlan = hasJunctionMove
      ? buildRoadJunctionMovePlan(document, payload.junctionMove as RoadJunctionMoveRequest)
      : null
    if (hasJunctionMove && !junctionMovePlan) {
      return { success: false, error: 'Road junction move is invalid or no longer connected' }
    }

    const oldValues: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(changes)) {
      oldValues[key] = entity[key]
      entity[key] = value
    }

    if (junctionMovePlan) {
      for (const roadGeometry of junctionMovePlan.roads) {
        const road = document.roads.find((candidate) => candidate.id === roadGeometry.roadId)
        if (!road) return { success: false, error: `Road not found: ${roadGeometry.roadId}` }
        road.polyline = { ...road.polyline, points: roadGeometry.points }
        if (road.id !== entityId) {
          recordChange(document, { entityId: road.id, entityType: 'road', operation: 'updated' })
        }
      }
      const junction = document.roadJunctions?.find((candidate) => candidate.id === junctionMovePlan.junctionId)
      if (!junction) return { success: false, error: `Road junction not found: ${junctionMovePlan.junctionId}` }
      junction.position = junctionMovePlan.position
    }

    const entityType = detectEntityType(document, entityId)
    recordChange(document, { entityId, entityType, operation: 'updated' })

    // Recalculate building when floor height or building roofHeight changes
    if (entityType === 'floor' && ('height' in changes)) {
      for (const bld of document.buildings) {
        if (bld.floors.some(f => f.id === entityId)) {
          recalculateBuilding(bld)
          break
        }
      }
    } else if (entityType === 'building' && ('roofHeight' in changes)) {
      const bld = document.buildings.find(b => b.id === entityId)
      if (bld) recalculateBuilding(bld)
    }

    const junctionMoveSnapshot = junctionMovePlan
      ? {
          junctionId: junctionMovePlan.junctionId,
          position: junctionMovePlan.previousPosition,
          roadGeometry: junctionMovePlan.roads.map(({ roadId, previousPoints }) => ({
            roadId,
            points: previousPoints,
          })),
        }
      : undefined
    return { success: true, entityId, data: { oldValues, junctionMoveSnapshot } }
  },
  inverse(payload: Record<string, unknown>, result: MutationResult): any {
    const entityId = payload.entityId as string
    const oldValues = result.data?.oldValues as Record<string, unknown>
    const junctionMove = result.data?.junctionMoveSnapshot as RoadJunctionMoveRequest | undefined
    return {
      id: 'entity.update',
      label: 'Undo Property Edit',
      payload: { entityId, changes: oldValues, ...(junctionMove ? { junctionMove } : {}) },
    }
  },
}
