import type { Building, CampusDocument, Floor } from '@navi/core'
import { showImportToast } from './ImportToast'

/**
 * Shared POI placement-context resolution.
 *
 * Authored POIs are floor-local entities (Floor.pois is the sole canonical
 * collection), so every POI tool gesture needs an active building and the
 * floor that matches the Studio's active floor level. When that context is
 * missing the tools must explain why instead of silently dropping the click.
 */

export type PoiPlacementContextResult =
  | { ok: true; building: Building; floor: Floor }
  | { ok: false; reason: string }

export function resolvePoiPlacementContext(
  document: CampusDocument | null | undefined,
  buildingId: string | null | undefined,
  floorLevel: number | null | undefined,
): PoiPlacementContextResult {
  if (!document) {
    return { ok: false, reason: 'POI placement requires an open campus document.' }
  }
  if (!buildingId) {
    return { ok: false, reason: 'Select a building before placing a POI.' }
  }
  const building = document.buildings.find((candidate) => candidate.id === buildingId)
  if (!building) {
    return { ok: false, reason: 'The selected building is no longer available. Select a building before placing a POI.' }
  }
  if (floorLevel === null || floorLevel === undefined || !Number.isFinite(floorLevel)) {
    return { ok: false, reason: `“${building.name}” has no active floor. Select a building floor before placing a POI.` }
  }
  const floor = building.floors.find((candidate) => candidate.level === floorLevel)
  if (!floor) {
    return { ok: false, reason: `“${building.name}” has no floor ${floorLevel}. Select a building floor before placing a POI.` }
  }
  return { ok: true, building, floor }
}

/** Surface a POI placement problem through the existing Studio toast channel. */
export function reportPoiPlacementBlocked(reason: string): void {
  showImportToast({ message: reason, type: 'error' })
}

export function describePoiGeometryFailure(tool: 'poi-circle' | 'poi-rectangle' | 'poi-polygon'): string {
  if (tool === 'poi-circle') {
    return 'Circle POI needs a non-zero radius — drag away from the center to set the size.'
  }
  if (tool === 'poi-rectangle') {
    return 'Rectangle POI needs a non-zero area — drag across the floor to set the size.'
  }
  return 'Polygon POI needs at least three vertices with non-zero area.'
}
