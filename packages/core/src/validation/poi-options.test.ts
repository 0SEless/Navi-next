import { describe, expect, it } from 'vitest'
import type { PoiApproachAnchor, WorldPOIGeometry } from '@navi/core'
import {
  nearestLocalPoiAnchor,
  nearestWorldPoiAnchor,
  projectLocalPoiAnchor,
  projectWorldPoiAnchor,
  resolvePoiApproachMode,
  resolvePoiVisibility,
  validatePoiAnchor,
  validatePoiNavigation,
  validatePoiVisibility,
} from './poi-options'

const CENTER = { lat: 25.633, lng: 122.927 }

const circle: WorldPOIGeometry = { type: 'circle', center: CENTER, radius: 10 }
const rectangle: WorldPOIGeometry = {
  type: 'rectangle',
  points: [
    { lat: 25.633, lng: 122.927 },
    { lat: 25.633, lng: 122.9271 },
    { lat: 25.6331, lng: 122.9271 },
    { lat: 25.6331, lng: 122.927 },
  ],
}
const polygon: WorldPOIGeometry = {
  type: 'polygon',
  points: [
    { lat: 25.633, lng: 122.927 },
    { lat: 25.6331, lng: 122.9271 },
    { lat: 25.633, lng: 122.9272 },
  ],
}

describe('POI visibility + navigation options', () => {
  it('resolves safe defaults when absent', () => {
    expect(resolvePoiVisibility(undefined)).toEqual({ showOnMap: true, searchable: true })
    expect(resolvePoiApproachMode(undefined)).toBe('automatic')
  })

  it('validates visibility and navigation shapes', () => {
    expect(validatePoiVisibility({ showOnMap: false, searchable: true })).toEqual({ valid: true })
    expect(validatePoiVisibility({ showOnMap: 'yes', searchable: true }).valid).toBe(false)
    expect(validatePoiNavigation({ approachMode: 'preferred' }, { type: 'circle' })).toEqual({ valid: true })
    expect(validatePoiNavigation({ approachMode: 'sometimes' }, { type: 'circle' }).valid).toBe(false)
  })

  it('constrains anchor kinds per geometry and point rejects anchors', () => {
    expect(validatePoiAnchor({ kind: 'circle-angle', angle: 1 }, 'circle')).toEqual({ valid: true })
    expect(validatePoiAnchor({ kind: 'circle-angle', angle: 1 }, 'polygon').valid).toBe(false)
    expect(validatePoiAnchor({ kind: 'rectangle-edge', edge: 3, t: 0.5 }, 'rectangle')).toEqual({ valid: true })
    expect(validatePoiAnchor({ kind: 'rectangle-edge', edge: 4, t: 0.5 }, 'rectangle').valid).toBe(false)
    expect(validatePoiAnchor({ kind: 'polygon-edge', edge: 1, t: 1.5 }, 'polygon').valid).toBe(false)
    expect(validatePoiAnchor({ kind: 'circle-angle', angle: 1 }, 'point').valid).toBe(false)
  })
})

describe('POI anchor projection', () => {
  it('projects circle anchors onto the circumference and follows moves/resizes', () => {
    const anchor: PoiApproachAnchor = { kind: 'circle-angle', angle: 0 }
    const east = projectWorldPoiAnchor(circle, anchor)!
    expect(east.lat).toBeCloseTo(CENTER.lat, 9)
    expect(east.lng).toBeGreaterThan(CENTER.lng)

    const moved: WorldPOIGeometry = { type: 'circle', center: { lat: CENTER.lat + 0.01, lng: CENTER.lng }, radius: 10 }
    expect(projectWorldPoiAnchor(moved, anchor)!.lat).toBeCloseTo(CENTER.lat + 0.01, 9)

    const resized: WorldPOIGeometry = { type: 'circle', center: CENTER, radius: 5 }
    const resizedEast = projectWorldPoiAnchor(resized, anchor)!
    const fullEast = projectWorldPoiAnchor(circle, anchor)!
    // Radius contributes linearly to the lng offset.
    expect((resizedEast.lng - CENTER.lng) / (fullEast.lng - CENTER.lng)).toBeCloseTo(0.5, 6)
  })

  it('projects rectangle anchors onto the chosen edge and follows rotation', () => {
    const anchor: PoiApproachAnchor = { kind: 'rectangle-edge', edge: 0, t: 0.5 }
    const midpoint = projectWorldPoiAnchor(rectangle, anchor)!
    expect(midpoint.lat).toBeCloseTo(25.633, 9)
    expect(midpoint.lng).toBeCloseTo(122.92705, 9)

    expect(projectWorldPoiAnchor(polygon, { kind: 'rectangle-edge', edge: 0, t: 0.5 })).toBeNull()
  })

  it('projects polygon anchors onto the chosen edge and rejects out-of-range edges', () => {
    const anchor: PoiApproachAnchor = { kind: 'polygon-edge', edge: 2, t: 0 }
    expect(projectWorldPoiAnchor(polygon, anchor)).toEqual(polygon.points[2])
    expect(projectWorldPoiAnchor(polygon, { kind: 'polygon-edge', edge: 9, t: 0 })).toBeNull()
  })

  it('projects local anchors in floor-local meters', () => {
    const localCircle = { type: 'circle' as const, center: { x: 5, y: 5 }, radius: 4 }
    const point = projectLocalPoiAnchor(localCircle, { kind: 'circle-angle', angle: 0 })!
    expect(point.x).toBeCloseTo(9, 9)
    expect(point.y).toBeCloseTo(5, 9)

    const localRect = { type: 'rectangle' as const, min: { x: 0, y: 0 }, max: { x: 10, y: 4 } }
    expect(projectLocalPoiAnchor(localRect, { kind: 'rectangle-edge', edge: 0, t: 0.5 })).toEqual({ x: 5, y: 0 })
    expect(projectLocalPoiAnchor(localRect, { kind: 'polygon-edge', edge: 0, t: 0.5 })).toBeNull()
  })

  it('snaps a clicked point to the nearest circle/rectangle/polygon anchor', () => {
    const circleHit = nearestWorldPoiAnchor(circle, { lat: CENTER.lat + 0.001, lng: CENTER.lng })!
    expect(circleHit.anchor).toEqual({ kind: 'circle-angle', angle: Math.PI / 2 })

    const rectHit = nearestWorldPoiAnchor(rectangle, { lat: 25.63305, lng: 122.92705 })!
    expect(rectHit.anchor.kind).toBe('rectangle-edge')
    expect(rectHit.position).toBeDefined()

    const polyHit = nearestWorldPoiAnchor(polygon, { lat: 25.6331, lng: 122.9272 })!
    expect(polyHit.anchor.kind).toBe('polygon-edge')

    expect(nearestWorldPoiAnchor({ type: 'point', position: CENTER }, CENTER)).toBeNull()

    const localHit = nearestLocalPoiAnchor(
      { type: 'rectangle', min: { x: 0, y: 0 }, max: { x: 10, y: 4 } },
      { x: 3, y: 4.2 },
    )!
    expect(localHit.anchor).toMatchObject({ kind: 'rectangle-edge', edge: 2 })
  })
})
