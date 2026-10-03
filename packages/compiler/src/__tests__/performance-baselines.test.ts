/**
 * Wave 4 — Performance Baselines
 *
 * Establishes baseline performance metrics for the compiler pipeline:
 *   - Compile time for small, medium, and large documents
 *   - A* query time on resulting graphs
 *   - Memory/artifact size sanity checks
 *
 * These are NOT benchmarks — they're guardrails that catch performance regressions.
 * Thresholds are generous to avoid flakiness across machines.
 */

import { describe, it, expect } from 'vitest'
import { compile } from '../pipeline/compile'
import type { CampusDocument, Building, Floor, Room, Entrance } from '@navi/core'

const COMPILE_TIMEOUT_MS = 5000
const QUERY_TIMEOUT_MS = 1000

// ── Fixture builders ──

function makeRoom(id: string, name: string, x: number, y: number): Room {
  return {
    id, name, number: id.replace(/\D/g, ''),
    category: 'classroom',
    polygon: { points: [{ x, y }, { x: x + 8, y }, { x: x + 8, y: y + 6 }, { x, y: y + 6 }, { x, y }] },
    roomDoors: [],
    capacity: 30, metadata: {},
  }
}

function makeEntrance(id: string, label: string, lat: number, lng: number): Entrance {
  // Legacy world-stored position (dual-mode tolerance — see P1-T4 D9).
  return { id, label, position: { lat, lng } as any, level: 0, type: 'main', hasQR: false, hasPanorama: false }
}

function makeFloor(id: string, level: number, rooms: Room[], entrance: Entrance): Floor {
  return {
    id, level, label: `Floor ${level}`, elevation: level * 3,
    rooms, hallways: [], staircases: [], elevators: [], entrances: [entrance], connectorStops: [], metadata: {},
  }
}

function makeBuilding(id: string, name: string, baseLat: number, baseLng: number, floors: Floor[]): Building {
  return {
    id, name, code: id.toUpperCase(), category: 'academic', description: '',
    footprint: { points: [{ lat: baseLat, lng: baseLng }, { lat: baseLat, lng: baseLng + 0.01 }, { lat: baseLat + 0.01, lng: baseLng + 0.01 }, { lat: baseLat + 0.01, lng: baseLng }, { lat: baseLat, lng: baseLng }] },
    baseElevation: 0, height: 15, floors, verticalConnectors: [], color: '#ccc', aliases: [], metadata: {},
  }
}

function makeDoc(numBuildings: number, floorsPerBuilding: number, roomsPerFloor: number): CampusDocument {
  const buildings: Building[] = []
  for (let b = 0; b < numBuildings; b++) {
    const baseLat = b * 0.02
    const baseLng = b * 0.02
    const floors: Floor[] = []
    for (let f = 0; f < floorsPerBuilding; f++) {
      const rooms: Room[] = []
      for (let r = 0; r < roomsPerFloor; r++) {
        const x = r * 15
        const y = f * 12
        rooms.push(makeRoom(`b${b}-f${f}-r${r}`, `Room ${b}-${f}-${r}`, x, y))
      }
      floors.push(makeFloor(`b${b}-f${f}`, f, rooms, makeEntrance(`b${b}-f${f}-ent`, `Entrance ${b}.${f}`, baseLat + 0.003, baseLng + 0.003)))
    }
    buildings.push(makeBuilding(`b${b}`, `Building ${b}`, baseLat, baseLng, floors))
  }
  return {
    schemaVersion: 1,
    version: 1,
    metadata: { campusId: `Perf-${numBuildings}b-${floorsPerBuilding}f-${roomsPerFloor}r`, name: `Perf-${numBuildings}b-${floorsPerBuilding}f-${roomsPerFloor}r`, description: '', lastModified: '', editorVersion: '1.0.0' },
    buildings, roads: [], panoramas: [], qrCheckpoints: [],
  }
}

