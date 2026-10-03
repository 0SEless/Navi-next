import { describe, it, expect } from 'vitest'
import { NavigationService } from '../navigation-service'
import type { LoadedPackage, NavigationGraph, NavNode, NavEdge } from '@navi/core'

function makeGraph(nodes: NavNode[], edges: NavEdge[]): NavigationGraph {
  return {
    version: '1.0.0',
    campusId: 'test',
    createdAt: '',
    checksum: '',
    nodes,
    edges,
    metadata: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      buildings: 1,
      floors: 1,
      boundingBox: { minLat: 0, maxLat: 1, minLng: 0, maxLng: 1 },
    },
  }
}

function makePkg(graph: NavigationGraph): LoadedPackage {
  return {
    manifest: {
      schemaVersion: '1.0',
      campusId: 'test',
      campusName: 'Test',
      publishedAt: '',
      compilerVersion: '0.1.0',
      revision: '1',
      artifacts: {
        graph: { path: 'graph.json', checksum: '', size: 0, schemaVersion: '1.0' },
        search: { path: 'search.json', checksum: '', size: 0, schemaVersion: '1.0' },
        buildings: { path: 'building.json', checksum: '', size: 0, schemaVersion: '1.0' },
        poi: { path: 'poi.json', checksum: '', size: 0, schemaVersion: '1.0' },
      },
      metadata: { routeable: true, nodeCount: graph.nodes.length, edgeCount: graph.edges.length, buildings: 1, floors: 1, boundingBox: { minLat: 0, maxLat: 1, minLng: 0, maxLng: 1 } },
    },
    graph,
    reports: [],
  }
}

function testGraph(): LoadedPackage {
  const nodes: NavNode[] = [
    { id: 'a', label: 'Entrance A', type: 'transition', position: { lat: 14.5, lng: 121.0 }, floor: 0, buildingId: 'b1', properties: {} },
    { id: 'b', label: 'Node B', type: 'corridor', position: { lat: 14.5001, lng: 121.0 }, floor: 0, buildingId: 'b1', properties: {} },
    { id: 'c', label: 'Room C', type: 'space', position: { lat: 14.5002, lng: 121.0 }, floor: 0, buildingId: 'b1', properties: {} },
    { id: 'd', label: 'Node D', type: 'transition', position: { lat: 14.5003, lng: 121.0002 }, floor: 1, buildingId: 'b1', properties: {} },
    { id: 'e', label: 'Room E', type: 'space', position: { lat: 14.5004, lng: 121.0003 }, floor: 1, buildingId: 'b1', properties: {} },
  ]

  const edges: NavEdge[] = [
    { id: 'a-b', from: 'a', to: 'b', type: 'walk', distance: 11, weight: 11 },
    { id: 'b-c', from: 'b', to: 'c', type: 'walk', distance: 11, weight: 11 },
    { id: 'b-d', from: 'b', to: 'd', type: 'stairs', distance: 15, weight: 15 },
    { id: 'd-e', from: 'd', to: 'e', type: 'walk', distance: 11, weight: 11 },
  ]

  return makePkg(makeGraph(nodes, edges))
}

describe('NavigationService', () => {
  it('finds a route between connected nodes', () => {
    const svc = new NavigationService(testGraph())
    const route = svc.findRoute('a', 'c')
    expect(route).not.toBeNull()
    expect(route!.path.map(s => s.nodeId)).toEqual(['a', 'b', 'c'])
    expect(route!.totalDistance).toBeGreaterThan(0)
    expect(route!.travelTime.seconds).toBeGreaterThan(0)
    expect(route!.travelTime.formatted).toBeTruthy()
  })

  it('returns null for unreachable nodes', () => {
    const svc = new NavigationService(testGraph())
    expect(svc.findRoute('a', 'nonexistent')).toBeNull()
  })

  it('finds nearest node to a position', () => {
    const svc = new NavigationService(testGraph())
    const result = svc.nearestNode({ lat: 14.5001, lng: 121.0 })
    expect(result).not.toBeNull()
    expect(result!.nodeId).toBe('b')
    expect(result!.distance).toBeGreaterThanOrEqual(0)
  })

  it('nearestNode returns null for empty graph', () => {
    const empty = makePkg(makeGraph([], []))
    const svc = new NavigationService(empty)
    expect(svc.nearestNode({ lat: 0, lng: 0 })).toBeNull()
  })

  it('finds nearest entrance to a position', () => {
    const svc = new NavigationService(testGraph())
    const result = svc.nearestEntrance({ lat: 14.5, lng: 121.0 })
    expect(result).not.toBeNull()
    expect(result!.nodeId).toBe('a')
  })

  it('nearestEntrance returns null when no transition nodes exist', () => {
    const graph = makeGraph(
      [{ id: 'x', label: 'X', type: 'space', position: { lat: 0, lng: 0 }, floor: 0, buildingId: 'b1', properties: {} }],
      []
    )
    const svc = new NavigationService(makePkg(graph))
    expect(svc.nearestEntrance({ lat: 0, lng: 0 })).toBeNull()
  })

  it('isReachable returns true for connected nodes', () => {
    const svc = new NavigationService(testGraph())
    expect(svc.isReachable('a', 'c')).toBe(true)
  })

  it('isReachable returns false for nonexistent destination', () => {
    const svc = new NavigationService(testGraph())
    expect(svc.isReachable('a', 'nonexistent')).toBe(false)
  })

  it('isReachable returns false for disconnected nodes', () => {
    const graph = makeGraph(
      [{ id: 'a', label: 'A', type: 'space', position: { lat: 0, lng: 0 }, floor: 0, buildingId: 'b1', properties: {} },
       { id: 'b', label: 'B', type: 'space', position: { lat: 1, lng: 1 }, floor: 0, buildingId: 'b1', properties: {} }],
      []
    )
    const svc = new NavigationService(makePkg(graph))
    expect(svc.isReachable('a', 'b')).toBe(false)
  })

  it('route includes travelTime with formatted string', () => {
    const svc = new NavigationService(testGraph())
    const route = svc.findRoute('a', 'e')
    expect(route).not.toBeNull()
    expect(route!.travelTime.seconds).toBeGreaterThan(0)
    expect(route!.travelTime.minutes).toBeGreaterThanOrEqual(0)
    expect(route!.travelTime.formatted).toMatch(/^(\d+s|\d+m \d+s|\d+m)$/)
  })

  it('does not activate wheelchair filtering through legacy accessible preferences', () => {
    const pkg = testGraph()
    pkg.graph.edges[0].routing = {
      sourceRoadId: 'road-a-b',
      authoredOrientation: 'forward',
      authored: { wheelchairAccessible: false },
    }
    const svc = new NavigationService(pkg)

    expect(svc.findRoute('a', 'c', { mode: 'accessible' })).not.toBeNull()
  })
})
