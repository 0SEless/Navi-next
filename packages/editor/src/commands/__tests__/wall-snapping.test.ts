import { describe, it, expect } from 'vitest'
import type { CampusDocument, LocalCoord } from '@navi/core'
import { wallCreateHandler } from '../wall-handlers'
import { snapPoint } from '../../geometry/snapping'
import type { Point2D, SnapConfig } from '../../geometry/snapping'

const defaultSnapConfig: SnapConfig = {
  gridSize: 1,
  endpointSnap: 0.5,
  gridSnap: 0.2,
  orthogonalSnap: true,
  angle45Snap: true,
}

function createDoc(): CampusDocument {
  return {
    schemaVersion: 1,
    version: 0,
    metadata: { campusId: 'test', name: 'test', description: '', lastModified: '', editorVersion: '0.1.0' },
    buildings: [
      {
        id: 'bld-1', name: 'Building A', code: 'BA', category: 'academic', description: '',
        footprint: { points: [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.001 }, { lat: 0.001, lng: 0.001 }, { lat: 0.001, lng: 0 }, { lat: 0, lng: 0 }] },
        baseElevation: 0, height: 20, color: '#4A90D9', aliases: [], metadata: {},
        floors: [
          { id: 'flr-1', level: 0, label: 'Ground', elevation: 0, height: 3.5, rooms: [], hallways: [], staircases: [], elevators: [], entrances: [], connectorStops: [], parametricComponents: [], walls: [], metadata: {} },
        ],
        verticalConnectors: [],
      },
    ],
    roads: [], panoramas: [], qrCheckpoints: [],
  }
}

function collectWallEndpoints(doc: CampusDocument, buildingId: string, floorId: string): Point2D[] {
  const building = doc.buildings.find(b => b.id === buildingId)
  if (!building) return []
  const floor = building.floors.find(f => f.id === floorId)
  if (!floor?.walls) return []
  const endpoints: Point2D[] = []
  for (const wall of floor.walls) {
    endpoints.push({ x: wall.start.x, y: wall.start.y })
    endpoints.push({ x: wall.end.x, y: wall.end.y })
  }
  return endpoints
}

