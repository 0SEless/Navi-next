import { describe, it, expect } from 'vitest'
import { computeFloorPlanCoords } from '../floor-plan-coords'
import type { LatLng } from '@/types/nav-types'

// P1-T16 (R4.1, group-16 item 8): pins the DOCUMENTED planAlignment.scale
// semantics — dimensionless linear multiplier relative to the footprint-bbox
// fit; rotate → scale → offset order. The doc (docs/architecture/
// floor-plan-alignment.md) must match THIS behavior exactly.

const R = 6371000
const DEG_TO_M = Math.PI / 180  // 1 degree = π/180 radians

// A footprint whose bbox is 100 m E–W × 80 m N–S (approx. equirectangular at
// this latitude; corners chosen so the bbox is exactly that).
function makeFootprint(): LatLng[] {
  const lat = 14.0
  const lng = 121.0
  const mPerLat = DEG_TO_M * R
  const mPerLng = DEG_TO_M * R * Math.cos((lat * Math.PI) / 180)
  return [
    { lat: lat + 40 / mPerLat, lng: lng - 50 / mPerLng }, // NE
    { lat: lat + 40 / mPerLat, lng: lng + 50 / mPerLng }, // NW
    { lat: lat - 40 / mPerLat, lng: lng + 50 / mPerLng }, // SW
    { lat: lat - 40 / mPerLat, lng: lng - 50 / mPerLng }, // SE
  ]
}

function cornerExtentMeters(corners: Array<[number, number]>, centroid: { lat: number; lng: number }): { w: number; h: number } {
  const mPerLat = DEG_TO_M * R
  const mPerLng = DEG_TO_M * R * Math.cos((centroid.lat * Math.PI) / 180)
  const xs = corners.map(c => (c[0] - centroid.lng) * mPerLng)
  const ys = corners.map(c => (c[1] - centroid.lat) * mPerLat)
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
}

