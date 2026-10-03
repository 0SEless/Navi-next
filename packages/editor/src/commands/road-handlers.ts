import { recordChange, RoadStyle } from '@navi/core'
import type { CampusDocument, LatLng, RoadDisplayMode, RoadSurface, RoadType } from '@navi/core'
import type { CommandHandler, Command, MutationResult } from './types'
import { genId } from '../id'
import { cleanupRoadRoutingReferences } from './routing-relationship-cleanup'
import { applyAuthoredConnection, applyKeepSeparate, type RoadConnectionRequest } from './road-connectivity'

/**
 * Clean up roadJunctions and separatedCrossings that reference a deleted road.
 *
 * For each RoadJunction referencing the deleted road:
 *   - Remove the deleted road ID from roadIds
 *   - Filter remaining roadIds against roads that still exist in document.roads
 *   - Remove duplicates
 *   - If ≥2 valid roadIds remain: preserve the junction (same ID, position, source)
 *   - If <2 valid roadIds remain: remove the junction entirely
 *
 * For every SeparatedCrossing referencing the deleted road:
 *   - Remove that SeparatedCrossing entirely (both roads are required)
 */
export function cleanupRoadReferences(
  document: CampusDocument,
  deletedRoadId: string,
): void {
  cleanupRoadRoutingReferences(document, deletedRoadId)
}

function defaultWidthForType(type: string): number {
  switch (type) {
    case 'connector': return 6
    case 'service': return 4
    default: return RoadStyle.defaultWidthPx
  }
}

function clampWidth(w: number): number {
  return Math.max(RoadStyle.minWidthPx, Math.min(RoadStyle.maxWidthPx, w))
}

export const roadCreateHandler: CommandHandler = {
  id: 'road.create',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const id = (payload.id as string) || genId('rd')
    const name = (payload.name as string) || ''
    const points = payload.points as LatLng[] | undefined
    const type = (payload.type as RoadType) || 'arterial'
    const width = clampWidth((payload.width as number) || defaultWidthForType(type))
    const surface = (payload.surface as RoadSurface) || 'paved'
    const displayMode: RoadDisplayMode = payload.displayMode === 'navigation-only' ? 'navigation-only' : 'visible'
    const connectorEntranceId = payload.connectorEntranceId as string | undefined

    if (!points || points.length < 2) {
      return { success: false, error: 'Road polyline must have at least 2 points' }
    }

    // Authored geometry is canonical. Proximity and visual snapping are not
    // authorization to move endpoints or connect this road to another road.
    // Explicit Connect decisions are applied below, atomically with creation.
    const roadPoints = points.map(point => ({ ...point }))
    const connections = Array.isArray(payload.connections)
      ? (payload.connections as RoadConnectionRequest[])
      : undefined

    document.roads.push({ id, name, polyline: { points: roadPoints }, width, surface, type, displayMode, connectorEntranceId, metadata: (payload.metadata as Record<string, unknown>) ?? {} })

    // Fix 1: apply explicit connection authority in the same command.
    // Connect projects the endpoint and creates/merges the RoadJunction.
    // Keep Separate preserves raw geometry and may persist a SeparatedCrossing.
    if (connections && connections.length > 0) {
      for (const request of connections) {
        if (request.action === 'connect') applyAuthoredConnection(document, id, request)
      }
      for (const request of connections) {
        if (request.action === 'separate') applyKeepSeparate(document, id, request)
      }
    }

    recordChange(document, { entityId: id, entityType: 'road', operation: 'created' })
    return { success: true, entityId: id, data: { id, snapCount: 0 } }
  },
  inverse(payload: Record<string, unknown>, result: MutationResult): Command | null {
    const id = (result.data?.id as string) || payload.id as string
    return { id: 'road.delete', label: 'Undo Create Road', payload: { roadId: id } }
  },
}

export const roadRenameHandler: CommandHandler = {
  id: 'road.rename',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const roadId = payload.roadId as string
    const newName = payload.name as string
    const road = document.roads.find(r => r.id === roadId)
    if (!road) return { success: false, error: `Road not found: ${roadId}` }

    const oldName = road.name
    road.name = newName

    recordChange(document, { entityId: roadId, entityType: 'road', operation: 'updated' })
    return { success: true, entityId: roadId, data: { oldName } }
  },
  inverse(payload: Record<string, unknown>, result: MutationResult): Command | null {
    return {
      id: 'road.rename',
      label: 'Undo Rename Road',
      payload: { roadId: payload.roadId as string, name: result.data?.oldName as string },
    }
  },
}

export const roadDeleteHandler: CommandHandler = {
  id: 'road.delete',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const roadId = payload.roadId as string
    const index = document.roads.findIndex(r => r.id === roadId)
    if (index === -1) return { success: false, error: `Road not found: ${roadId}` }

    document.roads.splice(index, 1)
    cleanupRoadReferences(document, roadId)
    recordChange(document, { entityId: roadId, entityType: 'road', operation: 'deleted' })
    return { success: true, entityId: roadId }
  },
  inverse(): Command | null {
    return null
  },
}
