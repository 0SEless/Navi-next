import { describe, it, expect } from 'vitest'
import { BuildingService } from '../building-service'
import type { BuildingIndex } from '@navi/core'
import type { LoadedPackage } from '../../loader'

function makePkg(buildingIndex?: BuildingIndex): LoadedPackage {
  return {
    manifest: {
      schemaVersion: '1.0',
      campusId: 'test',
      campusName: 'Test',
      publishedAt: '',
      compilerVersion: '0.1.0',
      revision: '1',
      artifacts: {
        graph: { path: 'graph.json', checksum: '', size: 0, schemaVersion: '1.0', formatVersion: '0' },
        search: { path: 'search.json', checksum: '', size: 0, schemaVersion: '1.0', formatVersion: '0' },
        buildings: { path: 'building.json', checksum: '', size: 0, schemaVersion: '1.0', formatVersion: '0' },
        poi: { path: 'poi.json', checksum: '', size: 0, schemaVersion: '1.0', formatVersion: '0' },
      },
      metadata: { routeable: true, nodeCount: 0, edgeCount: 0, buildings: 2, floors: 3, boundingBox: { minLat: 14.4, maxLat: 14.6, minLng: 121.0, maxLng: 121.1 } },
    },
    graph: { version: '1.0.0', campusId: 'test', createdAt: '', checksum: '', nodes: [], edges: [], metadata: { nodeCount: 0, edgeCount: 0, buildings: 0, floors: 0, boundingBox: { minLat: 0, maxLat: 1, minLng: 0, maxLng: 1 } } },
    buildingIndex,
    reports: [],
  }
}

function testIndex(): BuildingIndex {
  return {
    version: '1.0.0',
    buildings: [
      {
        id: 'b1',
        name: 'Engineering Building',
        code: 'ENG',
        category: 'academic',
        position: { lat: 14.5, lng: 121.0 },
        floors: [
          { level: 1, label: 'Ground Floor', elevation: 0, rooms: [{ id: 'r1', name: 'Room 101', number: '101', nodeId: 'n1' }] },
          { level: 2, label: 'Second Floor', elevation: 4, rooms: [{ id: 'r2', name: 'Room 201', number: '201', nodeId: 'n2' }] },
        ],
        entrances: [
          { id: 'e1', label: 'Main Entrance', position: { lat: 14.5, lng: 121.0 } },
          { id: 'e2', label: 'Side Entrance', position: { lat: 14.501, lng: 121.0 } },
        ],
        nodeId: 'n1',
      },
      {
        id: 'b2',
        name: 'Library',
        code: 'LIB',
        category: 'academic',
        position: { lat: 14.51, lng: 121.02 },
        floors: [
          { level: 1, label: 'First Floor', elevation: 0, rooms: [] },
        ],
        entrances: [
          { id: 'e3', label: 'Front Door', position: { lat: 14.51, lng: 121.02 } },
        ],
        nodeId: 'n5',
      },
    ],
  }
}

