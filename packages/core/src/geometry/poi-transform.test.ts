import { describe, expect, it } from 'vitest'
import type { WorldPOIGeometry } from '@navi/core'
import {
  moveLocalPolygonVertex,
  moveWorldPolygonVertex,
  resizeLocalRectangle,
  resizeWorldRectangle,
  rotateLocalPoiGeometry,
  rotateWorldPoiGeometry,
  setLocalCircleRadius,
  setWorldCircleRadius,
  translateLocalPoiGeometry,
  translateWorldPoiGeometry,
  worldPoiGeometryCentroid,
  localPoiGeometryCentroid,
  localRectangleCornersOf,
} from './poi-transform'

const ORIGIN = { lat: 25.633, lng: 122.927 }
const d = 0.0001

function worldRectangle(): Extract<WorldPOIGeometry, { type: 'rectangle' }> {
  return {
    type: 'rectangle',
    points: [
      { lat: ORIGIN.lat, lng: ORIGIN.lng },
      { lat: ORIGIN.lat, lng: ORIGIN.lng + d },
      { lat: ORIGIN.lat + d, lng: ORIGIN.lng + d },
      { lat: ORIGIN.lat + d, lng: ORIGIN.lng },
    ],
  }
}

function approxPoint(actual: { lat: number; lng: number }, expected: { lat: number; lng: number }) {
  expect(actual.lat).toBeCloseTo(expected.lat, 9)
  expect(actual.lng).toBeCloseTo(expected.lng, 9)
}

