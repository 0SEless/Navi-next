import { describe, it, expect } from 'vitest'
import { CoordinateTransformer } from '@navi/core'
import type { Component, LatLng } from '@/types/nav-types'
import { computeHallwayPolygon } from '@/types/hallway-types'
// Regression tests for P1-T3: the path-editing seam must consume building-local
// meters and produce building-local meters. The old defect (FloorEditorCanvas.tsx
// lines 293-296) used an identity projection (x=lng, y=lat), so every edit
// treated degrees as meters: 45-degree shift-snap was geographically wrong, and
// vertex drags / width offsets were degree-quantities (3 "units" ≈ 327 km).
import { createPathProjection, componentToEditablePath, snapTo45Degrees } from '@/lib/path-projection'

const BUILDING_ID = 'b1'
// Jolo (same origin used by the P1-T2 round-trip trace)
const ORIGIN = { lat: 11.8195, lng: 122.0922 }

function makeTransformer(): CoordinateTransformer {
  const tf = new CoordinateTransformer()
  tf.registerBuilding({ buildingId: BUILDING_ID, origin: ORIGIN, rotation: 0 })
  return tf
}

// Equirectangular distance in meters — same convention as hallway-types.ts
function distanceMeters(a: LatLng, b: LatLng): number {
  const avgLat = (a.lat + b.lat) / 2
  const mLat = 111320
  const mpd = 111320 * Math.cos((avgLat * Math.PI) / 180)
  const dLat = (b.lat - a.lat) * mLat
  const dLng = (b.lng - a.lng) * mpd
  return Math.sqrt(dLat * dLat + dLng * dLng)
}

function bearingDegrees(a: LatLng, b: LatLng): number {
  const avgLat = (a.lat + b.lat) / 2
  const mLat = 111320
  const mpd = 111320 * Math.cos((avgLat * Math.PI) / 180)
  return (Math.atan2((b.lat - a.lat) * mLat, (b.lng - a.lng) * mpd) * 180) / Math.PI
}

// Building-local meter frame (equirect meters relative to origin)
function toMeters(p: LatLng): { x: number; y: number } {
  const mLat = 111320
  const mpd = 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180)
  return { x: (p.lng - ORIGIN.lng) * mpd, y: (p.lat - ORIGIN.lat) * mLat }
}

