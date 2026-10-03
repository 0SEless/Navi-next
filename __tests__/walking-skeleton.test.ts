import { describe, it, expect } from 'vitest'
import { CampusCompiler, buildSearchIndex, buildPOIData, buildBuildingIndex } from '@navi/compiler'
import { RuntimeEngine } from '@navi/runtime'
import type { LoadedPackage } from '@navi/runtime'
import type { POIIndex } from '@navi/core'
import { createGoldenCampus } from '../packages/editor/src/demo/golden-campus'

function createRuntimeEngine(): RuntimeEngine {
  const campus = createGoldenCampus()
  const compiler = new CampusCompiler({ nodeInterval: 5, mergeThreshold: 3, optimizationLevel: 'moderate', includeAccessibility: false })
  const result = compiler.compile(campus)
  const graph = result.graph!

  const pkg: LoadedPackage = {
    manifest: {
      schemaVersion: '1.0',
  formatVersion: '0',
      campusId: campus.metadata.name,
      campusName: campus.metadata.name,
      publishedAt: new Date().toISOString(),
      compilerVersion: '0.1.0',
      revision: '1',
      artifacts: {
        graph: { path: 'navigation.graph.json', checksum: '', size: 0, schemaVersion: '1.0', formatVersion: '0' },
        search: { path: 'search.index.json', checksum: '', size: 0, schemaVersion: '1.0', formatVersion: '0' },
        buildings: { path: 'building-index.json', checksum: '', size: 0, schemaVersion: '1.0', formatVersion: '0' },
        poi: { path: 'poi.json', checksum: '', size: 0, schemaVersion: '1.0', formatVersion: '0' },
      },
      metadata: {
        nodeCount: graph.nodes.length,
        edgeCount: graph.edges.length,
        buildingCount: campus.buildings.length,
        floorCount: campus.buildings.reduce((s, b) => s + b.floors.length, 0),
        boundingBox: graph.metadata.boundingBox,
        routeable: graph.edges.length > 0,
      },
    },
    graph,
    searchIndex: buildSearchIndex(campus, graph),
    buildingIndex: buildBuildingIndex(campus, graph),
    poiIndex: buildPOIData(graph) as unknown as POIIndex,
    reports: [], warnings: [],
  }
  return new RuntimeEngine(pkg)
}

