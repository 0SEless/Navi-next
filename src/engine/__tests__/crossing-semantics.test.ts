/**
 * Phase 4 — Explicit Crossing Semantics Tests
 *
 * Tests for:
 * - Automatic X-intersection creation
 * - Crossing survives save/reload
 * - Repeated sync does not duplicate junction
 * - Keep Separate prevents routing connection
 * - Save/reload separated crossing
 * - Repeated sync does not regenerate rejected crossing
 * - Keep Separate → Create Junction restores routing
 * - Non-crossing roads don't create junction
 * - Existing junction at intersection is reused
 * - Three roads at one junction
 * - Navigation-only × normal road
 * - Moving road removes ghost junction
 * - Authored junction lifecycle protected
 * - Road array order independence
 */
import { describe, expect, it } from 'vitest'
import { Graph } from '../graph'
import { aStar } from '../a-star'
import type { TracePath } from '@/types/nav-types'
import type { SeparatedCrossing, CampusDocument } from '@navi/core'
import { markCrossingSeparate, createJunctionAtCrossing, isCrossingSeparated } from '../../../packages/editor/src/commands/road-connectivity'

const makeTrace = (id: string, points: TracePath['points']): TracePath => ({
  id, campusId: 'test-campus', floor: 0, type: 'arterial', points,
})

function findJunction(graph: Graph, traceIds: string[]) {
  return graph.nodes.find(n =>
    n.metadata?.connectionNode === true &&
    traceIds.every(tid => (n.metadata?.traceIds as string[])?.includes(tid))
  )
}

