import type { CoordinateTransformer } from '@navi/core'
import type { Component, LatLng } from '@/types/nav-types'
import type { EditablePath } from '@/types/path-types'
import { extractHallwayData } from '@/types/hallway-types'

// ────────────────────────────────────────────────────────────────────────────
// P1-T3: Meter-space path projection seam.
//
// The old path-editing code (FloorEditorCanvas.tsx lines 293-296) used an
// identity projection (x=lng, y=lat), so the path editor ran in degree space:
// shift-snap computed 45° from degree deltas (geographically wrong), drag
// deltas and width offsets were degree-quantities. All math below operates in
// building-local meters and only converts at the map boundary (project/
// unproject/toLatLng). "No code path treats degrees as meters."
//
// The transformer is guaranteed to have every building registered in the
// editor (P1-T2). The `?? identity` fallbacks below are null-safe defaults for
// unregistered buildings only — they never apply to registered buildings, so
// they can never reintroduce degree-space authoring in the editor.
// ────────────────────────────────────────────────────────────────────────────

export interface PathProjection {
  /** building-local meters → map lng/lat */
  project: (x: number, y: number) => [number, number]
  /** map lng/lat → building-local meters */
  unproject: (lng: number, lat: number) => { x: number; y: number }
  /** building-local meters → LatLng */
  toLatLng: (x: number, y: number) => LatLng
}

export function createPathProjection(transformer: CoordinateTransformer, buildingId: string): PathProjection {
  return {
    project: (x, y) => {
      const w = transformer.buildingLocalToWorld({ x, y }, buildingId)
      return w ? [w.lng, w.lat] : [x, y]
    },
    unproject: (lng, lat) => transformer.worldToBuildingLocal({ lat, lng }, buildingId) ?? { x: lng, y: lat },
    toLatLng: (x, y) => transformer.buildingLocalToWorld({ x, y }, buildingId) ?? { lat: y, lng: x },
  }
}

/**
 * Shift-snap constraint: snap a position to the nearest 45° ray around an
 * origin. All inputs/outputs are building-local meters, so a snapped
 * displacement bears a geographically-correct 45° (moved out of degree space
 * per P1-T3).
 */
export function snapTo45Degrees(pos: { x: number; y: number }, origin: { x: number; y: number }): { x: number; y: number } {
  const dx = pos.x - origin.x
  const dy = pos.y - origin.y
  if (dx === 0 && dy === 0) return pos
  const angle = Math.atan2(dy, dx)
  const snapAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4)
  const dist = Math.sqrt(dx * dx + dy * dy)
  return { x: origin.x + Math.cos(snapAngle) * dist, y: origin.y + Math.sin(snapAngle) * dist }
}

/**
 * Build an editable path in building-local meters from a hallway Component
 * (whose polygon is in world LatLng). `toLocal` maps a world LatLng back to
 * building-local meters (normally `projection.unproject`).
 */
export function componentToEditablePath(
  c: Component,
  toLocal: (p: LatLng) => { x: number; y: number },
  readOnly: boolean,
): EditablePath | null {
  if (c.type !== 'hallway') return null
  const data = extractHallwayData(c)
  if (!data?.centerline || data.centerline.length < 2) return null
  const cl = data.centerline
  return {
    id: c.id,
    vertices: cl.map((p, i) => {
      const local = toLocal(p)
      return { id: `${c.id}-v${i}`, x: local.x, y: local.y }
    }),
    segments: Array.from({ length: cl.length - 1 }, (_, i) => ({
      id: `${c.id}-s${i}`, startVertexId: `${c.id}-v${i}`, endVertexId: `${c.id}-v${i + 1}`, type: 'straight' as const,
    })),
    closed: false,
    readOnly,
  }
}