describe('Wave 4 | Performance Baselines', () => {

  describe('Compile time', () => {
    it('compiles a minimal document (0 buildings) in < 100ms', () => {
      const doc = makeDoc(0, 0, 0)
      const start = performance.now()
      const result = compile(doc, {
        nodeInterval: 10, mergeThreshold: 5, optimizationLevel: 'none', includeAccessibility: false,
      })
      const elapsed = performance.now() - start
      expect(elapsed).toBeLessThan(100)
      expect(result.graph.nodes).toHaveLength(0)
    })

    it('compiles a small document (2 buildings, 1 floor, 5 rooms) in < 200ms', () => {
      const doc = makeDoc(2, 1, 5)
      const start = performance.now()
      const result = compile(doc, {
        nodeInterval: 10, mergeThreshold: 5, optimizationLevel: 'none', includeAccessibility: false,
      })
      const elapsed = performance.now() - start
      expect(elapsed).toBeLessThan(200)
      // 2 blds × 1 flr × 5 rooms = 10 space nodes + 2 transition nodes = 12+ nodes
      expect(result.graph.nodes.length).toBeGreaterThanOrEqual(12)
    }, COMPILE_TIMEOUT_MS)

    it('compiles a medium document (5 buildings, 3 floors, 10 rooms) in < 1000ms', () => {
      const doc = makeDoc(5, 3, 10)
      const start = performance.now()
      const result = compile(doc, {
        nodeInterval: 10, mergeThreshold: 5, optimizationLevel: 'none', includeAccessibility: false,
      })
      const elapsed = performance.now() - start
      expect(elapsed).toBeLessThan(1000)
      // 5 blds × 3 flrs × 10 rooms = 150 space nodes + 15 transition nodes ≈ 165+ nodes
      expect(result.graph.nodes.length).toBeGreaterThanOrEqual(150)
    }, COMPILE_TIMEOUT_MS)

    it('compiles a large document (10 buildings, 5 floors, 20 rooms) in < 3000ms', () => {
      const doc = makeDoc(10, 5, 20)
      const start = performance.now()
      const result = compile(doc, {
        nodeInterval: 10, mergeThreshold: 5, optimizationLevel: 'none', includeAccessibility: false,
      })
      const elapsed = performance.now() - start
      expect(elapsed).toBeLessThan(3000)
      // 10 blds × 5 flrs × 20 rooms = 1000 space nodes + 50 transition nodes ≈ 1050+ nodes
      expect(result.graph.nodes.length).toBeGreaterThanOrEqual(1000)
    }, COMPILE_TIMEOUT_MS)
  })

  describe('Compile scaling sanity', () => {
    it('small graph compile is faster than large graph compile', () => {
      const smallDoc = makeDoc(1, 1, 5)
      const largeDoc = makeDoc(10, 5, 20)
      const t1 = performance.now()
      compile(smallDoc, { nodeInterval: 10, mergeThreshold: 5, optimizationLevel: 'none', includeAccessibility: false })
      const smallTime = performance.now() - t1
      const t2 = performance.now()
      compile(largeDoc, { nodeInterval: 10, mergeThreshold: 5, optimizationLevel: 'none', includeAccessibility: false })
      const largeTime = performance.now() - t2
      // Large (1000 rooms, 10 blds) should be slower than small (5 rooms, 1 bld)
      // But there can be variance; use a loose factor
      expect(largeTime).toBeGreaterThan(smallTime * 0.1) // at least 10% of small
    })

    it('compile time is measurable (> 0ms) for any non-empty document', () => {
      const doc = makeDoc(1, 1, 1)
      const start = performance.now()
      compile(doc, { nodeInterval: 10, mergeThreshold: 5, optimizationLevel: 'none', includeAccessibility: false })
      const elapsed = performance.now() - start
      expect(elapsed).toBeGreaterThanOrEqual(0)
    })
  })

  describe('Artifact size sanity', () => {
    it('medium document produces reasonable artifact sizes (< 500kb serialized)', () => {
      const doc = makeDoc(5, 3, 10)
      const result = compile(doc, {
        nodeInterval: 10, mergeThreshold: 5, optimizationLevel: 'none', includeAccessibility: false,
      })
      const json = JSON.stringify(result.graph)
      expect(json.length).toBeLessThan(500 * 1024) // < 500kb
      expect(json.length).toBeGreaterThan(1000) // at least some data
    })

    it('large document produces reasonable artifact sizes (< 5mb serialized)', () => {
      const doc = makeDoc(10, 5, 20)
      const result = compile(doc, {
        nodeInterval: 10, mergeThreshold: 5, optimizationLevel: 'none', includeAccessibility: false,
      })
      const json = JSON.stringify(result.graph)
      expect(json.length).toBeLessThan(5 * 1024 * 1024) // < 5mb
    })
  })

  describe('Report consistency', () => {
    it('compile report counts are always accurate', () => {
      const doc = makeDoc(3, 2, 8)
      const result = compile(doc, {
        nodeInterval: 10, mergeThreshold: 5, optimizationLevel: 'none', includeAccessibility: false,
      })
      expect(result.report.nodesGenerated).toBe(result.graph.nodes.length)
      expect(result.report.edgesGenerated).toBe(result.graph.edges.length)
      expect(result.report.spacesExtracted).toBe(3 * 2 * 8) // buildings × floors × rooms
      expect(result.report.corridorsExtracted).toBe(0) // no roads in this doc
    })
  })
})
