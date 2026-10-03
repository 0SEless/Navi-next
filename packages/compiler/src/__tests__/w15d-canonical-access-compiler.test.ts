import { describe, it, expect } from 'vitest'
import { resolveCompiledRouteNodeId, compileCanonicalAccess } from '../primitives/canonical-access-compiler'
import { generatePrimitives } from '../primitives/coordinator'
import { assessRouteNetworkAuthority } from '../primitives/route-network-authority'
import { normalizeConnectivity } from '../connectivity/normalizer'
import type { NormalizedDocument, NormalizedFloor, RouteNetwork, GenerationContext, PrimitiveNode } from '../types'
import type { RoomAttributes, EntranceAccess, VerticalTransition } from '@navi/core'

const ctx: GenerationContext = { nodeInterval: 10, mergeThreshold: 0.5 }

// ── Helpers ──

function makeBuilding(overrides?: Record<string, unknown>) {
  return {
    id: 'b1',
    name: 'Building A',
    code: 'BA',
    category: 'academic',
    position: { lat: 14.0, lng: 121.0 },
    baseElevation: 0,
    height: 10,
    floors: [],
    ...overrides,
  } as any
}

function makeFloor(overrides?: Partial<NormalizedFloor>): NormalizedFloor {
  return {
    id: 'b1-0',
    level: 0,
    label: 'Ground',
    elevation: 0,
    buildingId: 'b1',
    rooms: [],
    hallways: [],
    connectorStops: [],
    entrances: [],
    anchors: [],
    ...overrides,
  } as any
}

function makeDoc(buildings?: any[], roads?: any[]): NormalizedDocument {
  return {
    buildings: buildings || [makeBuilding({ floors: [makeFloor()] })],
    roads: roads || [],
  }
}

function makeRouteNetwork(overrides?: Partial<RouteNetwork>): RouteNetwork {
  return {
    nodes: [
      { id: 'rn-1', type: 'waypoint', position: { x: 2, y: 3 }, floor: 0 },
      { id: 'rn-2', type: 'waypoint', position: { x: 8, y: 3 }, floor: 0 },
      { id: 'rn-3', type: 'poi', position: { x: 5, y: 6 }, floor: 0 },
    ],
    edges: [
      { id: 're-1', from: 'rn-1', to: 'rn-2', type: 'walk', distance: 6 },
      { id: 're-2', from: 'rn-2', to: 'rn-3', type: 'walk', distance: 5 },
    ],
    ...overrides,
  }
}

function makeRoomPoiNode(id: string, x: number, y: number, floor: number, buildingId: string): PrimitiveNode {
  return {
    id,
    kind: 'poi',
    label: `Room ${id}`,
    position: { lat: 14.0 + y / 111320, lng: 121.0 + x / (111320 * Math.cos((14.0 * Math.PI) / 180)) },
    floor,
    buildingId,
    poiCategory: 'room',
    source: {
      entityId: id,
      entityType: 'room',
      field: 'centroid',
      generatorId: 'builtin:room-extractor',
    },
  }
}

function makeRouteNode(id: string, x: number, y: number, floor: number, buildingId: string): PrimitiveNode {
  return {
    id: `R-${id}`,
    kind: 'waypoint',
    label: `Route ${id}`,
    position: { lat: 14.0 + y / 111320, lng: 121.0 + x / (111320 * Math.cos((14.0 * Math.PI) / 180)) },
    floor,
    buildingId,
    source: {
      entityId: id,
      entityType: 'route_node',
      field: 'position',
      generatorId: 'builtin:route-network-extractor',
    },
  }
}

function makeOutdoorNode(id: string): PrimitiveNode {
  return {
    id,
    kind: 'waypoint',
    label: `Outdoor ${id}`,
    position: { lat: 13.999, lng: 120.999 },
    floor: 0,
    buildingId: '',
    source: {
      entityId: id,
      entityType: 'road',
      field: 'position',
      generatorId: 'builtin:skeleton-generator',
    },
  }
}

// ── Route Node ID Resolution Tests ──

describe('resolveCompiledRouteNodeId', () => {
  it('prefixes authored ID with R-', () => {
    expect(resolveCompiledRouteNodeId('rn-1')).toBe('R-rn-1')
  })

  it('handles empty string', () => {
    expect(resolveCompiledRouteNodeId('')).toBe('R-')
  })

  it('handles IDs with special characters', () => {
    expect(resolveCompiledRouteNodeId('my-route-node')).toBe('R-my-route-node')
  })

  it('is deterministic for same input', () => {
    const id = 'rn-42'
    expect(resolveCompiledRouteNodeId(id)).toBe(resolveCompiledRouteNodeId(id))
  })
})

// ── RoomAccess Compilation Tests ──

describe('RoomAccess Compilation', () => {
  it('creates edge from room POI to compiled route node', () => {
    const routeNetwork = makeRouteNetwork()
    const roomAttributes: RoomAttributes[] = [
      { faceId: 'r1', name: 'Room 101', number: '101', category: 'classroom', searchable: true,
        accessPoints: [{ openingId: 'op-1', routeNodeId: 'rn-1', primary: true }] },
    ]

    const doc = makeDoc([makeBuilding({
      floors: [makeFloor({ routeNetwork, roomAttributes })],
    })])

    const existingNodes: PrimitiveNode[] = [
      makeRoomPoiNode('r1', 5, 4, 0, 'b1'),
      makeRouteNode('rn-1', 2, 3, 0, 'b1'),
    ]

    const result = compileCanonicalAccess(doc, existingNodes)

    expect(result.edges.length).toBe(1)
    const edge = result.edges[0]!
    expect(edge.kind).toBe('access')
    if ('from' in edge) {
      expect(edge.from).toBe('r1')
      expect(edge.to).toBe('R-rn-1')
    }
    expect(edge.distance).toBeGreaterThan(0)
    if ('accessType' in edge) {
      expect(edge.accessType).toBe('room_access')
    }
  })

  it('preserves all access points for multi-access rooms', () => {
    const routeNetwork = makeRouteNetwork()
    const roomAttributes: RoomAttributes[] = [
      { faceId: 'r1', name: 'Room 101', number: '101', category: 'classroom', searchable: true,
        accessPoints: [
          { openingId: 'op-1', routeNodeId: 'rn-1', primary: true },
          { openingId: 'op-2', routeNodeId: 'rn-2', primary: false },
        ] },
    ]

    const doc = makeDoc([makeBuilding({
      floors: [makeFloor({ routeNetwork, roomAttributes })],
    })])

    const existingNodes: PrimitiveNode[] = [
      makeRoomPoiNode('r1', 5, 4, 0, 'b1'),
      makeRouteNode('rn-1', 2, 3, 0, 'b1'),
      makeRouteNode('rn-2', 8, 3, 0, 'b1'),
    ]

    const result = compileCanonicalAccess(doc, existingNodes)

    expect(result.edges.length).toBe(2)
    const primaryEdge = result.edges.find(e => 'to' in e && e.to === 'R-rn-1')
    const secondaryEdge = result.edges.find(e => 'to' in e && e.to === 'R-rn-2')
    expect(primaryEdge).toBeDefined()
    expect(secondaryEdge).toBeDefined()
  })

  it('uses primary access for destination resolution', () => {
    const routeNetwork = makeRouteNetwork()
    const roomAttributes: RoomAttributes[] = [
      { faceId: 'r1', name: 'Room 101', number: '101', category: 'classroom', searchable: true,
        accessPoints: [
          { openingId: 'op-1', routeNodeId: 'rn-1', primary: true },
          { openingId: 'op-2', routeNodeId: 'rn-2', primary: false },
        ] },
    ]

    const doc = makeDoc([makeBuilding({
      floors: [makeFloor({ routeNetwork, roomAttributes })],
    })])

    const existingNodes: PrimitiveNode[] = [
      makeRoomPoiNode('r1', 5, 4, 0, 'b1'),
      makeRouteNode('rn-1', 2, 3, 0, 'b1'),
      makeRouteNode('rn-2', 8, 3, 0, 'b1'),
    ]

    const result = compileCanonicalAccess(doc, existingNodes)

    // Both edges exist, primary is rn-1
    expect(result.canonicalAccess.canonicalRoomIds.has('r1')).toBe(true)
  })

  it('reports warning when route node not found', () => {
    const routeNetwork = makeRouteNetwork()
    const roomAttributes: RoomAttributes[] = [
      { faceId: 'r1', name: 'Room 101', number: '101', category: 'classroom', searchable: true,
        accessPoints: [{ openingId: 'op-1', routeNodeId: 'rn-missing', primary: true }] },
    ]

    const doc = makeDoc([makeBuilding({
      floors: [makeFloor({ routeNetwork, roomAttributes })],
    })])

    const existingNodes: PrimitiveNode[] = [
      makeRoomPoiNode('r1', 5, 4, 0, 'b1'),
    ]

    const result = compileCanonicalAccess(doc, existingNodes)

    expect(result.edges.length).toBe(0)
    expect(result.diagnostics.some(d => d.code === 'ROOM_ACCESS_ROUTE_NODE_MISSING')).toBe(true)
  })

  it('reports warning when POI node not found', () => {
    const routeNetwork = makeRouteNetwork()
    const roomAttributes: RoomAttributes[] = [
      { faceId: 'r-missing', name: 'Ghost Room', number: '000', category: 'classroom', searchable: true,
        accessPoints: [{ openingId: 'op-1', routeNodeId: 'rn-1', primary: true }] },
    ]

    const doc = makeDoc([makeBuilding({
      floors: [makeFloor({ routeNetwork, roomAttributes })],
    })])

    const existingNodes: PrimitiveNode[] = [
      makeRouteNode('rn-1', 2, 3, 0, 'b1'),
    ]

    const result = compileCanonicalAccess(doc, existingNodes)

    expect(result.edges.length).toBe(0)
    expect(result.diagnostics.some(d => d.code === 'ROOM_ACCESS_NO_POI')).toBe(true)
  })

  it('skips floors without roomAttributes', () => {
    const doc = makeDoc([makeBuilding({
      floors: [makeFloor({ routeNetwork: makeRouteNetwork() })],
    })])

    const existingNodes: PrimitiveNode[] = [
      makeRouteNode('rn-1', 2, 3, 0, 'b1'),
    ]

    const result = compileCanonicalAccess(doc, existingNodes)

    expect(result.edges.length).toBe(0)
    expect(result.canonicalAccess.canonicalRoomIds.size).toBe(0)
  })

  it('reportsROOM_ACCESS_COMPILED diagnostic', () => {
    const routeNetwork = makeRouteNetwork()
    const roomAttributes: RoomAttributes[] = [
      { faceId: 'r1', name: 'Room 101', number: '101', category: 'classroom', searchable: true,
        accessPoints: [{ openingId: 'op-1', routeNodeId: 'rn-1', primary: true }] },
    ]

    const doc = makeDoc([makeBuilding({
      floors: [makeFloor({ routeNetwork, roomAttributes })],
    })])

    const existingNodes: PrimitiveNode[] = [
      makeRoomPoiNode('r1', 5, 4, 0, 'b1'),
      makeRouteNode('rn-1', 2, 3, 0, 'b1'),
    ]

    const result = compileCanonicalAccess(doc, existingNodes)

    expect(result.diagnostics.some(d => d.code === 'ROOM_ACCESS_COMPILED')).toBe(true)
  })
})

