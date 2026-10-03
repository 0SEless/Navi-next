import type { CampusDocument } from '@navi/core'
import type { CommandHandler, Command, MutationResult } from './types'

export const floorManageHandler: CommandHandler = {
  id: 'floor.manage',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const buildingId = payload.buildingId as string
    if (!buildingId) return { success: false, error: 'buildingId required' }
    const building = document.buildings.find(b => b.id === buildingId)
    if (!building) return { success: false, error: `Building not found: ${buildingId}` }
    return { success: true, entityId: buildingId, data: { floorCount: building.floors.length } }
  },
  inverse(): Command | null { return null },
}

export const buildingEditInteriorHandler: CommandHandler = {
  id: 'building.editInterior',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const buildingId = (payload as { buildingId?: string })?.buildingId
    if (!buildingId) return { success: false, error: 'buildingId required' }
    const building = document.buildings.find(b => b.id === buildingId)
    if (!building) return { success: false, error: `Building not found: ${buildingId}` }
    if (building.floors.length === 0) return { success: false, error: 'Building has no floors' }
    const targetFloor = (payload as { floor?: number })?.floor ?? 0
    const matchedFloor = building.floors.some(f => f.level === targetFloor)
      ? targetFloor
      : (building.floors[0]?.level ?? 0)
    const pathParts = window.location.pathname.split('/')
    const mapId = pathParts[2]
    if (mapId) {
      window.location.href = `/studio/${mapId}/edit/building/${buildingId}/floor/${matchedFloor}`
    }
    return { success: true, entityId: buildingId }
  },
}

function footprintCentroid(points: { lat: number; lng: number }[]): { lat: number; lng: number } | null {
  if (points.length === 0) return null
  const n = points.length
  const raw = points.slice(0, n - (points[0].lat === points[n - 1].lat && points[0].lng === points[n - 1].lng ? 1 : 0))
  if (raw.length === 0) return null
  const lat = raw.reduce((s, p) => s + p.lat, 0) / raw.length
  const lng = raw.reduce((s, p) => s + p.lng, 0) / raw.length
  return { lat, lng }
}

export const buildingAdjustPositionHandler: CommandHandler = {
  id: 'building.adjustPosition',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const buildingId = payload.buildingId as string
    if (!buildingId) return { success: false, error: 'buildingId required' }
    const building = document.buildings.find(b => b.id === buildingId)
    if (!building) return { success: false, error: `Building not found: ${buildingId}` }
    const centroid = footprintCentroid(building.footprint.points)
    return {
      success: true,
      entityId: buildingId,
      data: { centroid, baseElevation: building.baseElevation, building },
    }
  },
  inverse(): Command | null { return null },
}

export const buildingOpenFloorEditorHandler: CommandHandler = {
  id: 'building.openFloorEditor',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const buildingId = payload.buildingId as string
    if (!buildingId) return { success: false, error: 'buildingId required' }
    const building = document.buildings.find(b => b.id === buildingId)
    if (!building) return { success: false, error: `Building not found: ${buildingId}` }
    if (building.floors.length === 0) return { success: false, error: 'Building has no floors' }
    return { success: true, entityId: buildingId }
  },
  inverse(): Command | null { return null },
}

export const assetUploadHandler: CommandHandler = {
  id: 'asset.upload',
  execute(): MutationResult {
    return { success: false, error: 'Asset upload is not available yet' }
  },
  inverse(): Command | null { return null },
}
