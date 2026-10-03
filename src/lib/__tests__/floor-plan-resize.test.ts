import { describe, expect, it } from 'vitest'
import type { LatLng } from '@/types/nav-types'
import {
  getFootprintBBoxLocalMeters,
  getPlanCornerLocalMeters,
  lngLatToLocalMeters,
  resizePlanFromHandle,
  resizePlanFromPointer,
} from '../floor-plan-resize'
import { transformLocalPoint } from '../floor-plan-transform'
import type { PlanResizeHandle } from '../floor-plan-resize'

const R = 6371000
const DEG_TO_RAD = Math.PI / 180

function makeFootprint(): LatLng[] {
  const lat = 14
  const lng = 121
  const metersPerLat = R * DEG_TO_RAD
  const metersPerLng = metersPerLat * Math.cos(lat * DEG_TO_RAD)
  return [
    { lat: lat + 40 / metersPerLat, lng: lng - 50 / metersPerLng },
    { lat: lat + 40 / metersPerLat, lng: lng + 50 / metersPerLng },
    { lat: lat - 40 / metersPerLat, lng: lng + 50 / metersPerLng },
    { lat: lat - 40 / metersPerLat, lng: lng - 50 / metersPerLng },
  ]
}

function pointAlong(from: { x: number; y: number }, to: { x: number; y: number }, distance: number) {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy)
  return { x: from.x + (dx / length) * distance, y: from.y + (dy / length) * distance }
}

function handleBasePoints(footprint: LatLng[], handle: PlanResizeHandle) {
  const corners = getFootprintBBoxLocalMeters(footprint)
  const center = {
    x: (corners[0].x + corners[1].x) / 2,
    y: (corners[0].y + corners[3].y) / 2,
  }
  switch (handle) {
    case 'nw': return { moving: corners[0], anchor: corners[2] }
    case 'n': return { moving: { x: center.x, y: corners[0].y }, anchor: { x: center.x, y: corners[3].y } }
    case 'ne': return { moving: corners[1], anchor: corners[3] }
    case 'e': return { moving: { x: corners[1].x, y: center.y }, anchor: { x: corners[0].x, y: center.y } }
    case 'se': return { moving: corners[2], anchor: corners[0] }
    case 's': return { moving: { x: center.x, y: corners[3].y }, anchor: { x: center.x, y: corners[0].y } }
    case 'sw': return { moving: corners[3], anchor: corners[1] }
    case 'w': return { moving: { x: corners[0].x, y: center.y }, anchor: { x: corners[1].x, y: center.y } }
  }
}

function pointerForScales(
  footprint: LatLng[],
  start: { scaleX: number; scaleY: number; rotation: number; offset: { x: number; y: number } },
  handle: PlanResizeHandle,
  scaleX: number,
  scaleY: number,
) {
  const { moving, anchor } = handleBasePoints(footprint, handle)
  const anchorWorld = transformLocalPoint(anchor, start)
  const transformedAnchor = transformLocalPoint(anchor, { scaleX, scaleY, rotation: start.rotation, offset: { x: 0, y: 0 } })
  const offset = {
    x: anchorWorld.x - transformedAnchor.x,
    y: anchorWorld.y - transformedAnchor.y,
  }
  return transformLocalPoint(moving, { scaleX, scaleY, rotation: start.rotation, offset })
}

