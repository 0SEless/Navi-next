import { describe, it, expect } from 'vitest'
import { toExplorerNodes, flattenNodes, findNodeById } from './adapter'
import type { CampusDocument } from '@navi/core'

function createMinimalDoc(): CampusDocument {
  return {
    schemaVersion: 1,
    metadata: { campusId: 'Test Campus', name: 'Test Campus', description: '', lastModified: '', editorVersion: '0.1.0' },
    buildings: [{
      id: 'bld-1',
      name: 'Science Building',
      code: 'SCI',
      category: 'academic',
      description: '',
      footprint: { points: [{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }] },
      baseElevation: 0,
      height: 10,
      floors: [{
        id: 'flr-1',
        level: 0,
        label: 'Ground Floor',
        elevation: 0,
        rooms: [{
          id: 'rm-1',
          name: 'Physics Lab',
          number: '101',
          category: 'lab',
          polygon: { points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] },
        }],
        hallways: [],
        staircases: [],
        elevators: [],
        entrances: [],
        metadata: {},
      }],
      color: '#3366ff',
      aliases: [],
      metadata: {},
    }, {
      id: 'bld-2',
      name: 'Library',
      code: 'LIB',
      category: 'library',
      description: '',
      footprint: { points: [{ lat: 2, lng: 2 }, { lat: 3, lng: 3 }] },
      baseElevation: 0,
      height: 8,
      floors: [],
      color: '#ff6633',
      aliases: [],
      metadata: {},
    }],
    roads: [{ id: 'rd-1', name: 'Main Road', polyline: { points: [{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }] }, width: 5, surface: 'paved', type: 'arterial', metadata: {} }],
    panoramas: [{ id: 'pano-1', label: 'Main Entrance View', position: { lat: 0, lng: 0 }, heading: 0, imageAssetId: 'img-1', hotspots: [] }],
    qrCheckpoints: [{ id: 'qr-1', label: 'Entry QR', position: { lat: 0, lng: 0 }, floor: 0, buildingId: 'bld-1', code: 'qr-entry', metadata: {} }],
  }
}

describe('ExplorerAdapter', () => {
  describe('toExplorerNodes', () => {
    it('returns an array of top-level nodes', () => {
      const doc = createMinimalDoc()
      const nodes = toExplorerNodes(doc)
      expect(Array.isArray(nodes)).toBe(true)
      expect(nodes.length).toBeGreaterThan(0)
    })

    it('creates building nodes with children', () => {
      const doc = createMinimalDoc()
      const nodes = toExplorerNodes(doc)
      const science = nodes.find(n => n.id === 'bld-1')
      expect(science).toBeDefined()
      expect(science!.type).toBe('building')
      expect(science!.label).toBe('Science Building')
      expect(science!.subtitle).toBe('SCI')
      expect(science!.children).toBeDefined()
      expect(science!.children!.length).toBe(1)
    })

    it('creates floor nodes nested under buildings', () => {
      const doc = createMinimalDoc()
      const nodes = toExplorerNodes(doc)
      const science = nodes.find(n => n.id === 'bld-1')!
      const ground = science.children!.find(c => c.id === 'flr-1')
      expect(ground).toBeDefined()
      expect(ground!.type).toBe('floor')
      expect(ground!.label).toBe('Ground Floor')
      expect(ground!.subtitle).toBe('Ground')
    })

    it('creates room nodes nested under floors', () => {
      const doc = createMinimalDoc()
      const nodes = toExplorerNodes(doc)
      const science = nodes.find(n => n.id === 'bld-1')!
      const ground = science.children!.find(c => c.id === 'flr-1')!
      const lab = ground.children!.find(c => c.id === 'rm-1')
      expect(lab).toBeDefined()
      expect(lab!.type).toBe('room')
      expect(lab!.label).toBe('Physics Lab')
      expect(lab!.subtitle).toBe('101')
    })

    it('creates road nodes at top level', () => {
      const doc = createMinimalDoc()
      const nodes = toExplorerNodes(doc)
      const road = nodes.find(n => n.id === 'rd-1')
      expect(road).toBeDefined()
      expect(road!.type).toBe('road')
      expect(road!.label).toBe('Main Road')
    })

    it('creates panorama nodes at top level', () => {
      const doc = createMinimalDoc()
      const nodes = toExplorerNodes(doc)
      const pano = nodes.find(n => n.id === 'pano-1')
      expect(pano).toBeDefined()
      expect(pano!.type).toBe('panorama')
      expect(pano!.label).toBe('Main Entrance View')
    })

    it('creates qr checkpoint nodes at top level', () => {
      const doc = createMinimalDoc()
      const nodes = toExplorerNodes(doc)
      const qr = nodes.find(n => n.id === 'qr-1')
      expect(qr).toBeDefined()
      expect(qr!.type).toBe('qr')
      expect(qr!.label).toBe('Entry QR')
    })

    it('every node has an entitySelector', () => {
      const doc = createMinimalDoc()
      const nodes = toExplorerNodes(doc)
      const all = flattenNodes(nodes)
      for (const node of all) {
        expect(node.entitySelector).toBeDefined()
        expect(node.entitySelector.type).toBe(node.type)
        expect(node.entitySelector.id).toBe(node.id)
      }
    })

    it('handles empty document', () => {
      const empty: CampusDocument = {
        schemaVersion: 1,
        version: 1,
        metadata: { campusId: '', name: '', description: '', lastModified: '', editorVersion: '0' },
        buildings: [],
        roads: [],
        panoramas: [],
        qrCheckpoints: [],
      }
      const nodes = toExplorerNodes(empty)
      expect(nodes).toEqual([])
    })
  })

  describe('flattenNodes', () => {
    it('flattens nested tree into flat array', () => {
      const doc = createMinimalDoc()
      const nodes = toExplorerNodes(doc)
      const flat = flattenNodes(nodes)
      // 2 buildings + 1 floor + 1 room + 1 road + 1 panorama + 1 qr = 7
      expect(flat.length).toBe(7)
      expect(flat.every(n => n.id)).toBe(true)
    })
  })

  describe('findNodeById', () => {
    it('finds a node by id in nested tree', () => {
      const doc = createMinimalDoc()
      const nodes = toExplorerNodes(doc)
      const found = findNodeById(nodes, 'rm-1' as any)
      expect(found).toBeDefined()
      expect(found!.label).toBe('Physics Lab')
    })

    it('returns undefined for unknown id', () => {
      const doc = createMinimalDoc()
      const nodes = toExplorerNodes(doc)
      const found = findNodeById(nodes, 'nonexistent' as any)
      expect(found).toBeUndefined()
    })
  })
})
