import { describe, expect, it } from 'vitest'
import type { LatLng, NavEdge, NavNode, NavigationGraph, POI, POIIndex } from '@navi/core'
import { RoutingEngine } from '../routing-engine'

type PlannedPoiRoutingEngine = RoutingEngine & {
  findRouteToPOI?: (
    fromId: string,
    request: { destinationType: 'poi'; poiId: string },
    poiIndex: POIIndex,
  ) => {
    ok: boolean
    route?: { path: Array<{ nodeId: string; edgeId?: string }>; totalDistance: number; generalizedCost?: number; destination?: { entityId: string } }
    resolution?: { temporaryRoutingTargetId: string; candidate: { kind: string; networkId: string; projection?: number } }
    failure?: { code: string }
  }
}

function navNode(id: string, lng: number): NavNode {
  return {
    id,
    label: id,
    type: 'outdoor',
    position: { lat: 0, lng },
    floor: 0,
    buildingId: '',
    properties: {},
  }
}

function navEdge(
  id: string,
  from: string,
  to: string,
  distance: number,
  routing?: NavEdge['routing'],
): NavEdge {
  return {
    id,
    from,
    to,
    type: 'walk',
    distance,
    weight: distance,
    ...(routing ? { routing } : {}),
  }
}

function overlayFixture(options: { oneWay?: boolean; weight?: number } = {}): NavigationGraph {
  const nodes = [
    navNode('origin', -0.0002),
    navNode('edge-a', 0),
    navNode('edge-b', 0.0002),
  ]
  const mainRouting = options.oneWay
    ? {
        sourceRoadId: 'main-road',
        authoredOrientation: 'forward' as const,
        authored: { direction: 'forward' as const },
      }
    : undefined
  const edges = [
    navEdge('origin-edge', 'origin', 'edge-a', 22.2),
    navEdge('main-edge', 'edge-a', 'edge-b', 100, mainRouting),
  ]
  if (options.weight !== undefined) edges[1].weight = options.weight
  return {
    version: '4c-routing-test',
    campusId: 'campus-4c',
    createdAt: '',
    checksum: '4c-routing-test',
    nodes,
    edges,
    metadata: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      buildings: 0,
      floors: 1,
      boundingBox: { minLng: -0.0002, maxLng: 0.0002, minLat: 0, maxLat: 0 },
    },
  }
}

function pointPoi(id: string, lng: number): POI {
  return {
    id,
    label: id,
    category: 'outdoor',
    position: { lat: 0, lng },
    source: 'authored',
    sourceId: id,
    properties: {},
    geometry: { type: 'point', position: { lat: 0, lng } },
  }
}

function poiIndex(points: POI[]): POIIndex {
  return { version: '4c-routing-test', points }
}

function graphSignature(graph: NavigationGraph): string {
  return JSON.stringify({ nodes: graph.nodes, edges: graph.edges, metadata: graph.metadata })
}

function routeToPoi(
  graph: NavigationGraph,
  poi: POI,
  fromId = 'origin',
): ReturnType<NonNullable<PlannedPoiRoutingEngine['findRouteToPOI']>> | { ok: false; failure: { code: string } } {
  const engine = new RoutingEngine(graph) as PlannedPoiRoutingEngine
  if (!engine.findRouteToPOI) return { ok: false, failure: { code: 'POI_ROUTER_NOT_IMPLEMENTED' } }
  return engine.findRouteToPOI(fromId, { destinationType: 'poi', poiId: poi.id }, poiIndex([poi]))
}