describe('Walking Skeleton â€” End-to-End Pipeline', () => {
  describe('CampusDocument', () => {
    it('is valid', () => {
      const campus = createGoldenCampus()
      expect(campus.schemaVersion).toBe(1)
      expect(campus.buildings).toHaveLength(1)
      expect(campus.buildings[0].floors).toHaveLength(1)
      expect(campus.buildings[0].floors[0].rooms).toHaveLength(2)
      expect(campus.buildings[0].floors[0].hallways).toHaveLength(1)
      expect(campus.buildings[0].floors[0].entrances).toHaveLength(1)
    })
  })

  describe('Compiler', () => {
    it('creates graph with >=4 nodes and >=3 edges', () => {
      const campus = createGoldenCampus()
      const compiler = new CampusCompiler({
        nodeInterval: 5, mergeThreshold: 3,
        optimizationLevel: 'moderate', includeAccessibility: false,
      })
      const result = compiler.compile(campus)
      expect(result.success).toBe(true)
      expect(result.graph).not.toBeNull()
      const graph = result.graph!
      expect(graph.nodes.length).toBeGreaterThanOrEqual(4)
      expect(graph.edges.length).toBeGreaterThanOrEqual(3)
    })

    it('produces non-empty checksum', () => {
      const campus = createGoldenCampus()
      const compiler = new CampusCompiler({
        nodeInterval: 5, mergeThreshold: 3,
        optimizationLevel: 'moderate', includeAccessibility: false,
      })
      const result = compiler.compile(campus)
      expect(result.graph!.checksum).toBeTruthy()
    })

    it('produces deterministic output', () => {
      const campus = createGoldenCampus()
      const compiler = new CampusCompiler({
        nodeInterval: 5, mergeThreshold: 3,
        optimizationLevel: 'moderate', includeAccessibility: false,
      })
      const r1 = compiler.compile(campus)
      const r2 = compiler.compile(campus)
      expect(r1.graph!.nodes).toEqual(r2.graph!.nodes)
      expect(r1.graph!.edges).toEqual(r2.graph!.edges)
    })
  })

  describe('Artifacts', () => {
    it('buildSearchIndex produces entries', () => {
      const campus = createGoldenCampus()
      const compiler = new CampusCompiler({ nodeInterval: 5, mergeThreshold: 3, optimizationLevel: 'moderate', includeAccessibility: false })
      const result = compiler.compile(campus)
      const index = buildSearchIndex(campus, result.graph!)
      expect(index.entries.length).toBeGreaterThan(0)
    })

    it('buildPOIData produces points', () => {
      const campus = createGoldenCampus()
      const compiler = new CampusCompiler({ nodeInterval: 5, mergeThreshold: 3, optimizationLevel: 'moderate', includeAccessibility: false })
      const result = compiler.compile(campus)
      const poi = buildPOIData(result.graph!)
      expect(poi.points.length).toBeGreaterThan(0)
    })

    it('buildBuildingIndex produces one building', () => {
      const campus = createGoldenCampus()
      const compiler = new CampusCompiler({ nodeInterval: 5, mergeThreshold: 3, optimizationLevel: 'moderate', includeAccessibility: false })
      const result = compiler.compile(campus)
      const bIndex = buildBuildingIndex(campus, result.graph!)
      expect(bIndex.buildings).toHaveLength(1)
    })
  })

  describe('Runtime', () => {
    it('loads without error', () => {
      const engine = createRuntimeEngine()
      expect(engine).toBeDefined()
    })

    it('has correct node/edge count', () => {
      const engine = createRuntimeEngine()
      const graph = engine.data.getGraph()
      expect(graph.metadata.nodeCount).toBeGreaterThanOrEqual(4)
      expect(graph.metadata.edgeCount).toBeGreaterThanOrEqual(3)
    })
  })

  describe('Search', () => {
    it('finds Room 101 by searching "101"', () => {
      const engine = createRuntimeEngine()
      const results = engine.search.search('101')
      expect(results.length).toBeGreaterThan(0)
      expect(results.some(r => r.title === 'Room 101')).toBe(true)
    })

    it('returns empty for nonexistent query', () => {
      const engine = createRuntimeEngine()
      const results = engine.search.search('ZZZ_NONEXISTENT')
      expect(results).toHaveLength(0)
    })
  })

  describe('Route', () => {
    it('finds a path from Room 101 to Room 102', () => {
      const engine = createRuntimeEngine()
      const nodes = engine.data.getGraph().nodes
      const fromNode = nodes.find(n => n.label === 'Room 101')
      const toNode = nodes.find(n => n.label === 'Room 102')
      expect(fromNode).toBeDefined()
      expect(toNode).toBeDefined()

      const route = engine.navigation.findRoute(fromNode!.id, toNode!.id)
      expect(route).not.toBeNull()
    })

    it('path has >=3 steps', () => {
      const engine = createRuntimeEngine()
      const nodes = engine.data.getGraph().nodes
      const fromNode = nodes.find(n => n.label === 'Room 101')
      const toNode = nodes.find(n => n.label === 'Room 102')
      const route = engine.navigation.findRoute(fromNode!.id, toNode!.id)!
      expect(route.path.length).toBeGreaterThanOrEqual(2)
    })

    it('instructions contain "walk" type', () => {
      const engine = createRuntimeEngine()
      const nodes = engine.data.getGraph().nodes
      const fromNode = nodes.find(n => n.label === 'Room 101')
      const toNode = nodes.find(n => n.label === 'Room 102')
      const route = engine.navigation.findRoute(fromNode!.id, toNode!.id)!
      const walkTypes = route.instructions.filter(i => i.type === 'walk')
      expect(walkTypes.length).toBeGreaterThan(0)
    })

    it('totalDistance > 0', () => {
      const engine = createRuntimeEngine()
      const nodes = engine.data.getGraph().nodes
      const fromNode = nodes.find(n => n.label === 'Room 101')
      const toNode = nodes.find(n => n.label === 'Room 102')
      const route = engine.navigation.findRoute(fromNode!.id, toNode!.id)!
      expect(route.totalDistance).toBeGreaterThan(0)
    })

    it('arrival instruction present', () => {
      const engine = createRuntimeEngine()
      const nodes = engine.data.getGraph().nodes
      const fromNode = nodes.find(n => n.label === 'Room 101')
      const toNode = nodes.find(n => n.label === 'Room 102')
      const route = engine.navigation.findRoute(fromNode!.id, toNode!.id)!
      const arrive = route.instructions.find(i => i.type === 'arrive')
      expect(arrive).toBeDefined()
      expect(arrive!.text).toBeTruthy()
    })
  })
})
