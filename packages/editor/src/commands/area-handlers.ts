import { recordChange } from '@navi/core'
import type { CampusDocument, Area, LatLng } from '@navi/core'
import type { CommandHandler, Command, MutationResult } from './types'
import { genId } from '../id'

export const areaCreateHandler: CommandHandler = {
  id: 'area.create',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const id = (payload.id as string) || genId('area')
    const name = (payload.name as string) || `Area ${id.slice(-6).toUpperCase()}`
    const points = payload.points as LatLng[] | undefined
    const color = (payload.color as string) || '#8B5CF6'

    if (!points || points.length < 3) {
      return { success: false, error: 'Area requires at least 3 points' }
    }

    if (!document.areas) document.areas = []
    const area: Area = { id, name, points, color }
    const existing = document.areas.findIndex(a => a.id === id)
    if (existing >= 0) {
      document.areas[existing] = area
    } else {
      document.areas.push(area)
    }

    recordChange(document, { entityId: id, entityType: 'area', operation: 'created' })
    return { success: true, entityId: id, data: { id } }
  },
  inverse(payload: Record<string, unknown>, result: MutationResult): Command | null {
    const id = (result.data?.id as string) || (payload.id as string)
    return { id: 'area.delete', label: 'Undo Create', payload: { areaId: id } }
  },
}

export const areaDeleteHandler: CommandHandler = {
  id: 'area.delete',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const id = payload.areaId as string
    if (!document.areas) return { success: false, error: `Area not found: ${id}` }
    const idx = document.areas.findIndex(a => a.id === id)
    if (idx < 0) return { success: false, error: `Area not found: ${id}` }
    document.areas.splice(idx, 1)
    recordChange(document, { entityId: id, entityType: 'area', operation: 'deleted' })
    return { success: true, entityId: id }
  },
  inverse(): Command | null {
    return null
  },
}
