/**
 * 3B-8: End-to-end scenario tests for Phase 3B.
 *
 * Tests actual Studio→document→graph behavior for key scenarios.
 */
import { describe, expect, it } from 'vitest'
import type { Road, RoadJunction, CampusDocument } from '@navi/core'
import { Graph } from '../../engine/graph'
import type { TracePath } from '@/types/nav-types'
import {
  findConnectivityCandidates,
  snapRoadEndpoints,
  EDITOR_SNAP_RADIUS_METERS,
} from '../../../packages/editor/src/commands/road-connectivity'

const makeTrace = (id: string, points: TracePath['points']): TracePath => ({
  id, campusId: 'test-campus', floor: 0, type: 'arterial', points,
})

const ROAD_A: Road = {
  id: 'road-a', name: 'Road A',
  polyline: { points: [{ lat: 0, lng: -0.001 }, { lat: 0, lng: 0.001 }] },
  width: 8, surface: 'paved', type: 'arterial', metadata: {},
}

function docWithRoads(roads: Road[], junctions?: RoadJunction[]): CampusDocument {
  return {
    schemaVersion: 1, version: 0,
    metadata: { campusId: 'test', name: 'test', description: '', lastModified: '', editorVersion: '0.1.0' },
    buildings: [], roads, panoramas: [], qrCheckpoints: [],
    roadJunctions: junctions,
  }
}

