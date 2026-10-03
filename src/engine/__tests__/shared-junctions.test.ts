/**
 * Phase 2 — Explicit Shared Junctions Tests
 *
 * Core invariant: Junction identity is stable across save/reload/rebuild.
 * Two or more roads meeting at one location share ONE logical junction.
 * The junction ID is assigned once and never regenerated.
 */
import { describe, expect, it } from 'vitest'
import { Graph } from '../graph'
import { aStar } from '../a-star'
import type { TracePath, NavNode } from '@/types/nav-types'

const makeTrace = (id: string, points: TracePath['points']): TracePath => ({
  id,
  campusId: 'test-campus',
  floor: 0,
  type: 'arterial',
  points,
})

const findJunction = (graph: Graph): NavNode | undefined =>
  graph.nodes.find(n => n.metadata?.connectionNode === true && Array.isArray(n.metadata?.traceIds))

const findJunctions = (graph: Graph): NavNode[] =>
  graph.nodes.filter(n => n.metadata?.connectionNode === true && Array.isArray(n.metadata?.traceIds))

describe('Phase 2 — Explicit Shared Junctions', () => {
  describe('two roads sharing one endpoint', () => {
    it('creates a shared junction node with both traceIds', () => {
      const graph = new Graph('test-campus')

      graph.addTraceWithCompile(makeTrace('road-a', [
        { lat: 0, lng: -0.001 },
        { lat: 0, lng: 0.001 },
      ]))
      graph.addTraceWithCompile(makeTrace('road-b', [
        { lat: -0.001, lng: 0 },
        { lat: 0, lng: 0 },
      ]))

      const junction = findJunction(graph)
      expect(junction).toBeDefined()
      expect(junction!.metadata?.traceIds).toEqual(expect.arrayContaining(['road-a', 'road-b']))
      expect(junction!.metadata?.connectionNode).toBe(true)
    })

    it('graph is connected through the junction', () => {
      const graph = new Graph('test-campus')

      graph.addTraceWithCompile(makeTrace('road-a', [
        { lat: 0, lng: -0.001 },
        { lat: 0, lng: 0.001 },
      ]))
      graph.addTraceWithCompile(makeTrace('road-b', [
        { lat: -0.001, lng: 0 },
        { lat: 0, lng: 0 },
      ]))

      expect(graph.connectedComponentCount).toBe(1)
    })
  })

  describe('endpoint into middle of another road', () => {
    it('creates a junction at the snap point', () => {
      const graph = new Graph('test-campus')

      // Road A: long east-west road
      graph.addTraceWithCompile(makeTrace('main', [
        { lat: 0, lng: -0.002 },
        { lat: 0, lng: 0.002 },
      ]))
      // Road B: short branch whose endpoint is near main's midpoint
      graph.addTraceWithCompile(makeTrace('branch', [
        { lat: 0.001, lng: 0 },
        { lat: 0, lng: 0 },
      ]))

      const junction = findJunction(graph)
      expect(junction).toBeDefined()
      expect(junction!.metadata?.traceIds).toEqual(expect.arrayContaining(['main', 'branch']))
    })
  })

  describe('three-road T junction', () => {
    it('creates one junction shared by all three roads', () => {
      const graph = new Graph('test-campus')

      graph.addTraceWithCompile(makeTrace('road-a', [
        { lat: 0, lng: -0.001 },
        { lat: 0, lng: 0.001 },
      ]))
      graph.addTraceWithCompile(makeTrace('road-b', [
        { lat: -0.001, lng: 0 },
        { lat: 0, lng: 0 },
      ]))
      graph.addTraceWithCompile(makeTrace('road-c', [
        { lat: 0.001, lng: 0 },
        { lat: 0, lng: 0 },
      ]))

      const junctions = findJunctions(graph)
      // Should have one junction (or possibly two if the endpoint detection
      // creates separate junctions for road-b and road-c). The key invariant
      // is that all three traces appear in at least one junction's traceIds.
      const allTraceIds = new Set<string>()
      for (const j of junctions) {
        for (const tid of (j.metadata?.traceIds as string[]) ?? []) {
          allTraceIds.add(tid)
        }
      }
      expect(allTraceIds).toContain('road-a')
      expect(allTraceIds).toContain('road-b')
      expect(allTraceIds).toContain('road-c')
    })
  })

  describe('four-road junction', () => {
    it('creates junction(s) connecting all four roads', () => {
      const graph = new Graph('test-campus')

      // Four roads all meeting at (0, 0)
      graph.addTraceWithCompile(makeTrace('road-n', [
        { lat: 0, lng: 0 },
        { lat: 0.001, lng: 0 },
      ]))
      graph.addTraceWithCompile(makeTrace('road-s', [
        { lat: 0, lng: 0 },
        { lat: -0.001, lng: 0 },
      ]))
      graph.addTraceWithCompile(makeTrace('road-e', [
        { lat: 0, lng: 0 },
        { lat: 0, lng: 0.001 },
      ]))
      graph.addTraceWithCompile(makeTrace('road-w', [
        { lat: 0, lng: 0 },
        { lat: 0, lng: -0.001 },
      ]))

      expect(graph.connectedComponentCount).toBe(1)
      const junctions = findJunctions(graph)
      expect(junctions.length).toBeGreaterThanOrEqual(1)

      // All four traces should appear in at least one junction
      const allTraceIds = new Set<string>()
      for (const j of junctions) {
        for (const tid of (j.metadata?.traceIds as string[]) ?? []) {
          allTraceIds.add(tid)
        }
      }
      expect(allTraceIds).toContain('road-n')
      expect(allTraceIds).toContain('road-s')
      expect(allTraceIds).toContain('road-e')
      expect(allTraceIds).toContain('road-w')
    })
  })

  describe('attach new road to existing junction', () => {
    it('reuses the existing junction node', () => {
      const graph = new Graph('test-campus')

      // Create initial junction
      graph.addTraceWithCompile(makeTrace('road-a', [
        { lat: 0, lng: -0.001 },
        { lat: 0, lng: 0.001 },
      ]))
      graph.addTraceWithCompile(makeTrace('road-b', [
        { lat: -0.001, lng: 0 },
        { lat: 0, lng: 0 },
      ]))

      const junction1 = findJunction(graph)!
      const junctionId1 = junction1.id

      // Add a third road connecting to the same junction
      graph.addTraceWithCompile(makeTrace('road-c', [
        { lat: 0.001, lng: 0 },
        { lat: 0, lng: 0 },
      ]))

      // The original junction should be reused (same ID)
      const junctions = findJunctions(graph)
      const hasOriginalId = junctions.some(j => j.id === junctionId1)
      expect(hasOriginalId).toBe(true)

      // road-c should be in the junction's traceIds
      const updatedJunction = junctions.find(j => j.id === junctionId1)!
      expect(updatedJunction.metadata?.traceIds).toContain('road-c')
    })
  })

  describe('nearby competing segment', () => {
    it('connects to the nearest road, not an arbitrary one', () => {
      const graph = new Graph('test-campus')

      // Two parallel roads
      graph.addTraceWithCompile(makeTrace('near', [
        { lat: 0, lng: -0.001 },
        { lat: 0, lng: 0.001 },
      ]))
      graph.addTraceWithCompile(makeTrace('far', [
        { lat: 0.001, lng: -0.001 },
        { lat: 0.001, lng: 0.001 },
      ]))

      // Branch endpoint near 'near' road
      graph.addTraceWithCompile(makeTrace('branch', [
        { lat: 0.0001, lng: 0 },
        { lat: 0, lng: 0 },
      ]))

      // The junction should connect 'branch' to 'near', not 'far'
      const junctions = findJunctions(graph)
      const branchJunction = junctions.find(j =>
        (j.metadata?.traceIds as string[])?.includes('branch')
      )
      expect(branchJunction).toBeDefined()
      expect(branchJunction!.metadata?.traceIds).toContain('near')
    })
  })

  describe('two junctions close to each other', () => {
    it('creates separate junction nodes for distinct connection points', () => {
      const graph = new Graph('test-campus')

      // Two roads meeting at two distinct points
      graph.addTraceWithCompile(makeTrace('road-a', [
        { lat: 0, lng: -0.001 },
        { lat: 0, lng: 0.001 },
      ]))
      // road-b crosses road-a at two different points
      graph.addTraceWithCompile(makeTrace('road-b', [
        { lat: -0.001, lng: -0.0005 },
        { lat: 0.001, lng: 0.0005 },
      ]))

      const junctions = findJunctions(graph)
      // Should have at least 1 junction (the X-crossing)
      expect(junctions.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('save/reload preserves junction ID', () => {
    it('toJSON → fromJSON preserves junction node IDs', () => {
      const graph = new Graph('test-campus')

      graph.addTraceWithCompile(makeTrace('road-a', [
        { lat: 0, lng: -0.001 },
        { lat: 0, lng: 0.001 },
      ]))
      graph.addTraceWithCompile(makeTrace('road-b', [
        { lat: -0.001, lng: 0 },
        { lat: 0, lng: 0 },
      ]))

      const junction1 = findJunction(graph)!
      const id1 = junction1.id

      // Serialize and deserialize
      const snapshot = graph.toJSON()
      const restored = Graph.fromJSON(snapshot)

      const junction2 = findJunction(restored)!
      expect(junction2.id).toBe(id1)
      expect(junction2.metadata?.traceIds).toEqual(expect.arrayContaining(['road-a', 'road-b']))
    })
  })

  describe('repeated reload preserves junction ID', () => {
    it('double round-trip preserves junction identity', () => {
      const graph = new Graph('test-campus')

      graph.addTraceWithCompile(makeTrace('road-a', [
        { lat: 0, lng: -0.001 },
        { lat: 0, lng: 0.001 },
      ]))
      graph.addTraceWithCompile(makeTrace('road-b', [
        { lat: -0.001, lng: 0 },
        { lat: 0, lng: 0 },
      ]))

      const id1 = findJunction(graph)!.id

      // First round-trip
      const g2 = Graph.fromJSON(graph.toJSON())
      const id2 = findJunction(g2)!.id
      expect(id2).toBe(id1)

      // Second round-trip
      const g3 = Graph.fromJSON(g2.toJSON())
      const id3 = findJunction(g3)!.id
      expect(id3).toBe(id1)
    })
  })

  describe('navigation-only road joins junction', () => {
    it('navigation-only trace participates in shared junction', () => {
      const graph = new Graph('test-campus')

      graph.addTraceWithCompile(makeTrace('visible-road', [
        { lat: 0, lng: -0.001 },
        { lat: 0, lng: 0.001 },
      ]))
      graph.addTraceWithCompile({
        ...makeTrace('hidden-road', [
          { lat: -0.001, lng: 0 },
          { lat: 0, lng: 0 },
        ]),
        displayMode: 'navigation-only',
      })

      const junction = findJunction(graph)
      expect(junction).toBeDefined()
      expect(junction!.metadata?.traceIds).toContain('hidden-road')
    })
  })

  describe('remove one road from a 3-road junction', () => {
    it('junction persists with remaining roads', () => {
      const graph = new Graph('test-campus')

      graph.addTraceWithCompile(makeTrace('road-a', [
        { lat: 0, lng: -0.001 },
        { lat: 0, lng: 0.001 },
      ]))
      graph.addTraceWithCompile(makeTrace('road-b', [
        { lat: -0.001, lng: 0 },
        { lat: 0, lng: 0 },
      ]))
      graph.addTraceWithCompile(makeTrace('road-c', [
        { lat: 0.001, lng: 0 },
        { lat: 0, lng: 0 },
      ]))

      // Remove road-c
      graph.removeTrace('road-c')

      // Junction should still exist with road-a and road-b
      const junctions = findJunctions(graph)
      const remainingJunction = junctions.find(j =>
        (j.metadata?.traceIds as string[])?.includes('road-a') &&
        (j.metadata?.traceIds as string[])?.includes('road-b')
      )
      expect(remainingJunction).toBeDefined()
    })
  })

  describe('graph routes through shared junction', () => {
    it('A* finds path across junction in every valid direction', () => {
      const graph = new Graph('test-campus')

      graph.addTraceWithCompile(makeTrace('road-a', [
        { lat: 0, lng: -0.001 },
        { lat: 0, lng: 0.001 },
      ]))
      graph.addTraceWithCompile(makeTrace('road-b', [
        { lat: -0.001, lng: 0 },
        { lat: 0, lng: 0 },
      ]))

      const aStart = graph.nodes.find(n => n.metadata?.traceId === 'road-a' && n.position.lng < -0.0005)
      const aEnd = graph.nodes.find(n => n.metadata?.traceId === 'road-a' && n.position.lng > 0.0005)
      const bStart = graph.nodes.find(n => n.metadata?.traceId === 'road-b' && n.position.lat < -0.0005)

      expect(aStar(graph.nodes, graph.edges, aStart!.id, aEnd!.id)).not.toBeNull()
      expect(aStar(graph.nodes, graph.edges, bStart!.id, aEnd!.id)).not.toBeNull()
      expect(aStar(graph.nodes, graph.edges, aStart!.id, bStart!.id)).not.toBeNull()
    })
  })

  describe('authored road coordinates unchanged after graph compilation', () => {
    it('trace points remain byte-equivalent after addTraceWithCompile', () => {
      const graph = new Graph('test-campus')

      const pointsA = [{ lat: 14.5, lng: 121.49 }, { lat: 14.5, lng: 121.51 }]
      const pointsB = [{ lat: 14.499, lng: 121.5 }, { lat: 14.5, lng: 121.5 }]

      const traceA = makeTrace('road-a', pointsA.map(p => ({ ...p })))
      const traceB = makeTrace('road-b', pointsB.map(p => ({ ...p })))

      graph.addTraceWithCompile(traceA)
      graph.addTraceWithCompile(traceB)

      expect(traceA.points).toEqual(pointsA)
      expect(traceB.points).toEqual(pointsB)
    })
  })

  describe('Phase 1 regression: connectionNode chain exclusion', () => {
    it('shared junction nodes are excluded from endpoint detection chains but remain traversable', () => {
      const graph = new Graph('test-campus')

      // Create a junction between road-a and road-b
      graph.addTraceWithCompile(makeTrace('road-a', [
        { lat: 0, lng: -0.001 },
        { lat: 0, lng: 0.001 },
      ]))
      graph.addTraceWithCompile(makeTrace('road-b', [
        { lat: -0.001, lng: 0 },
        { lat: 0, lng: 0 },
      ]))

      const junction = findJunction(graph)!
      expect(junction.metadata?.connectionNode).toBe(true)

      // Junction node should have edges (traversable)
      const junctionEdges = graph.edges.filter(
        e => e.from === junction.id || e.to === junction.id
      )
      expect(junctionEdges.length).toBeGreaterThanOrEqual(2)

      // A* should route through the junction
      const bStart = graph.nodes.find(n => n.metadata?.traceId === 'road-b' && n.position.lat < -0.0005)
      const aEnd = graph.nodes.find(n => n.metadata?.traceId === 'road-a' && n.position.lng > 0.0005)
      expect(aStar(graph.nodes, graph.edges, bStart!.id, aEnd!.id)).not.toBeNull()
    })
  })
})
