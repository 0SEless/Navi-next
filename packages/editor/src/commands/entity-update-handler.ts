import { recordChange } from '@navi/core'
import type { CampusDocument } from '@navi/core'
import type { CommandHandler, MutationResult } from './types'
import { recalculateBuilding } from './floor-handlers'
import { buildRoadJunctionMovePlan, type RoadJunctionMoveRequest } from './road-junction-geometry'

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

    const oldValues: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(changes)) {
      oldValues[key] = entity[key]
    }

    const junctionMoveRequest = payload.junctionMove as RoadJunctionMoveRequest | undefined
    let junctionMoveUndo: RoadJunctionMoveRequest | undefined
    if (junctionMoveRequest) {
      const plan = buildRoadJunctionMovePlan(document, junctionMoveRequest)
      if (!plan || !plan.roads.some((road) => road.roadId === entityId)) {
        return { success: false, error: 'Road junction geometry could not be moved consistently' }
      }

      for (const movedRoad of plan.roads) {
        const road = document.roads.find((candidate) => candidate.id === movedRoad.roadId)!
        road.polyline = { ...road.polyline, points: movedRoad.points.map((point) => ({ ...point })) }
        recordChange(document, { entityId: road.id, entityType: 'road', operation: 'updated' })
      }
      const junction = document.roadJunctions?.find((candidate) => candidate.id === plan.junctionId)
      if (!junction) return { success: false, error: 'Road junction not found' }
      junction.position = { ...plan.position }
      recordChange(document, { entityId: junction.id, entityType: 'roadJunction', operation: 'updated' })
      junctionMoveUndo = {
        junctionId: plan.junctionId,
        position: plan.previousPosition,
        roadGeometry: plan.roads.map((road) => ({ roadId: road.roadId, points: road.previousPoints })),
      }
    }

    for (const [key, value] of Object.entries(changes)) {
      if (junctionMoveRequest && key === 'polyline') continue
      entity[key] = value
    }

    const entityType = detectEntityType(document, entityId)
    if (!junctionMoveRequest || Object.keys(changes).some((key) => key !== 'polyline')) {
      recordChange(document, { entityId, entityType, operation: 'updated' })
    }

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

    return { success: true, entityId, data: { oldValues, ...(junctionMoveUndo ? { junctionMoveUndo } : {}) } }
  },
  inverse(payload: Record<string, unknown>, result: MutationResult): any {
    const entityId = payload.entityId as string
    const oldValues = result.data?.oldValues as Record<string, unknown>
    const junctionMoveUndo = result.data?.junctionMoveUndo as RoadJunctionMoveRequest | undefined
    return {
      id: 'entity.update',
      label: 'Undo Property Edit',
      payload: { entityId, changes: oldValues, ...(junctionMoveUndo ? { junctionMove: junctionMoveUndo } : {}) },
    }
  },
}