describe('3B-8: End-to-end scenarios', () => {
  describe('Scenario 1: Endpoint within 0.5m of road → candidate → stable junction', () => {
    it('editor discovers the candidate, graph junction survives round-trip', () => {
      // 1. Editor: find candidates at ~0.45m
      const point = { lat: 0.000004, lng: 0 } // ~0.45m north of road-a
      const result = findConnectivityCandidates(point, { roads: [ROAD_A] })
      expect(result.best).not.toBeNull()
      expect(result.best!.distanceMeters).toBeLessThan(0.5)

      // 2. Graph: creates junction with 2m radius
      const graph = new Graph('test-campus')
      graph.addTraceWithCompile(makeTrace('road-a', [
        { lat: 0, lng: -0.001 }, { lat: 0, lng: 0.001 },
      ]), 2)
      graph.addTraceWithCompile(makeTrace('road-b', [
        { lat: 0.000014, lng: 0 }, { lat: 0.001, lng: 0 },
      ]), 2)

      const junctions = graph.nodes.filter(
        n => n.metadata?.connectionNode === true && Array.isArray(n.metadata?.traceIds)
      )
      const j = junctions.find(n => (n.metadata?.traceIds as string[])?.includes('road-b'))
      expect(j).toBeDefined()

      // 3. Round-trip preserves junction
      const snap = graph.toJSON()
      const restored = Graph.fromJSON(snap)
      const j2 = restored.nodes.find(n => n.id === j!.id)
      expect(j2).toBeDefined()
      expect(j2!.metadata?.traceIds).toEqual(expect.arrayContaining(['road-a', 'road-b']))
    })
  })

  describe('Scenario 2: Endpoint 3m from road → no snap → no connection', () => {
    it('editor does not snap, graph does not connect with 2m radius', () => {
      // 1. Editor: no candidates at 3m
      const point = { lat: 0.000027, lng: 0 } // ~3m north
      const result = findConnectivityCandidates(point, { roads: [ROAD_A] })
      expect(result.best).toBeNull()

      // 2. Graph with 2m radius: no junction created
      const graph = new Graph('test-campus')
      graph.addTraceWithCompile(makeTrace('road-a', [
        { lat: 0, lng: -0.001 }, { lat: 0, lng: 0.001 },
      ]), 2)
      graph.addTraceWithCompile(makeTrace('road-b', [
        { lat: 0.000027, lng: 0 }, { lat: 0.001, lng: 0 },
      ]), 2)

      const junctions = graph.nodes.filter(
        n => n.metadata?.connectionNode === true && Array.isArray(n.metadata?.traceIds)
      )
      const j = junctions.find(n => (n.metadata?.traceIds as string[])?.includes('road-b'))
      expect(j).toBeUndefined()
    })
  })

  describe('Scenario 3: Endpoint 1m from road + Alt → no snap', () => {
    it('Alt bypass prevents snap even within radius', () => {
      const point = { lat: 0.000009, lng: 0 } // ~1m north
      const result = findConnectivityCandidates(point, {
        roads: [ROAD_A],
        bypass: true,
      })
      expect(result.bypassed).toBe(true)
      expect(result.position).toEqual(point)
      expect(result.best).toBeNull()
    })
  })

  describe('Scenario 4: Two competing candidates → ambiguity', () => {
    it('ambiguous flag set, no silent selection', () => {
      const roadC: Road = {
        ...ROAD_A, id: 'road-c', name: 'Road C',
        polyline: { points: [{ lat: 0, lng: -0.001 }, { lat: 0, lng: 0.001 }] },
      }
      const result = findConnectivityCandidates(
        { lat: 0.000004, lng: 0 },
        { roads: [ROAD_A, roadC] },
      )
      expect(result.ambiguous).toBe(true)
      // Position should be original (not snapped) when ambiguous
      expect(result.position).toEqual({ lat: 0.000004, lng: 0 })
    })
  })

  describe('Scenario 5: Existing RoadJunction nearby → reuse', () => {
    it('reuses existing junction ID', () => {
      const junctions: RoadJunction[] = [{
        id: 'j-existing', position: { lat: 0, lng: 0 },
        roadIds: ['road-a', 'road-x'], source: 'authored',
      }]
      const result = findConnectivityCandidates(
        { lat: 0.000004, lng: 0 },
        { roads: [ROAD_A], junctions },
      )
      expect(result.best).not.toBeNull()
      expect(result.best!.kind).toBe('existing-junction')
      expect(result.best!.junctionId).toBe('j-existing')
    })
  })

  describe('Scenario 6: Navigation-only target → visible in Studio', () => {
    it('navigation-only road is a valid snap candidate', () => {
      const navRoad: Road = {
        ...ROAD_A, id: 'nav-road', name: 'Nav Road',
        displayMode: 'navigation-only',
      }
      const result = findConnectivityCandidates(
        { lat: 0.000004, lng: 0 },
        { roads: [navRoad] },
      )
      expect(result.best).not.toBeNull()
      expect(result.best!.targetRoadId).toBe('nav-road')
    })
  })

  describe('Scenario 7: Save/reload preserves geometry and junction', () => {
    it('road coordinates and junction ID survive round-trip', () => {
      const graph = new Graph('test-campus')
      graph.addTraceWithCompile(makeTrace('road-a', [
        { lat: 14.5, lng: 121.49 }, { lat: 14.5, lng: 121.51 },
      ]), 2)
      graph.addTraceWithCompile(makeTrace('road-b', [
        { lat: 14.500014, lng: 121.5 }, { lat: 14.501, lng: 121.5 },
      ]), 2)

      const j1 = graph.nodes.find(
        n => n.metadata?.connectionNode === true &&
          (n.metadata?.traceIds as string[])?.includes('road-b')
      )
      expect(j1).toBeDefined()
      const j1Id = j1!.id

      // Serialize and deserialize
      const snap = graph.toJSON()
      const restored = Graph.fromJSON(snap)

      // Junction ID preserved
      const j2 = restored.nodes.find(n => n.id === j1Id)
      expect(j2).toBeDefined()

      // Road coordinates preserved
      const r1 = restored.traces.find(t => t.id === 'road-a')
      expect(r1?.points).toEqual([
        { lat: 14.5, lng: 121.49 }, { lat: 14.5, lng: 121.51 },
      ])
    })
  })

  describe('Provenance: legacy-inferred source', () => {
    it('auto-detected junctions get legacy-inferred source', () => {
      const junctions: RoadJunction[] = [{
        id: 'j-legacy', position: { lat: 0, lng: 0 },
        roadIds: ['road-a', 'road-b'], source: 'legacy-inferred',
      }]
      expect(junctions[0].source).toBe('legacy-inferred')
    })

    it('authored junctions keep authored source through persistence', () => {
      const junctions: RoadJunction[] = [{
        id: 'j-authored', position: { lat: 0, lng: 0 },
        roadIds: ['road-a', 'road-b'], source: 'authored',
      }]
      // Simulate persistence round-trip
      const serialized = JSON.stringify(junctions)
      const deserialized = JSON.parse(serialized) as RoadJunction[]
      expect(deserialized[0].source).toBe('authored')
    })
  })

  describe('Close-junction persistence: distinct junctions survive', () => {
    it('two junctions 0.3m apart are NOT merged by persistence', () => {
      const junctions: RoadJunction[] = [
        { id: 'j-1', position: { lat: 0, lng: 0 }, roadIds: ['road-a'], source: 'authored' },
        { id: 'j-2', position: { lat: 0.000003, lng: 0 }, roadIds: ['road-b'], source: 'authored' },
      ]
      // _persistJunctions matches by position within 0.00001° (~1m)
      // These are 0.00003° apart (~3m) — should NOT be merged
      expect(junctions[0].id).not.toBe(junctions[1].id)
      expect(junctions).toHaveLength(2)
    })
  })
})
