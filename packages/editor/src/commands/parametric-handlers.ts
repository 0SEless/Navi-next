import { recordChange } from '@navi/core'
import type { CampusDocument } from '@navi/core'
import type { CommandHandler, Command, MutationResult } from './types'
import { genId } from '../id'

function findFloor(document: CampusDocument, buildingId: string, floorId: string) {
  const building = document.buildings.find(b => b.id === buildingId)
  if (!building) return null
  const floor = building.floors.find(f => f.id === floorId)
  return floor ? { building, floor } : null
}

export const parametricCreateHandler: CommandHandler = {
  id: 'parametric.create',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const buildingId = payload.buildingId as string
    const floorId = payload.floorId as string
    const ctx = findFloor(document, buildingId, floorId)
    if (!ctx) return { success: false, error: `Building/floor not found: ${buildingId}/${floorId}` }

    const id = (payload.id as string) || genId('pc')
    const definitionId = payload.definitionId as string
    const position = payload.position as { x: number; y: number } | undefined
    const rotation = (payload.rotation as number) ?? 0
    const properties = (payload.properties as Record<string, unknown>) ?? {}

    if (!definitionId) return { success: false, error: 'definitionId is required' }
    if (!position) return { success: false, error: 'position is required' }

    if (!ctx.floor.parametricComponents) ctx.floor.parametricComponents = []
    ctx.floor.parametricComponents.push({ id, definitionId, position, rotation, properties })

    recordChange(document, { entityId: id, entityType: 'parametric', operation: 'created' })
    return { success: true, entityId: id, data: { id, buildingId, floorId } }
  },
  inverse(payload: Record<string, unknown>, result: MutationResult): Command | null {
    const id = (result.data?.id as string) || payload.id as string
    return {
      id: 'parametric.delete',
      label: 'Undo Create Parametric',
      payload: { parametricId: id, buildingId: result.data?.buildingId as string, floorId: result.data?.floorId as string },
    }
  },
}

export const parametricDeleteHandler: CommandHandler = {
  id: 'parametric.delete',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const parametricId = payload.parametricId as string
    for (const bld of document.buildings) {
      for (const flr of bld.floors) {
        if (!flr.parametricComponents) continue
        const index = flr.parametricComponents.findIndex(p => p.id === parametricId)
        if (index !== -1) {
          flr.parametricComponents.splice(index, 1)
          recordChange(document, { entityId: parametricId, entityType: 'parametric', operation: 'deleted' })
          return { success: true, entityId: parametricId }
        }
      }
    }
    return { success: false, error: `Parametric not found: ${parametricId}` }
  },
  inverse(): Command | null {
    return null
  },
}

export const parametricUpdateHandler: CommandHandler = {
  id: 'parametric.update',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const parametricId = payload.parametricId as string
    const changes = payload.changes as Record<string, unknown> ?? {}
    for (const bld of document.buildings) {
      for (const flr of bld.floors) {
        if (!flr.parametricComponents) continue
        const pc = flr.parametricComponents.find(p => p.id === parametricId)
        if (pc) {
          const oldState = { position: { ...pc.position }, rotation: pc.rotation, properties: { ...pc.properties } }
          if (changes.position) pc.position = { ...(changes.position as any) }
          if (changes.rotation != null) pc.rotation = changes.rotation as number
          if (changes.properties) pc.properties = { ...pc.properties, ...(changes.properties as Record<string, unknown>) }
          recordChange(document, { entityId: parametricId, entityType: 'parametric', operation: 'updated' })
          return { success: true, entityId: parametricId, data: { oldState } }
        }
      }
    }
    return { success: false, error: `Parametric not found: ${parametricId}` }
  },
  inverse(payload: Record<string, unknown>, result: MutationResult): Command | null {
    const id = payload.parametricId as string
    const oldState = (result.data as any)?.oldState
    if (!oldState) return null
    return {
      id: 'parametric.update',
      label: 'Undo Parametric Update',
      payload: { parametricId: id, changes: oldState },
    }
  },
}