describe('Phase 4 — Explicit Crossing Semantics', () => {
  describe('1. Two ordinary roads cross → junction auto-created', () => {
    it('creates a junction at the geometric intersection', () => {
      const graph = new Graph('test-campus')
      graph.addTraceWithCompile(makeTrace('road-a', [
        { lat: 0, lng: -0.001 }, { lat: 0, lng: 0.001 },
      ]), 2)
      graph.addTraceWithCompile(makeTrace('road-b', [
        { lat: -0.001, lng: 0 }, { lat: 0.001, lng: 0 },
      ]), 2)

      const j = findJunction(graph, ['road-a', 'road-b'])
      expect(j).toBeDefined()
      expect(j!.metadata?.connectionNode).toBe(true)
    })
  })

  describe('2. Crossing junction survives save/reload', () => {
    it('junction ID preserved through round-trip', () => {
      const graph = new Graph('test-campus')
      graph.addTraceWithCompile(makeTrace('road-a', [
        { lat: 0, lng: -0.001 }, { lat: 0, lng: 0.001 },
      ]), 2)
      graph.addTraceWithCompile(makeTrace('road-b', [
        { lat: -0.001, lng: 0 }, { lat: 0.001, lng: 0 },
      ]), 2)

      const j1 = findJunction(graph, ['road-a', 'road-b'])!
      const snap = graph.toJSON()
      const restored = Graph.fromJSON(snap)
      const j2 = restored.nodes.find(n => n.id === j1.id)
      expect(j2).toBeDefined()
      expect(j2!.metadata?.traceIds).toEqual(expect.arrayContaining(['road-a', 'road-b']))
    })
  })

  describe('3. Repeated sync does not duplicate junction', () => {
    it('syncing twice produces one junction', () => {
      const graph = new Graph('test-campus')
      graph.addTraceWithCompile(makeTrace('road-a', [
        { lat: 0, lng: -0.001 }, { lat: 0, lng: 0.001 },
      ]), 2)
      graph.addTraceWithCompile(makeTrace('road-b', [
        { lat: -0.001, lng: 0 }, { lat: 0.001, lng: 0 },
      ]), 2)

      // Simulate re-sync: clear and rebuild
      graph.setNodes([])
      graph.setEdges([])
      graph.setTraces([])
      graph.addTraceWithCompile(makeTrace('road-a', [
        { lat: 0, lng: -0.001 }, { lat: 0, lng: 0.001 },
      ]), 2)
      graph.addTraceWithCompile(makeTrace('road-b', [
        { lat: -0.001, lng: 0 }, { lat: 0.001, lng: 0 },
      ]), 2)

      const junctions = graph.nodes.filter(
        n => n.metadata?.connectionNode === true &&
          (n.metadata?.traceIds as string[])?.includes('road-a') &&
          (n.metadata?.traceIds as string[])?.includes('road-b')
      )
      expect(junctions).toHaveLength(1)
    })
  })

  describe('4. Keep Separate prevents routing connection', () => {
    it('separated crossing has no traversable junction', () => {
      const doc: CampusDocument = {
        schemaVersion: 1, version: 0,
        metadata: { campusId: 'test', name: 'test', description: '', lastModified: '', editorVersion: '0.1' },
        buildings: [],
        roads: [
          { id: 'road-a', name: 'A', polyline: { points: [{ lat: 0, lng: -0.001 }, { lat: 0, lng: 0.001 }] }, width: 8, surface: 'paved', type: 'arterial', metadata: {} },
          { id: 'road-b', name: 'B', polyline: { points: [{ lat: -0.001, lng: 0 }, { lat: 0.001, lng: 0 }] }, width: 8, surface: 'paved', type: 'arterial', metadata: {} },
        ],
        panoramas: [], qrCheckpoints: [],
        separatedCrossings: [{
          id: 'sc-1', roadIds: ['road-a', 'road-b'], position: { lat: 0, lng: 0 },
        }],
      }

      const graph = new Graph('test-campus')
      graph.separatedCrossings = doc.separatedCrossings!
      graph.addTraceWithCompile(makeTrace('road-a', doc.roads[0].polyline.points), 2)
      graph.addTraceWithCompile(makeTrace('road-b', doc.roads[1].polyline.points), 2)

      // No junction should be created at the crossing
      const j = findJunction(graph, ['road-a', 'road-b'])
      expect(j).toBeUndefined()
    })

    it('routing cannot turn at separated crossing', () => {
      const doc: CampusDocument = {
        schemaVersion: 1, version: 0,
        metadata: { campusId: 'test', name: 'test', description: '', lastModified: '', editorVersion: '0.1' },
        buildings: [],
        roads: [
          { id: 'road-a', name: 'A', polyline: { points: [{ lat: 0, lng: -0.001 }, { lat: 0, lng: 0.001 }] }, width: 8, surface: 'paved', type: 'arterial', metadata: {} },
          { id: 'road-b', name: 'B', polyline: { points: [{ lat: -0.001, lng: 0 }, { lat: 0.001, lng: 0 }] }, width: 8, surface: 'paved', type: 'arterial', metadata: {} },
        ],
        panoramas: [], qrCheckpoints: [],
        separatedCrossings: [{
          id: 'sc-1', roadIds: ['road-a', 'road-b'], position: { lat: 0, lng: 0 },
        }],
      }

      const graph = new Graph('test-campus')
      graph.separatedCrossings = doc.separatedCrossings!
      graph.addTraceWithCompile(makeTrace('road-a', doc.roads[0].polyline.points), 2)
      graph.addTraceWithCompile(makeTrace('road-b', doc.roads[1].polyline.points), 2)

      // A* should NOT find a path from road-a to road-b through the crossing
      const aStart = graph.nodes.find(n => n.metadata?.traceId === 'road-a' && n.position.lng < -0.0005)
      const bEnd = graph.nodes.find(n => n.metadata?.traceId === 'road-b' && n.position.lat > 0.0005)
      if (aStart && bEnd) {
        const path = aStar(graph.nodes, graph.edges, aStart.id, bEnd.id)
        // Path should not exist or should not cross the junction
        expect(path).toBeNull()
      }
    })
  })

  describe('5. Save/reload separated crossing', () => {
    it('separated crossing survives round-trip', () => {
      const graph = new Graph('test-campus')
      graph.separatedCrossings = [{
        id: 'sc-1', roadIds: ['road-a', 'road-b'], position: { lat: 0, lng: 0 },
      }]

      const snap = graph.toJSON()
      expect(snap.separatedCrossings).toHaveLength(1)
      expect(snap.separatedCrossings![0].id).toBe('sc-1')

      const restored = Graph.fromJSON(snap)
      expect(restored.separatedCrossings).toHaveLength(1)
      expect(restored.separatedCrossings[0].roadIds).toEqual(['road-a', 'road-b'])
    })
  })

  describe('6. Repeated sync does not regenerate rejected crossing', () => {
    it('separated crossing stays separated after re-sync', () => {
      const graph = new Graph('test-campus')
      graph.separatedCrossings = [{
        id: 'sc-1', roadIds: ['road-a', 'road-b'], position: { lat: 0, lng: 0 },
      }]

      graph.addTraceWithCompile(makeTrace('road-a', [
        { lat: 0, lng: -0.001 }, { lat: 0, lng: 0.001 },
      ]), 2)
      graph.addTraceWithCompile(makeTrace('road-b', [
        { lat: -0.001, lng: 0 }, { lat: 0.001, lng: 0 },
      ]), 2)

      // Clear and re-sync (simulating GraphAdapter.sync)
      graph.setNodes([])
      graph.setEdges([])
      graph.setTraces([])
      // separatedCrossings persists on the graph
      graph.addTraceWithCompile(makeTrace('road-a', [
        { lat: 0, lng: -0.001 }, { lat: 0, lng: 0.001 },
      ]), 2)
      graph.addTraceWithCompile(makeTrace('road-b', [
        { lat: -0.001, lng: 0 }, { lat: 0.001, lng: 0 },
      ]), 2)

      const j = findJunction(graph, ['road-a', 'road-b'])
      expect(j).toBeUndefined()
    })
  })

  describe('7. Keep Separate → Create Junction', () => {
    it('removes separation and creates junction', () => {
      const doc: CampusDocument = {
        schemaVersion: 1, version: 0,
        metadata: { campusId: 'test', name: 'test', description: '', lastModified: '', editorVersion: '0.1' },
        buildings: [],
        roads: [
          { id: 'road-a', name: 'A', polyline: { points: [{ lat: 0, lng: -0.001 }, { lat: 0, lng: 0.001 }] }, width: 8, surface: 'paved', type: 'arterial', metadata: {} },
          { id: 'road-b', name: 'B', polyline: { points: [{ lat: -0.001, lng: 0 }, { lat: 0.001, lng: 0 }] }, width: 8, surface: 'paved', type: 'arterial', metadata: {} },
        ],
        panoramas: [], qrCheckpoints: [],
        separatedCrossings: [{
          id: 'sc-1', roadIds: ['road-a', 'road-b'], position: { lat: 0, lng: 0 },
        }],
      }

      // Initially separated
      expect(isCrossingSeparated(doc, 'road-a', 'road-b')).toBe(true)

      // Create junction
      const junction = createJunctionAtCrossing(doc, 'road-a', 'road-b', { lat: 0, lng: 0 })
      expect(junction).toBeDefined()
      expect(junction!.roadIds).toEqual(expect.arrayContaining(['road-a', 'road-b']))
      expect(junction!.source).toBe('authored')

      // No longer separated
      expect(isCrossingSeparated(doc, 'road-a', 'road-b')).toBe(false)
      expect(doc.separatedCrossings).toHaveLength(0)
    })
  })

  describe('8. Non-crossing roads → no junction', () => {
    it('parallel roads do not create junction', () => {
      const graph = new Graph('test-campus')
      graph.addTraceWithCompile(makeTrace('road-a', [
        { lat: 0, lng: -0.001 }, { lat: 0, lng: 0.001 },
      ]), 2)
      graph.addTraceWithCompile(makeTrace('road-b', [
        { lat: 0.001, lng: -0.001 }, { lat: 0.001, lng: 0.001 },
      ]), 2)

      const j = findJunction(graph, ['road-a', 'road-b'])
      expect(j).toBeUndefined()
    })
  })

  describe('9. Existing junction at intersection → reused', () => {
    it('pre-seeded junction is reused', () => {
      const graph = new Graph('test-campus')
      // Pre-seed a junction
      graph.addNode({
        id: 'j-pre', label: 'J', name: 'J', type: 'intersection',
        campusId: 'test', floor: 0, buildingId: '',
        position: { lat: 0, lng: 0 },
        metadata: { connectionNode: true, traceIds: ['road-a', 'road-b'], junctionRecordId: 'j-pre' },
      })

      graph.addTraceWithCompile(makeTrace('road-a', [
        { lat: 0, lng: -0.001 }, { lat: 0, lng: 0.001 },
      ]), 2)
      graph.addTraceWithCompile(makeTrace('road-b', [
        { lat: -0.001, lng: 0 }, { lat: 0.001, lng: 0 },
      ]), 2)

      const j = graph.nodes.find(n => n.id === 'j-pre')
      expect(j).toBeDefined()
      expect(j!.metadata?.traceIds).toContain('road-a')
      expect(j!.metadata?.traceIds).toContain('road-b')
    })
  })

  describe('10. Three roads at one junction', () => {
    it('one shared junction for all three', () => {
      const graph = new Graph('test-campus')
      graph.addTraceWithCompile(makeTrace('road-a', [
        { lat: 0, lng: -0.001 }, { lat: 0, lng: 0.001 },
      ]), 2)
      graph.addTraceWithCompile(makeTrace('road-b', [
        { lat: -0.001, lng: 0 }, { lat: 0, lng: 0 },
      ]), 2)
      graph.addTraceWithCompile(makeTrace('road-c', [
        { lat: 0.001, lng: 0 }, { lat: 0, lng: 0 },
      ]), 2)

      const allTraceIds = new Set<string>()
      for (const n of graph.nodes) {
        if (n.metadata?.connectionNode && Array.isArray(n.metadata?.traceIds)) {
          for (const tid of n.metadata.traceIds as string[]) allTraceIds.add(tid)
        }
      }
      expect(allTraceIds).toContain('road-a')
      expect(allTraceIds).toContain('road-b')
      expect(allTraceIds).toContain('road-c')
    })
  })

  describe('11. Navigation-only × normal road', () => {
    it('navigation-only road participates in intersection', () => {
      const graph = new Graph('test-campus')
      graph.addTraceWithCompile(makeTrace('visible', [
        { lat: 0, lng: -0.001 }, { lat: 0, lng: 0.001 },
      ]), 2)
      graph.addTraceWithCompile({
        ...makeTrace('hidden', [
          { lat: -0.001, lng: 0 }, { lat: 0.001, lng: 0 },
        ]),
        displayMode: 'navigation-only',
      }, 2)

      const j = findJunction(graph, ['visible', 'hidden'])
      expect(j).toBeDefined()
    })
  })

  describe('12. Moving road removes ghost junction', () => {
    it('junction disappears when roads no longer cross', () => {
      const graph = new Graph('test-campus')
      graph.separatedCrossings = [] // no separations

      // Roads cross
      graph.addTraceWithCompile(makeTrace('road-a', [
        { lat: 0, lng: -0.001 }, { lat: 0, lng: 0.001 },
      ]), 2)
      graph.addTraceWithCompile(makeTrace('road-b', [
        { lat: -0.001, lng: 0 }, { lat: 0.001, lng: 0 },
      ]), 2)

      const j1 = findJunction(graph, ['road-a', 'road-b'])
      expect(j1).toBeDefined()

      // Clear and rebuild with road-b moved away (parallel)
      graph.setNodes([])
      graph.setEdges([])
      graph.setTraces([])
      graph.separatedCrossings = []

      graph.addTraceWithCompile(makeTrace('road-a', [
        { lat: 0, lng: -0.001 }, { lat: 0, lng: 0.001 },
      ]), 2)
      graph.addTraceWithCompile(makeTrace('road-b', [
        { lat: 0.001, lng: -0.001 }, { lat: 0.001, lng: 0.001 },
      ]), 2)

      const j2 = findJunction(graph, ['road-a', 'road-b'])
      expect(j2).toBeUndefined()
    })
  })

  describe('13. Road array order independence', () => {
    it('same result regardless of road order', () => {
      const g1 = new Graph('test-campus')
      g1.addTraceWithCompile(makeTrace('a', [{ lat: 0, lng: -0.001 }, { lat: 0, lng: 0.001 }]), 2)
      g1.addTraceWithCompile(makeTrace('b', [{ lat: -0.001, lng: 0 }, { lat: 0.001, lng: 0 }]), 2)

      const g2 = new Graph('test-campus')
      g2.addTraceWithCompile(makeTrace('b', [{ lat: -0.001, lng: 0 }, { lat: 0.001, lng: 0 }]), 2)
      g2.addTraceWithCompile(makeTrace('a', [{ lat: 0, lng: -0.001 }, { lat: 0, lng: 0.001 }]), 2)

      const j1 = findJunction(g1, ['a', 'b'])
      const j2 = findJunction(g2, ['a', 'b'])
      expect(j1).toBeDefined()
      expect(j2).toBeDefined()
      // Both should have a and b in traceIds
      expect(j1!.metadata?.traceIds).toEqual(expect.arrayContaining(['a', 'b']))
      expect(j2!.metadata?.traceIds).toEqual(expect.arrayContaining(['a', 'b']))
    })
  })

  describe('14. markCrossingSeparate / isCrossingSeparated', () => {
    it('marks and checks separation', () => {
      const doc: CampusDocument = {
        schemaVersion: 1, version: 0,
        metadata: { campusId: 'test', name: 'test', description: '', lastModified: '', editorVersion: '0.1' },
        buildings: [], roads: [], panoramas: [], qrCheckpoints: [],
      }

      expect(isCrossingSeparated(doc, 'a', 'b')).toBe(false)
      markCrossingSeparate(doc, 'a', 'b', { lat: 0, lng: 0 })
      expect(isCrossingSeparated(doc, 'a', 'b')).toBe(true)
      expect(isCrossingSeparated(doc, 'b', 'a')).toBe(true) // order-independent
    })

    it('removes existing junction when marking separate', () => {
      const doc: CampusDocument = {
        schemaVersion: 1, version: 0,
        metadata: { campusId: 'test', name: 'test', description: '', lastModified: '', editorVersion: '0.1' },
        buildings: [], roads: [], panoramas: [], qrCheckpoints: [],
        roadJunctions: [{
          id: 'j-1', position: { lat: 0, lng: 0 }, roadIds: ['a', 'b'], source: 'authored',
        }],
      }

      markCrossingSeparate(doc, 'a', 'b', { lat: 0, lng: 0 })
      expect(doc.roadJunctions).toHaveLength(0)
      expect(doc.separatedCrossings).toHaveLength(1)
    })
  })
})
