import { describe, it, expect, beforeEach } from 'vitest'
import { SpatialQueryService, type EntityRef } from '../spatial-query-service'
import type { BBox } from '../polygon'

function makeRef(id: string, type: EntityRef['type'], position: { lat: number; lng: number }): EntityRef {
  return { id, type, position }
}

function makeBBox(position: { lat: number; lng: number }, size = 0.0001): BBox {
  return {
    minX: position.lng - size,
    maxX: position.lng + size,
    minY: position.lat - size,
    maxY: position.lat + size,
  }
}

describe('SpatialQueryService', () => {
  let service: SpatialQueryService

  beforeEach(() => {
    service = new SpatialQueryService()
  })

  describe('insertEntity / removeEntity', () => {
    it('inserts and queries entities', () => {
      const ref = makeRef('road-1', 'road', { lat: 0, lng: 0 })
      service.insertEntity(ref, makeBBox(ref.position!))

      expect(service.size).toBe(1)
      const results = service.entitiesAtPoint(ref.position!)
      expect(results).toHaveLength(1)
      expect(results[0].id).toBe('road-1')
    })

    it('removes entities', () => {
      const ref = makeRef('road-1', 'road', { lat: 0, lng: 0 })
      service.insertEntity(ref, makeBBox(ref.position!))
      service.removeEntity('road-1')

      expect(service.size).toBe(0)
      const results = service.entitiesAtPoint(ref.position!)
      expect(results).toHaveLength(0)
    })

    it('updates entities', () => {
      const ref1 = makeRef('road-1', 'road', { lat: 0, lng: 0 })
      service.insertEntity(ref1, makeBBox(ref1.position!))
      expect(service.size).toBe(1)

      // Query at original position
      const results1 = service.entitiesAtPoint(ref1.position!)
      expect(results1).toHaveLength(1)

      // Update to new position
      const ref2 = makeRef('road-1', 'road', { lat: 0, lng: 0.001 })
      service.updateEntity(ref2, makeBBox(ref2.position!))
      expect(service.size).toBe(1)

      // Query at new position
      const results2 = service.entitiesAtPoint(ref2.position!)
      expect(results2).toHaveLength(1)
      expect(results2[0].id).toBe('road-1')

      // Query at old position should return empty
      const results3 = service.entitiesAtPoint(ref1.position!)
      expect(results3).toHaveLength(0)
    })

    it('clears all entities', () => {
      service.insertEntity(makeRef('road-1', 'road', { lat: 0, lng: 0 }), makeBBox({ lat: 0, lng: 0 }))
      service.insertEntity(makeRef('road-2', 'road', { lat: 1, lng: 1 }), makeBBox({ lat: 1, lng: 1 }))

      service.clear()

      expect(service.size).toBe(0)
    })
  })

  describe('nearestEntity', () => {
    it('finds nearest entity', () => {
      service.insertEntity(makeRef('road-1', 'road', { lat: 0, lng: 0 }), makeBBox({ lat: 0, lng: 0 }))
      service.insertEntity(makeRef('road-2', 'road', { lat: 0, lng: 0.001 }), makeBBox({ lat: 0, lng: 0.001 }))

      const result = service.nearestEntity({ lat: 0, lng: 0.0001 })
      expect(result).not.toBeNull()
      expect(result!.entity.id).toBe('road-1')
    })

    it('respects maxDistance', () => {
      service.insertEntity(makeRef('road-1', 'road', { lat: 0, lng: 0 }), makeBBox({ lat: 0, lng: 0 }))
      service.insertEntity(makeRef('road-2', 'road', { lat: 0, lng: 0.01 }), makeBBox({ lat: 0, lng: 0.01 }))

      const result = service.nearestEntity({ lat: 0, lng: 0 }, { maxDistance: 100 })
      expect(result).not.toBeNull()
      expect(result!.entity.id).toBe('road-1')
    })

    it('returns null when no entities in range', () => {
      service.insertEntity(makeRef('road-1', 'road', { lat: 0, lng: 0 }), makeBBox({ lat: 0, lng: 0 }))

      const result = service.nearestEntity({ lat: 1, lng: 1 }, { maxDistance: 100 })
      expect(result).toBeNull()
    })

    it('filters by type', () => {
      service.insertEntity(makeRef('road-1', 'road', { lat: 0, lng: 0 }), makeBBox({ lat: 0, lng: 0 }))
      service.insertEntity(makeRef('entrance-1', 'entrance', { lat: 0, lng: 0.0001 }), makeBBox({ lat: 0, lng: 0.0001 }))

      const result = service.nearestEntity({ lat: 0, lng: 0 }, { type: 'road' })
      expect(result).not.toBeNull()
      expect(result!.entity.id).toBe('road-1')
      expect(result!.entity.type).toBe('road')
    })

    it('filters by floorId', () => {
      service.insertEntity(makeRef('room-1', 'room', { lat: 0, lng: 0 }), makeBBox({ lat: 0, lng: 0 }))
      service.insertEntity(makeRef('room-2', 'room', { lat: 0, lng: 0.0001 }), makeBBox({ lat: 0, lng: 0.0001 }))

      const room1 = service.entityMap.get('room-1')!
      const room2 = service.entityMap.get('room-2')!
      room1.floorId = 'floor-1'
      room2.floorId = 'floor-2'

      const result = service.nearestEntity({ lat: 0, lng: 0 }, { floorId: 'floor-2' })
      expect(result).not.toBeNull()
      expect(result!.entity.id).toBe('room-2')
    })

    it('excludes entities', () => {
      service.insertEntity(makeRef('road-1', 'road', { lat: 0, lng: 0 }), makeBBox({ lat: 0, lng: 0 }))
      service.insertEntity(makeRef('road-2', 'road', { lat: 0, lng: 0.0001 }), makeBBox({ lat: 0, lng: 0.0001 }))

      const result = service.nearestEntity({ lat: 0, lng: 0 }, { exclude: ['road-1'] })
      expect(result).not.toBeNull()
      expect(result!.entity.id).toBe('road-2')
    })
  })

  describe('nearestRoad', () => {
    it('finds nearest road', () => {
      service.insertEntity(makeRef('road-1', 'road', { lat: 0, lng: 0 }), makeBBox({ lat: 0, lng: 0 }))
      service.insertEntity(makeRef('entrance-1', 'entrance', { lat: 0, lng: 0.0001 }), makeBBox({ lat: 0, lng: 0.0001 }))

      const result = service.nearestRoad({ lat: 0, lng: 0 })
      expect(result).not.toBeNull()
      expect(result!.entity.type).toBe('road')
    })
  })

  describe('nearestNode', () => {
    it('finds nearest node (entrance, stair, or elevator)', () => {
      service.insertEntity(makeRef('entrance-1', 'entrance', { lat: 0, lng: 0 }), makeBBox({ lat: 0, lng: 0 }))
      service.insertEntity(makeRef('road-1', 'road', { lat: 0, lng: 0.0001 }), makeBBox({ lat: 0, lng: 0.0001 }))

      const result = service.nearestNode({ lat: 0, lng: 0 })
      expect(result).not.toBeNull()
      expect(result!.entity.type).toBe('entrance')
    })
  })

  describe('entityAtPoint', () => {
    it('finds entity at point', () => {
      service.insertEntity(makeRef('room-1', 'room', { lat: 0, lng: 0 }), makeBBox({ lat: 0, lng: 0 }))

      const result = service.entityAtPoint({ lat: 0, lng: 0 })
      expect(result).not.toBeNull()
      expect(result!.id).toBe('room-1')
    })

    it('returns null when no entity at point', () => {
      const result = service.entityAtPoint({ lat: 1, lng: 1 })
      expect(result).toBeNull()
    })
  })

  describe('entitiesInRadius', () => {
    it('finds entities within radius', () => {
      service.insertEntity(makeRef('road-1', 'road', { lat: 0, lng: 0 }), makeBBox({ lat: 0, lng: 0 }))
      service.insertEntity(makeRef('road-2', 'road', { lat: 0, lng: 0.001 }), makeBBox({ lat: 0, lng: 0.001 }))
      service.insertEntity(makeRef('road-3', 'road', { lat: 0, lng: 0.01 }), makeBBox({ lat: 0, lng: 0.01 }))

      const results = service.entitiesInRadius({ lat: 0, lng: 0 }, 500)
      expect(results.length).toBeGreaterThanOrEqual(2)
    })

    it('returns sorted by distance', () => {
      service.insertEntity(makeRef('road-1', 'road', { lat: 0, lng: 0.001 }), makeBBox({ lat: 0, lng: 0.001 }))
      service.insertEntity(makeRef('road-2', 'road', { lat: 0, lng: 0.0005 }), makeBBox({ lat: 0, lng: 0.0005 }))

      const results = service.entitiesInRadius({ lat: 0, lng: 0 }, 500)
      expect(results.length).toBe(2)
      expect(results[0].distance).toBeLessThan(results[1].distance)
    })
  })

  describe('entitiesInBounds', () => {
    it('finds entities in bounding box', () => {
      service.insertEntity(makeRef('road-1', 'road', { lat: 0, lng: 0 }), makeBBox({ lat: 0, lng: 0 }))
      service.insertEntity(makeRef('road-2', 'road', { lat: 1, lng: 1 }), makeBBox({ lat: 1, lng: 1 }))

      const results = service.entitiesInBounds({
        minX: -0.001,
        maxX: 0.001,
        minY: -0.001,
        maxY: 0.001,
      })

      expect(results).toHaveLength(1)
      expect(results[0].id).toBe('road-1')
    })
  })

  describe('geometry queries', () => {
    it('nearestPointOnSegment', () => {
      const result = service.nearestPointOnSegment(
        { lat: 0, lng: 0.0001 },
        { lat: 0, lng: 0 },
        { lat: 0, lng: 0.001 },
      )
      expect(result.lat).toBe(0)
      expect(result.lng).toBeCloseTo(0.0001, 5)
    })

    it('nearestPointOnPolyline', () => {
      const result = service.nearestPointOnPolyline(
        { lat: 0, lng: 0.0001 },
        [
          { lat: 0, lng: 0 },
          { lat: 0, lng: 0.001 },
          { lat: 0, lng: 0.002 },
        ],
      )
      expect(result).not.toBeNull()
      expect(result!.lat).toBe(0)
      expect(result!.lng).toBeCloseTo(0.0001, 5)
    })

    it('distance', () => {
      const d = service.distance(
        { lat: 0, lng: 0 },
        { lat: 0, lng: 0.001 },
      )
      expect(d).toBeGreaterThan(0)
      expect(d).toBeLessThan(200) // Should be ~111 meters
    })

    it('distanceMeters', () => {
      const d = service.distanceMeters(
        { lat: 0, lng: 0 },
        { lat: 0, lng: 0.001 },
      )
      expect(d).toBeGreaterThan(0)
      expect(d).toBeLessThan(200)
    })

    it('pointInPolygon', () => {
      const polygon = [
        { lat: 0, lng: 0 },
        { lat: 0, lng: 0.001 },
        { lat: 0.001, lng: 0.001 },
        { lat: 0.001, lng: 0 },
      ]

      expect(service.pointInPolygon({ lat: 0.0005, lng: 0.0005 }, polygon)).toBe(true)
      expect(service.pointInPolygon({ lat: 1, lng: 1 }, polygon)).toBe(false)
    })

    it('lineIntersection', () => {
      const result = service.lineIntersection(
        [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.001 }],
        [{ lat: -0.001, lng: 0.0005 }, { lat: 0.001, lng: 0.0005 }],
      )
      expect(result).not.toBeNull()
      expect(result!.lat).toBeCloseTo(0, 5)
      expect(result!.lng).toBeCloseTo(0.0005, 5)
    })

    it('lineIntersection returns null for parallel lines', () => {
      const result = service.lineIntersection(
        [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.001 }],
        [{ lat: 0.001, lng: 0 }, { lat: 0.001, lng: 0.001 }],
      )
      expect(result).toBeNull()
    })
  })

  describe('loadFromRoads', () => {
    it('indexes roads by multiple points along polyline', () => {
      const roads = [{
        id: 'road-1',
        polyline: {
          points: [
            { lat: 0, lng: 0 },
            { lat: 0, lng: 0.001 },  // ~111m long
          ],
        },
      }]

      service.loadFromRoads(roads, 50) // Sample every 50m

      // Query near the start of the road
      const result = service.nearestRoad({ lat: 0, lng: 0 })
      expect(result).not.toBeNull()
      expect(result!.entity.id).toBe('road-1')
      expect(result!.distance).toBeLessThan(10) // Should be very close
    })

    it('finds nearest segment on long road, not centroid', () => {
      const roads = [{
        id: 'road-long',
        polyline: {
          points: [
            { lat: 0, lng: 0 },        // Start
            { lat: 0, lng: 0.005 },     // End (~555m away)
          ],
        },
      }]

      service.loadFromRoads(roads, 50) // Sample every 50m

      // Query near the START of the road (not the centroid at 0.0025)
      const result = service.nearestRoad({ lat: 0, lng: 0.0001 })
      expect(result).not.toBeNull()
      expect(result!.entity.id).toBe('road-long')
      // Should be close to the start, not 250m+ away at centroid
      expect(result!.distance).toBeLessThan(50)
    })

    it('handles degenerate road with single point', () => {
      const roads = [{
        id: 'road-degenerate',
        polyline: {
          points: [{ lat: 0, lng: 0 }],
        },
      }]

      service.loadFromRoads(roads)

      const result = service.nearestRoad({ lat: 0, lng: 0 })
      expect(result).not.toBeNull()
      expect(result!.entity.id).toBe('road-degenerate')
    })
  })
})
