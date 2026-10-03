import { describe, it, expect } from 'vitest'
import { validateConnectivity } from '../connectivity/validator'
import type { ConnectivityGraph, WaypointNode, EntrancePortalNode, SkeletonEdge, PortalEdge } from '../types'

function makeWaypoint(id: string, entityId?: string, floor = 0, buildingId = 'b1'): WaypointNode {
  return { id, kind: 'waypoint', position: { lat: 14.0, lng: 121.0 }, floor, buildingId, source: { entityId: entityId || id, entityType: 'waypoint', generatorId: 'test' } }
}

function makeEntrancePortal(id: string): EntrancePortalNode {
  return { id, kind: 'entrance_portal', position: { lat: 14.0, lng: 121.0 }, outdoorPosition: { lat: 14.0, lng: 121.0 }, indoorPosition: { lat: 14.001, lng: 121.001 }, floor: 0, buildingId: 'b1', entranceId: `${id}_ent`, accessible: true, source: { entityId: `${id}_ent`, entityType: 'entrance', generatorId: 'test' } }
}

function makeSkeletonEdge(id: string, from: string, to: string, distance = 10): SkeletonEdge {
  return { id, kind: 'skeleton', from, to, distance, source: { entityId: id, entityType: 'skeleton', generatorId: 'test' } }
}

function makePortalEdge(id: string, nodeId: string, distance = 1): PortalEdge {
  return { id, kind: 'portal', nodeId, distance, source: { entityId: id, entityType: 'portal', generatorId: 'test' } }
}

function makeGraph(overrides?: Partial<ConnectivityGraph>): ConnectivityGraph {
  return {
    nodes: [],
    edges: [],
    metadata: { campusId: 'campus-1', buildingCount: 1, floorCount: 1, generatedAt: 0 },
    diagnostics: [],
    ...overrides,
  }
}

