import { describe, it, expect, vi, beforeEach } from 'vitest'
import { emitGraph } from '../emitter'
import type { ConnectivityGraph, WaypointNode, POINode, TransitionNode, EntrancePortalNode, SkeletonEdge, AccessEdge, TransitionEdge, PortalEdge } from '../types'

vi.mock('@navi/core', () => {
  const actual = vi.importActual('@navi/core')
  return {
    ...actual,
    haversineDistance: vi.fn(() => { throw new Error('SPATIAL_SEARCH_CALLED') }),
  }
})

import { haversineDistance } from '@navi/core'

function makeWp(id: string, floor = 0, buildingId = 'b1', lat = 14.0, lng = 121.0): WaypointNode {
  return { id, kind: 'waypoint', position: { lat, lng }, floor, buildingId, source: { entityId: id, entityType: 'waypoint', generatorId: 'test' } }
}

function makePOI(id: string, label = 'POI', floor = 0, buildingId = 'b1'): POINode {
  return { id, kind: 'poi', label, position: { lat: 14.0, lng: 121.0 }, floor, buildingId, poiCategory: 'room', source: { entityId: id, entityType: 'poi', generatorId: 'test' } }
}

function makeTransition(id: string, floor = 0, buildingId = 'b1', behavior = 'stairs'): TransitionNode {
  return { id, kind: 'transition', position: { lat: 14.0, lng: 121.0 }, floor, buildingId, connectorId: 'c1', stopId: `${id}_stop`, behavior, accessible: true, baseCost: 15, source: { entityId: id, entityType: 'transition', generatorId: 'test' } }
}

function makeEntrancePortal(id: string, floor = 0, buildingId = 'b1'): EntrancePortalNode {
  return { id, kind: 'entrance_portal', position: { lat: 14.00005, lng: 121.00005 }, outdoorPosition: { lat: 14.0, lng: 121.0 }, indoorPosition: { lat: 14.0001, lng: 121.0001 }, floor, buildingId, entranceId: `${id}_ent`, accessible: true, source: { entityId: `${id}_ent`, entityType: 'entrance', generatorId: 'test' } }
}

function makeSk(id: string, from: string, to: string, distance = 10): SkeletonEdge {
  return { id, kind: 'skeleton', from, to, distance, source: { entityId: id, entityType: 'skeleton', generatorId: 'test' } }
}

function makeAe(id: string, from: string, to: string, distance = 5): AccessEdge {
  return { id, kind: 'access', from, to, distance, accessType: 'door', source: { entityId: id, entityType: 'access', generatorId: 'test' } }
}

function makeTe(id: string, from: string, to: string, behavior = 'stairs', distance = 3): TransitionEdge {
  return { id, kind: 'transition', from, to, behavior, baseCost: 15, distance, source: { entityId: id, entityType: 'transition', generatorId: 'test' } }
}

function makePe(id: string, nodeId: string, distance = 1): PortalEdge {
  return { id, kind: 'portal', nodeId, distance, source: { entityId: id, entityType: 'portal', generatorId: 'test' } }
}

function makeGraph(overrides?: Partial<ConnectivityGraph>): ConnectivityGraph {
  return {
    nodes: [],
    edges: [],
    metadata: { campusId: 'spy-test', buildingCount: 1, floorCount: 1, generatedAt: 0 },
    diagnostics: [],
    ...overrides,
  }
}

describe('emitGraph spatial spy (AC4)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls zero spatial functions during Phase 3.3 emit', () => {
    const wp1 = makeWp('wp1', 0, 'b1', 14.0, 121.0)
    const wp2 = makeWp('wp2', 0, 'b1', 14.001, 121.001)
    const poi = makePOI('poi1', 'Room', 0, 'b1')
    const tn = makeTransition('t1', 1, 'b1', 'stairs')
    const ep = makeEntrancePortal('ep1')
    const sk = makeSk('sk1', 'wp1', 'wp2', 10)
    const ae = makeAe('ae1', 'poi1', 'wp1', 5)
    const te = makeTe('te1', 'wp1', 't1', 'stairs', 3)
    const pe = makePe('pe1', 'ep1', 1)

    const graph = makeGraph({
      nodes: [wp1, wp2, poi, tn, ep],
      edges: [sk, ae, te, pe],
      metadata: { campusId: 'spy-test', buildingCount: 1, floorCount: 2, generatedAt: 0 },
    })

    const result = emitGraph(graph)

    expect(haversineDistance).not.toHaveBeenCalled()
    expect(result.nodes.length).toBeGreaterThan(0)
    expect(result.edges.length).toBeGreaterThan(0)
  })

  it('calls zero spatial functions on a minimal graph', () => {
    const wp = makeWp('wp1')
    const graph = makeGraph({ nodes: [wp] })

    emitGraph(graph)

    expect(haversineDistance).not.toHaveBeenCalled()
  })

  it('calls zero spatial functions on an entrance-only graph', () => {
    const ep = makeEntrancePortal('ep1')
    const pe = makePe('pe1', 'ep1', 1)
    const graph = makeGraph({ nodes: [ep], edges: [pe] })

    emitGraph(graph)

    expect(haversineDistance).not.toHaveBeenCalled()
  })

  it('completes emit normally with the spatial spy active', () => {
    const wp1 = makeWp('wp1')
    const wp2 = makeWp('wp2')
    const sk = makeSk('sk1', 'wp1', 'wp2', 5)
    const graph = makeGraph({ nodes: [wp1, wp2], edges: [sk] })

    expect(() => emitGraph(graph)).not.toThrow()
  })
})
