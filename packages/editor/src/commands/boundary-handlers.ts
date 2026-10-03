import { recordChange } from '@navi/core'
import type { CampusDocument } from '@navi/core'
import type { CommandHandler, Command, MutationResult } from './types'

export const boundarySetHandler: CommandHandler = {
  id: 'boundary.set',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const points = payload.points as Array<{ lat: number; lng: number }> | undefined
    if (!points || points.length < 3) {
      return { success: false, error: 'Boundary requires at least 3 points' }
    }
    document.boundary = { points }
    recordChange(document, { entityId: 'campus-boundary', entityType: 'campus', operation: 'updated' })
    return { success: true, entityId: 'campus-boundary', data: { points } }
  },
  inverse(): Command | null {
    return null
  },
}

export const boundaryClearHandler: CommandHandler = {
  id: 'boundary.clear',
  execute(document: CampusDocument): MutationResult {
    document.boundary = undefined
    recordChange(document, { entityId: 'campus-boundary', entityType: 'campus', operation: 'deleted' })
    return { success: true, entityId: 'campus-boundary' }
  },
  inverse(): Command | null {
    return null
  },
}
