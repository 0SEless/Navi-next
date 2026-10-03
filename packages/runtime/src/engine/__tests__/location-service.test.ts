import { describe, it, expect } from 'vitest'
import { LocationService } from '../location-service'
import type { NavNode, BuildingIndex, LatLng } from '@navi/core'
import type { LoadedPackage } from '../../loader'

function makePkg(nodes: NavNode[], buildingIndex?: BuildingIndex): LoadedPackage {
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
      metadata: { routeable: true, nodeCount: nodes.length, edgeCount: 0, buildings: buildingIndex?.buildings.length ?? 0, floors: 1, boundingBox: { minLat: 14, maxLat: 15, minLng: 121, maxLng: 122 } },
    },
    graph: { version: '1.0.0', campusId: 'test', createdAt: '', checksum: '', nodes, edges: [], metadata: { nodeCount: nodes.length, edgeCount: 0, buildings: 0, floors: 0, boundingBox: { minLat: 0, maxLat: 1, minLng: 0, maxLng: 1 } } },
    buildingIndex,
    reports: [],
  }
}

function testNodes(): NavNode[] {
  return [
    { id: 'n1', label: 'Entrance', type: 'transition', position: { lat: 14.5, lng: 121.0 }, floor: 1, buildingId: 'b1', properties: {} },
    { id: 'n2', label: 'Hallway', type: 'corridor', position: { lat: 14.501, lng: 121.0 }, floor: 1, buildingId: 'b1', properties: {} },
    { id: 'n3', label: 'Room 201', type: 'space', position: { lat: 14.502, lng: 121.001 }, floor: 2, buildingId: 'b1', properties: {} },
  ]
}

function testBuildingIndex(): BuildingIndex {
  return {
    version: '1.0.0',
    buildings: [
      {
        id: 'b1',
        name: 'Engineering Building',
        code: 'ENG',
        category: 'academic',
        position: { lat: 14.5, lng: 121.0 },
        floors: [{ level: 1, label: 'Ground Floor', elevation: 0, rooms: [] }],
        entrances: [{ id: 'e1', label: 'Main', position: { lat: 14.5, lng: 121.0 } }],
        nodeId: 'n1',
      },
    ],
  }
}

describe('LocationService', () => {
  const nodes = testNodes()
  const buildingIndex = testBuildingIndex()
  const pkg = makePkg(nodes, buildingIndex)
  const svc = new LocationService(pkg)

  describe('resolve()', () => {
    it('returns LocationContext with all fields', () => {
      const ctx = svc.resolve({ lat: 14.5, lng: 121.0 })
      expect(ctx).toBeDefined()
      expect(ctx.position.lat).toBeCloseTo(14.5)
      expect(ctx.isIndoor).toBeDefined()
    })

    it('returns node for position near a graph node', () => {
      const ctx = svc.resolve({ lat: 14.5, lng: 121.0 })
      expect(ctx.node).toBeDefined()
      expect(ctx.node!.node.id).toBe('n1')
      expect(ctx.node!.distance).toBeGreaterThanOrEqual(0)
    })

    it('returns building for position near a building', () => {
      const ctx = svc.resolve({ lat: 14.5, lng: 121.0 })
      expect(ctx.building).toBeDefined()
      expect(ctx.building!.id).toBe('b1')
    })

    it('returns isIndoor=true near a building', () => {
      const ctx = svc.resolve({ lat: 14.5, lng: 121.0 })
      expect(ctx.isIndoor).toBe(true)
    })

    it('returns isIndoor=false far from any building', () => {
      const ctx = svc.resolve({ lat: 0, lng: 0 })
      expect(ctx.isIndoor).toBe(false)
    })
  })

  describe('snapToNode()', () => {
    it('returns SnapResult for position near a node', () => {
      const result = svc.snapToNode({ lat: 14.5, lng: 121.0 })
      expect(result).toBeDefined()
      expect(result!.node.id).toBe('n1')
      expect(result!.distance).toBeGreaterThanOrEqual(0)
    })

    it('is stateless â€” same input returns same result', () => {
      const a = svc.snapToNode({ lat: 14.5, lng: 121.0 })
      const b = svc.snapToNode({ lat: 14.5, lng: 121.0 })
      expect(a!.node.id).toBe(b!.node.id)
      expect(a!.distance).toBe(b!.distance)
    })

    it('returns undefined for empty graph', () => {
      const empty = new LocationService(makePkg([]))
      expect(empty.snapToNode({ lat: 14.5, lng: 121.0 })).toBeUndefined()
    })
  })

  describe('getBuilding()', () => {
    it('returns BuildingResult for position near building', () => {
      const result = svc.getBuilding({ lat: 14.5, lng: 121.0 })
      expect(result).toBeDefined()
      expect(result!.id).toBe('b1')
      expect(result!.name).toBe('Engineering Building')
    })

    it('returns undefined for position far from any building', () => {
      expect(svc.getBuilding({ lat: 0, lng: 0 })).toBeUndefined()
    })
  })

  describe('getFloor()', () => {
    it('returns floor from snapped node', () => {
      expect(svc.getFloor({ lat: 14.5, lng: 121.0 })).toBe(1)
    })

    it('returns undefined for empty graph', () => {
      const empty = new LocationService(makePkg([]))
      expect(empty.getFloor({ lat: 0, lng: 0 })).toBeUndefined()
    })
  })

  describe('isInsideBuilding()', () => {
    it('returns true for position near building', () => {
      expect(svc.isInsideBuilding({ lat: 14.5, lng: 121.0 })).toBe(true)
    })

    it('returns false for position far from any building', () => {
      expect(svc.isInsideBuilding({ lat: 0, lng: 0 })).toBe(false)
    })
  })

  describe('convenience methods are projections of resolve()', () => {
    it('snapToNode matches resolve().node', () => {
      const pos = { lat: 14.5, lng: 121.0 }
      expect(svc.snapToNode(pos)).toEqual(svc.resolve(pos).node)
    })

    it('getBuilding matches resolve().building', () => {
      const pos = { lat: 14.5, lng: 121.0 }
      expect(svc.getBuilding(pos)).toEqual(svc.resolve(pos).building)
    })

    it('getFloor matches resolve().node.node.floor', () => {
      const pos = { lat: 14.5, lng: 121.0 }
      expect(svc.getFloor(pos)).toBe(svc.resolve(pos).node?.node.floor)
    })

    it('isInsideBuilding matches resolve().isIndoor', () => {
      const pos = { lat: 14.5, lng: 121.0 }
      expect(svc.isInsideBuilding(pos)).toBe(svc.resolve(pos).isIndoor)
    })
  })

  describe('undefined buildingIndex', () => {
    const noBuildings = new LocationService(makePkg(testNodes()))

    it('resolve returns undefined building', () => {
      const ctx = noBuildings.resolve({ lat: 14.5, lng: 121.0 })
      expect(ctx.building).toBeUndefined()
      expect(ctx.isIndoor).toBe(false)
    })

    it('getBuilding returns undefined', () => {
      expect(noBuildings.getBuilding({ lat: 14.5, lng: 121.0 })).toBeUndefined()
    })
  })
})