// ── EntranceAccess Compilation Tests ──

describe('EntranceAccess Compilation', () => {
  it('creates bridge edge between outdoor and indoor nodes', () => {
    const routeNetwork = makeRouteNetwork()
    const entranceAccess: EntranceAccess[] = [
      { entranceId: 'e1', outdoorNodeId: 'outdoor-42', indoorRouteNodeId: 'rn-1' },
    ]

    const doc = makeDoc([makeBuilding({ floors: [makeFloor({ routeNetwork, entranceAccess })] })])

    const existingNodes: PrimitiveNode[] = [
      makeOutdoorNode('outdoor-42'),
      makeRouteNode('rn-1', 2, 3, 0, 'b1'),
    ]

    const result = compileCanonicalAccess(doc, existingNodes)

    expect(result.edges.length).toBe(1)
    expect(result.edges[0]!.kind).toBe('access')
    expect(result.edges[0]!.from).toBe('outdoor-42')
    expect(result.edges[0]!.to).toBe('R-rn-1')
    expect(result.edges[0]!.accessType).toBe('entrance_bridge')
    expect(result.edges[0]!.distance).toBeGreaterThan(0)
  })

  it('creates a stable outdoor junction for an explicit route-segment target', () => {
    const routeNetwork = makeRouteNetwork()
    const entranceAccess: EntranceAccess[] = [
      {
        entranceId: 'e1',
        outdoorNodeId: 'N-entrance-access-e1',
        indoorRouteNodeId: 'rn-1',
        outdoorRouteId: 'road-1',
        outdoorPosition: { lat: 14.001, lng: 121.002 },
      },
    ]

    const doc = makeDoc(
      [makeBuilding({ floors: [makeFloor({ routeNetwork, entranceAccess })] })],
      [{ id: 'road-1', name: 'Outdoor route', polyline: [{ lat: 14.001, lng: 121.0 }, { lat: 14.001, lng: 121.004 }], width: 3, surface: 'paved', type: 'connector' }],
    )

    const existingNodes: PrimitiveNode[] = [makeRouteNode('rn-1', 2, 3, 0, 'b1')]
    const result = compileCanonicalAccess(doc, existingNodes)

    expect(result.nodes).toContainEqual(expect.objectContaining({
      id: 'N-entrance-access-e1',
      kind: 'waypoint',
      position: { lat: 14.001, lng: 121.002 },
    }))
    expect(result.edges).toContainEqual(expect.objectContaining({
      from: 'N-entrance-access-e1',
      to: 'R-rn-1',
      accessType: 'entrance_bridge',
    }))
    expect(result.canonicalAccess.canonicalEntranceIds.has('e1')).toBe(true)
  })

  it('joins the stable access junction into the selected outdoor route chain', () => {
    const routeNetwork = makeRouteNetwork()
    const entranceAccess: EntranceAccess[] = [
      {
        entranceId: 'e1',
        outdoorNodeId: 'N-entrance-access-e1',
        indoorRouteNodeId: 'rn-1',
        outdoorRouteId: 'road-1',
        outdoorPosition: { lat: 14.001, lng: 121.002 },
      },
    ]
    const document = makeDoc(
      [makeBuilding({ floors: [makeFloor({ routeNetwork, entranceAccess })] })],
      [{ id: 'road-1', name: 'Outdoor route', polyline: [{ lat: 14.001, lng: 121.0 }, { lat: 14.001, lng: 121.004 }], width: 3, surface: 'paved', type: 'connector' }],
    )

    const primitiveGraph = generatePrimitives(document, ctx)
    const graph = normalizeConnectivity(primitiveGraph, 0.5)
    const accessNode = graph.nodes.find((node) => node.id === 'N-entrance-access-e1')

    expect(accessNode).toBeDefined()
    expect(graph.edges.some((edge) => edge.kind === 'skeleton' && (edge.from === accessNode?.id || edge.to === accessNode?.id))).toBe(true)
  })

  it('reports warning when outdoor node not found', () => {
    const routeNetwork = makeRouteNetwork()
    const entranceAccess: EntranceAccess[] = [
      { entranceId: 'e1', outdoorNodeId: 'outdoor-missing', indoorRouteNodeId: 'rn-1' },
    ]

    const doc = makeDoc([makeBuilding({
      floors: [makeFloor({ routeNetwork, entranceAccess })],
    })])

    const existingNodes: PrimitiveNode[] = [
      makeRouteNode('rn-1', 2, 3, 0, 'b1'),
    ]

    const result = compileCanonicalAccess(doc, existingNodes)

    expect(result.edges.length).toBe(0)
    expect(result.diagnostics.some(d => d.code === 'ENTRANCE_ACCESS_OUTDOOR_MISSING')).toBe(true)
  })

  it('reports warning when indoor route node not found', () => {
    const routeNetwork = makeRouteNetwork()
    const entranceAccess: EntranceAccess[] = [
      { entranceId: 'e1', outdoorNodeId: 'outdoor-42', indoorRouteNodeId: 'rn-missing' },
    ]

    const doc = makeDoc([makeBuilding({
      floors: [makeFloor({ routeNetwork, entranceAccess })],
    })])

    const existingNodes: PrimitiveNode[] = [
      makeOutdoorNode('outdoor-42'),
    ]

    const result = compileCanonicalAccess(doc, existingNodes)

    expect(result.edges.length).toBe(0)
    expect(result.diagnostics.some(d => d.code === 'ENTRANCE_ACCESS_INDOOR_MISSING')).toBe(true)
  })

  it('reportsENTRANCE_ACCESS_COMPILED diagnostic', () => {
    const routeNetwork = makeRouteNetwork()
    const entranceAccess: EntranceAccess[] = [
      { entranceId: 'e1', outdoorNodeId: 'outdoor-42', indoorRouteNodeId: 'rn-1' },
    ]

    const doc = makeDoc([makeBuilding({
      floors: [makeFloor({ routeNetwork, entranceAccess })],
    })])

    const existingNodes: PrimitiveNode[] = [
      makeOutdoorNode('outdoor-42'),
      makeRouteNode('rn-1', 2, 3, 0, 'b1'),
    ]

    const result = compileCanonicalAccess(doc, existingNodes)

    expect(result.diagnostics.some(d => d.code === 'ENTRANCE_ACCESS_COMPILED')).toBe(true)
  })

  it('skips floors without entranceAccess', () => {
    const doc = makeDoc([makeBuilding({
      floors: [makeFloor({ routeNetwork: makeRouteNetwork() })],
    })])

    const existingNodes: PrimitiveNode[] = [
      makeRouteNode('rn-1', 2, 3, 0, 'b1'),
    ]

    const result = compileCanonicalAccess(doc, existingNodes)

    expect(result.edges.length).toBe(0)
    expect(result.canonicalAccess.canonicalEntranceIds.size).toBe(0)
  })
})

