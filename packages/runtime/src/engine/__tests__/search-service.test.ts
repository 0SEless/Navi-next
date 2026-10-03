import { describe, it, expect } from 'vitest'
import { SearchService } from '../search-service'
import type { SearchIndex, SearchEntry } from '@navi/core'
import type { LoadedPackage } from '../../loader'

function makePkg(searchIndex?: SearchIndex): LoadedPackage {
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
      metadata: { routeable: true, nodeCount: 0, edgeCount: 0, buildings: 1, floors: 1, boundingBox: { minLat: 0, maxLat: 1, minLng: 0, maxLng: 1 } },
    },
    graph: { version: '1.0.0', campusId: 'test', createdAt: '', checksum: '', nodes: [], edges: [], metadata: { nodeCount: 0, edgeCount: 0, buildings: 0, floors: 0, boundingBox: { minLat: 0, maxLat: 1, minLng: 0, maxLng: 1 } } },
    searchIndex,
    reports: [],
  }
}

function testIndex(): SearchIndex {
  return {
    version: '1.0.0',
    entries: [
      { id: 'b1', label: 'Engineering Building', type: 'building', nodeId: 'n1', position: { lng: 121, lat: 14 }, tags: ['engineering'], buildingId: 'b1' },
      { id: 'b2', label: 'Library', type: 'building', nodeId: 'n2', position: { lng: 121, lat: 14 }, tags: ['library'], buildingId: 'b2' },
      { id: 'r1', label: 'Room 101', type: 'room', nodeId: 'n3', position: { lng: 121, lat: 14 }, tags: ['classroom'], buildingId: 'b1', floor: 1 },
      { id: 'r2', label: 'Room 202', type: 'room', nodeId: 'n4', position: { lng: 121, lat: 14 }, tags: ['lab'], buildingId: 'b1', floor: 2 },
      { id: 'e1', label: 'Main Entrance', type: 'entrance', nodeId: 'n5', position: { lng: 121, lat: 14 }, tags: ['entrance'], buildingId: 'b1' },
    ],
  }
}

const authoredSearchEntry = {
  id: 'poi-study-area',
  label: 'Student Study Area',
  type: 'poi',
  position: { lng: 121.002, lat: 14.002 },
  tags: ['student', 'study', 'area', 'owner', 'library'],
  category: 'study_area',
  buildingId: 'b1',
  floor: 1,
  floorId: 'f1',
  source: 'authored',
  sourceId: 'poi-study-area',
} as unknown as SearchEntry

describe('SearchService', () => {
  const pkg = makePkg(testIndex())
  const svc = new SearchService(pkg)

  describe('search()', () => {
    it('returns results ranked by score', () => {
      const results = svc.search('Library')
      expect(results.length).toBeGreaterThan(0)
      expect(results[0].id).toBe('b2')
      expect(results[0].score).toBeGreaterThan(0)
    })

    it('returns empty for empty query', () => {
      expect(svc.search('')).toEqual([])
    })

    it('returns empty for no match', () => {
      expect(svc.search('ZZZ_NONEXISTENT')).toEqual([])
    })

    it('returns score in results', () => {
      const results = svc.search('Room')
      expect(results.length).toBeGreaterThan(0)
      expect(results[0].score).toBeGreaterThan(0)
    })
  })

  describe('autocomplete()', () => {
    it('returns prefix matches', () => {
      const results = svc.autocomplete('Lib')
      expect(results.length).toBeGreaterThan(0)
      expect(results[0].id).toBe('b2')
    })

    it('returns empty for empty prefix', () => {
      expect(svc.autocomplete('')).toEqual([])
    })

    it('returns empty for no match', () => {
      expect(svc.autocomplete('ZZZ_NONEXISTENT')).toEqual([])
    })

    it('does not include score', () => {
      const results = svc.autocomplete('Lib')
      expect(results[0].score).toBeUndefined()
    })
  })

  describe('findById()', () => {
    it('returns result for valid ID', () => {
      const result = svc.findById('b2')
      expect(result).toBeDefined()
      expect(result!.id).toBe('b2')
      expect(result!.title).toBe('Library')
    })

    it('returns undefined for unknown ID', () => {
      expect(svc.findById('nonexistent')).toBeUndefined()
    })
  })

  describe('findByCategory()', () => {
    it('returns all entries of that type', () => {
      const results = svc.findByCategory('room')
      expect(results.length).toBe(2)
      expect(results.every(r => r.category === 'room')).toBe(true)
    })

    it('returns empty for unknown category', () => {
      expect(svc.findByCategory('unknown' as any)).toEqual([])
    })

    it('does not include score', () => {
      const results = svc.findByCategory('building')
      expect(results[0].score).toBeUndefined()
    })

    it('returns results sorted by label', () => {
      const results = svc.findByCategory('room')
      expect(results[0].title).toBe('Room 101')
      expect(results[1].title).toBe('Room 202')
    })
  })

  describe('mapEntry() shape', () => {
    it('produces correct fields from entry', () => {
      const results = svc.search('Library')
      const result = results[0]
      expect(result.id).toBe('b2')
      expect(result.title).toBe('Library')
      expect(result.category).toBe('building')
      expect(result.nodeId).toBe('n2')
      expect(result.buildingId).toBe('b2')
      expect(result.floor).toBeUndefined()
    })

    it('preserves floor and buildingId', () => {
      const results = svc.findByCategory('room')
      const room = results.find(r => r.id === 'r1')
      expect(room).toBeDefined()
      expect(room!.buildingId).toBe('b1')
      expect(room!.floor).toBe(1)
    })

    it('maps an authored no-node POI as a discovery result', () => {
      const authoredSvc = new SearchService(makePkg({ version: '1.0.0', entries: [authoredSearchEntry] }))
      const result = authoredSvc.search('study_area')[0]
      expect(result).toMatchObject({
        id: 'poi-study-area',
        title: 'Student Study Area',
        category: 'poi',
        position: { lat: 14.002, lng: 121.002 },
        poiCategory: 'study_area',
        source: 'authored',
        sourceId: 'poi-study-area',
        floorId: 'f1',
        buildingId: 'b1',
        floor: 1,
      })
      expect(result?.nodeId).toBeUndefined()
    })
  })

  describe('immutability', () => {
    it('does not mutate LoadedPackage', () => {
      const before = JSON.stringify(pkg.searchIndex)
      svc.search('Library')
      svc.autocomplete('Lib')
      svc.findById('b2')
      svc.findByCategory('room')
      expect(JSON.stringify(pkg.searchIndex)).toBe(before)
    })
  })

  describe('undefined searchIndex', () => {
    const emptyPkg = makePkg()
    const emptySvc = new SearchService(emptyPkg)

    it('search returns empty', () => {
      expect(emptySvc.search('Library')).toEqual([])
    })

    it('autocomplete returns empty', () => {
      expect(emptySvc.autocomplete('Lib')).toEqual([])
    })

    it('findById returns undefined', () => {
      expect(emptySvc.findById('b2')).toBeUndefined()
    })

    it('findByCategory returns empty', () => {
      expect(emptySvc.findByCategory('room')).toEqual([])
    })
  })
})
