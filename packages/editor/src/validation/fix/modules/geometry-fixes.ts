import type { CampusDocument, LatLng, LocalCoord } from '@navi/core'
import type { ValidationIssue } from '../../snapshot'
import type { FixProvider, FixContext } from '../types'
import type { Command } from '../../../commands/types'

function findEntity(document: CampusDocument, id: string): { entity: Record<string, any>; type: string } | null {
  for (const bld of document.buildings) {
    if (bld.id === id) return { entity: bld as any, type: 'building' }
    for (const flr of bld.floors) {
      if (flr.id === id) return { entity: flr as any, type: 'floor' }
      for (const rm of flr.rooms) if (rm.id === id) return { entity: rm as any, type: 'room' }
      for (const hw of flr.hallways) if (hw.id === id) return { entity: hw as any, type: 'hallway' }
      for (const st of flr.staircases) if (st.id === id) return { entity: st as any, type: 'staircase' }
      for (const el of flr.elevators) if (el.id === id) return { entity: el as any, type: 'elevator' }
      for (const ent of flr.entrances) if (ent.id === id) return { entity: ent as any, type: 'entrance' }
    }
  }
  for (const rd of document.roads) if (rd.id === id) return { entity: rd as any, type: 'road' }
  for (const pan of document.panoramas) if (pan.id === id) return { entity: pan as any, type: 'panorama' }
  for (const qr of document.qrCheckpoints) if (qr.id === id) return { entity: qr as any, type: 'qrCheckpoint' }
  return null
}

function pointsEqual(a: { x: number; y: number } | { lat: number; lng: number }, b: { x: number; y: number } | { lat: number; lng: number }): boolean {
  if ('x' in a && 'x' in b) return a.x === b.x && (a as any).y === (b as any).y
  if ('lat' in a && 'lat' in b) return a.lat === (b as any).lat && (a as any).lng === (b as any).lng
  return false
}

export const closePolygonFix: FixProvider = {
  fixId: 'geometry.close-polygon',
  label: 'Close Polygon',
  description: 'Closes an open polygon by appending the first point to the end',

  canFix(issue: ValidationIssue, context: FixContext): boolean {
    const entityId = issue.targets[0]?.entityId
    if (!entityId) return false
    const found = findEntity(context.document, entityId)
    if (!found) return false
    const { entity, type } = found
    const points = type === 'building' ? entity.footprint?.points : entity.polygon?.points
    if (!points || points.length < 2) return false
    return !pointsEqual(points[0], points[points.length - 1])
  },

  createCommand(issue: ValidationIssue, context: FixContext): Command | null {
    const entityId = issue.targets[0]?.entityId
    if (!entityId) return null
    const found = findEntity(context.document, entityId)
    if (!found) return null
    const { entity, type } = found
    const points = type === 'building' ? entity.footprint?.points : entity.polygon?.points
    if (!points || points.length < 2) return null
    if (pointsEqual(points[0], points[points.length - 1])) return null

    const closedPoints = [...points, points[0]]
    if (type === 'building') {
      return {
        id: 'entity.update',
        label: 'Close Polygon',
        payload: { entityId, changes: { footprint: { points: closedPoints } } },
      }
    }
    return {
      id: 'entity.update',
      label: 'Close Polygon',
      payload: { entityId, changes: { polygon: { points: closedPoints as LocalCoord[] } } },
    }
  },
}
