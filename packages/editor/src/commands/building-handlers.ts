import { recordChange } from '@navi/core'
import type { CampusDocument, BuildingCategory, Floor } from '@navi/core'
import type { CommandHandler, Command, MutationResult } from './types'
import { genId } from '../id'
import { cleanupBuildingRoutingReferences } from './routing-relationship-cleanup'

const defaultBuilding = (id: string, name: string, code: string) => ({
  id,
  name,
  code,
  category: 'academic' as BuildingCategory,
  description: '',
  footprint: { points: [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.001 }, { lat: 0.001, lng: 0.001 }, { lat: 0.001, lng: 0 }, { lat: 0, lng: 0 }] },
  baseElevation: 0,
  height: 20,
  floors: [] as Floor[],
  verticalConnectors: [],
  color: '#4A90D9',
  aliases: [],
  metadata: {},
})

export const buildingCreateHandler: CommandHandler = {
  id: 'building.create',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const name = (payload.name as string) || ''
    const code = (payload.code as string) || ''
    const id = (payload.id as string) || genId('bld')

    const building = defaultBuilding(id, name, code)
    const footprint = payload.footprint as { points: Array<{ lat: number; lng: number }> } | undefined
    if (footprint?.points) {
      building.footprint = footprint
    }
    const floors = payload.floors as Floor[] | undefined
    if (floors) building.floors = floors
    if (typeof payload.height === 'number') building.height = payload.height
    if (typeof payload.color === 'string') building.color = payload.color
    const existing = document.buildings.findIndex(b => b.id === id)
    if (existing >= 0) {
      document.buildings[existing] = building
    } else {
      document.buildings.push(building)
    }

    recordChange(document, { entityId: id, entityType: 'building', operation: 'created' })
    return { success: true, entityId: id, data: { id } }
  },
  inverse(payload: Record<string, unknown>, result: MutationResult): Command | null {
    const id = (result.data?.id as string) || payload.id as string
    return { id: 'building.delete', label: 'Undo Create', payload: { buildingId: id } }
  },
}

export const buildingRenameHandler: CommandHandler = {
  id: 'building.rename',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const buildingId = payload.buildingId as string
    const newName = payload.name as string
    const building = document.buildings.find(b => b.id === buildingId)
    if (!building) return { success: false, error: `Building not found: ${buildingId}` }

    const oldName = building.name
    building.name = newName

    recordChange(document, { entityId: buildingId, entityType: 'building', operation: 'updated' })
    return { success: true, entityId: buildingId, data: { oldName } }
  },
  inverse(payload: Record<string, unknown>, result: MutationResult): Command | null {
    return {
      id: 'building.rename',
      label: 'Undo Rename',
      payload: { buildingId: payload.buildingId as string, name: result.data?.oldName as string },
    }
  },
}

export const buildingDeleteHandler: CommandHandler = {
  id: 'building.delete',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const buildingId = payload.buildingId as string
    const index = document.buildings.findIndex(b => b.id === buildingId)
    if (index === -1) return { success: false, error: `Building not found: ${buildingId}` }

    const removed = document.buildings[index]
    cleanupBuildingRoutingReferences(document, removed)
    document.buildings.splice(index, 1)

    // Cascade: remove panoramas and QR checkpoints referencing this building
    document.panoramas = document.panoramas.filter(p => p.buildingId !== removed.id)
    document.qrCheckpoints = document.qrCheckpoints.filter(q => q.buildingId !== removed.id)

    recordChange(document, { entityId: buildingId, entityType: 'building', operation: 'deleted' })
    return { success: true, entityId: buildingId, data: { removed } }
  },
  inverse(payload: Record<string, unknown>, result: MutationResult): Command | null {
    return null
  },
}