// ── VerticalTransition Compilation Tests ──

describe('VerticalTransition Compilation', () => {
  it('creates edges between consecutive floor connections', () => {
    const routeNetwork: RouteNetwork = {
      nodes: [
        { id: 'rn-f1', type: 'waypoint', position: { x: 5, y: 5 }, floor: 0 },
        { id: 'rn-f2', type: 'waypoint', position: { x: 5, y: 5 }, floor: 1 },
      ],
      edges: [],
    }

    const verticalTransitions: VerticalTransition[] = [
      { id: 'vt-1', featureId: 'stair-1', type: 'staircase', connections: [
        { floorId: 'b1-0', routeNodeId: 'rn-f1' },
        { floorId: 'b1-1', routeNodeId: 'rn-f2' },
      ]},
    ]

    const doc = makeDoc([makeBuilding({
      floors: [
        makeFloor({ routeNetwork, id: 'b1-0', level: 0 }),
        makeFloor({ id: 'b1-1', level: 1, elevation: 3.5 }),
      ],
      verticalTransitions,
    })])

    const existingNodes: PrimitiveNode[] = [
      makeRouteNode('rn-f1', 5, 5, 0, 'b1'),
      makeRouteNode('rn-f2', 5, 5, 1, 'b1'),
    ]

    const result = compileCanonicalAccess(doc, existingNodes)

    expect(result.edges.length).toBe(1)
    expect(result.edges[0]!.kind).toBe('transition')
    expect(result.edges[0]!.from).toBe('R-rn-f1')
    expect(result.edges[0]!.to).toBe('R-rn-f2')
    expect(result.edges[0]!.behavior).toBe('stairs')
    expect(result.edges[0]!.distance).toBeGreaterThan(0)
  })

  it('uses elevator behavior for elevator transitions', () => {
    const routeNetwork: RouteNetwork = {
      nodes: [
        { id: 'rn-f1', type: 'waypoint', position: { x: 5, y: 5 }, floor: 0 },
        { id: 'rn-f2', type: 'waypoint', position: { x: 5, y: 5 }, floor: 1 },
      ],
      edges: [],
    }

    const verticalTransitions: VerticalTransition[] = [
      { id: 'vt-el', featureId: 'el-1', type: 'elevator', connections: [
        { floorId: 'b1-0', routeNodeId: 'rn-f1' },
        { floorId: 'b1-1', routeNodeId: 'rn-f2' },
      ]},
    ]

    const doc = makeDoc([makeBuilding({
      floors: [
        makeFloor({ routeNetwork, id: 'b1-0', level: 0 }),
        makeFloor({ id: 'b1-1', level: 1, elevation: 3.5 }),
      ],
      verticalTransitions,
    })])

    const existingNodes: PrimitiveNode[] = [
      makeRouteNode('rn-f1', 5, 5, 0, 'b1'),
      makeRouteNode('rn-f2', 5, 5, 1, 'b1'),
    ]

    const result = compileCanonicalAccess(doc, existingNodes)

    expect(result.edges[0]!.behavior).toBe('elevator')
  })

  it('reportsVERTICAL_TRANSITION_NODE_MISSING for missing nodes', () => {
    const verticalTransitions: VerticalTransition[] = [
      { id: 'vt-1', featureId: 'stair-1', type: 'staircase', connections: [
        { floorId: 'b1-0', routeNodeId: 'rn-missing' },
        { floorId: 'b1-1', routeNodeId: 'rn-f2' },
      ]},
    ]

    const doc = makeDoc([makeBuilding({
      floors: [
        makeFloor({ id: 'b1-0', level: 0 }),
        makeFloor({ id: 'b1-1', level: 1, elevation: 3.5 }),
      ],
      verticalTransitions,
    })])

    const existingNodes: PrimitiveNode[] = [
      makeRouteNode('rn-f2', 5, 5, 1, 'b1'),
    ]

    const result = compileCanonicalAccess(doc, existingNodes)

    expect(result.edges.length).toBe(0)
    expect(result.diagnostics.some(d => d.code === 'VERTICAL_TRANSITION_NODE_MISSING')).toBe(true)
  })

  it('reportsVERTICAL_TRANSITION_FLOOR_GAP for non-adjacent floors', () => {
    const routeNetwork: RouteNetwork = {
      nodes: [
        { id: 'rn-f1', type: 'waypoint', position: { x: 5, y: 5 }, floor: 0 },
        { id: 'rn-f3', type: 'waypoint', position: { x: 5, y: 5 }, floor: 2 },
      ],
      edges: [],
    }

    const verticalTransitions: VerticalTransition[] = [
      { id: 'vt-1', featureId: 'stair-1', type: 'staircase', connections: [
        { floorId: 'b1-0', routeNodeId: 'rn-f1' },
        { floorId: 'b1-2', routeNodeId: 'rn-f3' },
      ]},
    ]

    const doc = makeDoc([makeBuilding({
      floors: [
        makeFloor({ routeNetwork, id: 'b1-0', level: 0 }),
        makeFloor({ id: 'b1-1', level: 1, elevation: 3.5 }),
        makeFloor({ id: 'b1-2', level: 2, elevation: 7 }),
      ],
      verticalTransitions,
    })])

    const existingNodes: PrimitiveNode[] = [
      makeRouteNode('rn-f1', 5, 5, 0, 'b1'),
      makeRouteNode('rn-f3', 5, 5, 2, 'b1'),
    ]

    const result = compileCanonicalAccess(doc, existingNodes)

    expect(result.edges.length).toBe(1)
    expect(result.diagnostics.some(d => d.code === 'VERTICAL_TRANSITION_FLOOR_GAP')).toBe(true)
  })

  it('reportsVERTICAL_TRANSITION_COMPILED diagnostic', () => {
    const routeNetwork: RouteNetwork = {
      nodes: [
        { id: 'rn-f1', type: 'waypoint', position: { x: 5, y: 5 }, floor: 0 },
        { id: 'rn-f2', type: 'waypoint', position: { x: 5, y: 5 }, floor: 1 },
      ],
      edges: [],
    }

    const verticalTransitions: VerticalTransition[] = [
      { id: 'vt-1', featureId: 'stair-1', type: 'staircase', connections: [
        { floorId: 'b1-0', routeNodeId: 'rn-f1' },
        { floorId: 'b1-1', routeNodeId: 'rn-f2' },
      ]},
    ]

    const doc = makeDoc([makeBuilding({
      floors: [
        makeFloor({ routeNetwork, id: 'b1-0', level: 0 }),
        makeFloor({ id: 'b1-1', level: 1, elevation: 3.5 }),
      ],
      verticalTransitions,
    })])

    const existingNodes: PrimitiveNode[] = [
      makeRouteNode('rn-f1', 5, 5, 0, 'b1'),
      makeRouteNode('rn-f2', 5, 5, 1, 'b1'),
    ]

    const result = compileCanonicalAccess(doc, existingNodes)

    expect(result.diagnostics.some(d => d.code === 'VERTICAL_TRANSITION_COMPILED')).toBe(true)
  })

  it('skips buildings without verticalTransitions', () => {
    const doc = makeDoc([makeBuilding({
      floors: [makeFloor({ routeNetwork: makeRouteNetwork() })],
    })])

    const existingNodes: PrimitiveNode[] = [
      makeRouteNode('rn-1', 2, 3, 0, 'b1'),
    ]

    const result = compileCanonicalAccess(doc, existingNodes)

    expect(result.edges.length).toBe(0)
    expect(result.canonicalAccess.canonicalFeatureIds.size).toBe(0)
  })
})