describe('createPathProjection (P1-T3: meter-space path editing)', () => {
  it('project maps building-local meters to world lng/lat — not identity', () => {
    const p = createPathProjection(makeTransformer(), BUILDING_ID)
    const [lng, lat] = p.project(24.3, 11.8)
    // 24.3 m east / 11.8 m north of the Jolo origin: sub-0.001° deltas
    expect(lng).toBeGreaterThan(ORIGIN.lng)
    expect(lng).toBeLessThan(ORIGIN.lng + 0.001)
    expect(lat).toBeGreaterThan(ORIGIN.lat)
    expect(lat).toBeLessThan(ORIGIN.lat + 0.001)
    // The old identity projection returned [24.3, 11.8] — a ~98° error
    expect(Math.abs(lng - 24.3)).toBeGreaterThan(90)
  })

  it('unproject(project(x, y)) round-trips in building-local meters', () => {
    const p = createPathProjection(makeTransformer(), BUILDING_ID)
    const local = p.unproject(...p.project(24.3, 11.8))
    expect(local.x).toBeCloseTo(24.3, 6)
    expect(local.y).toBeCloseTo(11.8, 6)
  })

  it('a 3 m drag in path space produces 3 m of world displacement — not 3° (~327 km)', () => {
    const p = createPathProjection(makeTransformer(), BUILDING_ID)
    const a = p.project(24.3, 11.8)
    const b = p.project(27.3, 11.8) // 3 m east in building-local meters
    const d = distanceMeters({ lat: a[1], lng: a[0] }, { lat: b[1], lng: b[0] })
    expect(d).toBeGreaterThan(2.5)
    expect(d).toBeLessThan(3.5)
    // Contrast: identity projection treats 3 "units" as 3° of longitude (~327 km)
    expect(distanceMeters({ lat: 11.8, lng: 24.3 }, { lat: 11.8, lng: 27.3 })).toBeGreaterThan(300000)
  })

  it('shift-snap constrains exactly-45° meter-space targets to a geographically-correct 45° bearing', () => {
    const p = createPathProjection(makeTransformer(), BUILDING_ID)
    // Target at exactly 45° in meter space (dx=3, dy=3)
    const snapped = snapTo45Degrees({ x: 27.3, y: 14.8 }, { x: 24.3, y: 11.8 })
    expect(snapped.x).toBeCloseTo(27.3, 6)
    expect(snapped.y).toBeCloseTo(14.8, 6)
    // The snapped displacement must bear 45.0° geographically (±0.1°)
    const o = p.project(24.3, 11.8)
    const s = p.project(snapped.x, snapped.y)
    const bearing = bearingDegrees({ lat: o[1], lng: o[0] }, { lat: s[1], lng: s[0] })
    expect(bearing).toBeGreaterThan(44.9)
    expect(bearing).toBeLessThan(45.1)
  })

  it('snaps near-45° meter-space targets onto the 45° ray with a geographically-correct bearing', () => {
    const p = createPathProjection(makeTransformer(), BUILDING_ID)
    // dx=3 m, dy=2.7 m → 41.99° in meter space → must snap to 45°
    const snapped = snapTo45Degrees({ x: 27.3, y: 14.5 }, { x: 24.3, y: 11.8 })
    const dx = snapped.x - 24.3
    const dy = snapped.y - 11.8
    expect(Math.abs(dx - dy)).toBeLessThan(1e-6)
    const o = p.project(24.3, 11.8)
    const s = p.project(snapped.x, snapped.y)
    const bearing = bearingDegrees({ lat: o[1], lng: o[0] }, { lat: s[1], lng: s[0] })
    // Degree-space snapping (old bug) yields ~45.6° here — outside the tolerance
    expect(bearing).toBeGreaterThan(44.9)
    expect(bearing).toBeLessThan(45.1)
  })

  it('componentToEditablePath builds meter-space vertices from a world-polygon hallway', () => {
    const tf = makeTransformer()
    const p = createPathProjection(tf, BUILDING_ID)
    const localPoints = [{ x: 24.3, y: 11.8 }, { x: 30, y: 11.8 }, { x: 30, y: 17 }]
    const world = localPoints.map((pt) => tf.buildingLocalToWorld(pt, BUILDING_ID) as LatLng)
    const c: Component = {
      id: 'hw-1',
      type: 'hallway',
      name: 'Main Hallway',
      polygon: world,
      dimensions: { width: 3, height: 0 },
    }
    const path = componentToEditablePath(c, (latlng) => tf.worldToBuildingLocal(latlng, BUILDING_ID) ?? { x: 0, y: 0 }, true)
    expect(path).not.toBeNull()
    expect(path!.id).toBe('hw-1') // Component id, never a featureId (ERRORS.md 2026-07-15)
    expect(path!.readOnly).toBe(true)
    expect(path!.vertices).toHaveLength(3)
    expect(path!.vertices[0].x).toBeCloseTo(24.3, 3)
    expect(path!.vertices[0].y).toBeCloseTo(11.8, 3)
    expect(path!.vertices[2].x).toBeCloseTo(30, 3)
    expect(path!.vertices[2].y).toBeCloseTo(17, 3)
    expect(path!.segments).toHaveLength(2)
  })

  it('hallway width 3 m authored in the editor produces 3 m-wide world geometry near the origin', () => {
    const tf = makeTransformer()
    const p = createPathProjection(tf, BUILDING_ID)
    const centerline = [{ x: 24.3, y: 11.8 }, { x: 27.3, y: 11.8 }, { x: 30.3, y: 11.8 }].map((pt) => p.toLatLng(pt.x, pt.y))
    const poly = computeHallwayPolygon(centerline, 3) // width 3 m
    // computeHallwayPolygon returns [...left, ...right.reverse()]
    const leftMid = { lat: (poly[0].lat + poly[2].lat) / 2, lng: (poly[0].lng + poly[2].lng) / 2 }
    const rightMid = { lat: (poly[3].lat + poly[5].lat) / 2, lng: (poly[3].lng + poly[5].lng) / 2 }
    const width = distanceMeters(leftMid, rightMid)
    expect(width).toBeGreaterThan(2.9)
    expect(width).toBeLessThan(3.1)
    // The corridor must sit at the Jolo origin, not at lng 24.3 (identity bug)
    expect(Math.abs(poly[0].lng - ORIGIN.lng)).toBeLessThan(0.01)
    expect(Math.abs(poly[0].lat - ORIGIN.lat)).toBeLessThan(0.01)
  })

  it('a 1 m vertex offset in the editor measures 1 m in world geometry — not 1° (~111 km)', () => {
    const tf = makeTransformer()
    const p = createPathProjection(tf, BUILDING_ID)
    // Straight line 24.3 → 30.3 east; middle vertex displaced 1 m north
    const cl = [
      { x: 24.3, y: 11.8 },
      { x: 27.3, y: 12.8 },
      { x: 30.3, y: 11.8 },
    ].map((pt) => p.toLatLng(pt.x, pt.y))
    // Perpendicular distance from the displaced vertex to the line through the endpoints
    const A = toMeters(cl[0])
    const B = toMeters(cl[2])
    const V = toMeters(cl[1])
    const base = Math.hypot(B.x - A.x, B.y - A.y)
    const area = Math.abs((B.x - A.x) * (V.y - A.y) - (B.y - A.y) * (V.x - A.x))
    const offset = area / base
    expect(offset).toBeGreaterThan(0.9)
    expect(offset).toBeLessThan(1.1)
    // Contrast: identity authoring would place the vertex 1° north ≈ 111 km off the line
    const Vdeg = toMeters({ lat: 12.8, lng: 27.3 })
    const offsetDeg = Math.abs((B.x - A.x) * (Vdeg.y - A.y) - (B.y - A.y) * (Vdeg.x - A.x)) / base
    expect(offsetDeg).toBeGreaterThan(100000)
  })
})