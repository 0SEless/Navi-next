import { describe, it, expect } from 'vitest'
import type { CampusDocument, Road } from '@navi/core'
import { snapRoadPoint as publicSnapRoadPoint } from '../../index'
import { snapRoadEndpoints, snapPoint, nearestPointOnPolyline, ROAD_SNAP_RADIUS_METERS } from '../road-snap'
import { roadCreateHandler } from '../road-handlers'

/**
 * Road endpoint snapping (T2c).
 *
 * Existing road rd-a runs east-west along lat 14.5 (lng 121.49 → 121.51).
 * 0.0001° lat ≈ 11.1m; 0.0001° lng ≈ 11.1m at this latitude.
 */
const ROAD_A: Road = {
  id: 'rd-a',
  name: 'Road A',
  polyline: {
    points: [
      { lat: 14.5, lng: 121.49 },
      { lat: 14.5, lng: 121.51 },
    ],
  },
  width: 8,
  surface: 'paved',
  type: 'arterial',
  metadata: {},
}

function docWithRoads(roads: Road[]): CampusDocument {
  return {
    schemaVersion: 1,
    version: 0,
    metadata: { campusId: 'snap', name: 'snap', description: '', lastModified: '', editorVersion: '0.1.0' },
    buildings: [],
    roads,
    panoramas: [],
    qrCheckpoints: [],
  }
}

describe('nearestPointOnPolyline', () => {
  it('returns the closest point on a segment with distance in meters', () => {
    // Point 30m north of the road's west endpoint
    const hit = nearestPointOnPolyline(
      { lat: 14.5003, lng: 121.49 },
      ROAD_A.polyline.points,
      { lat: 14.5, lng: 121.49 },
    )!
    expect(hit.distance).toBeGreaterThan(25)
    expect(hit.distance).toBeLessThan(35)
    // Projection lands on the road line itself
    expect(hit.point.lat).toBeCloseTo(14.5, 6)
    expect(hit.point.lng).toBeCloseTo(121.49, 6)
  })

  it('clamps projection to segment endpoints', () => {
    // Point far west of the road's start — projection clamps to the first vertex
    const hit = nearestPointOnPolyline(
      { lat: 14.5, lng: 121.4 },
      ROAD_A.polyline.points,
      { lat: 14.5, lng: 121.49 },
    )!
    expect(hit.point.lat).toBeCloseTo(14.5, 6)
    expect(hit.point.lng).toBeCloseTo(121.49, 6)
  })
})

describe('snapRoadEndpoints', () => {
  it('snaps an endpoint within the radius onto the road', () => {
    // ~0.45m north of the road — within the 0.5m discovery radius
    const points = [
      { lat: 14.500004, lng: 121.49 },
      { lat: 14.5005, lng: 121.53 },
    ]
    const result = snapRoadEndpoints(points, [ROAD_A])

    expect(result.snapped).toBe(true)
    expect(result.snapCount).toBe(1)
    // West endpoint moved onto the road line
    expect(result.points[0].lat).toBeCloseTo(14.5, 6)
    expect(result.points[0].lng).toBeCloseTo(121.49, 6)
    // Far endpoint untouched
    expect(result.points[1]).toEqual(points[1])
  })

  it('snaps BOTH endpoints when both are within the radius', () => {
    const points = [
      { lat: 14.500004, lng: 121.49 },
      { lat: 14.500004, lng: 121.51 }, // ~0.45m north of the road's east end
    ]
    const result = snapRoadEndpoints(points, [ROAD_A])

    expect(result.snapCount).toBe(2)
    expect(result.points[1].lat).toBeCloseTo(14.5, 6)
  })

  it('leaves endpoints beyond the radius untouched', () => {
    // 55m north of the road — beyond the 0.5m radius
    const points = [
      { lat: 14.5005, lng: 121.49 },
      { lat: 14.5005, lng: 121.53 },
    ]
    const result = snapRoadEndpoints(points, [ROAD_A])

    expect(result.snapped).toBe(false)
    expect(result.snapCount).toBe(0)
    expect(result.points).toEqual(points)
  })

  it('never moves interior points', () => {
    const points = [
      { lat: 14.500004, lng: 121.49 },
      { lat: 14.4999, lng: 121.50 }, // interior point 11m south of the road — would snap if considered
      { lat: 14.500004, lng: 121.51 },
    ]
    const result = snapRoadEndpoints(points, [ROAD_A])

    expect(result.snapCount).toBe(2)
    expect(result.points[1]).toEqual(points[1])
  })

  it('respects a custom radius', () => {
    const points = [
      { lat: 14.5002, lng: 121.49 }, // ~22m away
      { lat: 14.5002, lng: 121.51 },
    ]
    expect(snapRoadEndpoints(points, [ROAD_A], undefined, 5).snapCount).toBe(0)
    expect(snapRoadEndpoints(points, [ROAD_A], undefined, 30).snapCount).toBe(2)
  })

  it('returns the input unchanged when there are no roads', () => {
    const points = [
      { lat: 14.50003, lng: 121.49 },
      { lat: 14.50003, lng: 121.53 },
    ]
    const result = snapRoadEndpoints(points, [])
    expect(result.snapped).toBe(false)
    expect(result.points).toEqual(points)
  })
})

describe('snapPoint', () => {
  it('snaps a lone point onto the nearest road within the radius', () => {
    const p = snapPoint({ lat: 14.500004, lng: 121.49 }, [ROAD_A])
    expect(p.lat).toBeCloseTo(14.5, 6)
    expect(p.lng).toBeCloseTo(121.49, 6)
  })

  it('returns the original point when nothing is near', () => {
    const p = { lat: 14.501, lng: 121.49 } // 111m away
    expect(snapPoint(p, [ROAD_A])).toEqual(p)
  })

  it('exports the 0.5m discovery radius by default', () => {
    expect(ROAD_SNAP_RADIUS_METERS).toBe(0.5)
  })

  it('exposes the geographic road helper through the editor package API', () => {
    const p = publicSnapRoadPoint({ lat: 14.500004, lng: 121.49 }, [ROAD_A])
    expect(p.lat).toBeCloseTo(14.5, 6)
    expect(p.lng).toBeCloseTo(121.49, 6)
  })
})

describe('roadCreateHandler explicit-only integration', () => {
  it('stores the authored polyline unchanged when creating a road next to an existing one', () => {
    const doc = docWithRoads([ROAD_A])
    const authoredStart = { lat: 14.500004, lng: 121.49 }
    const result = roadCreateHandler.execute(doc, {
      name: 'New Rd',
      points: [
        authoredStart,
        { lat: 14.500004, lng: 121.53 },
      ],
    })

    expect(result.success).toBe(true)
    expect(result.data).toMatchObject({ snapCount: 0 })
    const created = doc.roads.find((r) => r.id === result.entityId)!
    expect(created.polyline.points[0]).toEqual(authoredStart)
    expect(doc.roadJunctions).toBeUndefined()
  })

  it('does not snap when the new road is far from everything', () => {
    const doc = docWithRoads([ROAD_A])
    const far = { lat: 14.505, lng: 121.55 } // ~650m away
    const result = roadCreateHandler.execute(doc, {
      name: 'Far Rd',
      points: [far, { lat: 14.505, lng: 121.57 }],
    })

    expect(result.data).toMatchObject({ snapCount: 0 })
    const created = doc.roads.find((r) => r.id === result.entityId)!
    expect(created.polyline.points[0]).toEqual(far)
  })
})
