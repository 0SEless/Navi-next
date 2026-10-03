import { describe, it, expect } from 'vitest'
import { emitGraph } from '../emitter'
import type { ConnectivityGraph, WaypointNode, POINode, TransitionNode, EntrancePortalNode, SkeletonEdge, AccessEdge, TransitionEdge, PortalEdge } from '../types'

function makeWaypoint(id: string, floor = 0, buildingId = 'b1', lat = 14.0, lng = 121.0): WaypointNode {
  return { id, kind: 'waypoint', position: { lat, lng }, floor, buildingId, source: { entityId: id, entityType: 'waypoint', generatorId: 'test' } }
}

function makePOI(id: string, label = 'POI', floor = 0, buildingId = 'b1'): POINode {
  return { id, kind: 'poi', label, position: { lat: 14.0, lng: 121.0 }, floor, buildingId, poiCategory: 'room', source: { entityId: id, entityType: 'poi', generatorId: 'test' } }
}

function makeTransition(id: string, floor = 0, buildingId = 'b1', behavior = 'stairs', baseCost = 15): TransitionNode {
  return { id, kind: 'transition', position: { lat: 14.0, lng: 121.0 }, floor, buildingId, connectorId: 'c1', stopId: `${id}_stop`, behavior, accessible: true, baseCost, source: { entityId: id, entityType: 'transition', generatorId: 'test' } }
}

function makeEntrancePortal(id: string, floor = 0, buildingId = 'b1', outdoorLat = 14.0, outdoorLng = 121.0, indoorLat = 14.0001, indoorLng = 121.0001): EntrancePortalNode {
  return { id, kind: 'entrance_portal', position: { lat: (outdoorLat + indoorLat) / 2, lng: (outdoorLng + indoorLng) / 2 }, outdoorPosition: { lat: outdoorLat, lng: outdoorLng }, indoorPosition: { lat: indoorLat, lng: indoorLng }, floor, buildingId, entranceId: `${id}_ent`, accessible: true, source: { entityId: `${id}_ent`, entityType: 'entrance', generatorId: 'test' } }
}

function makeSkeletonEdge(id: string, from: string, to: string, distance = 10): SkeletonEdge {
  return { id, kind: 'skeleton', from, to, distance, source: { entityId: id, entityType: 'skeleton', generatorId: 'test' } }
}

function makeAccessEdge(id: string, from: string, to: string, distance = 5): AccessEdge {
  return { id, kind: 'access', from, to, distance, accessType: 'door', source: { entityId: id, entityType: 'access', generatorId: 'test' } }
}

