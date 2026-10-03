/**
 * 3B-5: Characterize the 0.5m editor discovery radius vs the 5m legacy graph threshold.
 *
 * Scenario: Road B endpoint is 3m from Road A.
 * - Editor: 0.5m radius → no candidate → no authored connection
 * - Graph sync (legacy mode): 5m threshold can still derive a connection
 *
 * This test determines whether graph sync overrides the authored decision.
 */
import { describe, expect, it } from 'vitest'
import { Graph } from '../../engine/graph'
import type { TracePath } from '@/types/nav-types'
import { findConnectivityCandidates, EDITOR_SNAP_RADIUS_METERS } from '../../../packages/editor/src/commands/road-connectivity'

const makeTrace = (id: string, points: TracePath['points']): TracePath => ({
  id,
  campusId: 'test-campus',
  floor: 0,
  type: 'arterial',
  points,
})

describe('3B-5: 0.5m editor discovery vs 5m legacy graph', () => {
  it('editor does NOT discover at 3m (beyond 0.5m radius)', () => {
    // Road B endpoint ~3m north of Road A (0.000027° lat ≈ 3m)
    const roadBEndpoint = { lat: 0.000027, lng: 0 }
    const result = findConnectivityCandidates(roadBEndpoint, {
      roads: [{
        id: 'road-a', name: 'Road A',
        polyline: { points: [{ lat: 0, lng: -0.001 }, { lat: 0, lng: 0.001 }] },
        width: 8, surface: 'paved', type: 'arterial', metadata: {},
      }],
    })
    expect(result.best).toBeNull() // 3m > 0.5m → no candidate
    expect(EDITOR_SNAP_RADIUS_METERS).toBe(0.5)
  })

  it('graph sync does NOT create connection at 3m with 2m connectivity radius', () => {
    const graph = new Graph('test-campus')

    // Road A: east-west
    graph.addTraceWithCompile(makeTrace('road-a', [
      { lat: 0, lng: -0.001 },
      { lat: 0, lng: 0.001 },
    ]), 2) // 2m connectivity radius (Phase 3)

    // Road B: endpoint ~3m north of Road A (beyond 2m threshold)
    graph.addTraceWithCompile(makeTrace('road-b', [
      { lat: 0.000027, lng: 0 }, // ~3m north
      { lat: 0.001, lng: 0 },
    ]), 2) // 2m connectivity radius (Phase 3)

    // Check if graph created a junction
    const junctions = graph.nodes.filter(
      n => n.metadata?.connectionNode === true && Array.isArray(n.metadata?.traceIds)
    )
    const roadBJunction = junctions.find(j =>
      (j.metadata?.traceIds as string[])?.includes('road-b')
    )

    // With 2m radius, graph should NOT create connection at 3m
    expect(roadBJunction).toBeUndefined()
  })

  it('explicit-only graph sync does not connect an endpoint 10 cm from another trace', () => {
    const graph = new Graph('test-campus')

    graph.addTraceWithCompile(makeTrace('road-a', [
      { lat: 0, lng: -0.001 },
      { lat: 0, lng: 0.001 },
    ]), 2, false)
    graph.addTraceWithCompile(makeTrace('road-b', [
      { lat: 0.0000009, lng: 0 },
      { lat: 0.001, lng: 0 },
    ]), 2, false)

    const shared = graph.nodes.filter(node =>
      node.metadata?.connectionNode === true &&
      Array.isArray(node.metadata?.traceIds) &&
      (node.metadata.traceIds as string[]).includes('road-a') &&
      (node.metadata.traceIds as string[]).includes('road-b')
    )
    expect(shared).toHaveLength(0)
    expect(graph.connectedComponentCount).toBe(2)
  })

  it('graph sync DOES create connection at 3m with legacy 5m radius', () => {
    const graph = new Graph('test-campus')

    // Road A: east-west
    graph.addTraceWithCompile(makeTrace('road-a', [
      { lat: 0, lng: -0.001 },
      { lat: 0, lng: 0.001 },
    ]), 5) // 5m legacy radius

    // Road B: endpoint ~3m north of Road A
    graph.addTraceWithCompile(makeTrace('road-b', [
      { lat: 0.000027, lng: 0 }, // ~3m north
      { lat: 0.001, lng: 0 },
    ]), 5) // 5m legacy radius

    // With 5m radius, graph SHOULD create connection at 3m
    const junctions = graph.nodes.filter(
      n => n.metadata?.connectionNode === true && Array.isArray(n.metadata?.traceIds)
    )
    const roadBJunction = junctions.find(j =>
      (j.metadata?.traceIds as string[])?.includes('road-b')
    )
    expect(roadBJunction).toBeDefined()
  })

  it('characterizes: endpoint just inside the 0.5m discovery boundary', () => {
    // ~0.45m north — inside the 0.5m discovery radius
    const point = { lat: 0.000004, lng: 0 }
    const result = findConnectivityCandidates(point, {
      roads: [{
        id: 'road-a', name: 'Road A',
        polyline: { points: [{ lat: 0, lng: -0.001 }, { lat: 0, lng: 0.001 }] },
        width: 8, surface: 'paved', type: 'arterial', metadata: {},
      }],
    })
    expect(result.best).not.toBeNull()
    expect(result.best!.distanceMeters).toBeLessThanOrEqual(0.5)
  })
})