describe('validateConnectivity', () => {
  it('returns zero diagnostics for a connected graph with entrance', () => {
    const ep = makeEntrancePortal('ep1')
    const wp1 = makeWaypoint('wp1')
    const wp2 = makeWaypoint('wp2')
    const sk = makeSkeletonEdge('sk1', 'ep1', 'wp1', 5)
    const sk2 = makeSkeletonEdge('sk2', 'wp1', 'wp2', 10)
    const pe = makePortalEdge('pe1', 'ep1', 1)
    const graph = makeGraph({ nodes: [ep, wp1, wp2], edges: [sk, sk2, pe] })
    const report = validateConnectivity(graph)
    expect(report.diagnostics.filter(d => d.severity === 'error')).toEqual([])
  })

  it('detects an orphan waypoint with zero incident edges', () => {
    const wp = makeWaypoint('orphan-wp', 'entity-orphan')
    const graph = makeGraph({ nodes: [wp] })
    const report = validateConnectivity(graph)
    const orphans = report.diagnostics.filter(d => d.code === 'SKELETON_DANGLING')
    expect(orphans.length).toBe(1)
    expect(orphans[0].sourceEntityId).toBe('entity-orphan')
    expect(orphans[0].severity).toBe('warning')
  })

  it('detects a dangling edge referencing a non-existent node', () => {
    const wp = makeWaypoint('wp1')
    const sk = makeSkeletonEdge('sk1', 'wp1', 'ghost-node', 10)
    const graph = makeGraph({ nodes: [wp], edges: [sk] })
    const report = validateConnectivity(graph)
    const dangles = report.diagnostics.filter(d => d.code === 'EDGE_ORPHANED')
    expect(dangles.length).toBe(1)
    expect(dangles[0].severity).toBe('error')
  })

  it('detects disconnected component not reachable from entrance', () => {
    const ep = makeEntrancePortal('ep1')
    const wp1 = makeWaypoint('reachable-wp')
    const wp2 = makeWaypoint('isolated-wp')
    const sk = makeSkeletonEdge('sk1', 'ep1', 'wp1', 10)
    // wp2 has no edge connecting it to ep1/wp1
    const graph = makeGraph({ nodes: [ep, wp1, wp2], edges: [sk] })
    const report = validateConnectivity(graph)
    const disconn = report.diagnostics.filter(d => d.code === 'HALLWAY_DISCONNECTED')
    expect(disconn.length).toBeGreaterThanOrEqual(1)
  })

  it('reports correct metrics for a healthy graph', () => {
    const ep = makeEntrancePortal('ep1')
    const wp1 = makeWaypoint('wp1'); const wp2 = makeWaypoint('wp2'); const wp3 = makeWaypoint('wp3')
    const sk1 = makeSkeletonEdge('sk1', 'ep1', 'wp1', 5)
    const sk2 = makeSkeletonEdge('sk2', 'wp1', 'wp2', 5)
    const sk3 = makeSkeletonEdge('sk3', 'wp2', 'wp3', 5)
    const pe = makePortalEdge('pe1', 'ep1', 1)
    const graph = makeGraph({ nodes: [ep, wp1, wp2, wp3], edges: [sk1, sk2, sk3, pe] })
    const report = validateConnectivity(graph)
    expect(report.metrics.reachableWaypoints).toBe(3)
    expect(report.metrics.orphanedWaypoints).toBe(0)
    expect(report.metrics.disconnectedComponents).toBe(0)
  })

  it('reports metrics with orphaned waypoints', () => {
    const ep = makeEntrancePortal('ep1')
    const wp1 = makeWaypoint('wp1')
    const wp2 = makeWaypoint('orphan-wp') // no edges
    const sk = makeSkeletonEdge('sk1', 'ep1', 'wp1', 5)
    const pe = makePortalEdge('pe1', 'ep1', 1)
    const graph = makeGraph({ nodes: [ep, wp1, wp2], edges: [sk, pe] })
    const report = validateConnectivity(graph)
    expect(report.metrics.orphanedWaypoints).toBe(1)
    expect(report.metrics.reachableWaypoints).toBe(1)
  })

  it('is read-only: does not mutate the input graph', () => {
    const wp = makeWaypoint('wp1')
    const sk = makeSkeletonEdge('sk1', 'wp1', 'wp2', 10)
    const graph = makeGraph({ nodes: [wp], edges: [sk] })
    const before = JSON.stringify(graph)
    validateConnectivity(graph)
    expect(JSON.stringify(graph)).toBe(before)
  })

  it('ignores portal edges for incident count (orphan detection)', () => {
    // A waypoint connected only by portal edges should be orphaned
    const ep = makeEntrancePortal('ep1')
    const wp = makeWaypoint('orphan-wp') // only incident is portal, not counted
    const pe = makePortalEdge('pe1', 'ep1', 1)
    const graph = makeGraph({ nodes: [ep, wp], edges: [pe] })
    const report = validateConnectivity(graph)
    const orphans = report.diagnostics.filter(d => d.code === 'SKELETON_DANGLING')
    expect(orphans.length).toBe(1)
  })

  it('passes validation for graph with multiple entrances', () => {
    const ep1 = makeEntrancePortal('ep1')
    const ep2 = makeEntrancePortal('ep2')
    const wp1 = makeWaypoint('wp1'); const wp2 = makeWaypoint('wp2')
    const sk1 = makeSkeletonEdge('sk1', 'ep1', 'wp1', 5)
    const sk2 = makeSkeletonEdge('sk2', 'wp1', 'wp2', 10)
    const pe1 = makePortalEdge('pe1', 'ep1', 1)
    const pe2 = makePortalEdge('pe2', 'ep2', 1)
    const graph = makeGraph({ nodes: [ep1, ep2, wp1, wp2], edges: [sk1, sk2, pe1, pe2] })
    const report = validateConnectivity(graph)
    expect(report.diagnostics.filter(d => d.severity === 'error')).toEqual([])
    expect(report.metrics.reachableWaypoints).toBe(2)
  })
})