describe('Phase 4C request-local POI routing overlay', () => {
  it('routes to an interior edge target while retaining stable POI identity', () => {
    const base = overlayFixture()
    const before = graphSignature(base)
    const result = routeToPoi(base, pointPoi('poi-mid-edge', 0.0001))

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.resolution.candidate.kind).toBe('edge')
      expect(result.resolution.candidate.networkId).toBe('main-edge')
      expect(result.resolution.candidate.projection).toBeCloseTo(0.5, 2)
      expect(result.route.path.map((step) => step.nodeId)).toContain(result.resolution.temporaryRoutingTargetId)
      expect(result.route.destination?.entityId).toBe('poi-mid-edge')
      expect(result.route.totalDistance).toBeCloseTo(72.2, 1)
    }
    expect(graphSignature(base)).toBe(before)
    expect(base.nodes.some((node) => node.id.includes('poi-mid-edge'))).toBe(false)
    expect(base.edges.some((edge) => edge.id.includes('poi-mid-edge'))).toBe(false)
  })

  it('preserves proportional edge cost for an interior projection', () => {
    const base = overlayFixture({ weight: 240 })
    const result = routeToPoi(base, pointPoi('poi-quarter-edge', 0.00005))

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.route.generalizedCost).toBeCloseTo(82.2, 1)
      expect(result.route.totalDistance).toBeCloseTo(47.2, 1)
    }
  })

  it('honors one-way edge eligibility when approaching an interior target', () => {
    const base = overlayFixture({ oneWay: true })
    const reachable = routeToPoi(base, pointPoi('poi-forward', 0.0001), 'origin')
    const blocked = routeToPoi(base, pointPoi('poi-reverse', 0.0001), 'edge-b')

    expect(reachable.ok).toBe(true)
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) expect(blocked.code).toBe('POI_DESTINATION_UNREACHABLE')
  })

  it('does not leak temporary targets across repeated requests', () => {
    const base = overlayFixture()
    const before = graphSignature(base)
    const targetIds = new Set<string>()

    for (let index = 0; index < 100; index += 1) {
      const result = routeToPoi(base, pointPoi(`poi-repeat-${index}`, 0.0001))
      expect(result.ok).toBe(true)
      if (result.ok) targetIds.add(result.resolution.temporaryRoutingTargetId)
      expect(graphSignature(base)).toBe(before)
    }

    expect(targetIds.size).toBe(100)
    expect(base.nodes).toHaveLength(3)
    expect(base.edges).toHaveLength(2)
  })

  it('isolates sequential POI requests and preserves ordinary node routes', () => {
    const base = overlayFixture()
    const before = graphSignature(base)
    const first = routeToPoi(base, pointPoi('poi-a', 0.00005))
    const second = routeToPoi(base, pointPoi('poi-b', 0.00015))
    const ordinary = new RoutingEngine(base).findRoute('origin', 'edge-b')

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (first.ok && second.ok) {
      expect(first.resolution.temporaryRoutingTargetId).not.toBe(second.resolution.temporaryRoutingTargetId)
      expect(first.route.destination?.entityId).toBe('poi-a')
      expect(second.route.destination?.entityId).toBe('poi-b')
      expect(second.route.path.map((step) => step.nodeId)).not.toContain(first.resolution.temporaryRoutingTargetId)
    }
    expect(ordinary?.path.map((step) => step.nodeId)).toEqual(['origin', 'edge-a', 'edge-b'])
    expect(graphSignature(base)).toBe(before)
  })

  it('routes to a scope-marked outdoor shape POI through the shared request-local overlay', () => {
    const base = overlayFixture()
    const before = graphSignature(base)
    const outdoorPoi: POI = {
      ...pointPoi('poi-outdoor-circle', 0.00005),
      scope: 'outdoor',
      geometry: { type: 'circle', center: { lat: 0, lng: 0.00005 }, radius: 2 },
    }

    const result = routeToPoi(base, outdoorPoi)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.route.destination?.entityId).toBe('poi-outdoor-circle')
      expect(result.resolution.candidate.networkId).toBe('main-edge')
    }
    // Request-local only: no permanent node/edge is created for the POI.
    expect(graphSignature(base)).toBe(before)
    expect(base.nodes.some((node) => node.id.includes('poi-outdoor-circle'))).toBe(false)
    expect(base.edges.some((edge) => edge.id.includes('poi-outdoor-circle'))).toBe(false)
  })
})
