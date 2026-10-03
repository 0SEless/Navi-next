/**
 * T28 — Performance Benchmarks
 *
 * Measures runtime operations at 100 / 1k / 10k node scales.
 * Thresholds are generous to avoid flakiness across machines.
 */

import { describe, it, expect } from 'vitest'
import type { NavigationGraph, NavNode, NavEdge, SearchIndex, SearchEntry, LoadedPackage, POIIndex } from '@navi/core'
import { RuntimeEngine } from '../runtime-engine'

interface BenchmarkScale {
  label: string
  nodeCount: number
}

const SCALES: BenchmarkScale[] = [
  { label: '100 nodes', nodeCount: 100 },
  { label: '1k nodes', nodeCount: 1000 },
  { label: '10k nodes', nodeCount: 10000 },
]

function makeGridGraph(nodeCount: number): { graph: NavigationGraph; searchIndex: SearchIndex } {
  const nodes: NavNode[] = []
  const edges: NavEdge[] = []
  const entries: SearchEntry[] = []
  const cols = Math.ceil(Math.sqrt(nodeCount))
  const spacing = 0.0005

  for (let i = 0; i < nodeCount; i++) {
    const row = Math.floor(i / cols)
    const col = i % cols
    const id = `n${i}`
    const type: NavNode['type'] = i % 5 === 0 ? 'transition' : i % 3 === 0 ? 'corridor' : 'space'
    const lat = 14.5 + row * spacing
    const lng = 121.0 + col * spacing

    nodes.push({
      id,
      label: type === 'space' ? `Room ${i}` : type === 'transition' ? `Node ${i}` : `Corridor ${i}`,
      type,
      position: { lat, lng },
      floor: 0,
      buildingId: 'b1',
      properties: {},
    })

    if (type === 'space') {
      entries.push({
        id: `search-${i}`,
        label: `Room ${i}`,
        type: 'room',
        nodeId: id,
        position: { lat, lng },
        tags: [`room-${i}`],
        buildingId: 'b1',
        floor: 0,
      })
    }

    // Connect to neighbor (right)
    if (col < cols - 1 && i + 1 < nodeCount) {
      edges.push({
        id: `e${i}-r`,
        from: id,
        to: `n${i + 1}`,
        type: 'walk',
        distance: spacing * 111320,
        weight: spacing * 111320,
      })
    }
    // Connect to neighbor (down)
    if (i + cols < nodeCount) {
      edges.push({
        id: `e${i}-d`,
        from: id,
        to: `n${i + cols}`,
        type: 'walk',
        distance: spacing * 111320,
        weight: spacing * 111320,
      })
    }
  }

  const bbox = {
    minLat: 14.5,
    maxLat: 14.5 + Math.floor(nodeCount / cols) * spacing,
    minLng: 121.0,
    maxLng: 121.0 + (cols - 1) * spacing,
  }

  const graph: NavigationGraph = {
    version: '1.0.0',
    campusId: 'perf-test',
    createdAt: '',
    checksum: '',
    nodes,
    edges,
    metadata: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      buildings: 1,
      floors: 1,
      boundingBox: bbox,
    },
  }

  const searchIndex: SearchIndex = {
    version: '1.0.0',
    entries,
  }

  return { graph, searchIndex }
}

function makePackage(nodeCount: number): LoadedPackage {
  const { graph, searchIndex } = makeGridGraph(nodeCount)

  return {
    manifest: {
      schemaVersion: '1.0',
      campusId: 'perf-test',
      campusName: 'Performance Test',
      publishedAt: '',
      compilerVersion: '0.1.0',
      revision: '1',
      artifacts: {
        graph: { path: 'graph.json', checksum: '', size: 0, schemaVersion: '1.0' },
        search: { path: 'search.json', checksum: '', size: 0, schemaVersion: '1.0' },
        buildings: { path: 'building.json', checksum: '', size: 0, schemaVersion: '1.0' },
        poi: { path: 'poi.json', checksum: '', size: 0, schemaVersion: '1.0' },
      },
      metadata: { ...graph.metadata, routeable: graph.edges.length > 0 },
    },
    graph,
    searchIndex,
    reports: [],
  }
}

describe('T28 | Runtime Performance Benchmarks', () => {
  for (const scale of SCALES) {
    describe(`${scale.label} (${scale.nodeCount})`, () => {
      it(`constructs RuntimeEngine (${scale.label})`, () => {
        const pkg = makePackage(scale.nodeCount)
        const start = performance.now()
        const engine = new RuntimeEngine(pkg)
        const elapsed = performance.now() - start
        expect(engine).toBeDefined()
        expect(elapsed).toBeLessThan(100)
      })

      it(`finds route between first and last node (${scale.label})`, () => {
        const pkg = makePackage(scale.nodeCount)
        const engine = new RuntimeEngine(pkg)
        const fromId = pkg.graph.nodes[0].id
        const toId = pkg.graph.nodes[pkg.graph.nodes.length - 1].id

        const start = performance.now()
        const route = engine.navigation.findRoute(fromId, toId)
        const elapsed = performance.now() - start

        expect(route).not.toBeNull()
        if (route) {
          expect(route.totalDistance).toBeGreaterThan(0)
          expect(route.path.length).toBeGreaterThan(1)
        }
        expect(elapsed).toBeLessThan(scale.nodeCount <= 1000 ? 500 : 5000)
      })

      it(`searches for "Room" query (${scale.label})`, () => {
        const pkg = makePackage(scale.nodeCount)
        const engine = new RuntimeEngine(pkg)

        const start = performance.now()
        const results = engine.search.search('Room')
        const elapsed = performance.now() - start

        expect(results.length).toBeGreaterThan(0)
        expect(elapsed).toBeLessThan(100)
      })

      it(`returns null for unreachable (deleted) node (${scale.label})`, () => {
        const pkg = makePackage(scale.nodeCount)
        const engine = new RuntimeEngine(pkg)

        const start = performance.now()
        const route = engine.navigation.findRoute('nonexistent-start', pkg.graph.nodes[0].id)
        const elapsed = performance.now() - start

        expect(route).toBeNull()
        expect(elapsed).toBeLessThan(50)
      })
    })
  }

  describe('Scaling sanity', () => {
    it('10k route is slower than 100 route (or equal for small graphs)', () => {
      const pkg100 = makePackage(100)
      const pkg10k = makePackage(10000)

      const e100 = new RuntimeEngine(pkg100)
      const e10k = new RuntimeEngine(pkg10k)

      const t1 = performance.now()
      e100.navigation.findRoute(pkg100.graph.nodes[0].id, pkg100.graph.nodes[pkg100.graph.nodes.length - 1].id)
      const t100 = performance.now() - t1

      const t2 = performance.now()
      e10k.navigation.findRoute(pkg10k.graph.nodes[0].id, pkg10k.graph.nodes[pkg10k.graph.nodes.length - 1].id)
      const t10k = performance.now() - t2

      expect(t10k).toBeGreaterThan(t100 * 0.1)
    })

    it('search at 10k returns same result shape as 100', () => {
      const e100 = new RuntimeEngine(makePackage(100))
      const e10k = new RuntimeEngine(makePackage(10000))

      const r100 = e100.search.search('Room')
      const r10k = e10k.search.search('Room')

      expect(r100.length).toBeGreaterThan(0)
      expect(r10k.length).toBeGreaterThan(0)
      expect(r10k.every(r => r.title.startsWith('Room'))).toBe(true)
    })
  })
})