describe('POI transform helpers', () => {
  it('moves world point/circle/rectangle/polygon without mutating the input', () => {
    const rect = worldRectangle()
    const snapshot = JSON.stringify(rect)
    const moved = translateWorldPoiGeometry(rect, 0.0002, -0.0003) as Extract<WorldPOIGeometry, { type: 'rectangle' }>
    approxPoint(moved.points[0], { lat: ORIGIN.lat + 0.0002, lng: ORIGIN.lng - 0.0003 })
    expect(JSON.stringify(rect)).toBe(snapshot)

    const point = translateWorldPoiGeometry({ type: 'point', position: ORIGIN }, 1, 2)
    expect(point).toEqual({ type: 'point', position: { lat: ORIGIN.lat + 1, lng: ORIGIN.lng + 2 } })

    const circle = translateWorldPoiGeometry({ type: 'circle', center: ORIGIN, radius: 5 }, 0, 0)
    expect(circle).toEqual({ type: 'circle', center: ORIGIN, radius: 5 })
  })

  it('moves local geometries and point records', () => {
    const moved = translateLocalPoiGeometry({ type: 'point', position: { x: 1, y: 2 } }, 4, -3)
    expect(moved).toEqual({ type: 'point', position: { x: 5, y: -1 } })

    const rect = translateLocalPoiGeometry({ type: 'rectangle', min: { x: 0, y: 0 }, max: { x: 10, y: 5 } }, 2, 2) as Extract<ReturnType<typeof translateLocalPoiGeometry>, { type: 'rectangle' }>
    expect(rect.min).toEqual({ x: 2, y: 2 })
    expect(rect.max).toEqual({ x: 12, y: 7 })
  })

  it('resizes a world rectangle from a dragged corner keeping the opposite corner and orientation', () => {
    const rect = worldRectangle()
    const opposite = rect.points[0]
    const dragged = { lat: ORIGIN.lat + 2 * d, lng: ORIGIN.lng + 2 * d }
    const resized = resizeWorldRectangle(rect, 2, dragged) as Extract<WorldPOIGeometry, { type: 'rectangle' }>

    approxPoint(resized.points[0], opposite)
    approxPoint(resized.points[2], dragged)
    // Edges stay perpendicular (orientation preserved).
    const edgeU = { x: resized.points[1].lng - resized.points[0].lng, y: resized.points[1].lat - resized.points[0].lat }
    const edgeV = { x: resized.points[3].lng - resized.points[0].lng, y: resized.points[3].lat - resized.points[0].lat }
    expect(Math.abs(edgeU.x * edgeV.x + edgeU.y * edgeV.y)).toBeLessThan(1e-12)
  })

  it('rejects a world rectangle resize that would collapse a side', () => {
    const rect = worldRectangle()
    expect(resizeWorldRectangle(rect, 2, { lat: rect.points[0].lat, lng: rect.points[0].lng })).toBeNull()
  })

  it('resizes and rotates local rectangles and polygons', () => {
    const rect = resizeLocalRectangle({ type: 'rectangle', min: { x: 0, y: 0 }, max: { x: 10, y: 4 } }, 2, { x: 20, y: 8 }) as Extract<ReturnType<typeof resizeLocalRectangle>, { type: 'rectangle' }>
    expect(rect.min).toEqual({ x: 0, y: 0 })
    expect(rect.max).toEqual({ x: 20, y: 8 })

    const rotated = rotateLocalPoiGeometry(
      { type: 'polygon', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] },
      Math.PI / 2,
    ) as Extract<ReturnType<typeof rotateLocalPoiGeometry>, { type: 'polygon' }>
    // 90° rotation around the centroid (5,5).
    expect(rotated.points[0].x).toBeCloseTo(10, 9)
    expect(rotated.points[0].y).toBeCloseTo(0, 9)
  })

  it('rotates a local rectangle without losing its rectangle identity', () => {
    const rotated = rotateLocalPoiGeometry(
      { type: 'rectangle', min: { x: 0, y: 0 }, max: { x: 4, y: 2 } },
      Math.PI / 2,
    ) as Extract<ReturnType<typeof rotateLocalPoiGeometry>, { type: 'rectangle' }>

    expect(rotated).toEqual({
      type: 'rectangle',
      min: { x: 0, y: 0 },
      max: { x: 4, y: 2 },
      rotation: Math.PI / 2,
    })
    const corners = localRectangleCornersOf(rotated)
    expect(corners[0].x).toBeCloseTo(3)
    expect(corners[0].y).toBeCloseTo(-1)
    expect(corners[1].x).toBeCloseTo(3)
    expect(corners[1].y).toBeCloseTo(3)
    expect(corners[2].x).toBeCloseTo(1)
    expect(corners[2].y).toBeCloseTo(3)
    expect(corners[3].x).toBeCloseTo(1)
    expect(corners[3].y).toBeCloseTo(-1)
  })

  it('resizes a rotated local rectangle in its authored axes', () => {
    const geometry = {
      type: 'rectangle' as const,
      min: { x: 0, y: 0 },
      max: { x: 4, y: 2 },
      rotation: Math.PI / 2,
    }
    const resized = resizeLocalRectangle(geometry, 2, { x: 0, y: 4 }) as Extract<ReturnType<typeof resizeLocalRectangle>, { type: 'rectangle' }>
    const corners = localRectangleCornersOf(resized)

    expect(resized.rotation).toBeCloseTo(Math.PI / 2)
    expect(corners[0].x).toBeCloseTo(3)
    expect(corners[0].y).toBeCloseTo(-1)
    expect(corners[2].x).toBeCloseTo(0)
    expect(corners[2].y).toBeCloseTo(4)
  })

  it('rotates an outdoor rectangle around its centroid preserving size and right angles', () => {
    const rect = worldRectangle()
    const before = worldPoiGeometryCentroid(rect)
    const rotated = rotateWorldPoiGeometry(rect, Math.PI / 3) as Extract<WorldPOIGeometry, { type: 'rectangle' }>
    const after = worldPoiGeometryCentroid(rotated)
    approxPoint(after, before)

    const edge = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => Math.hypot((b.lat - a.lat) * 111320, (b.lng - a.lng) * 111320 * Math.cos((a.lat * Math.PI) / 180))
    const width = edge(rotated.points[0], rotated.points[1])
    const height = edge(rotated.points[0], rotated.points[3])
    const expectedLngMeters = d * 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180)
    expect(width).toBeCloseTo(expectedLngMeters, 3)
    expect(height).toBeCloseTo(d * 111320, 3)
  })

  it('moves polygon vertices in both scopes and clamps circle radius', () => {
    const polygon = { type: 'polygon' as const, points: [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }, { lat: 1, lng: 1 }] }
    const moved = moveWorldPolygonVertex(polygon, 1, { lat: 5, lng: 6 }) as typeof polygon
    expect(moved.points[1]).toEqual({ lat: 5, lng: 6 })

    const local = moveLocalPolygonVertex({ type: 'polygon', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] }, 2, { x: 9, y: 9 })
    expect((local as { points: Array<{ x: number; y: number }> }).points[2]).toEqual({ x: 9, y: 9 })

    expect(setWorldCircleRadius({ type: 'circle', center: ORIGIN, radius: 5 }, -3)).toEqual({ type: 'circle', center: ORIGIN, radius: 0.1 })
    expect(setLocalCircleRadius({ type: 'circle', center: { x: 0, y: 0 }, radius: 5 }, 7)).toEqual({ type: 'circle', center: { x: 0, y: 0 }, radius: 7 })
    expect(localPoiGeometryCentroid({ type: 'rectangle', min: { x: 0, y: 0 }, max: { x: 4, y: 2 } })).toEqual({ x: 2, y: 1 })
  })
})