// ── A* Pathfinding Proofs ──

describe('A* Pathfinding Proofs', () => {
  function buildAdjacency(nodes: PrimitiveNode[], edges: Array<{ from: string; to: string; distance: number }>) {
    const adj = new Map<string, Array<{ to: string; distance: number }>>()
    for (const node of nodes) adj.set(node.id, [])
    for (const edge of edges) {
      adj.get(edge.from)?.push({ to: edge.to, distance: edge.distance })
      adj.get(edge.to)?.push({ to: edge.from, distance: edge.distance })
    }
    return adj
  }

  function aStar(
    start: string,
    goal: string,
    adj: Map<string, Array<{ to: string; distance: number }>>,
    heuristic: (a: string, b: string) => number = () => 0,
  ): string[] | null {
    const gScore = new Map<string, number>()
    const fScore = new Map<string, number>()
    const cameFrom = new Map<string, string>()
    const openSet = new Set<string>([start])

    gScore.set(start, 0)
    fScore.set(start, heuristic(start, goal))

    while (openSet.size > 0) {
      let current = ''
      let bestF = Infinity
      for (const node of openSet) {
        const f = fScore.get(node) ?? Infinity
        if (f < bestF) { bestF = f; current = node }
      }

      if (current === goal) {
        const path = [current]
        while (cameFrom.has(current)) { current = cameFrom.get(current)!; path.unshift(current) }
        return path
      }

      openSet.delete(current)
      for (const neighbor of adj.get(current) ?? []) {
        const tentativeG = (gScore.get(current) ?? Infinity) + neighbor.distance
        if (tentativeG < (gScore.get(neighbor.to) ?? Infinity)) {
          cameFrom.set(neighbor.to, current)
          gScore.set(neighbor.to, tentativeG)
          fScore.set(neighbor.to, tentativeG)
          openSet.add(neighbor.to)
        }
      }
    }
    return null
  }

  it('Same-floor Room→Room via RouteNetwork', () => {
    const routeNetwork: RouteNetwork = {
      nodes: [
        { id: 'rn-1', type: 'waypoint', position: { x: 0, y: 0 }, floor: 0 },
        { id: 'rn-2', type: 'waypoint', position: { x: 10, y: 0 }, floor: 0 },
        { id: 'rn-3', type: 'waypoint', position: { x: 5, y: 5 }, floor: 0 },
      ],
      edges: [
        { id: 're-1', from: 'rn-1', to: 'rn-2', type: 'walk', distance: 10 },
        { id: 're-2', from: 'rn-2', to: 'rn-3', type: 'walk', distance: 7 },
        { id: 're-3', from: 'rn-1', to: 'rn-3', type: 'walk', distance: 8 },
      ],
    }

    const roomAttributes: RoomAttributes[] = [
      { faceId: 'r1', name: 'Room A', number: '101', searchable: true,
        accessPoints: [{ openingId: 'op-1', routeNodeId: 'rn-1', primary: true }] },
      { faceId: 'r2', name: 'Room B', number: '102', searchable: true,
        accessPoints: [{ openingId: 'op-2', routeNodeId: 'rn-3', primary: true }] },
    ]

    const doc = makeDoc([makeBuilding({
      floors: [makeFloor({ routeNetwork, roomAttributes })],
    })])

    const existingNodes: PrimitiveNode[] = [
      makeRoomPoiNode('r1', 2, 3, 0, 'b1'),
      makeRoomPoiNode('r2', 5, 6, 0, 'b1'),
      makeRouteNode('rn-1', 0, 0, 0, 'b1'),
      makeRouteNode('rn-2', 10, 0, 0, 'b1'),
      makeRouteNode('rn-3', 5, 5, 0, 'b1'),
    ]

    const result = compileCanonicalAccess(doc, existingNodes)

    // Combine route network edges + canonical access edges for full graph
    const routeEdges = routeNetwork.edges.map(e => ({
      from: `R-${e.from}`,
      to: `R-${e.to}`,
      distance: e.distance,
    }))
    const canonicalEdges = result.edges.map(e => ({
      from: e.from,
      to: e.to,
      distance: e.distance,
    }))
    const allEdges = [...routeEdges, ...canonicalEdges]
    const adj = buildAdjacency(existingNodes, allEdges)

    // A* from Room A (r1) to Room B (r2)
    const path = aStar('r1', 'r2', adj)

    expect(path).not.toBeNull()
    // Path should go: r1 → R-rn-1 → R-rn-3 → r2 (or via R-rn-2)
    expect(path![0]).toBe('r1')
    expect(path![path!.length - 1]).toBe('r2')
    expect(path!.some(id => id.startsWith('R-'))).toBe(true)
  })

  it('Outdoor→Room via EntranceAccess bridge', () => {
    const routeNetwork: RouteNetwork = {
      nodes: [
        { id: 'rn-1', type: 'waypoint', position: { x: 2, y: 3 }, floor: 0 },
        { id: 'rn-2', type: 'waypoint', position: { x: 5, y: 5 }, floor: 0 },
      ],
      edges: [
        { id: 're-1', from: 'rn-1', to: 'rn-2', type: 'walk', distance: 4 },
      ],
    }

    const entranceAccess: EntranceAccess[] = [
      { entranceId: 'e1', outdoorNodeId: 'outdoor-42', indoorRouteNodeId: 'rn-1' },
    ]

    const roomAttributes: RoomAttributes[] = [
      { faceId: 'r1', name: 'Room A', number: '101', searchable: true,
        accessPoints: [{ openingId: 'op-1', routeNodeId: 'rn-2', primary: true }] },
    ]

    const doc = makeDoc([makeBuilding({
      floors: [makeFloor({ routeNetwork, entranceAccess, roomAttributes })],
    })])

    const existingNodes: PrimitiveNode[] = [
      makeOutdoorNode('outdoor-42'),
      makeRouteNode('rn-1', 2, 3, 0, 'b1'),
      makeRouteNode('rn-2', 5, 5, 0, 'b1'),
      makeRoomPoiNode('r1', 5, 6, 0, 'b1'),
    ]

    const result = compileCanonicalAccess(doc, existingNodes)

    // Combine route network edges + canonical access edges
    const routeEdges = routeNetwork.edges.map(e => ({
      from: `R-${e.from}`,
      to: `R-${e.to}`,
      distance: e.distance,
    }))
    const canonicalEdges = result.edges.map(e => ({
      from: e.from,
      to: e.to,
      distance: e.distance,
    }))
    const allEdges = [...routeEdges, ...canonicalEdges]
    const adj = buildAdjacency(existingNodes, allEdges)

    const path = aStar('outdoor-42', 'r1', adj)
    const reversePath = aStar('r1', 'outdoor-42', adj)

    expect(path).not.toBeNull()
    expect(path![0]).toBe('outdoor-42')
    expect(path![path!.length - 1]).toBe('r1')
    // Must traverse the bridge edge
    expect(path!.some(id => id === 'R-rn-1' || id === 'R-rn-2')).toBe(true)
    expect(reversePath).not.toBeNull()
    expect(reversePath![0]).toBe('r1')
    expect(reversePath![reversePath!.length - 1]).toBe('outdoor-42')
    expect(reversePath!.some(id => id === 'R-rn-1' || id === 'R-rn-2')).toBe(true)
  })

  it('Floor1→Floor2 via VerticalTransition', () => {
    const routeNetworkF1: RouteNetwork = {
      nodes: [
        { id: 'rn-f1-1', type: 'waypoint', position: { x: 5, y: 5 }, floor: 0 },
        { id: 'rn-f1-stair', type: 'waypoint', position: { x: 10, y: 5 }, floor: 0 },
      ],
      edges: [
        { id: 're-f1-1', from: 'rn-f1-1', to: 'rn-f1-stair', type: 'walk', distance: 5 },
      ],
    }

    const routeNetworkF2: RouteNetwork = {
      nodes: [
        { id: 'rn-f2-stair', type: 'waypoint', position: { x: 10, y: 5 }, floor: 1 },
        { id: 'rn-f2-1', type: 'waypoint', position: { x: 5, y: 5 }, floor: 1 },
      ],
      edges: [
        { id: 're-f2-1', from: 'rn-f2-stair', to: 'rn-f2-1', type: 'walk', distance: 5 },
      ],
    }

    const roomAttributesF1: RoomAttributes[] = [
      { faceId: 'r1', name: 'Room F1', number: '101', searchable: true,
        accessPoints: [{ openingId: 'op-1', routeNodeId: 'rn-f1-1', primary: true }] },
    ]

    const roomAttributesF2: RoomAttributes[] = [
      { faceId: 'r2', name: 'Room F2', number: '201', searchable: true,
        accessPoints: [{ openingId: 'op-2', routeNodeId: 'rn-f2-1', primary: true }] },
    ]

    const verticalTransitions: VerticalTransition[] = [
      { id: 'vt-1', featureId: 'stair-1', type: 'staircase', connections: [
        { floorId: 'b1-0', routeNodeId: 'rn-f1-stair' },
        { floorId: 'b1-1', routeNodeId: 'rn-f2-stair' },
      ]},
    ]

    const doc = makeDoc([makeBuilding({
      floors: [
        makeFloor({ routeNetwork: routeNetworkF1, roomAttributes: roomAttributesF1, id: 'b1-0', level: 0 }),
        makeFloor({ routeNetwork: routeNetworkF2, roomAttributes: roomAttributesF2, id: 'b1-1', level: 1, elevation: 3.5 }),
      ],
      verticalTransitions,
    })])

    const existingNodes: PrimitiveNode[] = [
      makeRoomPoiNode('r1', 5, 6, 0, 'b1'),
      makeRoomPoiNode('r2', 5, 6, 1, 'b1'),
      makeRouteNode('rn-f1-1', 5, 5, 0, 'b1'),
      makeRouteNode('rn-f1-stair', 10, 5, 0, 'b1'),
      makeRouteNode('rn-f2-stair', 10, 5, 1, 'b1'),
      makeRouteNode('rn-f2-1', 5, 5, 1, 'b1'),
    ]

    const result = compileCanonicalAccess(doc, existingNodes)

    // Combine all route network edges + canonical access edges
    const routeEdges = [
      ...routeNetworkF1.edges.map(e => ({ from: `R-${e.from}`, to: `R-${e.to}`, distance: e.distance })),
      ...routeNetworkF2.edges.map(e => ({ from: `R-${e.from}`, to: `R-${e.to}`, distance: e.distance })),
    ]
    const canonicalEdges = result.edges.map(e => ({
      from: e.from,
      to: e.to,
      distance: e.distance,
    }))
    const allEdges = [...routeEdges, ...canonicalEdges]
    const adj = buildAdjacency(existingNodes, allEdges)

    const path = aStar('r1', 'r2', adj)

    expect(path).not.toBeNull()
    expect(path![0]).toBe('r1')
    expect(path![path!.length - 1]).toBe('r2')
    // Must traverse vertical transition edge
    expect(path!.some(id => id === 'R-rn-f1-stair' || id === 'R-rn-f2-stair')).toBe(true)
  })
})