describe('W4A: wall snapping integration', () => {
  describe('endpoint snapping to existing wall', () => {
    it('snaps new wall start to existing wall endpoint', () => {
      const doc = createDoc()
      // Create first wall: (0,0) → (5,0)
      wallCreateHandler.execute(doc, {
        buildingId: 'bld-1', floorId: 'flr-1',
        start: { x: 0, y: 0 }, end: { x: 5, y: 0 },
      })

      // Collect endpoints for snap
      const endpoints = collectWallEndpoints(doc, 'bld-1', 'flr-1')
      expect(endpoints).toHaveLength(2)

      // User clicks near (5, 0.1) — should snap to (5, 0)
      const rawPoint: Point2D = { x: 5.05, y: 0.1 }
      const result = snapPoint(rawPoint, defaultSnapConfig, endpoints)

      expect(result.snapType).toBe('endpoint')
      expect(result.position).toEqual({ x: 5, y: 0 })
    })

    it('snaps new wall end to existing wall endpoint', () => {
      const doc = createDoc()
      // Create first wall: (0,0) → (10,0)
      wallCreateHandler.execute(doc, {
        buildingId: 'bld-1', floorId: 'flr-1',
        start: { x: 0, y: 0 }, end: { x: 10, y: 0 },
      })

      const endpoints = collectWallEndpoints(doc, 'bld-1', 'flr-1')
      expect(endpoints).toHaveLength(2)

      // Second wall start at (10,0), end near (10, 0.1) — should snap to (10, 0)
      const lastPoint: Point2D = { x: 10, y: 0 }
      const rawEnd: Point2D = { x: 10.05, y: 0.1 }
      const result = snapPoint(rawEnd, defaultSnapConfig, endpoints, lastPoint)

      expect(result.snapType).toBe('endpoint')
      expect(result.position).toEqual({ x: 10, y: 0 })
    })

    it('stored wall coordinates are the snapped building-local values', () => {
      const doc = createDoc()
      // Simulate snapping: user clicks near (0.05, 0.1) for start, near (5.05, 0.1) for end
      const endpoints: Point2D[] = []
      const startSnap = snapPoint({ x: 0.05, y: 0.1 }, defaultSnapConfig, endpoints)
      // startSnap should snap to grid (0, 0)
      expect(startSnap.position).toEqual({ x: 0, y: 0 })

      const endSnap = snapPoint({ x: 5.05, y: 0.1 }, defaultSnapConfig, endpoints, startSnap.position)
      // endSnap should snap to grid (5, 0)
      expect(endSnap.position).toEqual({ x: 5, y: 0 })

      // Create wall with snapped coordinates
      const result = wallCreateHandler.execute(doc, {
        buildingId: 'bld-1', floorId: 'flr-1',
        start: startSnap.position, end: endSnap.position,
        thickness: 0.15, height: 3.5,
      })
      expect(result.success).toBe(true)

      // Verify stored coordinates are the snapped values, not the raw clicks
      const wall = doc.buildings[0].floors[0].walls![0]
      expect(wall.start).toEqual({ x: 0, y: 0 })
      expect(wall.end).toEqual({ x: 5, y: 0 })
    })
  })

  describe('grid snapping', () => {
    it('snaps to nearest 1m grid point', () => {
      const result = snapPoint({ x: 1.08, y: 0.95 }, defaultSnapConfig, [])
      expect(result.snapType).toBe('grid')
      expect(result.position).toEqual({ x: 1, y: 1 })
    })

    it('snaps to grid when drawing wall', () => {
      const endpoints: Point2D[] = []
      const startSnap = snapPoint({ x: 0.05, y: 0.08 }, defaultSnapConfig, endpoints)
      expect(startSnap.position).toEqual({ x: 0, y: 0 })

      const endSnap = snapPoint({ x: 4.92, y: 0.05 }, defaultSnapConfig, endpoints, startSnap.position)
      expect(endSnap.position).toEqual({ x: 5, y: 0 })
    })
  })

  describe('orthogonal snapping', () => {
    it('snaps to horizontal line from last point', () => {
      const lastPoint: Point2D = { x: 0, y: 0 }
      const result = snapPoint({ x: 5.3, y: 0.1 }, defaultSnapConfig, [], lastPoint)
      expect(result.snapType).toBe('orthogonal')
      expect(result.position).toEqual({ x: 5.3, y: 0 })
    })

    it('snaps to vertical line from last point', () => {
      const lastPoint: Point2D = { x: 0, y: 0 }
      const result = snapPoint({ x: 0.1, y: 5.3 }, defaultSnapConfig, [], lastPoint)
      expect(result.snapType).toBe('orthogonal')
      expect(result.position).toEqual({ x: 0, y: 5.3 })
    })
  })

  describe('45-degree snapping', () => {
    it('snaps to 45-degree angle from last point', () => {
      const config: SnapConfig = { ...defaultSnapConfig, orthogonalSnap: false }
      const lastPoint: Point2D = { x: 0, y: 0 }
      const result = snapPoint({ x: 4.3, y: 4.2 }, config, [], lastPoint)
      expect(result.snapType).toBe('45deg')
      const dist = Math.sqrt(4.3 * 4.3 + 4.2 * 4.2)
      expect(result.position.x).toBeCloseTo(dist * Math.cos(Math.PI / 4), 10)
      expect(result.position.y).toBeCloseTo(dist * Math.sin(Math.PI / 4), 10)
    })
  })

  describe('snap priority', () => {
    it('endpoint snap takes priority over grid snap', () => {
      const endpoints: Point2D[] = [{ x: 1, y: 1 }]
      const result = snapPoint({ x: 1.05, y: 1 }, defaultSnapConfig, endpoints)
      expect(result.snapType).toBe('endpoint')
      expect(result.position).toEqual({ x: 1, y: 1 })
    })

    it('grid snap takes priority over orthogonal snap', () => {
      const lastPoint: Point2D = { x: 0, y: 0 }
      const result = snapPoint({ x: 5.05, y: 0.05 }, defaultSnapConfig, [], lastPoint)
      expect(result.snapType).toBe('grid')
    })
  })

  describe('wall endpoint alignment', () => {
    it('two walls sharing a snapped endpoint have identical coordinates', () => {
      const doc = createDoc()
      // First wall: horizontal
      wallCreateHandler.execute(doc, {
        buildingId: 'bld-1', floorId: 'flr-1',
        start: { x: 0, y: 0 }, end: { x: 5, y: 0 },
      })

      // Second wall: vertical from same endpoint
      wallCreateHandler.execute(doc, {
        buildingId: 'bld-1', floorId: 'flr-1',
        start: { x: 5, y: 0 }, end: { x: 5, y: 5 },
      })

      const walls = doc.buildings[0].floors[0].walls!
      expect(walls).toHaveLength(2)

      // Wall 1 end === Wall 2 start (shared endpoint)
      expect(walls[0].end).toEqual(walls[1].start)
      expect(walls[0].end).toEqual({ x: 5, y: 0 })
    })

    it('snapped coordinates prevent floating-point misalignment', () => {
      const doc = createDoc()
      const endpoints: Point2D[] = []

      // Simulate imprecise user clicks
      const startSnap = snapPoint({ x: 0.03, y: 0.07 }, defaultSnapConfig, endpoints)
      const endSnap = snapPoint({ x: 4.98, y: 0.04 }, defaultSnapConfig, endpoints, startSnap.position)

      // Both should snap to exact grid points
      expect(startSnap.position).toEqual({ x: 0, y: 0 })
      expect(endSnap.position).toEqual({ x: 5, y: 0 })

      // Create wall
      wallCreateHandler.execute(doc, {
        buildingId: 'bld-1', floorId: 'flr-1',
        start: startSnap.position, end: endSnap.position,
      })

      // Second wall should snap to first wall's endpoint
      const endpoints2 = collectWallEndpoints(doc, 'bld-1', 'flr-1')
      const start2Snap = snapPoint({ x: 5.02, y: 0.03 }, defaultSnapConfig, endpoints2)
      expect(start2Snap.snapType).toBe('endpoint')
      expect(start2Snap.position).toEqual({ x: 5, y: 0 })
    })
  })

  describe('validation', () => {
    it('rejects wall with start === end', () => {
      const doc = createDoc()
      const result = wallCreateHandler.execute(doc, {
        buildingId: 'bld-1', floorId: 'flr-1',
        start: { x: 5, y: 5 }, end: { x: 5, y: 5 },
      })
      expect(result.success).toBe(false)
      expect(result.error).toContain('different points')
    })

    it('rejects wall with thickness <= 0', () => {
      const doc = createDoc()
      const result = wallCreateHandler.execute(doc, {
        buildingId: 'bld-1', floorId: 'flr-1',
        start: { x: 0, y: 0 }, end: { x: 5, y: 0 },
        thickness: 0, height: 3.5,
      })
      expect(result.success).toBe(false)
      expect(result.error).toContain('thickness')
    })

    it('rejects wall with height <= 0', () => {
      const doc = createDoc()
      const result = wallCreateHandler.execute(doc, {
        buildingId: 'bld-1', floorId: 'flr-1',
        start: { x: 0, y: 0 }, end: { x: 5, y: 0 },
        thickness: 0.15, height: -1,
      })
      expect(result.success).toBe(false)
      expect(result.error).toContain('height')
    })
  })
})