describe('BuildingService', () => {
  const pkg = makePkg(testIndex())
  const svc = new BuildingService(pkg)

  describe('get()', () => {
    it('returns BuildingResult for valid ID', () => {
      const result = svc.get('b1')
      expect(result).toBeDefined()
      expect(result!.id).toBe('b1')
      expect(result!.name).toBe('Engineering Building')
      expect(result!.code).toBe('ENG')
    })

    it('returns undefined for unknown ID', () => {
      expect(svc.get('nonexistent')).toBeUndefined()
    })
  })

  describe('list()', () => {
    it('returns all buildings sorted by name', () => {
      const results = svc.list()
      expect(results.length).toBe(2)
      expect(results[0].name).toBe('Engineering Building')
      expect(results[1].name).toBe('Library')
    })

    it('returns empty for empty buildingIndex', () => {
      const empty = new BuildingService(makePkg())
      expect(empty.list()).toEqual([])
    })
  })

  describe('findNearest()', () => {
    it('returns nearest building to a position', () => {
      const result = svc.findNearest({ lat: 14.5, lng: 121.0 })
      expect(result).toBeDefined()
      expect(result!.id).toBe('b1')
    })

    it('returns nearest building when closer to another building', () => {
      const result = svc.findNearest({ lat: 14.51, lng: 121.02 })
      expect(result).toBeDefined()
      expect(result!.id).toBe('b2')
    })

    it('returns undefined for empty buildingIndex', () => {
      const empty = new BuildingService(makePkg())
      expect(empty.findNearest({ lat: 0, lng: 0 })).toBeUndefined()
    })
  })

  describe('getEntrances()', () => {
    it('returns entrances sorted by name', () => {
      const results = svc.getEntrances('b1')
      expect(results.length).toBe(2)
      expect(results[0].name).toBe('Main Entrance')
      expect(results[1].name).toBe('Side Entrance')
    })

    it('returns empty for unknown building', () => {
      expect(svc.getEntrances('nonexistent')).toEqual([])
    })
  })

  describe('findContaining()', () => {
    it('returns building for point near its centroid', () => {
      const result = svc.findContaining({ lat: 14.5, lng: 121.0 })
      expect(result).toBeDefined()
      expect(result!.id).toBe('b1')
    })

    it('returns undefined for point far from any building', () => {
      const result = svc.findContaining({ lat: 0, lng: 0 })
      expect(result).toBeUndefined()
    })
  })

  describe('BuildingResult shape', () => {
    it('produces correct fields', () => {
      const result = svc.get('b1')!
      expect(result.id).toBe('b1')
      expect(result.name).toBe('Engineering Building')
      expect(result.code).toBe('ENG')
      expect(result.category).toBe('academic')
      expect(result.position.lat).toBeCloseTo(14.5)
      expect(result.position.lng).toBeCloseTo(121.0)
      expect(result.entrances).toEqual(['e1', 'e2'])
      expect(result.floors).toEqual(['Ground Floor', 'Second Floor'])
    })

    it('does not expose nodeId', () => {
      const result = svc.get('b1')!
      expect((result as any).nodeId).toBeUndefined()
    })
  })

  describe('EntranceResult shape', () => {
    it('produces correct fields', () => {
      const results = svc.getEntrances('b1')
      expect(results[0].id).toBe('e1')
      expect(results[0].name).toBe('Main Entrance')
      expect(results[0].position.lat).toBeCloseTo(14.5)
    })

    it('does not expose nodeId', () => {
      const results = svc.getEntrances('b1')
      expect((results[0] as any).nodeId).toBeUndefined()
    })
  })

  describe('immutability', () => {
    it('does not mutate LoadedPackage', () => {
      const before = JSON.stringify(pkg.buildingIndex)
      svc.get('b1')
      svc.list()
      svc.findNearest({ lat: 14.5, lng: 121.0 })
      svc.getEntrances('b1')
      svc.findContaining({ lat: 14.5, lng: 121.0 })
      expect(JSON.stringify(pkg.buildingIndex)).toBe(before)
    })
  })

  describe('undefined buildingIndex', () => {
    const emptySvc = new BuildingService(makePkg())

    it('get returns undefined', () => {
      expect(emptySvc.get('b1')).toBeUndefined()
    })

    it('list returns empty', () => {
      expect(emptySvc.list()).toEqual([])
    })

    it('findNearest returns undefined', () => {
      expect(emptySvc.findNearest({ lat: 14.5, lng: 121.0 })).toBeUndefined()
    })

    it('getEntrances returns empty', () => {
      expect(emptySvc.getEntrances('b1')).toEqual([])
    })

    it('findContaining returns undefined', () => {
      expect(emptySvc.findContaining({ lat: 14.5, lng: 121.0 })).toBeUndefined()
    })
  })
})