describe('floor-plan resize math', () => {
  const footprint = makeFootprint()

  it('derives the same local-meter bbox used by the canonical plan transform', () => {
    const corners = getFootprintBBoxLocalMeters(footprint)
    expect(corners).toHaveLength(4)
    expect(corners[0].x).toBeCloseTo(-50, 6)
    expect(corners[0].y).toBeCloseTo(40, 6)
    expect(corners[1].x).toBeCloseTo(50, 6)
    expect(corners[1].y).toBeCloseTo(40, 6)
    expect(corners[2].x).toBeCloseTo(50, 6)
    expect(corners[2].y).toBeCloseTo(-40, 6)
    expect(corners[3].x).toBeCloseTo(-50, 6)
    expect(corners[3].y).toBeCloseTo(-40, 6)
  })

  it('uniformly scales from a corner while keeping the opposite corner fixed', () => {
    const start = { scale: 1, rotation: 0, offset: { x: 12, y: -7 } }
    const anchor = getPlanCornerLocalMeters(footprint, start, 2)
    const moving = getPlanCornerLocalMeters(footprint, start, 0)
    const baseDiagonal = Math.hypot(100, 80)
    const pointer = pointAlong(anchor, moving, baseDiagonal * 1.75)

    const next = resizePlanFromPointer(footprint, start, 0, pointer)

    expect(next.scale).toBe(1.75)
    expect(next.rotation).toBe(0)
    const nextAnchor = getPlanCornerLocalMeters(footprint, next, 2)
    const nextMoving = getPlanCornerLocalMeters(footprint, next, 0)
    expect(nextAnchor.x).toBeCloseTo(anchor.x, 6)
    expect(nextAnchor.y).toBeCloseTo(anchor.y, 6)
    expect(nextMoving.x).toBeCloseTo(-113, 6)
    expect(nextMoving.y).toBeCloseTo(93, 6)
  })

  it('uses rotation in the same canonical frame and is independent of map zoom', () => {
    const start = { scale: 1.2, rotation: 37, offset: { x: -4, y: 9 } }
    const anchor = getPlanCornerLocalMeters(footprint, start, 2)
    const moving = getPlanCornerLocalMeters(footprint, start, 0)
    const pointer = pointAlong(anchor, moving, Math.hypot(100, 80) * 1.4)

    const next = resizePlanFromPointer(footprint, start, 0, pointer)

    expect(next.scale).toBe(1.4)
    expect(next.rotation).toBe(37)
    const nextAnchor = getPlanCornerLocalMeters(footprint, next, 2)
    expect(nextAnchor.x).toBeCloseTo(anchor.x, 6)
    expect(nextAnchor.y).toBeCloseTo(anchor.y, 6)

    const samePhysicalPoint = lngLatToLocalMeters(
      { lat: footprint[0].lat, lng: footprint[0].lng },
      footprint,
    )
    expect(samePhysicalPoint.x).toBeCloseTo(-50, 6)
    expect(samePhysicalPoint.y).toBeCloseTo(40, 6)
  })

  it.each([
    ['e', 1.8, 0.8],
    ['w', 1.8, 0.8],
    ['n', 1.2, 1.35],
    ['s', 1.2, 1.35],
  ] as const)('changes only the requested axis for the %s side handle', (handle, scaleX, scaleY) => {
    const start = { scaleX: 1.2, scaleY: 0.8, rotation: 31, offset: { x: 7, y: -5 } }
    const { anchor } = handleBasePoints(footprint, handle)
    const anchorBefore = transformLocalPoint(anchor, start)
    const pointer = pointerForScales(footprint, start, handle, scaleX, scaleY)

    const next = resizePlanFromHandle(footprint, start, handle, pointer)

    expect(next.scaleX).toBeCloseTo(scaleX, 6)
    expect(next.scaleY).toBeCloseTo(scaleY, 6)
    const anchorAfter = transformLocalPoint(anchor, next)
    expect(anchorAfter.x).toBeCloseTo(anchorBefore.x, 6)
    expect(anchorAfter.y).toBeCloseTo(anchorBefore.y, 6)
  })

  it.each(['nw', 'ne', 'se', 'sw'] as const)('keeps the opposite corner anchored for rotated %s resize', (handle) => {
    const start = { scaleX: 1.15, scaleY: 0.85, rotation: -24, offset: { x: -3, y: 11 } }
    const { anchor } = handleBasePoints(footprint, handle)
    const anchorBefore = transformLocalPoint(anchor, start)
    const pointer = pointerForScales(footprint, start, handle, 1.65, 1.1)

    const next = resizePlanFromHandle(footprint, start, handle, pointer, { aspectRatioLocked: false })

    expect(next.scaleX).toBeCloseTo(1.65, 6)
    expect(next.scaleY).toBeCloseTo(1.1, 6)
    const anchorAfter = transformLocalPoint(anchor, next)
    expect(anchorAfter.x).toBeCloseTo(anchorBefore.x, 6)
    expect(anchorAfter.y).toBeCloseTo(anchorBefore.y, 6)
  })

  it('preserves the displayed gesture-start ratio when a corner is locked', () => {
    const start = { scaleX: 1.5, scaleY: 0.75, rotation: 18, offset: { x: 4, y: 6 } }
    const { anchor } = handleBasePoints(footprint, 'se')
    const anchorBefore = transformLocalPoint(anchor, start)
    const pointer = pointerForScales(footprint, start, 'se', 1.9, 1.2)

    const next = resizePlanFromHandle(footprint, start, 'se', pointer, { aspectRatioLocked: true })

    const startRatio = (100 * start.scaleX) / (80 * start.scaleY)
    const nextRatio = (100 * (next.scaleX ?? 0)) / (80 * (next.scaleY ?? 0))
    expect(nextRatio).toBeCloseTo(startRatio, 6)
    expect(next.scaleX).toBeGreaterThan(start.scaleX)
    expect(next.scaleY).toBeGreaterThan(start.scaleY)
    const anchorAfter = transformLocalPoint(anchor, next)
    expect(anchorAfter.x).toBeCloseTo(anchorBefore.x, 6)
    expect(anchorAfter.y).toBeCloseTo(anchorBefore.y, 6)
  })

  it('clamps crossing and invalid pointers to finite positive minimum dimensions', () => {
    const start = { scaleX: 1, scaleY: 1, rotation: 42, offset: { x: 0, y: 0 } }
    const { anchor } = handleBasePoints(footprint, 'nw')
    const collapsed = resizePlanFromHandle(footprint, start, 'nw', anchor, { minDimensionMeters: 5, aspectRatioLocked: false })
    const invalid = resizePlanFromHandle(footprint, start, 'nw', { x: Number.NaN, y: Number.POSITIVE_INFINITY })

    expect(collapsed.scaleX).toBeGreaterThanOrEqual(0.05 - 1e-9)
    expect(collapsed.scaleY).toBeGreaterThanOrEqual(0.0625 - 1e-9)
    expect(Number.isFinite(collapsed.scaleX)).toBe(true)
    expect(Number.isFinite(collapsed.scaleY)).toBe(true)
    expect(invalid).toEqual(start)
  })

  it('does not mutate the immutable gesture-start alignment', () => {
    const start = { scaleX: 1.1, scaleY: 0.9, rotation: 12, offset: { x: 2, y: 3 } }
    const before = JSON.parse(JSON.stringify(start))
    const pointer = pointerForScales(footprint, start, 'e', 1.7, 0.9)

    resizePlanFromHandle(footprint, start, 'e', pointer)

    expect(start).toEqual(before)
  })
})
