import { describe, it, expect } from 'vitest'
import { FloorGeometryService } from '../floor-geometry-service'
import type { FloorGeometryArtifact } from '@navi/core'
import type { LoadedPackage } from '../../loader'

function makePkg(floorGeometry?: FloorGeometryArtifact): LoadedPackage {
  return {
    manifest: {
      schemaVersion: '1.0', formatVersion: '0',
      campusId: 'test', campusName: 'Test', publishedAt: '', compilerVersion: '0.1.0', revision: '1',
      artifacts: { graph: { path: 'g.json', checksum: '', size: 0, schemaVersion: '1.0', formatVersion: '0' } },
      metadata: { routeable: true, nodeCount: 0, edgeCount: 0, buildingCount: 2, floorCount: 3, boundingBox: { minLat: 0, maxLat: 1, minLng: 0, maxLng: 1 } },
    },
    graph: { version: '1.0', campusId: 'test', createdAt: '', checksum: '', nodes: [], edges: [], metadata: { nodeCount: 0, edgeCount: 0, buildings: 0, floors: 0, boundingBox: { minLat: 0, maxLat: 1, minLng: 0, maxLng: 1 } } },
    reports: [],
    warnings: [],
    floorGeometry,
  }
}

function testArtifact(): FloorGeometryArtifact {
  return {
    schemaVersion: 1, formatVersion: 0, campusId: 'campus-1',
    buildings: [
      {
        id: 'b1', name: 'Building A',
        anchor: { origin: { lat: 14.5, lng: 121.0 }, rotation: 45 },
        floors: [
          {
            level: 0, label: 'Ground Floor', elevation: 0,
            offset: { x: 10, y: 20 },
            rooms: [
              { id: 'r1', name: 'Room 101', number: '101', polygon: { points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 4 }, { x: 0, y: 4 }] } },
              { id: 'r2', name: 'Room 102', number: '102', polygon: { points: [{ x: 6, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 4 }, { x: 6, y: 4 }] } },
            ],
            hallways: [{ id: 'h1', name: 'Main Corridor', polyline: { points: [{ x: 0, y: 5 }, { x: 10, y: 5 }] } }],
            staircases: [{ id: 's1', name: 'Stair A', position: { x: 0, y: 6 }, rotation: 0 }],
            elevators: [{ id: 'el1', name: 'Elevator 1', position: { x: 10, y: 6 }, rotation: 90 }],
            doors: [{ id: 'd1', roomId: 'r1', doorType: 'entry', position: { x: 2.5, y: 0 }, width: 0.9 }],
            pois: [{ id: 'po1', name: 'Water Fountain', category: 'amenity', position: { x: 5, y: 5.5 } }],
            qrCheckpoints: [{ id: 'qr1', label: 'Lobby QR', code: 'CHK-001', position: { x: 5, y: 2 } }],
          },
          {
            level: 1, label: 'First Floor', elevation: 3.5,
            offset: { x: 10, y: 20 },
            rooms: [{ id: 'r3', name: 'Room 201', number: '201', polygon: { points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 4 }, { x: 0, y: 4 }] } }],
            hallways: [], staircases: [], elevators: [], doors: [], pois: [], qrCheckpoints: [],
          },
        ],
      },
      {
        id: 'b2', name: 'Building B',
        anchor: { origin: { lat: 14.502, lng: 121.002 }, rotation: 0 },
        floors: [{ level: 0, label: 'Lobby', elevation: 0, offset: { x: 0, y: 0 }, rooms: [], hallways: [], staircases: [], elevators: [], doors: [], pois: [], qrCheckpoints: [] }],
      },
    ],
  }
}