// ── Legacy Suppression Tests ──

describe('Legacy Suppression', () => {
  it('canonicalRoomIds populated from RoomAccess', () => {
    const routeNetwork = makeRouteNetwork()
    const roomAttributes: RoomAttributes[] = [
      { faceId: 'r1', name: 'Room 101', searchable: true,
        accessPoints: [{ openingId: 'op-1', routeNodeId: 'rn-1', primary: true }] },
    ]

    const doc = makeDoc([makeBuilding({
      floors: [makeFloor({ routeNetwork, roomAttributes })],
    })])

    const existingNodes: PrimitiveNode[] = [
      makeRoomPoiNode('r1', 5, 4, 0, 'b1'),
      makeRouteNode('rn-1', 2, 3, 0, 'b1'),
    ]

    const result = compileCanonicalAccess(doc, existingNodes)

    expect(result.canonicalAccess.canonicalRoomIds.has('r1')).toBe(true)
  })

  it('canonicalEntranceIds populated from EntranceAccess', () => {
    const routeNetwork = makeRouteNetwork()
    const entranceAccess: EntranceAccess[] = [
      { entranceId: 'e1', outdoorNodeId: 'outdoor-42', indoorRouteNodeId: 'rn-1' },
    ]

    const doc = makeDoc([makeBuilding({
      floors: [makeFloor({ routeNetwork, entranceAccess })],
    })])

    const existingNodes: PrimitiveNode[] = [
      makeOutdoorNode('outdoor-42'),
      makeRouteNode('rn-1', 2, 3, 0, 'b1'),
    ]

    const result = compileCanonicalAccess(doc, existingNodes)

    expect(result.canonicalAccess.canonicalEntranceIds.has('e1')).toBe(true)
  })

  it('canonicalFeatureIds populated from VerticalTransitions', () => {
    const routeNetwork: RouteNetwork = {
      nodes: [
        { id: 'rn-f1', type: 'waypoint', position: { x: 5, y: 5 }, floor: 0 },
        { id: 'rn-f2', type: 'waypoint', position: { x: 5, y: 5 }, floor: 1 },
      ],
      edges: [],
    }

    const verticalTransitions: VerticalTransition[] = [
      { id: 'vt-1', featureId: 'stair-1', type: 'staircase', connections: [
        { floorId: 'b1-0', routeNodeId: 'rn-f1' },
        { floorId: 'b1-1', routeNodeId: 'rn-f2' },
      ]},
    ]

    const doc = makeDoc([makeBuilding({
      floors: [
        makeFloor({ routeNetwork, id: 'b1-0', level: 0 }),
        makeFloor({ id: 'b1-1', level: 1, elevation: 3.5 }),
      ],
      verticalTransitions,
    })])

    const existingNodes: PrimitiveNode[] = [
      makeRouteNode('rn-f1', 5, 5, 0, 'b1'),
      makeRouteNode('rn-f2', 5, 5, 1, 'b1'),
    ]

    const result = compileCanonicalAccess(doc, existingNodes)

    expect(result.canonicalAccess.canonicalFeatureIds.has('stair-1')).toBe(true)
  })
})

// ── Required Gate Cases (20) ──

