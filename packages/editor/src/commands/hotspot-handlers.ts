import { recordChange } from '@navi/core'
import type { CampusDocument, PanoramaHotspot, HotspotContent } from '@navi/core'
import type { CommandHandler, Command, MutationResult } from './types'
import { genId } from '../id'

export const hotspotCreateHandler: CommandHandler = {
  id: 'hotspot.create',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const panoramaId = payload.panoramaId as string
    const hotspotType = (payload.hotspotType as 'navigation' | 'information') || 'navigation'
    const label = (payload.label as string) || ''
    const yaw = (payload.yaw as number) ?? 0
    const pitch = (payload.pitch as number) ?? 0
    const targetId = (payload.targetId as string) || ''
    const content = payload.content as HotspotContent | undefined

    if (!panoramaId) return { success: false, error: 'Panorama ID is required' }

    const panorama = document.panoramas.find(p => p.id === panoramaId)
    if (!panorama) return { success: false, error: `Panorama not found: ${panoramaId}` }

    const hotspot: PanoramaHotspot = {
      hotspotType,
      target: {
        type: hotspotType === 'navigation' ? 'panorama' : 'url',
        targetId: hotspotType === 'navigation' ? targetId : '',
      },
      position: { yaw, pitch },
      label,
      content: hotspotType === 'information' ? content : undefined,
    }

    panorama.hotspots.push(hotspot)
    recordChange(document, { entityId: panoramaId, entityType: 'hotspot', operation: 'created' })
    return { success: true, entityId: panoramaId, data: { hotspotIndex: panorama.hotspots.length - 1 } }
  },
  inverse(payload: Record<string, unknown>, result: MutationResult): Command | null {
    return { id: 'hotspot.delete', label: 'Undo Create Hotspot', payload: { panoramaId: payload.panoramaId, hotspotIndex: result.data?.hotspotIndex } }
  },
}

export const hotspotUpdateHandler: CommandHandler = {
  id: 'hotspot.update',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const panoramaId = payload.panoramaId as string
    const hotspotIndex = payload.hotspotIndex as number
    const changes = payload.changes as Partial<PanoramaHotspot>

    if (!panoramaId) return { success: false, error: 'Panorama ID is required' }
    if (hotspotIndex === undefined) return { success: false, error: 'Hotspot index is required' }

    const panorama = document.panoramas.find(p => p.id === panoramaId)
    if (!panorama) return { success: false, error: `Panorama not found: ${panoramaId}` }
    if (hotspotIndex < 0 || hotspotIndex >= panorama.hotspots.length) {
      return { success: false, error: `Invalid hotspot index: ${hotspotIndex}` }
    }

    const hotspot = panorama.hotspots[hotspotIndex]
    if (changes.hotspotType !== undefined) hotspot.hotspotType = changes.hotspotType
    if (changes.target !== undefined) hotspot.target = changes.target
    if (changes.position !== undefined) hotspot.position = changes.position
    if (changes.label !== undefined) hotspot.label = changes.label
    if (changes.content !== undefined) hotspot.content = changes.content

    recordChange(document, { entityId: panoramaId, entityType: 'hotspot', operation: 'updated' })
    return { success: true, entityId: panoramaId }
  },
  inverse(): Command | null {
    return null
  },
}

export const hotspotDeleteHandler: CommandHandler = {
  id: 'hotspot.delete',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const panoramaId = payload.panoramaId as string
    const hotspotIndex = payload.hotspotIndex as number

    if (!panoramaId) return { success: false, error: 'Panorama ID is required' }
    if (hotspotIndex === undefined) return { success: false, error: 'Hotspot index is required' }

    const panorama = document.panoramas.find(p => p.id === panoramaId)
    if (!panorama) return { success: false, error: `Panorama not found: ${panoramaId}` }
    if (hotspotIndex < 0 || hotspotIndex >= panorama.hotspots.length) {
      return { success: false, error: `Invalid hotspot index: ${hotspotIndex}` }
    }

    const removed = panorama.hotspots.splice(hotspotIndex, 1)[0]
    recordChange(document, { entityId: panoramaId, entityType: 'hotspot', operation: 'deleted' })
    return { success: true, entityId: panoramaId, data: { removedHotspot: removed } }
  },
  inverse(payload: Record<string, unknown>, result: MutationResult): Command | null {
    if (!result.data?.removedHotspot) return null
    return { id: 'hotspot.create', label: 'Undo Delete Hotspot', payload: { panoramaId: payload.panoramaId, ...result.data.removedHotspot } }
  },
}