describe('FloorGeometryService', () => {
  const svc = new FloorGeometryService(makePkg(testArtifact()))

  describe('available', () => {
    it('returns true when floorGeometry is present', () => {
      expect(svc.available).toBe(true)
    })
    it('returns false when floorGeometry is absent', () => {
      expect(new FloorGeometryService(makePkg()).available).toBe(false)
    })
  })

  describe('getCampusId()', () => {
    it('returns campusId from artifact', () => {
      expect(svc.getCampusId()).toBe('campus-1')
    })
    it('returns undefined when absent', () => {
      expect(new FloorGeometryService(makePkg()).getCampusId()).toBeUndefined()
    })
  })

  describe('listBuildings()', () => {
    it('returns all buildings', () => {
      const buildings = svc.listBuildings()
      expect(buildings).toHaveLength(2)
      expect(buildings[0].id).toBe('b1')
      expect(buildings[1].id).toBe('b2')
    })
    it('returns floor levels per building', () => {
      const b1 = svc.listBuildings().find(b => b.id === 'b1')!
      expect(b1.floorLevels).toEqual([0, 1])
    })
    it('returns anchor data', () => {
      const b1 = svc.listBuildings().find(b => b.id === 'b1')!
      expect(b1.anchor.origin).toEqual({ lat: 14.5, lng: 121.0 })
      expect(b1.anchor.rotation).toBe(45)
    })
    it('returns empty when no floorGeometry', () => {
      expect(new FloorGeometryService(makePkg()).listBuildings()).toEqual([])
    })
  })

  describe('getBuilding()', () => {
    it('returns building for valid ID', () => {
      const b = svc.getBuilding('b1')
      expect(b).toBeDefined()
      expect(b!.name).toBe('Building A')
    })
    it('returns undefined for unknown ID', () => {
      expect(svc.getBuilding('nonexistent')).toBeUndefined()
    })
    it('returns undefined when no floorGeometry', () => {
      expect(new FloorGeometryService(makePkg()).getBuilding('b1')).toBeUndefined()
    })
  })

  describe('getFloor()', () => {
    it('returns floor metadata', () => {
      const floor = svc.getFloor('b1', 0)
      expect(floor).toBeDefined()
      expect(floor!.level).toBe(0)
      expect(floor!.label).toBe('Ground Floor')
      expect(floor!.elevation).toBe(0)
      expect(floor!.offset).toEqual({ x: 10, y: 20 })
    })
    it('returns undefined for unknown level', () => {
      expect(svc.getFloor('b1', 99)).toBeUndefined()
    })
    it('returns undefined for unknown building', () => {
      expect(svc.getFloor('nonexistent', 0)).toBeUndefined()
    })
  })

  describe('getRooms()', () => {
    it('returns rooms for floor 0', () => {
      const rooms = svc.getRooms('b1', 0)
      expect(rooms).toHaveLength(2)
      expect(rooms[0].id).toBe('r1')
      expect(rooms[0].name).toBe('Room 101')
      expect(rooms[0].polygon.points).toEqual([
        { x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 4 }, { x: 0, y: 4 },
      ])
    })
    it('returns empty for building with no rooms', () => {
      expect(svc.getRooms('b2', 0)).toEqual([])
    })
  })

  describe('getWalls()', () => {
    it('returns wall segments from room polygons', () => {
      const walls = svc.getWalls('b1', 0)
      expect(walls).toHaveLength(8)
      expect(walls[0]).toEqual({ from: { x: 0, y: 0 }, to: { x: 5, y: 0 } })
    })
    it('returns empty for floor with no rooms', () => {
      expect(svc.getWalls('b2', 0)).toEqual([])
    })
  })

  describe('getDoors()', () => {
    it('returns doors for floor', () => {
      const doors = svc.getDoors('b1', 0)
      expect(doors).toHaveLength(1)
      expect(doors[0].id).toBe('d1')
      expect(doors[0].roomId).toBe('r1')
      expect(doors[0].doorType).toBe('entry')
      expect(doors[0].width).toBe(0.9)
    })
    it('returns empty for floor with no doors', () => {
      expect(svc.getDoors('b1', 1)).toEqual([])
    })
  })

  describe('getStaircases()', () => {
    it('returns staircases', () => {
      const stairs = svc.getStaircases('b1', 0)
      expect(stairs).toHaveLength(1)
      expect(stairs[0].id).toBe('s1')
      expect(stairs[0].name).toBe('Stair A')
      expect(stairs[0].position).toEqual({ x: 0, y: 6 })
    })
    it('returns empty for floor with no staircases', () => {
      expect(svc.getStaircases('b1', 1)).toEqual([])
    })
  })

  describe('getElevators()', () => {
    it('returns elevators', () => {
      const elevators = svc.getElevators('b1', 0)
      expect(elevators).toHaveLength(1)
      expect(elevators[0].id).toBe('el1')
      expect(elevators[0].name).toBe('Elevator 1')
      expect(elevators[0].position).toEqual({ x: 10, y: 6 })
      expect(elevators[0].rotation).toBe(90)
    })
    it('returns empty for floor with no elevators', () => {
      expect(svc.getElevators('b1', 1)).toEqual([])
    })
  })

  describe('getHallways()', () => {
    it('returns hallways', () => {
      const hallways = svc.getHallways('b1', 0)
      expect(hallways).toHaveLength(1)
      expect(hallways[0].id).toBe('h1')
      expect(hallways[0].name).toBe('Main Corridor')
      expect(hallways[0].polyline.points).toEqual([{ x: 0, y: 5 }, { x: 10, y: 5 }])
    })
    it('returns empty for floor with no hallways', () => {
      expect(svc.getHallways('b1', 1)).toEqual([])
    })
  })

  describe('getPOIs()', () => {
    it('returns POIs', () => {
      const pois = svc.getPOIs('b1', 0)
      expect(pois).toHaveLength(1)
      expect(pois[0].id).toBe('po1')
      expect(pois[0].name).toBe('Water Fountain')
      expect(pois[0].category).toBe('amenity')
      expect(pois[0].position).toEqual({ x: 5, y: 5.5 })
    })
    it('returns empty for floor with no POIs', () => {
      expect(svc.getPOIs('b1', 1)).toEqual([])
    })
  })

  describe('getQRCheckpoints()', () => {
    it('returns QR checkpoints', () => {
      const qrs = svc.getQRCheckpoints('b1', 0)
      expect(qrs).toHaveLength(1)
      expect(qrs[0].id).toBe('qr1')
      expect(qrs[0].label).toBe('Lobby QR')
      expect(qrs[0].code).toBe('CHK-001')
      expect(qrs[0].position).toEqual({ x: 5, y: 2 })
    })
    it('returns empty for floor with no QR checkpoints', () => {
      expect(svc.getQRCheckpoints('b1', 1)).toEqual([])
    })
  })

  describe('undefined floorGeometry', () => {
    const emptySvc = new FloorGeometryService(makePkg())
    it('all getters return empty/undefined', () => {
      expect(emptySvc.available).toBe(false)
      expect(emptySvc.getCampusId()).toBeUndefined()
      expect(emptySvc.listBuildings()).toEqual([])
      expect(emptySvc.getBuilding('b1')).toBeUndefined()
      expect(emptySvc.getFloor('b1', 0)).toBeUndefined()
      expect(emptySvc.getRooms('b1', 0)).toEqual([])
      expect(emptySvc.getWalls('b1', 0)).toEqual([])
      expect(emptySvc.getDoors('b1', 0)).toEqual([])
      expect(emptySvc.getStaircases('b1', 0)).toEqual([])
      expect(emptySvc.getElevators('b1', 0)).toEqual([])
      expect(emptySvc.getHallways('b1', 0)).toEqual([])
      expect(emptySvc.getPOIs('b1', 0)).toEqual([])
      expect(emptySvc.getQRCheckpoints('b1', 0)).toEqual([])
    })
  })

  describe('immutability', () => {
    it('does not mutate LoadedPackage', () => {
      const before = JSON.stringify(makePkg(testArtifact()).floorGeometry)
      svc.listBuildings()
      svc.getBuilding('b1')
      svc.getFloor('b1', 0)
      svc.getRooms('b1', 0)
      svc.getWalls('b1', 0)
      svc.getDoors('b1', 0)
      svc.getStaircases('b1', 0)
      svc.getElevators('b1', 0)
      svc.getHallways('b1', 0)
      svc.getPOIs('b1', 0)
      svc.getQRCheckpoints('b1', 0)
      expect(JSON.stringify(makePkg(testArtifact()).floorGeometry)).toBe(before)
    })
  })
})
