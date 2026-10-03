import { recordChange } from '@navi/core'
import type { CampusDocument, LocalCoord, LatLng } from '@navi/core'
import type { CommandHandler, Command, MutationResult } from './types'
import { genId } from '../id'

export const panoramaCreateHandler: CommandHandler = {
  id: 'panorama.create',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const id = (payload.id as string) || genId('pan')
    const label = (payload.label as string) || ''
    // D9 coordinate semantics:
    // - When buildingId is present: position is LocalCoord (building-local meters)
    // - When buildingId is absent: position is LatLng (world coordinates)
    const position = payload.position as LocalCoord | LatLng | undefined
    const heading = (payload.heading as number) ?? 0
    const imageAssetId = (payload.imageAssetId as string) || ''
    const buildingId = payload.buildingId as string | undefined
    const floor = (payload.floor as number) ?? 0

    if (!position) return { success: false, error: 'Panorama position is required' }
    if (!imageAssetId) return { success: false, error: 'Panorama imageAssetId is required' }

    // Validate coordinate system matches buildingId
    const isLatLng = (position as unknown as { lat?: number }).lat !== undefined
    if (buildingId && isLatLng) {
      return { success: false, error: 'Building-associated panorama must use LocalCoord (building-local meters), not LatLng' }
    }
    if (!buildingId && !isLatLng) {
      return { success: false, error: 'Outdoor panorama (no buildingId) must use LatLng (world coordinates), not LocalCoord' }
    }

    document.panoramas.push({ id, label, position, heading, imageAssetId, buildingId, floor, hotspots: [] })

    recordChange(document, { entityId: id, entityType: 'panorama', operation: 'created' })
    return { success: true, entityId: id, data: { id } }
  },
  inverse(payload: Record<string, unknown>, result: MutationResult): Command | null {
    const id = (result.data?.id as string) || payload.id as string
    return { id: 'panorama.delete', label: 'Undo Create Panorama', payload: { panoramaId: id } }
  },
}

export const panoramaDeleteHandler: CommandHandler = {
  id: 'panorama.delete',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const panoramaId = payload.panoramaId as string
    const index = document.panoramas.findIndex(p => p.id === panoramaId)
    if (index === -1) return { success: false, error: `Panorama not found: ${panoramaId}` }

    document.panoramas.splice(index, 1)
    recordChange(document, { entityId: panoramaId, entityType: 'panorama', operation: 'deleted' })
    return { success: true, entityId: panoramaId }
  },
  inverse(): Command | null {
    return null
  },
}
