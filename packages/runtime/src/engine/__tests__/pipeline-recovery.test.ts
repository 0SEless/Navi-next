/**
 * Wave 5 â€” Pipeline/Recovery
 *
 * T27: Full pipeline end-to-end test.
 * Uses CampusCompiler (V2) â†’ artifact builders â†’ RuntimeEngine.
 * No file I/O â€” tests the real compileâ†’artifactsâ†’runtime pipeline
 * in-memory with the same implementations the production path uses.
 */

import { describe, it, expect } from 'vitest'
import type { CampusDocument, POIIndex, NavigationGraph } from '@navi/core'
import type { LoadedPackage } from '../../loader'
import { RuntimeEngine } from '../runtime-engine'

function pipelineDoc(): CampusDocument {
  return {
    schemaVersion: 1,
    version: 0,
    metadata: { campusId: 'PipelineTest', name: 'PipelineTest', description: 'E2E test', lastModified: '', editorVersion: '1.0.0' },
    buildings: [{
      id: 'b1', name: 'Main', code: 'M', category: 'academic', description: '',
      footprint: { points: [{ lat: 14.0, lng: 121.0 }, { lat: 14.0, lng: 121.001 }, { lat: 14.001, lng: 121.001 }, { lat: 14.001, lng: 121.0 }, { lat: 14.0, lng: 121.0 }] },
      baseElevation: 0, height: 10,
      verticalConnectors: [],
      floors: [{
        id: 'f1', level: 0, label: 'Ground', elevation: 0,
        rooms: [
          { id: 'r1', name: 'Room 1', number: '101', category: 'classroom',
            polygon: { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 8 }, { x: 0, y: 8 }, { x: 0, y: 0 }] },
            capacity: 30, roomDoors: [], metadata: {} },
          { id: 'r2', name: 'Room 2', number: '102', category: 'classroom',
            polygon: { points: [{ x: 20, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 8 }, { x: 20, y: 8 }, { x: 20, y: 0 }] },
            capacity: 25, roomDoors: [], metadata: {} },
        ],
        hallways: [], staircases: [], elevators: [],
        entrances: [{ id: 'e1', label: 'Main Entrance', position: { lat: 14.0005, lng: 121.0005 } as any, level: 0, type: 'main', hasQR: true, hasPanorama: false }],
        connectorStops: [],
        metadata: {},
      }],
      color: '#336699', aliases: [], metadata: {},
    }],
    roads: [{
      id: 'road1', name: 'Campus Road', polyline: { points: [{ lat: 14.0005, lng: 121.0005 }, { lat: 14.001, lng: 121.001 }] },
      width: 4, surface: 'paved', type: 'connector', metadata: {},
    }],
    panoramas: [], qrCheckpoints: [],
  }
}

async function buildLoadedPackage(doc: CampusDocument): Promise<LoadedPackage> {
  const { compile, buildSearchIndex, buildPOIData, buildBuildingIndex } = await import('@navi/compiler')
  const result = compile(doc, {
    nodeInterval: 10, mergeThreshold: 5, optimizationLevel: 'none', includeAccessibility: false,
  })
  const graph: NavigationGraph = result.graph
  const searchIndex = buildSearchIndex(doc, graph)
  const buildingIndex = buildBuildingIndex(doc, graph)
  const poiIndex = buildPOIData(graph)

  return {
    manifest: {
      schemaVersion: '1.0',
  formatVersion: '0',
      campusId: doc.metadata.name,
      campusName: doc.metadata.name,
      publishedAt: new Date().toISOString(),
      compilerVersion: '0.1.0',
      revision: '1',
      artifacts: {
        graph: { path: 'navigation.graph.json', checksum: graph.checksum, size: 0, schemaVersion: '1.0', formatVersion: '0' },
        search: { path: 'search.index.json', checksum: '', size: 0, schemaVersion: '1.0', formatVersion: '0' },
        buildings: { path: 'building-index.json', checksum: '', size: 0, schemaVersion: '1.0', formatVersion: '0' },
        poi: { path: 'poi.json', checksum: '', size: 0, schemaVersion: '1.0', formatVersion: '0' },
      },
      metadata: {
        nodeCount: graph.nodes.length,
        edgeCount: graph.edges.length,
        buildingCount: doc.buildings.length,
        floorCount: doc.buildings.reduce((s, b) => s + b.floors.length, 0),
        boundingBox: graph.metadata.boundingBox,
        routeable: graph.edges.length > 0,
      },
    },
    graph,
    searchIndex: searchIndex as any,
    buildingIndex: buildingIndex as any,
    poiIndex: poiIndex as unknown as POIIndex,
    reports: [], warnings: [],
  }
}

describe('Wave 5 | Pipeline / Recovery', () => {
  describe('Full pipeline: compile â†’ artifacts â†’ runtime â†’ route', () => {
    it('compiles, builds artifacts, creates engine, and finds a route', async () => {
      const doc = pipelineDoc()
      const pkg = await buildLoadedPackage(doc)
      const engine = new RuntimeEngine(pkg)

      expect(engine.data.getCampusId()).toBe('PipelineTest')
      expect(engine.data.getBuilding('b1')?.name).toBe('Main')

      const fromNode = pkg.graph.nodes.find(n => n.type === 'transition')
      const toNode = pkg.graph.nodes.find(n => n.type === 'space')
      expect(fromNode).toBeDefined()
      expect(toNode).toBeDefined()
      if (!fromNode || !toNode) return

      const route = engine.navigation.findRoute(fromNode.id, toNode.id)
      expect(route).not.toBeNull()
      expect(route!.totalDistance).toBeGreaterThan(0)
      expect(route!.path.length).toBeGreaterThanOrEqual(2)
      expect(route!.instructions[route!.instructions.length - 1].type).toBe('arrive')
    })

    it('produces deterministic output across compilations', async () => {
      const doc = pipelineDoc()
      const pkg1 = await buildLoadedPackage(doc)
      const pkg2 = await buildLoadedPackage(doc)
      expect(pkg1.graph.nodes).toEqual(pkg2.graph.nodes)
      expect(pkg1.graph.edges).toEqual(pkg2.graph.edges)
    })
  })

  describe('Error recovery', () => {
    it('rejects nonexistent path', async () => {
      const { load } = await import('../../loader')
      const result = await load('/nonexistent')
      expect(result.success).toBe(false)
    })
  })
})
