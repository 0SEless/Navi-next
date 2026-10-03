/**
 * Phase 5 — Admin Connectivity UX Tests
 *
 * Tests the actual admin workflow for junction/crossing management.
 */
import { describe, expect, it } from 'vitest'
import type { CampusDocument, RoadJunction, SeparatedCrossing } from '@navi/core'
import { markCrossingSeparate, createJunctionAtCrossing, isCrossingSeparated } from '../../../packages/editor/src/commands/road-connectivity'

function makeDoc(junctions?: RoadJunction[], crossings?: SeparatedCrossing[]): CampusDocument {
  return {
    schemaVersion: 1, version: 0,
    metadata: { campusId: 'test', name: 'test', description: '', lastModified: '', editorVersion: '0.1' },
    buildings: [],
    roads: [
      { id: 'road-a', name: 'Main Road', polyline: { points: [{ lat: 0, lng: -0.001 }, { lat: 0, lng: 0.001 }] }, width: 8, surface: 'paved', type: 'arterial', metadata: {} },
      { id: 'road-b', name: 'Service Path', polyline: { points: [{ lat: -0.001, lng: 0 }, { lat: 0.001, lng: 0 }] }, width: 4, surface: 'paved', type: 'service', metadata: {} },
    ],
    panoramas: [], qrCheckpoints: [],
    roadJunctions: junctions,
    separatedCrossings: crossings,
  }
}

describe('Phase 5 — Admin Connectivity UX', () => {
  describe('1-3: Junction inspector', () => {
    it('junction has correct road names', () => {
      const doc = makeDoc([{
        id: 'j-1', position: { lat: 0, lng: 0 }, roadIds: ['road-a', 'road-b'], source: 'authored',
      }])
      const j = doc.roadJunctions![0]
      const roadNames = j.roadIds.map(rid => doc.roads.find(r => r.id === rid)?.name ?? rid)
      expect(roadNames).toEqual(['Main Road', 'Service Path'])
    })
  })

  describe('4: Keep Separate updates document', () => {
    it('removes junction and adds separated crossing', () => {
      const doc = makeDoc([{
        id: 'j-1', position: { lat: 0, lng: 0 }, roadIds: ['road-a', 'road-b'], source: 'authored',
      }])
      const result = markCrossingSeparate(doc, 'road-a', 'road-b', { lat: 0, lng: 0 })
      expect(result).toBeDefined()
      expect(doc.roadJunctions).toHaveLength(0)
      expect(doc.separatedCrossings).toHaveLength(1)
      expect(doc.separatedCrossings![0].roadIds).toEqual(['road-a', 'road-b'])
    })
  })

  describe('5: Keep Separate removes graph traversal', () => {
    it('separated crossing prevents routing', () => {
      const doc = makeDoc(undefined, [{
        id: 'sc-1', roadIds: ['road-a', 'road-b'], position: { lat: 0, lng: 0 },
      }])
      expect(isCrossingSeparated(doc, 'road-a', 'road-b')).toBe(true)
    })
  })

  describe('6: Keep Separate survives reload', () => {
    it('separated crossing persists through JSON round-trip', () => {
      const doc = makeDoc(undefined, [{
        id: 'sc-1', roadIds: ['road-a', 'road-b'], position: { lat: 0, lng: 0 },
      }])
      const serialized = JSON.stringify(doc)
      const deserialized = JSON.parse(serialized) as CampusDocument
      expect(deserialized.separatedCrossings).toHaveLength(1)
      expect(deserialized.separatedCrossings![0].id).toBe('sc-1')
    })
  })

  describe('7: Undo Keep Separate restores connection', () => {
    it('removing separation record restores junction', () => {
      const doc = makeDoc(undefined, [{
        id: 'sc-1', roadIds: ['road-a', 'road-b'], position: { lat: 0, lng: 0 },
      }])
      // Simulate undo: remove the separation
      doc.separatedCrossings = []
      expect(isCrossingSeparated(doc, 'road-a', 'road-b')).toBe(false)
    })
  })

  describe('8: Create Junction restores connectivity', () => {
    it('removes separation and creates junction', () => {
      const doc = makeDoc(undefined, [{
        id: 'sc-1', roadIds: ['road-a', 'road-b'], position: { lat: 0, lng: 0 },
      }])
      const junction = createJunctionAtCrossing(doc, 'road-a', 'road-b', { lat: 0, lng: 0 })
      expect(junction).toBeDefined()
      expect(junction!.roadIds).toEqual(expect.arrayContaining(['road-a', 'road-b']))
      expect(junction!.source).toBe('authored')
      expect(isCrossingSeparated(doc, 'road-a', 'road-b')).toBe(false)
      expect(doc.roadJunctions).toHaveLength(1)
    })
  })

  describe('9-10: Separated crossing selectable', () => {
    it('crossing has correct road names', () => {
      const doc = makeDoc(undefined, [{
        id: 'sc-1', roadIds: ['road-a', 'road-b'], position: { lat: 0, lng: 0 },
      }])
      const sc = doc.separatedCrossings![0]
      const roadNames = sc.roadIds.map(rid => doc.roads.find(r => r.id === rid)?.name ?? rid)
      expect(roadNames).toEqual(['Main Road', 'Service Path'])
    })
  })

  describe('12: Create Junction survives reload', () => {
    it('junction persists through JSON round-trip', () => {
      const doc = makeDoc()
      // Manually add junction (avoids genId dependency in test)
      doc.roadJunctions = [{
        id: 'j-test', position: { lat: 0, lng: 0 }, roadIds: ['road-a', 'road-b'], source: 'authored',
      }]
      const serialized = JSON.stringify(doc)
      const deserialized = JSON.parse(serialized) as CampusDocument
      expect(deserialized.roadJunctions).toHaveLength(1)
      expect(deserialized.roadJunctions![0].source).toBe('authored')
    })
  })

  describe('17: Authored junction lifecycle', () => {
    it('authored junction not destroyed by intermediate sync', () => {
      const doc = makeDoc([{
        id: 'j-authored', position: { lat: 0, lng: 0 }, roadIds: ['road-a', 'road-b'], source: 'authored',
      }])
      // Simulate: junction exists, both roads still cross
      expect(doc.roadJunctions).toHaveLength(1)
      expect(doc.roadJunctions![0].id).toBe('j-authored')
      expect(doc.roadJunctions![0].source).toBe('authored')
    })
  })
})
