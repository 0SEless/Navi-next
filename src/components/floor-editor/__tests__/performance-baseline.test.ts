import { describe, it, expect } from 'vitest'
import type { EditablePath } from '@/types/path-types'
import { computeHallwayPolygon } from '@/types/hallway-types'

describe('RC-7: Performance Baseline', () => {
  const MAX_HALLWAYS = 100
  const MAX_VERTICES = 500
  const TARGET_CREATE_MS = 500
  const TARGET_POLYGON_MS = 200

  function generateHallways(count: number, verticesPerHallway: number): Array<{ id: string; vertices: Array<{ lat: number; lng: number }> }> {
    const hallways: Array<{ id: string; vertices: Array<{ lat: number; lng: number }> }> = []
    for (let i = 0; i < count; i++) {
      const pts: Array<{ lat: number; lng: number }> = []
      for (let j = 0; j < verticesPerHallway; j++) {
        pts.push({
          lat: 11.001 + Math.random() * 0.0004,
          lng: 125.0015 + Math.random() * 0.0006,
        })
      }
      hallways.push({ id: `hw-perf-${i}`, vertices: pts })
    }
    return hallways
  }

  function makeEditablePath(id: string, rawPoints: Array<{ lat: number; lng: number }>): EditablePath {
    return {
      id,
      vertices: rawPoints.map((p, i) => ({ id: `${id}-v${i}`, x: p.lng, y: p.lat })),
      segments: Array.from({ length: rawPoints.length - 1 }, (_, i) => ({
        id: `${id}-s${i}`, startVertexId: `${id}-v${i}`, endVertexId: `${id}-v${i + 1}`, type: 'straight' as const,
      })),
      closed: false,
      readOnly: true,
    }
  }

  it(`creates ${MAX_HALLWAYS} EditablePaths with ${MAX_VERTICES} total vertices in < ${TARGET_CREATE_MS}ms`, () => {
    const raw = generateHallways(MAX_HALLWAYS, 5)
    const start = performance.now()
    const paths = raw.map(hw => makeEditablePath(hw.id, hw.vertices))
    const elapsed = performance.now() - start
    const totalVertices = paths.reduce((sum, p) => sum + p.vertices.length, 0)
    expect(paths).toHaveLength(MAX_HALLWAYS)
    expect(totalVertices).toBe(MAX_HALLWAYS * 5)
    console.log(`  Create ${MAX_HALLWAYS} EditablePaths: ${elapsed.toFixed(1)}ms (target < ${TARGET_CREATE_MS}ms)`)
    expect(elapsed).toBeLessThan(TARGET_CREATE_MS)
  })

  it(`computes polygons for ${MAX_HALLWAYS} hallways in < ${TARGET_POLYGON_MS}ms`, () => {
    const raw = generateHallways(MAX_HALLWAYS, 5)
    const totalStart = performance.now()
    for (const hw of raw) {
      const centerline = hw.vertices
      const polygon = computeHallwayPolygon(centerline, 3)
      expect(polygon.length).toBeGreaterThanOrEqual(3)
    }
    const elapsed = performance.now() - totalStart
    console.log(`  Compute ${MAX_HALLWAYS} hallway polygons: ${elapsed.toFixed(1)}ms total, ${(elapsed / MAX_HALLWAYS).toFixed(2)}ms avg (target < ${TARGET_POLYGON_MS}ms total)`)
    expect(elapsed).toBeLessThan(TARGET_POLYGON_MS)
  })

  it(`handles ${MAX_VERTICES} total vertices across ${MAX_HALLWAYS} hallways`, () => {
    const raw = generateHallways(MAX_HALLWAYS, MAX_VERTICES / MAX_HALLWAYS)
    const start = performance.now()
    const polygons = raw.map(hw => computeHallwayPolygon(hw.vertices, 3))
    const elapsed = performance.now() - start
    const totalVertices = raw.reduce((sum, hw) => sum + hw.vertices.length, 0)
    expect(totalVertices).toBe(MAX_VERTICES)
    const validPolygons = polygons.filter(p => p.length >= 3)
    expect(validPolygons.length).toBe(MAX_HALLWAYS)
    console.log(`  Process ${MAX_VERTICES} vertices across ${MAX_HALLWAYS} hallways: ${elapsed.toFixed(1)}ms (${(elapsed / MAX_VERTICES * 1000).toFixed(2)}μs/vertex)`)
    expect(elapsed).toBeLessThan(TARGET_POLYGON_MS * 2)
  })

  it('10 hallway create operations via dispatcher-like API (simulated)', () => {
    const doc = {
      buildings: [{ id: 'bld-1', floors: [{ id: 'flr-0', level: 0, hallways: [] as any[] }] }]
    }
    const start = performance.now()
    for (let i = 0; i < 10; i++) {
      const hw = {
        id: `hw-${i}`, name: `Perf ${i}`, polyline: { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] }, width: 3,
      }
      doc.buildings[0].floors[0].hallways.push(hw)
    }
    const elapsed = performance.now() - start
    console.log(`  Push 10 hallways into document: ${elapsed.toFixed(3)}ms`)
    expect(doc.buildings[0].floors[0].hallways).toHaveLength(10)
    expect(elapsed).toBeLessThan(10)
  })

  it('memory: 100 EditablePaths in memory', () => {
    const raw = generateHallways(100, 10)
    const paths = raw.map(hw => makeEditablePath(hw.id, hw.vertices))
    const jsonSize = JSON.stringify(paths).length
    const kb = (jsonSize / 1024).toFixed(1)
    console.log(`  100 EditablePaths JSON size: ${kb}KB`)
    expect(paths).toHaveLength(100)
  })
})
