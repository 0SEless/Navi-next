/**
 * Wave 6 — Release Readiness
 *
 * Final sweep that verifies:
 *   - All packages export their expected public API
 *   - TypeScript types are consistent across packages
 *   - Edge-case documents compile without crashing
 *   - Extreme inputs are handled gracefully
 *   - No runtime errors from unexpected but valid input shapes
 */

import { describe, it, expect } from 'vitest'
import { compile } from '../pipeline/compile'
import { directExtract } from '../extractors/direct-extract'
import { generateArtifacts, buildGraph, buildSearchIndex, buildPOIData, buildBuildingIndex } from '../artifacts/artifact-generator'
import type { CampusDocument, Floor } from '@navi/core'
import type { CompileResult, NavigationGraph, SearchIndex, POIData, BuildingIndex, NavNode, NavEdge } from '../types'

// ── Package exports check ──

describe('Wave 6 | Release Readiness', () => {

  describe('Public API exports', () => {
    it('@navi/compiler exports compile function', () => {
      expect(typeof compile).toBe('function')
    })

    it('@navi/compiler exports directExtract function', () => {
      expect(typeof directExtract).toBe('function')
    })

    it('@navi/compiler exports all artifact builders', () => {
      expect(typeof generateArtifacts).toBe('function')
      expect(typeof buildGraph).toBe('function')
      expect(typeof buildSearchIndex).toBe('function')
      expect(typeof buildPOIData).toBe('function')
      expect(typeof buildBuildingIndex).toBe('function')
    })

    it('types exports are valid TypeScript interfaces (compile-time check)', () => {
      // Runtime check: these types should all be serializable objects
      const typeChecks: Array<{ name: string; check: () => unknown }> = [
        { name: 'NavNode', check: () => ({ id: '', label: '', type: 'space', position: { lat: 0, lng: 0 }, floor: 0, buildingId: '', properties: {} } satisfies NavNode) },
        { name: 'NavEdge', check: () => ({ id: '', from: '', to: '', type: 'walk', distance: 0, weight: 0 } satisfies NavEdge) },
      ]
      for (const tc of typeChecks) {
        expect(tc.check()).toBeDefined()
      }
    })
  })

  // ── Edge-case documents ──

  describe('Edge-case documents', () => {
    it('compiles an empty document gracefully', () => {
      const doc: CampusDocument = {
        schemaVersion: 1,
        version: 1,
        metadata: { campusId: '', name: '', description: '', lastModified: '', editorVersion: '' },
        buildings: [], roads: [], panoramas: [], qrCheckpoints: [],
      }
      const result = compile(doc, {
        nodeInterval: 10, mergeThreshold: 5, optimizationLevel: 'none', includeAccessibility: false,
      })
      expect(result.graph.nodes).toHaveLength(0)
      expect(result.graph.edges).toHaveLength(0)
      expect(result.report.warnings).toHaveLength(0)
      expect(result.report.errors).toHaveLength(0)
      expect(result.duration).toBeGreaterThanOrEqual(0)
    })

    it('compiles a document with a single room', () => {
      const doc: CampusDocument = {
        schemaVersion: 1,
        version: 1,
        metadata: { campusId: 'Tiny', name: 'Tiny', description: '', lastModified: '', editorVersion: '1.0.0' },
        buildings: [{
          id: 'b1', name: 'Solo', code: 'S', category: 'academic', description: '',
          footprint: { points: [{ lat: 14.0, lng: 121.0 }, { lat: 14.0, lng: 121.001 }, { lat: 14.001, lng: 121.001 }, { lat: 14.001, lng: 121.0 }, { lat: 14.0, lng: 121.0 }] },
          baseElevation: 0, height: 5,
          floors: [{
            id: 'f1', level: 0, label: 'Ground', elevation: 0,
            rooms: [{ id: 'r1', name: 'The Only Room', number: '001', category: 'classroom',
              polygon: { points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 5 }, { x: 0, y: 0 }] },
              roomDoors: [], capacity: 10, metadata: {} }],
            hallways: [], staircases: [], elevators: [], connectorStops: [],
            entrances: [{ id: 'e1', label: 'Door', position: { lat: 14.0003, lng: 121.0003 } as any, level: 0, type: 'main', hasQR: false, hasPanorama: false }],
            metadata: {},
          }],
          verticalConnectors: [], color: '#ccc', aliases: [], metadata: {},
        }],
        roads: [], panoramas: [], qrCheckpoints: [],
      }
      const result = compile(doc, {
        nodeInterval: 10, mergeThreshold: 5, optimizationLevel: 'none', includeAccessibility: false,
      })
      expect(result.graph.nodes.length).toBeGreaterThanOrEqual(2) // 1 space + 1 transition
      expect(result.graph.edges.length).toBeGreaterThanOrEqual(1) // connected
    })

    it('handles special characters in names and labels', () => {
      const doc: CampusDocument = {
        schemaVersion: 1,
        version: 1,
        metadata: { campusId: 'Café & Räume — Test', name: 'Café & Räume — Test', description: 'Über cool! 日本語', lastModified: '', editorVersion: '1.0.0' },
        buildings: [{
          id: 'b1', name: 'Hauptgebäude', code: 'HG', category: 'academic', description: '',
          footprint: { points: [{ lat: 14.0, lng: 121.0 }, { lat: 14.0, lng: 121.001 }, { lat: 14.001, lng: 121.001 }, { lat: 14.001, lng: 121.0 }, { lat: 14.0, lng: 121.0 }] },
          baseElevation: 0, height: 5,
          floors: [{
            id: 'f1', level: 0, label: 'Erdgeschoss', elevation: 0,
            rooms: [{ id: 'r1', name: 'Raum 1 (α, β, γ)', number: '001', category: 'classroom',
              polygon: { points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 5 }, { x: 0, y: 5 }] },
              roomDoors: [], capacity: 10, metadata: {} }],
            hallways: [], staircases: [], elevators: [], connectorStops: [],
            entrances: [{ id: 'e1', label: 'Eingang → Straße', position: { lat: 14.0, lng: 121.0 } as any, level: 0, type: 'main', hasQR: false, hasPanorama: false }],
            metadata: {},
          }],
          verticalConnectors: [], color: '#ccc', aliases: [], metadata: {},
        }],
        roads: [], panoramas: [], qrCheckpoints: [],
      }
      // Should not throw
      expect(() => compile(doc, {
        nodeInterval: 10, mergeThreshold: 5, optimizationLevel: 'none', includeAccessibility: false,
      })).not.toThrow()
    })

    it('handles extreme coordinate values (edge of valid range)', () => {
      const doc: CampusDocument = {
        schemaVersion: 1,
        version: 1,
        metadata: { campusId: 'Extreme', name: 'Extreme', description: '', lastModified: '', editorVersion: '1.0.0' },
        buildings: [{
          id: 'b1', name: 'North Pole Campus', code: 'NP', category: 'academic', description: '',
          footprint: { points: [{ lat: 89.9, lng: 179.9 }, { lat: 89.9, lng: -179.9 }, { lat: 89.99, lng: -179.9 }, { lat: 89.99, lng: 179.9 }, { lat: 89.9, lng: 179.9 }] },
          baseElevation: 0, height: 5,
          floors: [{
            id: 'f1', level: 0, label: 'Ground', elevation: 0,
            rooms: [{ id: 'r1', name: 'Ice Room', number: '001', category: 'classroom',
              polygon: { points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 5 }, { x: 0, y: 0 }] },
              roomDoors: [], capacity: 10, metadata: {} }],
            hallways: [], staircases: [], elevators: [], connectorStops: [],
            entrances: [{ id: 'e1', label: 'Ice Door', position: { lat: 89.95, lng: 180 } as any, level: 0, type: 'main', hasQR: false, hasPanorama: false }],
            metadata: {},
          }],
          verticalConnectors: [], color: '#fff', aliases: [], metadata: {},
        }],
        roads: [], panoramas: [], qrCheckpoints: [],
      }
      const result = compile(doc, {
        nodeInterval: 10, mergeThreshold: 5, optimizationLevel: 'none', includeAccessibility: false,
      })
      // Should produce valid output even at extreme coordinates
      expect(result.graph.nodes.length).toBeGreaterThanOrEqual(2)
      // Haversine should handle extreme coords without NaN
      for (const edge of result.graph.edges) {
        expect(Number.isFinite(edge.distance)).toBe(true)
        expect(edge.distance).toBeGreaterThanOrEqual(0)
      }
    })

    it('handles a building with many floors but one room each', () => {
      const rooms: Array<{ id: string; name: string; number: string; category: 'classroom'; polygon: { points: Array<{ x: number; y: number }> }; roomDoors: never[]; capacity: number; metadata: Record<string, unknown> }> = []
      const entrances: Array<{ id: string; label: string; position: { x: number; y: number }; level: number; type: 'main'; hasQR: boolean; hasPanorama: boolean }> = []
      const floors: Floor[] = []
      for (let i = 0; i < 20; i++) {
        rooms.push({ id: `r${i}`, name: `Room ${i}`, number: `${100 + i}`, category: 'classroom',
          polygon: { points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 5 }, { x: 0, y: 0 }] },
          roomDoors: [], capacity: 10, metadata: {} })
        entrances.push({ id: `e${i}`, label: `Ent ${i}`, position: { lat: 14.0 + i * 0.001, lng: 121.0 } as any, level: i, type: 'main', hasQR: false, hasPanorama: false })
        floors.push({ id: `f${i}`, level: i, label: `Floor ${i}`, elevation: i * 3,
          rooms: [rooms[i]], hallways: [], staircases: [], elevators: [], entrances: [entrances[i]], connectorStops: [], metadata: {} })
      }
      const doc: CampusDocument = {
        schemaVersion: 1,
        version: 1,
        metadata: { campusId: 'Skyscraper', name: 'Skyscraper', description: '', lastModified: '', editorVersion: '1.0.0' },
        buildings: [{
          id: 'b1', name: 'Tower', code: 'T', category: 'academic', description: '',
          footprint: { points: [{ lat: 14.0, lng: 121.0 }, { lat: 14.0, lng: 121.001 }, { lat: 14.001, lng: 121.001 }, { lat: 14.001, lng: 121.0 }, { lat: 14.0, lng: 121.0 }] },
          baseElevation: 0, height: 60, floors,
          verticalConnectors: [], color: '#888', aliases: [], metadata: {},
        }],
        roads: [], panoramas: [], qrCheckpoints: [],
      }
      const result = compile(doc, {
        nodeInterval: 10, mergeThreshold: 5, optimizationLevel: 'none', includeAccessibility: false,
      })
      // 20 rooms + 20 entrances = 40 nodes
      expect(result.graph.nodes.length).toBe(40)
      // Each room connects to its entrance on same floor
      expect(result.graph.edges.length).toBeGreaterThanOrEqual(20)
    })
  })

  describe('Cross-package type consistency', () => {
    it('CompileResult has all required fields', () => {
      const doc: CampusDocument = {
        schemaVersion: 1,
        version: 1,
        metadata: { campusId: 'Check', name: 'Check', description: '', lastModified: '', editorVersion: '1.0.0' },
        buildings: [], roads: [], panoramas: [], qrCheckpoints: [],
      }
      const result = compile(doc, {
        nodeInterval: 10, mergeThreshold: 5, optimizationLevel: 'none', includeAccessibility: false,
      })
      // Required fields
      expect(result).toHaveProperty('graph')
      expect(result).toHaveProperty('report')
      expect(result).toHaveProperty('duration')
      // graph fields
      expect(result.graph).toHaveProperty('nodes')
      expect(result.graph).toHaveProperty('edges')
      expect(result.graph).toHaveProperty('metadata')
      expect(result.graph).toHaveProperty('checksum')
      expect(result.graph).toHaveProperty('version')
      // metadata fields
      expect(result.graph.metadata).toHaveProperty('nodeCount')
      expect(result.graph.metadata).toHaveProperty('edgeCount')
      expect(result.graph.metadata).toHaveProperty('buildings')
      expect(result.graph.metadata).toHaveProperty('floors')
      expect(result.graph.metadata).toHaveProperty('boundingBox')
    })

    it('all node positions have both lat and lng', () => {
      const doc: CampusDocument = {
        schemaVersion: 1,
        version: 1,
        metadata: { campusId: 'PosCheck', name: 'PosCheck', description: '', lastModified: '', editorVersion: '1.0.0' },
        buildings: [{
          id: 'b1', name: 'B', code: 'B', category: 'academic', description: '',
          footprint: { points: [{ lat: 14.0, lng: 121.0 }, { lat: 14.0, lng: 121.001 }, { lat: 14.001, lng: 121.001 }, { lat: 14.001, lng: 121.0 }, { lat: 14.0, lng: 121.0 }] },
          baseElevation: 0, height: 5,
          floors: [{
            id: 'f1', level: 0, label: 'G', elevation: 0,
            rooms: [{ id: 'r1', name: 'R1', number: '1', category: 'classroom',
              polygon: { points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 5 }, { x: 0, y: 0 }] },
              roomDoors: [], capacity: 10, metadata: {} }],
            hallways: [], staircases: [], elevators: [], connectorStops: [],
            entrances: [{ id: 'e1', label: 'Door', position: { lat: 14.0003, lng: 121.0003 } as any, level: 0, type: 'main', hasQR: false, hasPanorama: false }],
            metadata: {},
          }],
          verticalConnectors: [], color: '#ccc', aliases: [], metadata: {},
        }],
        roads: [], panoramas: [], qrCheckpoints: [],
      }
      const result = compile(doc, {
        nodeInterval: 10, mergeThreshold: 5, optimizationLevel: 'none', includeAccessibility: false,
      })
      for (const node of result.graph.nodes) {
        expect(typeof node.position.lat).toBe('number')
        expect(typeof node.position.lng).toBe('number')
        expect(Number.isFinite(node.position.lat)).toBe(true)
        expect(Number.isFinite(node.position.lng)).toBe(true)
      }
    })
  })
})