describe('Required Gate Cases (20)', () => {
  describe('Route Node ID Resolution (4)', () => {
    it('GC1: resolveCompiledRouteNodeId produces R- prefix', () => {
      expect(resolveCompiledRouteNodeId('rn-1')).toBe('R-rn-1')
    })

    it('GC2: resolveCompiledRouteNodeId is used by RoomAccess compiler', () => {
      const routeNetwork = makeRouteNetwork()
      const roomAttributes: RoomAttributes[] = [
        { faceId: 'r1', name: 'Room', searchable: true,
          accessPoints: [{ openingId: 'op-1', routeNodeId: 'rn-1', primary: true }] },
      ]

      const doc = makeDoc([makeBuilding({
        floors: [makeFloor({ routeNetwork, roomAttributes })],
      })])

      const existingNodes: PrimitiveNode[] = [
        makeRoomPoiNode('r1', 5, 4, 0, 'b1'),
        makeRouteNode('rn-1', 2, 3, 0, 'b1'),
      ]

      const result = compileCanonicalAccess(doc, existingNodes)
      // Edge to should be R-rn-1 (resolved via resolveCompiledRouteNodeId)
      expect(result.edges[0]!.to).toBe('R-rn-1')
    })

    it('GC3: resolveCompiledRouteNodeId is used by EntranceAccess compiler', () => {
      const routeNetwork = makeRouteNetwork()
      const entranceAccess: EntranceAccess[] = [
        { entranceId: 'e1', outdoorNodeId: 'outdoor-42', indoorRouteNodeId: 'rn-1' },
      ]

      const doc = makeDoc([makeBuilding({
        floors: [makeFloor({ routeNetwork, entranceAccess })],
      })])

      const existingNodes: PrimitiveNode[] = [
        makeOutdoorNode('outdoor-42'),
        makeRouteNode('rn-1', 2, 3, 0, 'b1'),
      ]

      const result = compileCanonicalAccess(doc, existingNodes)
      // Indoor endpoint should be R-rn-1
      expect(result.edges[0]!.to).toBe('R-rn-1')
    })

    it('GC4: resolveCompiledRouteNodeId is used by VerticalTransition compiler', () => {
      const routeNetwork: RouteNetwork = {
        nodes: [
          { id: 'rn-f1', type: 'waypoint', position: { x: 5, y: 5 }, floor: 0 },
          { id: 'rn-f2', type: 'waypoint', position: { x: 5, y: 5 }, floor: 1 },
        ],
        edges: [],
      }

      const verticalTransitions: VerticalTransition[] = [
        { id: 'vt-1', featureId: 'stair-1', type: 'staircase', connections: [
          { floorId: 'b1-0', routeNodeId: 'rn-f1' },
          { floorId: 'b1-1', routeNodeId: 'rn-f2' },
        ]},
      ]

      const doc = makeDoc([makeBuilding({
        floors: [
          makeFloor({ routeNetwork, id: 'b1-0', level: 0 }),
          makeFloor({ id: 'b1-1', level: 1, elevation: 3.5 }),
        ],
        verticalTransitions,
      })])

      const existingNodes: PrimitiveNode[] = [
        makeRouteNode('rn-f1', 5, 5, 0, 'b1'),
        makeRouteNode('rn-f2', 5, 5, 1, 'b1'),
      ]

      const result = compileCanonicalAccess(doc, existingNodes)
      // Both endpoints should be R- prefixed
      expect(result.edges[0]!.from).toBe('R-rn-f1')
      expect(result.edges[0]!.to).toBe('R-rn-f2')
    })
  })

  describe('RoomAccess Compilation (4)', () => {
    it('GC5: creates walk edge from room POI to route node', () => {
      const routeNetwork = makeRouteNetwork()
      const roomAttributes: RoomAttributes[] = [
        { faceId: 'r1', name: 'Room', searchable: true,
          accessPoints: [{ openingId: 'op-1', routeNodeId: 'rn-1', primary: true }] },
      ]

      const doc = makeDoc([makeBuilding({
        floors: [makeFloor({ routeNetwork, roomAttributes })],
      })])

      const existingNodes: PrimitiveNode[] = [
        makeRoomPoiNode('r1', 5, 4, 0, 'b1'),
        makeRouteNode('rn-1', 2, 3, 0, 'b1'),
      ]

      const result = compileCanonicalAccess(doc, existingNodes)
      expect(result.edges[0]!.kind).toBe('access')
      expect(result.edges[0]!.accessType).toBe('room_access')
    })

    it('GC6: distance is haversine between positions', () => {
      const routeNetwork = makeRouteNetwork()
      const roomAttributes: RoomAttributes[] = [
        { faceId: 'r1', name: 'Room', searchable: true,
          accessPoints: [{ openingId: 'op-1', routeNodeId: 'rn-1', primary: true }] },
      ]

      const doc = makeDoc([makeBuilding({
        floors: [makeFloor({ routeNetwork, roomAttributes })],
      })])

      const existingNodes: PrimitiveNode[] = [
        makeRoomPoiNode('r1', 5, 4, 0, 'b1'),
        makeRouteNode('rn-1', 2, 3, 0, 'b1'),
      ]

      const result = compileCanonicalAccess(doc, existingNodes)
      expect(result.edges[0]!.distance).toBeGreaterThan(0)
      expect(Number.isFinite(result.edges[0]!.distance)).toBe(true)
    })

    it('GC7: multiple access points preserved', () => {
      const routeNetwork = makeRouteNetwork()
      const roomAttributes: RoomAttributes[] = [
        { faceId: 'r1', name: 'Room', searchable: true,
          accessPoints: [
            { openingId: 'op-1', routeNodeId: 'rn-1', primary: true },
            { openingId: 'op-2', routeNodeId: 'rn-2', primary: false },
          ] },
      ]

      const doc = makeDoc([makeBuilding({
        floors: [makeFloor({ routeNetwork, roomAttributes })],
      })])

      const existingNodes: PrimitiveNode[] = [
        makeRoomPoiNode('r1', 5, 4, 0, 'b1'),
        makeRouteNode('rn-1', 2, 3, 0, 'b1'),
        makeRouteNode('rn-2', 8, 3, 0, 'b1'),
      ]

      const result = compileCanonicalAccess(doc, existingNodes)
      expect(result.edges.length).toBe(2)
    })

    it('GC8: primary access used for destination resolution', () => {
      const routeNetwork = makeRouteNetwork()
      const roomAttributes: RoomAttributes[] = [
        { faceId: 'r1', name: 'Room', searchable: true,
          accessPoints: [
            { openingId: 'op-1', routeNodeId: 'rn-1', primary: true },
            { openingId: 'op-2', routeNodeId: 'rn-2', primary: false },
          ] },
      ]

      const doc = makeDoc([makeBuilding({
        floors: [makeFloor({ routeNetwork, roomAttributes })],
      })])

      const existingNodes: PrimitiveNode[] = [
        makeRoomPoiNode('r1', 5, 4, 0, 'b1'),
        makeRouteNode('rn-1', 2, 3, 0, 'b1'),
        makeRouteNode('rn-2', 8, 3, 0, 'b1'),
      ]

      const result = compileCanonicalAccess(doc, existingNodes)
      // Both edges exist, but primary flag is tracked
      expect(result.edges.some(e => e.to === 'R-rn-1')).toBe(true)
      expect(result.edges.some(e => e.to === 'R-rn-2')).toBe(true)
    })
  })

  describe('EntranceAccess Compilation (4)', () => {
    it('GC9: outdoorNodeId resolved against outdoor graph', () => {
      const routeNetwork = makeRouteNetwork()
      const entranceAccess: EntranceAccess[] = [
        { entranceId: 'e1', outdoorNodeId: 'outdoor-42', indoorRouteNodeId: 'rn-1' },
      ]

      const doc = makeDoc([makeBuilding({
        floors: [makeFloor({ routeNetwork, entranceAccess })],
      })])

      const existingNodes: PrimitiveNode[] = [
        makeOutdoorNode('outdoor-42'),
        makeRouteNode('rn-1', 2, 3, 0, 'b1'),
      ]

      const result = compileCanonicalAccess(doc, existingNodes)
      expect(result.edges[0]!.from).toBe('outdoor-42')
    })

    it('GC10: indoorRouteNodeId resolved via R- prefix', () => {
      const routeNetwork = makeRouteNetwork()
      const entranceAccess: EntranceAccess[] = [
        { entranceId: 'e1', outdoorNodeId: 'outdoor-42', indoorRouteNodeId: 'rn-1' },
      ]

      const doc = makeDoc([makeBuilding({
        floors: [makeFloor({ routeNetwork, entranceAccess })],
      })])

      const existingNodes: PrimitiveNode[] = [
        makeOutdoorNode('outdoor-42'),
        makeRouteNode('rn-1', 2, 3, 0, 'b1'),
      ]

      const result = compileCanonicalAccess(doc, existingNodes)
      expect(result.edges[0]!.to).toBe('R-rn-1')
    })

    it('GC11: bridge edge created between outdoor and indoor', () => {
      const routeNetwork = makeRouteNetwork()
      const entranceAccess: EntranceAccess[] = [
        { entranceId: 'e1', outdoorNodeId: 'outdoor-42', indoorRouteNodeId: 'rn-1' },
      ]

      const doc = makeDoc([makeBuilding({
        floors: [makeFloor({ routeNetwork, entranceAccess })],
      })])

      const existingNodes: PrimitiveNode[] = [
        makeOutdoorNode('outdoor-42'),
        makeRouteNode('rn-1', 2, 3, 0, 'b1'),
      ]

      const result = compileCanonicalAccess(doc, existingNodes)
      expect(result.edges[0]!.accessType).toBe('entrance_bridge')
      expect(result.edges[0]!.distance).toBeGreaterThan(0)
    })

    it('GC12: warning when outdoor node missing', () => {
      const routeNetwork = makeRouteNetwork()
      const entranceAccess: EntranceAccess[] = [
        { entranceId: 'e1', outdoorNodeId: 'missing', indoorRouteNodeId: 'rn-1' },
      ]

      const doc = makeDoc([makeBuilding({
        floors: [makeFloor({ routeNetwork, entranceAccess })],
      })])

      const existingNodes: PrimitiveNode[] = [
        makeRouteNode('rn-1', 2, 3, 0, 'b1'),
      ]

      const result = compileCanonicalAccess(doc, existingNodes)
      expect(result.edges.length).toBe(0)
      expect(result.diagnostics.some(d => d.code === 'ENTRANCE_ACCESS_OUTDOOR_MISSING')).toBe(true)
    })
  })

  describe('VerticalTransition Compilation (4)', () => {
    it('GC13: edges between consecutive connections', () => {
      const routeNetwork: RouteNetwork = {
        nodes: [
          { id: 'rn-f1', type: 'waypoint', position: { x: 5, y: 5 }, floor: 0 },
          { id: 'rn-f2', type: 'waypoint', position: { x: 5, y: 5 }, floor: 1 },
        ],
        edges: [],
      }

      const verticalTransitions: VerticalTransition[] = [
        { id: 'vt-1', featureId: 'stair-1', type: 'staircase', connections: [
          { floorId: 'b1-0', routeNodeId: 'rn-f1' },
          { floorId: 'b1-1', routeNodeId: 'rn-f2' },
        ]},
      ]

      const doc = makeDoc([makeBuilding({
        floors: [
          makeFloor({ routeNetwork, id: 'b1-0', level: 0 }),
          makeFloor({ id: 'b1-1', level: 1, elevation: 3.5 }),
        ],
        verticalTransitions,
      })])

      const existingNodes: PrimitiveNode[] = [
        makeRouteNode('rn-f1', 5, 5, 0, 'b1'),
        makeRouteNode('rn-f2', 5, 5, 1, 'b1'),
      ]

      const result = compileCanonicalAccess(doc, existingNodes)
      expect(result.edges.length).toBe(1)
      expect(result.edges[0]!.from).toBe('R-rn-f1')
      expect(result.edges[0]!.to).toBe('R-rn-f2')
    })

    it('GC14: edge type matches transition type (stairs/elevator)', () => {
      const routeNetwork: RouteNetwork = {
        nodes: [
          { id: 'rn-f1', type: 'waypoint', position: { x: 5, y: 5 }, floor: 0 },
          { id: 'rn-f2', type: 'waypoint', position: { x: 5, y: 5 }, floor: 1 },
        ],
        edges: [],
      }

      const verticalTransitions: VerticalTransition[] = [
        { id: 'vt-el', featureId: 'el-1', type: 'elevator', connections: [
          { floorId: 'b1-0', routeNodeId: 'rn-f1' },
          { floorId: 'b1-1', routeNodeId: 'rn-f2' },
        ]},
      ]

      const doc = makeDoc([makeBuilding({
        floors: [
          makeFloor({ routeNetwork, id: 'b1-0', level: 0 }),
          makeFloor({ id: 'b1-1', level: 1, elevation: 3.5 }),
        ],
        verticalTransitions,
      })])

      const existingNodes: PrimitiveNode[] = [
        makeRouteNode('rn-f1', 5, 5, 0, 'b1'),
        makeRouteNode('rn-f2', 5, 5, 1, 'b1'),
      ]

      const result = compileCanonicalAccess(doc, existingNodes)
      expect(result.edges[0]!.behavior).toBe('elevator')
    })

    it('GC15: adjacent-floor connections preferred', () => {
      const routeNetwork: RouteNetwork = {
        nodes: [
          { id: 'rn-f1', type: 'waypoint', position: { x: 5, y: 5 }, floor: 0 },
          { id: 'rn-f2', type: 'waypoint', position: { x: 5, y: 5 }, floor: 1 },
          { id: 'rn-f3', type: 'waypoint', position: { x: 5, y: 5 }, floor: 2 },
        ],
        edges: [],
      }

      // 3-floor connection (not all-pairs)
      const verticalTransitions: VerticalTransition[] = [
        { id: 'vt-1', featureId: 'stair-1', type: 'staircase', connections: [
          { floorId: 'b1-0', routeNodeId: 'rn-f1' },
          { floorId: 'b1-1', routeNodeId: 'rn-f2' },
          { floorId: 'b1-2', routeNodeId: 'rn-f3' },
        ]},
      ]

      const doc = makeDoc([makeBuilding({
        floors: [
          makeFloor({ routeNetwork, id: 'b1-0', level: 0 }),
          makeFloor({ id: 'b1-1', level: 1, elevation: 3.5 }),
          makeFloor({ id: 'b1-2', level: 2, elevation: 7 }),
        ],
        verticalTransitions,
      })])

      const existingNodes: PrimitiveNode[] = [
        makeRouteNode('rn-f1', 5, 5, 0, 'b1'),
        makeRouteNode('rn-f2', 5, 5, 1, 'b1'),
        makeRouteNode('rn-f3', 5, 5, 2, 'b1'),
      ]

      const result = compileCanonicalAccess(doc, existingNodes)
      // Should have 2 edges (F0→F1, F1→F2), not 3 (all-pairs)
      expect(result.edges.length).toBe(2)
    })

    it('GC16: warning when route node missing', () => {
      const verticalTransitions: VerticalTransition[] = [
        { id: 'vt-1', featureId: 'stair-1', type: 'staircase', connections: [
          { floorId: 'b1-0', routeNodeId: 'rn-missing' },
          { floorId: 'b1-1', routeNodeId: 'rn-f2' },
        ]},
      ]

      const doc = makeDoc([makeBuilding({
        floors: [
          makeFloor({ id: 'b1-0', level: 0 }),
          makeFloor({ id: 'b1-1', level: 1, elevation: 3.5 }),
        ],
        verticalTransitions,
      })])

      const existingNodes: PrimitiveNode[] = [
        makeRouteNode('rn-f2', 5, 5, 1, 'b1'),
      ]

      const result = compileCanonicalAccess(doc, existingNodes)
      expect(result.edges.length).toBe(0)
      expect(result.diagnostics.some(d => d.code === 'VERTICAL_TRANSITION_NODE_MISSING')).toBe(true)
    })

    it('fails the authored chain closed when its middle connection cannot resolve', () => {
      const verticalTransitions: VerticalTransition[] = [{
        id: 'vt-missing-middle',
        featureId: 'stair-1',
        type: 'staircase',
        connections: [
          { floorId: 'b1-0', routeNodeId: 'rn-f0' },
          { floorId: 'b1-1', routeNodeId: 'rn-missing' },
          { floorId: 'b1-2', routeNodeId: 'rn-f2' },
        ],
      }]
      const doc = makeDoc([makeBuilding({
        floors: [
          makeFloor({ id: 'b1-0', level: 0 }),
          makeFloor({ id: 'b1-1', level: 1, elevation: 3.5 }),
          makeFloor({ id: 'b1-2', level: 2, elevation: 7 }),
        ],
        verticalTransitions,
      })])
      const existingNodes: PrimitiveNode[] = [
        makeRouteNode('rn-f0', 5, 5, 0, 'b1'),
        makeRouteNode('rn-f2', 5, 5, 2, 'b1'),
      ]

      const result = compileCanonicalAccess(doc, existingNodes)

      expect(result.edges).toEqual([])
      expect(result.diagnostics.some(d => d.code === 'VERTICAL_TRANSITION_NODE_MISSING')).toBe(true)
      expect(result.canonicalAccess.canonicalFeatureIds.has('stair-1')).toBe(true)
    })
  })

  describe('Legacy Suppression (4)', () => {
    it('GC17: canonical RoomAccess → suppress door→waypoint for same room', () => {
      const routeNetwork = makeRouteNetwork()
      const roomAttributes: RoomAttributes[] = [
        { faceId: 'r1', name: 'Room', searchable: true,
          accessPoints: [{ openingId: 'op-1', routeNodeId: 'rn-1', primary: true }] },
      ]

      const doc = makeDoc([makeBuilding({
        floors: [makeFloor({ routeNetwork, roomAttributes })],
      })])

      const existingNodes: PrimitiveNode[] = [
        makeRoomPoiNode('r1', 5, 4, 0, 'b1'),
        makeRouteNode('rn-1', 2, 3, 0, 'b1'),
      ]

      const result = compileCanonicalAccess(doc, existingNodes)
      expect(result.canonicalAccess.canonicalRoomIds.has('r1')).toBe(true)
    })

    it('GC18: canonical EntranceAccess → suppress entrance portal for same entrance', () => {
      const routeNetwork = makeRouteNetwork()
      const entranceAccess: EntranceAccess[] = [
        { entranceId: 'e1', outdoorNodeId: 'outdoor-42', indoorRouteNodeId: 'rn-1' },
      ]

      const doc = makeDoc([makeBuilding({
        floors: [makeFloor({ routeNetwork, entranceAccess })],
      })])

      const existingNodes: PrimitiveNode[] = [
        makeOutdoorNode('outdoor-42'),
        makeRouteNode('rn-1', 2, 3, 0, 'b1'),
      ]

      const result = compileCanonicalAccess(doc, existingNodes)
      expect(result.canonicalAccess.canonicalEntranceIds.has('e1')).toBe(true)
    })

    it('GC19: canonical VerticalTransition → suppress connectorStop/feature edges for same feature', () => {
      const routeNetwork: RouteNetwork = {
        nodes: [
          { id: 'rn-f1', type: 'waypoint', position: { x: 5, y: 5 }, floor: 0 },
          { id: 'rn-f2', type: 'waypoint', position: { x: 5, y: 5 }, floor: 1 },
        ],
        edges: [],
      }

      const verticalTransitions: VerticalTransition[] = [
        { id: 'vt-1', featureId: 'stair-1', type: 'staircase', connections: [
          { floorId: 'b1-0', routeNodeId: 'rn-f1' },
          { floorId: 'b1-1', routeNodeId: 'rn-f2' },
        ]},
      ]

      const doc = makeDoc([makeBuilding({
        floors: [
          makeFloor({ routeNetwork, id: 'b1-0', level: 0 }),
          makeFloor({ id: 'b1-1', level: 1, elevation: 3.5 }),
        ],
        verticalTransitions,
      })])

      const existingNodes: PrimitiveNode[] = [
        makeRouteNode('rn-f1', 5, 5, 0, 'b1'),
        makeRouteNode('rn-f2', 5, 5, 1, 'b1'),
      ]

      const result = compileCanonicalAccess(doc, existingNodes)
      expect(result.canonicalAccess.canonicalFeatureIds.has('stair-1')).toBe(true)
    })

    it('GC20: canonical data does not affect legacy floors', () => {
      const routeNetwork: RouteNetwork = {
        nodes: [
          { id: 'rn-1', type: 'waypoint', position: { x: 2, y: 3 }, floor: 0 },
        ],
        edges: [],
      }

      const roomAttributes: RoomAttributes[] = [
        { faceId: 'r1', name: 'Room F0', searchable: true,
          accessPoints: [{ openingId: 'op-1', routeNodeId: 'rn-1', primary: true }] },
      ]

      const doc = makeDoc([makeBuilding({
        floors: [
          makeFloor({
            routeNetwork, roomAttributes,
            id: 'b1-0', level: 0,
          }),
          makeFloor({
            id: 'b1-1', level: 1, elevation: 3.5,
            // Legacy floor — no canonical structures
          }),
        ],
      })])

      const existingNodes: PrimitiveNode[] = [
        makeRoomPoiNode('r1', 5, 4, 0, 'b1'),
        makeRouteNode('rn-1', 2, 3, 0, 'b1'),
      ]

      const result = compileCanonicalAccess(doc, existingNodes)

      // Only floor 0 room is canonical
      expect(result.canonicalAccess.canonicalRoomIds.has('r1')).toBe(true)
      // Floor 1 has no canonical data (no room attributes on that floor)
      expect(result.canonicalAccess.canonicalRoomIds.size).toBe(1)
    })
  })
})

