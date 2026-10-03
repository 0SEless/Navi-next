/**
 * Phase 1 — Geometry Integrity Tests
 *
 * Core invariant: CampusDocument.roads[] authored geometry is canonical.
 * Graph compilation must never silently rewrite coordinates.
 *
 * These tests verify that:
 * - syncTraceIntersections does NOT mutate trace.points
 * - graph sync does NOT mutate source document geometry
 * - repeated sync causes zero coordinate drift
 * - save → reload preserves exact authored coordinates
 * - routing graph still creates derived connections correctly
 */
import { describe, expect, it } from 'vitest'
import { Graph } from '../graph'
import { aStar } from '../a-star'
import type { TracePath } from '@/types/nav-types'

const makeTrace = (id: string, points: TracePath['points']): TracePath => ({
  id,
  campusId: 'test-campus',
  floor: 0,
  type: 'arterial',
  points,
})

describe('Phase 1 — Geometry Integrity', () => {
  describe('syncTraceIntersections does NOT mutate trace.points', () => {
    it('preserves authored endpoint coordinates when endpoint snaps to nearby segment', () => {
      const graph = new Graph('test-campus')

      // Road A: east-west at lat 0
      const traceA = makeTrace('road-a', [
        { lat: 0, lng: -0.001 },
        { lat: 0, lng: 0.001 },
      ])
      graph.addTraceWithCompile(traceA)

      // Road B: endpoint at (0, 0) which is ON road A's segment
      const traceBPoints = [
        { lat: -0.001, lng: 0 },
        { lat: 0, lng: 0 },
      ]
      const traceB = makeTrace('road-b', traceBPoints)
      graph.addTraceWithCompile(traceB)

      // Authored coordinates must be unchanged
      expect(traceB.points[0]).toEqual({ lat: -0.001, lng: 0 })
      expect(traceB.points[1]).toEqual({ lat: 0, lng: 0 })
    })

    it('preserves authored endpoint coordinates when endpoint is within 5m of segment', () => {
      const graph = new Graph('test-campus')

      // Road A: east-west
      const traceA = makeTrace('road-a', [
        { lat: 0, lng: -0.001 },
        { lat: 0, lng: 0.001 },
      ])
      graph.addTraceWithCompile(traceA)

      // Road B: endpoint ~3m north of road A (within 5m threshold)
      // 0.00003° lat ≈ 3.3m
      const traceBPoints = [
        { lat: 0.00003, lng: 0 },
        { lat: 0.001, lng: 0 },
      ]
      const traceB = makeTrace('road-b', traceBPoints)
      graph.addTraceWithCompile(traceB)

      // Authored coordinates must be unchanged
      expect(traceB.points[0]).toEqual({ lat: 0.00003, lng: 0 })
      expect(traceB.points[1]).toEqual({ lat: 0.001, lng: 0 })
    })

    it('does not mutate trace A when trace B is added', () => {
      const graph = new Graph('test-campus')

      const traceA = makeTrace('road-a', [
        { lat: 0, lng: -0.001 },
        { lat: 0, lng: 0.001 },
      ])
      graph.addTraceWithCompile(traceA)

      const traceB = makeTrace('road-b', [
        { lat: -0.001, lng: 0 },
        { lat: 0, lng: 0 },
      ])
      graph.addTraceWithCompile(traceB)

      // Trace A must be unchanged
      expect(traceA.points).toEqual([
        { lat: 0, lng: -0.001 },
        { lat: 0, lng: 0.001 },
      ])
    })
  })

  describe('graph sync does NOT mutate source geometry', () => {
    it('graph.addTraceWithCompile does not modify the input trace points', () => {
      const graph = new Graph('test-campus')

      const originalPoints = [
        { lat: 14.5, lng: 121.49 },
        { lat: 14.5, lng: 121.51 },
      ]
      const trace = makeTrace('road-1', [...originalPoints])
      graph.addTraceWithCompile(trace)

      // Deep equality check
      expect(trace.points[0].lat).toBe(originalPoints[0].lat)
      expect(trace.points[0].lng).toBe(originalPoints[0].lng)
      expect(trace.points[1].lat).toBe(originalPoints[1].lat)
      expect(trace.points[1].lng).toBe(originalPoints[1].lng)
    })
  })

  describe('repeated sync causes zero coordinate drift', () => {
    it('adding the same traces multiple times does not drift coordinates', () => {
      const graph = new Graph('test-campus')

      const traceA = makeTrace('road-a', [
        { lat: 0, lng: -0.001 },
        { lat: 0, lng: 0.001 },
      ])
      const traceB = makeTrace('road-b', [
        { lat: -0.001, lng: 0 },
        { lat: 0, lng: 0 },
      ])

      // First pass
      graph.addTraceWithCompile(traceA)
      graph.addTraceWithCompile(traceB)

      const pointsA1 = traceA.points.map(p => ({ ...p }))
      const pointsB1 = traceB.points.map(p => ({ ...p }))

      // Remove and re-add (simulating GraphAdapter.sync)
      graph.removeTrace('road-a')
      graph.removeTrace('road-b')

      // Second pass — recompile with same data
      graph.addTraceWithCompile(traceA)
      graph.addTraceWithCompile(traceB)

      // Coordinates must be identical
      expect(traceA.points).toEqual(pointsA1)
      expect(traceB.points).toEqual(pointsB1)
    })

    it('repeated recompileTrace causes zero drift', () => {
      const graph = new Graph('test-campus')

      const traceA = makeTrace('road-a', [
        { lat: 0, lng: -0.001 },
        { lat: 0, lng: 0.001 },
      ])
      const traceB = makeTrace('road-b', [
        { lat: -0.001, lng: 0 },
        { lat: 0, lng: 0 },
      ])

      graph.addTraceWithCompile(traceA)
      graph.addTraceWithCompile(traceB)

      const pointsA = traceA.points.map(p => ({ ...p }))
      const pointsB = traceB.points.map(p => ({ ...p }))

      // Recompile both traces multiple times
      for (let i = 0; i < 5; i++) {
        graph.recompileTrace('road-a')
        graph.recompileTrace('road-b')
      }

      expect(traceA.points).toEqual(pointsA)
      expect(traceB.points).toEqual(pointsB)
    })
  })

  describe('save → reload preserves exact authored coordinates', () => {
    it('toJSON → fromJSON round-trip preserves trace points', () => {
      const graph = new Graph('test-campus')

      const traceA = makeTrace('road-a', [
        { lat: 14.5, lng: 121.49 },
        { lat: 14.5, lng: 121.51 },
      ])
      const traceB = makeTrace('road-b', [
        { lat: 14.499, lng: 121.5 },
        { lat: 14.5, lng: 121.5 },
      ])

      graph.addTraceWithCompile(traceA)
      graph.addTraceWithCompile(traceB)

      // Serialize and deserialize
      const snapshot = graph.toJSON()
      const restored = Graph.fromJSON(snapshot)

      // Trace points must be identical
      const restoredA = restored.traces.find(t => t.id === 'road-a')
      const restoredB = restored.traces.find(t => t.id === 'road-b')

      expect(restoredA?.points).toEqual(traceA.points)
      expect(restoredB?.points).toEqual(traceB.points)
    })

    it('double round-trip preserves exact coordinates', () => {
      const graph = new Graph('test-campus')

      const traceA = makeTrace('road-a', [
        { lat: 14.5, lng: 121.49 },
        { lat: 14.5, lng: 121.51 },
      ])

      graph.addTraceWithCompile(traceA)

      // First round-trip
      const snap1 = graph.toJSON()
      const g2 = Graph.fromJSON(snap1)

      // Second round-trip
      const snap2 = g2.toJSON()
      const g3 = Graph.fromJSON(snap2)

      const final = g3.traces.find(t => t.id === 'road-a')
      expect(final?.points).toEqual(traceA.points)
    })
  })

  describe('routing graph still creates derived connections', () => {
    it('endpoint-to-segment junction is created in the graph', () => {
      const graph = new Graph('test-campus')

      graph.addTraceWithCompile(makeTrace('main', [
        { lat: 0, lng: -0.001 },
        { lat: 0, lng: 0.001 },
      ]))
      graph.addTraceWithCompile(makeTrace('branch', [
        { lat: -0.001, lng: 0 },
        { lat: 0, lng: 0 },
      ]))

      // Branch endpoint connects to main
      const branchEnd = graph.nodes.find(
        n => n.metadata?.traceId === 'branch' && n.metadata?.connectionNode === true
      )
      expect(branchEnd).toBeDefined()

      // Graph is connected
      expect(graph.connectedComponentCount).toBe(1)
    })

    it('X-crossing creates junction node in the graph', () => {
      const graph = new Graph('test-campus')

      graph.addTraceWithCompile(makeTrace('horizontal', [
        { lat: 0, lng: -0.001 },
        { lat: 0, lng: 0.001 },
      ]))
      graph.addTraceWithCompile(makeTrace('vertical', [
        { lat: -0.001, lng: 0 },
        { lat: 0.001, lng: 0 },
      ]))

      // Junction node exists at the crossing
      const junction = graph.nodes.find(
        n => n.metadata?.connectionNode === true &&
          Math.abs(n.position.lat) < 0.00001 &&
          Math.abs(n.position.lng) < 0.00001
      )
      expect(junction).toBeDefined()
      expect(junction!.metadata?.traceIds).toEqual(
        expect.arrayContaining(['horizontal', 'vertical'])
      )

      // Both traces are connected through the junction
      expect(graph.connectedComponentCount).toBe(1)
    })

    it('A* pathfinding works across junction', () => {
      const graph = new Graph('test-campus')

      graph.addTraceWithCompile(makeTrace('main', [
        { lat: 0, lng: -0.001 },
        { lat: 0, lng: 0.001 },
      ]))
      graph.addTraceWithCompile(makeTrace('branch', [
        { lat: -0.001, lng: 0 },
        { lat: 0, lng: 0 },
      ]))

      const branchStart = graph.nodes.find(
        n => n.metadata?.traceId === 'branch' &&
          n.position.lat < -0.0005
      )
      const mainEnd = graph.nodes.find(
        n => n.metadata?.traceId === 'main' &&
          n.position.lng > 0.0005
      )

      expect(branchStart).toBeDefined()
      expect(mainEnd).toBeDefined()
      expect(aStar(graph.nodes, graph.edges, branchStart!.id, mainEnd!.id)).not.toBeNull()
    })
  })

  describe('existing maps load without migration', () => {
    it('graph with pre-existing traces loads and reconnects correctly', () => {
      // Simulate a saved graph snapshot with traces
      const graph = new Graph('test-campus')

      const traceA = makeTrace('road-a', [
        { lat: 0, lng: -0.001 },
        { lat: 0, lng: 0.001 },
      ])
      const traceB = makeTrace('road-b', [
        { lat: -0.001, lng: 0 },
        { lat: 0, lng: 0 },
      ])

      graph.addTraceWithCompile(traceA)
      graph.addTraceWithCompile(traceB)

      // Serialize (simulating save)
      const snapshot = graph.toJSON()

      // Deserialize (simulating reload)
      const restored = Graph.fromJSON(snapshot)

      // Verify junction is restored
      const junction = restored.nodes.find(
        n => n.metadata?.connectionNode === true
      )
      expect(junction).toBeDefined()

      // Verify connectivity
      expect(restored.connectedComponentCount).toBe(1)

      // Verify trace points are preserved
      const restoredA = restored.traces.find(t => t.id === 'road-a')
      const restoredB = restored.traces.find(t => t.id === 'road-b')
      expect(restoredA?.points).toEqual(traceA.points)
      expect(restoredB?.points).toEqual(traceB.points)
    })
  })
})