function makeTransitionEdge(id: string, from: string, to: string, behavior = 'stairs', baseCost = 15, distance = 3): TransitionEdge {
  return { id, kind: 'transition', from, to, behavior, baseCost, distance, source: { entityId: id, entityType: 'transition', generatorId: 'test' } }
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

describe('emitGraph', () => {
  it('maps a waypoint node to a NavNode with type waypoint', () => {
    const wp = makeWaypoint('wp1', 0, 'b1', 14.5, 121.5)
    const graph = makeGraph({ nodes: [wp], metadata: { ...makeGraph().metadata, campusId: 'c1' } })
    const result = emitGraph(graph)
    const nav = result.nodes.find(n => n.buildingId === 'b1')
    expect(nav).toBeDefined()
    expect(nav!.type).toBe('waypoint')
    expect(nav!.position).toEqual({ lat: 14.5, lng: 121.5 })
    expect(nav!.floor).toBe(0)
    expect(nav!.buildingId).toBe('b1')
  })

  it('maps a POI node to a NavNode with type poi and preserves label', () => {
    const poi = makePOI('poi1', 'Room 101', 1, 'b1')
    const graph = makeGraph({ nodes: [poi] })
    const result = emitGraph(graph)
    const nav = result.nodes.find(n => n.label === 'Room 101')
    expect(nav).toBeDefined()
    expect(nav!.type).toBe('poi')
    expect(nav!.buildingId).toBe('b1')
    expect(nav!.floor).toBe(1)
  })

  it('maps a transition node to a NavNode with type transition', () => {
    const tn = makeTransition('t1', 1, 'b1', 'elevator', 20)
    const graph = makeGraph({ nodes: [tn] })
    const result = emitGraph(graph)
    const nav = result.nodes.find(n => n.type === 'transition')
    expect(nav).toBeDefined()
    expect(nav!.floor).toBe(1)
  })

  it('emits TWO NavNodes for an entrance_portal (outdoor + entrance)', () => {
    const ep = makeEntrancePortal('ep1', 0, 'b1', 14.0, 121.0, 14.001, 121.001)
    const graph = makeGraph({ nodes: [ep] })
    const result = emitGraph(graph)
    const outdoor = result.nodes.find(n => n.type === 'outdoor')
    const entrance = result.nodes.find(n => n.type === 'entrance')
    expect(outdoor).toBeDefined()
    expect(entrance).toBeDefined()
    expect(outdoor!.position).toEqual({ lat: 14.0, lng: 121.0 })
    expect(entrance!.position).toEqual({ lat: 14.001, lng: 121.001 })
    expect(outdoor!.buildingId).toBe('b1')
    expect(entrance!.buildingId).toBe('b1')
  })

  it('emits a portal edge connecting outdoor → entrance', () => {
    const ep = makeEntrancePortal('ep1')
    const pe = makePortalEdge('pe1', 'ep1', 2)
    const graph = makeGraph({ nodes: [ep], edges: [pe] })
    const result = emitGraph(graph)
    const outdoor = result.nodes.find(n => n.type === 'outdoor')!
    const entrance = result.nodes.find(n => n.type === 'entrance')!
    const portalEdge = result.edges.find(e => e.from === outdoor.id && e.to === entrance.id)
    expect(portalEdge).toBeDefined()
    expect(portalEdge!.type).toBe('walk')
    expect(portalEdge!.distance).toBe(2)
  })

  it('maps a skeleton edge to a walk NavEdge', () => {
    const wp1 = makeWaypoint('wp1', 0, 'b1', 14.0, 121.0)
    const wp2 = makeWaypoint('wp2', 0, 'b1', 14.001, 121.001)
    const sk = makeSkeletonEdge('sk1', 'wp1', 'wp2', 15)
    const graph = makeGraph({ nodes: [wp1, wp2], edges: [sk] })
    const result = emitGraph(graph)
    const navEdge = result.edges.find(e => e.distance === 15)
    expect(navEdge).toBeDefined()
    expect(navEdge!.type).toBe('walk')
    expect(navEdge!.weight).toBe(15)
  })

  it('maps an access edge to a walk NavEdge', () => {
    const wp1 = makeWaypoint('wp1')
    const wp2 = makeWaypoint('wp2')
    const ae = makeAccessEdge('ae1', 'wp1', 'wp2', 3)
    const graph = makeGraph({ nodes: [wp1, wp2], edges: [ae] })
    const result = emitGraph(graph)
    const navEdge = result.edges.find(e => e.distance === 3)
    expect(navEdge).toBeDefined()
    expect(navEdge!.type).toBe('walk')
  })

  describe('transition edge behavior mapping', () => {
    it('maps stairs behavior to stairs NavEdge type', () => {
      const wp1 = makeWaypoint('wp1'); const wp2 = makeWaypoint('wp2')
      const te = makeTransitionEdge('te1', 'wp1', 'wp2', 'stairs', 15, 4)
      const graph = makeGraph({ nodes: [wp1, wp2], edges: [te] })
      const result = emitGraph(graph)
      expect(result.edges.find(e => e.type === 'stairs')).toBeDefined()
    })

    it('maps elevator behavior to elevator NavEdge type', () => {
      const wp1 = makeWaypoint('wp1'); const wp2 = makeWaypoint('wp2')
      const te = makeTransitionEdge('te1', 'wp1', 'wp2', 'elevator', 20, 4)
      const graph = makeGraph({ nodes: [wp1, wp2], edges: [te] })
      const result = emitGraph(graph)
      expect(result.edges.find(e => e.type === 'elevator')).toBeDefined()
    })

    it('maps escalator behavior to transition NavEdge type', () => {
      const wp1 = makeWaypoint('wp1'); const wp2 = makeWaypoint('wp2')
      const te = makeTransitionEdge('te1', 'wp1', 'wp2', 'escalator', 10, 4)
      const graph = makeGraph({ nodes: [wp1, wp2], edges: [te] })
      const result = emitGraph(graph)
      expect(result.edges.find(e => e.type === 'transition')).toBeDefined()
    })

    it('maps ramp behavior to walk NavEdge type', () => {
      const wp1 = makeWaypoint('wp1'); const wp2 = makeWaypoint('wp2')
      const te = makeTransitionEdge('te1', 'wp1', 'wp2', 'ramp', 10, 4)
      const graph = makeGraph({ nodes: [wp1, wp2], edges: [te] })
      const result = emitGraph(graph)
      expect(result.edges.find(e => e.type === 'walk')).toBeDefined()
    })

    it('maps unknown behavior to walk NavEdge type', () => {
      const wp1 = makeWaypoint('wp1'); const wp2 = makeWaypoint('wp2')
      const te = makeTransitionEdge('te1', 'wp1', 'wp2', 'unknown' as any, 10, 4)
      const graph = makeGraph({ nodes: [wp1, wp2], edges: [te] })
      const result = emitGraph(graph)
      expect(result.edges.find(e => e.type === 'walk')).toBeDefined()
    })
  })

  it('uses baseCost as weight for transition edges', () => {
    const wp1 = makeWaypoint('wp1'); const wp2 = makeWaypoint('wp2')
    const te = makeTransitionEdge('te1', 'wp1', 'wp2', 'stairs', 25, 4)
    const graph = makeGraph({ nodes: [wp1, wp2], edges: [te] })
    const result = emitGraph(graph)
    const navEdge = result.edges.find(e => e.distance === 4)
    expect(navEdge).toBeDefined()
    expect(navEdge!.weight).toBe(25)
  })

  it('skips edges referencing non-existent nodes', () => {
    const wp = makeWaypoint('wp1')
    const sk = makeSkeletonEdge('sk1', 'wp1', 'nonexistent', 5)
    const graph = makeGraph({ nodes: [wp], edges: [sk] })
    const result = emitGraph(graph)
    expect(result.edges.length).toBe(0)
  })

  it('computes bounding box from all node positions', () => {
    const wp1 = makeWaypoint('wp1', 0, 'b1', 14.0, 121.0)
    const wp2 = makeWaypoint('wp2', 0, 'b1', 14.5, 122.0)
    const graph = makeGraph({ nodes: [wp1, wp2] })
    const result = emitGraph(graph)
    expect(result.metadata.boundingBox.minLat).toBe(14.0)
    expect(result.metadata.boundingBox.maxLat).toBe(14.5)
    expect(result.metadata.boundingBox.minLng).toBe(121.0)
    expect(result.metadata.boundingBox.maxLng).toBe(122.0)
  })

  it('sets metadata nodeCount and edgeCount correctly', () => {
    const wp = makeWaypoint('wp1'); const poi = makePOI('poi1')
    const sk = makeSkeletonEdge('sk1', 'wp1', 'poi1', 5)
    const graph = makeGraph({ nodes: [wp, poi], edges: [sk] })
    const result = emitGraph(graph)
    expect(result.metadata.nodeCount).toBe(2)
    expect(result.metadata.edgeCount).toBe(1)
  })

  it('returns empty result for empty graph', () => {
    const graph = makeGraph()
    const result = emitGraph(graph)
    expect(result.nodes).toEqual([])
    expect(result.edges).toEqual([])
    expect(result.metadata.nodeCount).toBe(0)
    expect(result.metadata.edgeCount).toBe(0)
    expect(result.metadata.boundingBox).toEqual({ minLng: 0, maxLng: 0, minLat: 0, maxLat: 0 })
  })

  it('sets version and campusId on the result', () => {
    const graph = makeGraph({ metadata: { ...makeGraph().metadata, campusId: 'campus-xyz' } })
    const result = emitGraph(graph)
    expect(result.version).toBe('1.0.0')
    expect(result.campusId).toBe('campus-xyz')
  })

  it('produces a non-empty checksum', () => {
    const wp = makeWaypoint('wp1')
    const graph = makeGraph({ nodes: [wp] })
    const result = emitGraph(graph)
    expect(result.checksum).toBeTruthy()
    expect(result.checksum.length).toBe(64) // sha256 hex
  })

  it('emits structurally equivalent output for same input (module-level seqId prevents byte-level checksum equality)', () => {
    // Module-level seqId means IDs differ between calls,
    // but structural properties (counts, metadata) are identical
    const wp = makeWaypoint('wp1'); const ep = makeEntrancePortal('ep1')
    const sk = makeSkeletonEdge('sk1', 'wp1', 'ep1', 5)
    const pe = makePortalEdge('pe1', 'ep1', 1)
    const graph = makeGraph({ nodes: [wp, ep], edges: [sk, pe], metadata: { ...makeGraph().metadata, campusId: 'det-test' } })
    const a = emitGraph(graph)
    const b = emitGraph(graph)
    expect(a.nodes.length).toBe(b.nodes.length)
    expect(a.edges.length).toBe(b.edges.length)
    expect(a.metadata).toEqual(b.metadata)
  })

  it('computes buildings and floors metadata', () => {
    const wp1 = makeWaypoint('wp1', 0, 'b1')
    const wp2 = makeWaypoint('wp2', 1, 'b1')
    const wp3 = makeWaypoint('wp3', 0, 'b2')
    const graph = makeGraph({ nodes: [wp1, wp2, wp3] })
    const result = emitGraph(graph)
    expect(result.metadata.buildings).toBe(2)
    expect(result.metadata.floors).toBe(3) // b1:0, b1:1, b2:0
  })
})