describe('P1-T16: planAlignment.scale semantics (R4.1)', () => {
  const footprint = makeFootprint()
  const centroid = { lat: 14.0, lng: 121.0 }

  it('scale=1 (or absent) → the plan exactly covers the footprint bbox', () => {
    const byDefault = computeFloorPlanCoords(footprint)
    const byScale1 = computeFloorPlanCoords(footprint, { scale: 1 })
    const ext1 = cornerExtentMeters(byDefault, centroid)
    expect(ext1.w).toBeCloseTo(100, 6)
    expect(ext1.h).toBeCloseTo(80, 6)
    const ext2 = cornerExtentMeters(byScale1, centroid)
    expect(ext2.w).toBeCloseTo(100, 6)
    expect(ext2.h).toBeCloseTo(80, 6)
  })

  it('scale=2 → double the bbox extent in BOTH axes, centered on the centroid', () => {
    const corners = computeFloorPlanCoords(footprint, { scale: 2 })
    const ext = cornerExtentMeters(corners, centroid)
    expect(ext.w).toBeCloseTo(200, 6)
    expect(ext.h).toBeCloseTo(160, 6)
    // Centered: the centroid of the plan corners is the footprint centroid
    const cx = corners.reduce((s, c) => s + c[0], 0) / 4
    const cy = corners.reduce((s, c) => s + c[1], 0) / 4
    expect(cx).toBeCloseTo(centroid.lng, 9)
    expect(cy).toBeCloseTo(centroid.lat, 9)
  })

  it('scale=0.5 → half the bbox extent (uniform)', () => {
    const corners = computeFloorPlanCoords(footprint, { scale: 0.5 })
    const ext = cornerExtentMeters(corners, centroid)
    expect(ext.w).toBeCloseTo(50, 6)
    expect(ext.h).toBeCloseTo(40, 6)
  })

  it('legacy uniform scale and explicit equal axis scales render identically', () => {
    const legacy = computeFloorPlanCoords(footprint, {
      scale: 1.75,
      rotation: 23,
      offset: { x: 4, y: -3 },
    })
    const axes = computeFloorPlanCoords(footprint, {
      scaleX: 1.75,
      scaleY: 1.75,
      rotation: 23,
      offset: { x: 4, y: -3 },
    } as any)
    expect(axes).toEqual(legacy)
  })

  it('offset is applied AFTER scale, in building-local meters (W12B)', () => {
    // offset.x=10 means 10 meters east. The corner centroid shifts by exactly 10 m.
    const corners = computeFloorPlanCoords(footprint, { scale: 2, offset: { x: 10, y: 0 } })
    const ext = cornerExtentMeters(corners, centroid)
    expect(ext.w).toBeCloseTo(200, 6)
    const cx = corners.reduce((s, c) => s + c[0], 0) / 4
    const mPerLng = DEG_TO_M * R * Math.cos((centroid.lat * Math.PI) / 180)
    const shiftMeters = (cx - centroid.lng) * mPerLng
    // 10 meters east
    expect(shiftMeters).toBeCloseTo(10, 3)
  })

  it('1m X offset = exactly 1m physical movement (W12B regression case 2)', () => {
    const corners = computeFloorPlanCoords(footprint, { offset: { x: 1, y: 0 } })
    const cx = corners.reduce((s, c) => s + c[0], 0) / 4
    const cy = corners.reduce((s, c) => s + c[1], 0) / 4
    const mPerLng = DEG_TO_M * R * Math.cos((centroid.lat * Math.PI) / 180)
    const mPerLat = DEG_TO_M * R
    expect((cx - centroid.lng) * mPerLng).toBeCloseTo(1, 6)
    expect((cy - centroid.lat) * mPerLat).toBeCloseTo(0, 6)
  })

  it('1m Y offset = exactly 1m physical movement (W12B regression case 3)', () => {
    const corners = computeFloorPlanCoords(footprint, { offset: { x: 0, y: 1 } })
    const cx = corners.reduce((s, c) => s + c[0], 0) / 4
    const cy = corners.reduce((s, c) => s + c[1], 0) / 4
    const mPerLng = DEG_TO_M * R * Math.cos((centroid.lat * Math.PI) / 180)
    const mPerLat = DEG_TO_M * R
    expect((cx - centroid.lng) * mPerLng).toBeCloseTo(0, 6)
    expect((cy - centroid.lat) * mPerLat).toBeCloseTo(1, 6)
  })

  it('rotation + offset compose correctly (W12B regression case 5)', () => {
    // 90° rotation + 5m X offset: the plan rotates, then shifts 5m east
    const corners = computeFloorPlanCoords(footprint, { rotation: 90, offset: { x: 5, y: 0 } })
    const cx = corners.reduce((s, c) => s + c[0], 0) / 4
    const cy = corners.reduce((s, c) => s + c[1], 0) / 4
    const mPerLng = DEG_TO_M * R * Math.cos((centroid.lat * Math.PI) / 180)
    const mPerLat = DEG_TO_M * R
    // Offset applied after rotation: 5m east in world coordinates
    expect((cx - centroid.lng) * mPerLng).toBeCloseTo(5, 3)
    expect((cy - centroid.lat) * mPerLat).toBeCloseTo(0, 3)
  })

  it('scale is NOT meters-per-pixel and NOT image-relative (pinned by construction)', () => {
    // The same alignment value must place the plan identically regardless of
    // the uploaded image's own dimensions — the math only sees the footprint
    // bbox and the multiplier. (Guards the documented definition.)
    const a = computeFloorPlanCoords(footprint, { scale: 1.5, offset: { x: 0, y: 0 }, rotation: 0 })
    const b = computeFloorPlanCoords(footprint, { scale: 1.5, offset: { x: 0, y: 0 }, rotation: 0 })
    expect(a).toEqual(b)
    const ext = cornerExtentMeters(a, centroid)
    expect(ext.w).toBeCloseTo(150, 6)
    expect(ext.h).toBeCloseTo(120, 6)
  })

  it('rotation applies BEFORE scale (documented transform order)', () => {
    // A 90° rotation then scale=2: the bbox-fit axes swap, then double.
    const corners = computeFloorPlanCoords(footprint, { scale: 2, rotation: 90 })
    const ext = cornerExtentMeters(corners, centroid)
    // After rotating the 100×80 bbox 90°: the E–W span becomes 80 m → ×2 = 160
    expect(ext.w).toBeCloseTo(160, 6)
    expect(ext.h).toBeCloseTo(200, 6)
  })
})