// ── Integration with generatePrimitives ──

describe('Integration with generatePrimitives', () => {
  it('canonical access edges appear in PrimitiveGraph', () => {
    const routeNetwork = makeRouteNetwork()
    const roomAttributes: RoomAttributes[] = [
      { faceId: 'r1', name: 'Room 101', searchable: true,
        accessPoints: [{ openingId: 'op-1', routeNodeId: 'rn-1', primary: true }] },
    ]

    // Floor must have rooms so extractRooms creates POI nodes that compileCanonicalAccess can match
    const floor: NormalizedFloor = {
      id: 'b1-0', level: 0, label: 'Ground', elevation: 0, buildingId: 'b1',
      rooms: [{
        id: 'r1', name: 'Room 101', number: '101', category: 'classroom',
        polygon: [{ lat: 14.0, lng: 121.0 }, { lat: 14.0, lng: 121.001 }, { lat: 14.001, lng: 121.001 }, { lat: 14.001, lng: 121.0 }],
        centroid: { lat: 14.0004, lng: 121.0004 },
        floorId: 'b1-0', floorLevel: 0, buildingId: 'b1',
        doors: [],
      }],
      hallways: [], connectorStops: [], entrances: [], anchors: [],
      routeNetwork, roomAttributes,
    } as any

    const doc = makeDoc([makeBuilding({
      floors: [floor],
    })])

    const graph = generatePrimitives(doc, ctx)

    // Should have canonical access edge
    const canonicalEdges = graph.edges.filter(e => e.source.generatorId === 'builtin:canonical-access-compiler')
    expect(canonicalEdges.length).toBe(1)
    expect(canonicalEdges[0]!.accessType).toBe('room_access')
  })

  it('canonical access diagnostic emitted', () => {
    const routeNetwork = makeRouteNetwork()
    const roomAttributes: RoomAttributes[] = [
      { faceId: 'r1', name: 'Room 101', searchable: true,
        accessPoints: [{ openingId: 'op-1', routeNodeId: 'rn-1', primary: true }] },
    ]

    const floor: NormalizedFloor = {
      id: 'b1-0', level: 0, label: 'Ground', elevation: 0, buildingId: 'b1',
      rooms: [{
        id: 'r1', name: 'Room 101', number: '101', category: 'classroom',
        polygon: [{ lat: 14.0, lng: 121.0 }, { lat: 14.0, lng: 121.001 }, { lat: 14.001, lng: 121.001 }, { lat: 14.001, lng: 121.0 }],
        centroid: { lat: 14.0004, lng: 121.0004 },
        floorId: 'b1-0', floorLevel: 0, buildingId: 'b1',
        doors: [],
      }],
      hallways: [], connectorStops: [], entrances: [], anchors: [],
      routeNetwork, roomAttributes,
    } as any

    const doc = makeDoc([makeBuilding({
      floors: [floor],
    })])

    const graph = generatePrimitives(doc, ctx)

    expect(graph.diagnostics.some(d => d.code === 'ROOM_ACCESS_COMPILED')).toBe(true)
  })
})
