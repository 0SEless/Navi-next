import type { FloorGeometryFile } from '@navi/core'
import type { ArtifactValidator } from '../artifact-hydrator'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCoordinatePair(v: unknown): v is { x: number; y: number } {
  return isRecord(v) && typeof v.x === 'number' && typeof v.y === 'number'
}

function isLatLng(v: unknown): v is { lat: number; lng: number } {
  return isRecord(v) && typeof v.lat === 'number' && typeof v.lng === 'number'
}

// P1.5 (R6.1/D15): floor-geometry.json validator — the artifact must carry a
// campusId, a buildings array, and every building must have an anchor and at
// least one floor. Geometry checks are structural (closed rings, coordinate
// pairs), not metric (meter ranges are deferred to consumption).
export const floorGeometryValidator: ArtifactValidator<FloorGeometryFile> = {
  artifactType: 'floorGeometry',
  supportedSchemaVersion: '1.0.0',
  validate(data: unknown): data is FloorGeometryFile {
    if (!isRecord(data)) return false
    if (typeof data.campusId !== 'string' || data.campusId.length === 0) return false
    if (typeof data.formatVersion !== 'number') return false
    if (!Array.isArray(data.buildings)) return false
    for (const b of data.buildings) {
      if (!isRecord(b)) return false
      if (typeof b.id !== 'string' || b.id.length === 0) return false
      if (typeof b.name !== 'string') return false
      const anchor = b.anchor
      if (!isRecord(anchor)) return false
      if (!isLatLng(anchor.origin)) return false
      if (typeof anchor.rotation !== 'number') return false
      if (!Array.isArray(b.floors)) return false
      for (const f of b.floors) {
        if (!isRecord(f)) return false
        if (typeof f.level !== 'number') return false
        if (typeof f.label !== 'string') return false
        if (typeof f.elevation !== 'number') return false
        if (!isCoordinatePair(f.offset)) return false
        if (!Array.isArray(f.rooms)) return false
        for (const r of f.rooms) {
          if (!isRecord(r)) return false
          if (typeof r.id !== 'string') return false
          if (!isRecord(r.polygon) || !Array.isArray(r.polygon.points)) return false
        }
        if (!Array.isArray(f.hallways)) return false
        for (const h of f.hallways) {
          if (!isRecord(h)) return false
          if (typeof h.id !== 'string') return false
          if (!isRecord(h.polyline) || !Array.isArray(h.polyline.points)) return false
        }
        if (!Array.isArray(f.staircases)) return false
        if (!Array.isArray(f.elevators)) return false
        if (!Array.isArray(f.doors)) return false
        if (!Array.isArray(f.pois)) return false
        if (!Array.isArray(f.qrCheckpoints)) return false
      }
    }
    return true
  },
}
