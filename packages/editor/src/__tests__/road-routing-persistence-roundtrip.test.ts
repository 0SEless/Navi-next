import { describe, expect, it } from 'vitest'
import type {
  Building,
  CampusDocument,
  Road,
  RoadDirection,
  RoadJunction,
  RoadRouting,
  RoadRoutingFeature,
  RoadSlope,
} from '@navi/core'
import { Graph } from '../../../../src/engine/graph'
import { GraphAdapter } from '../graph-adapter'
import { createDocument } from '../context/create-editor-context'

const POINTS_A = [
  { lat: 33.42, lng: -111.93 },
  { lat: 33.4205, lng: -111.9295 },
  { lat: 33.421, lng: -111.929 },
]

function makeRoad(id: string, routing?: RoadRouting): Road {
  return {
    id,
    name: id,
    polyline: { points: POINTS_A.map(point => ({ ...point })) },
    width: 5,
    surface: 'paved',
    type: 'arterial',
    displayMode: 'navigation-only',
    ...(routing === undefined ? {} : { routing }),
    metadata: { provenance: 'phase-3-test', manualColor: '#123456' },
  }
}

function makeDocument(
  roads: Road[],
  roadJunctions?: RoadJunction[],
  buildings: Building[] = [],
): CampusDocument {
  return {
    schemaVersion: 1,
    version: 3,
    metadata: {
      campusId: 'phase-3-campus',
      name: 'Phase 3 Campus',
      description: '',
      lastModified: '2026-09-11T00:00:00.000Z',
      editorVersion: 'test',
    },
    buildings,
    roads,
    panoramas: [],
    qrCheckpoints: [],
    ...(roadJunctions === undefined ? {} : { roadJunctions }),
    connectivitySemanticsVersion: '1.0.0',
  }
}

function syncDocument(document: CampusDocument): Graph {
  const graph = new Graph(document.metadata.campusId)
  new GraphAdapter(graph).sync(document)
  return graph
}

function roundTrip(document: CampusDocument) {
  const sourceGraph = syncDocument(document)
  const snapshot = JSON.parse(JSON.stringify(sourceGraph.toJSON()))
  const restoredGraph = Graph.fromJSON(snapshot)
  const reloadedDocument = createDocument(restoredGraph)
  return { sourceGraph, snapshot, restoredGraph, reloadedDocument }
}

function topologyDigest(graph: Graph) {
  const nodeKey = (nodeId: string) => {
    const node = graph.getNode(nodeId)
    if (!node) return `missing:${nodeId}`
    const stableId = /^[NE]\d+$/.test(node.id) ? undefined : node.id
    return JSON.stringify({
      stableId,
      type: node.type,
      position: node.position,
      traceId: node.metadata?.traceId,
      traceIds: node.metadata?.traceIds,
      junctionRecordId: node.metadata?.junctionRecordId,
    })
  }
  return {
    connectedComponentCount: graph.connectedComponentCount,
    nodes: graph.nodes.map(node => ({
      stableId: /^[NE]\d+$/.test(node.id) ? undefined : node.id,
      type: node.type,
      position: node.position,
      traceId: node.metadata?.traceId,
      traceIds: node.metadata?.traceIds,
      junctionRecordId: node.metadata?.junctionRecordId,
    })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    edges: graph.edges.map(edge => ({
      stableId: /^E\d+$/.test(edge.id) ? undefined : edge.id,
      endpoints: [nodeKey(edge.from), nodeKey(edge.to)].sort(),
    })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  }
}

function makeAccessBuilding(): Building {
  return {
    id: 'building-1',
    name: 'Access Building',
    code: 'AB',
    category: 'academic',
    description: '',
    footprint: {
      points: [
        { lat: 33.4202, lng: -111.9298 },
        { lat: 33.4208, lng: -111.9298 },
        { lat: 33.4208, lng: -111.9292 },
        { lat: 33.4202, lng: -111.9292 },
        { lat: 33.4202, lng: -111.9298 },
      ],
    },
    baseElevation: 0,
    height: 10,
    floors: [{
      id: 'floor-0',
      level: 0,
      label: 'Ground',
      elevation: 0,
      height: 3.5,
      rooms: [],
      hallways: [],
      staircases: [],
      elevators: [],
      entrances: [{
        id: 'entrance-1',
        label: 'Main Entrance',
        position: { x: 0, y: 0 },
        level: 0,
        type: 'main',
        hasQR: false,
        hasPanorama: false,
      }],
      routeNetwork: {
        nodes: [
          { id: 'route-start', type: 'waypoint', position: { x: 0, y: 0 }, floor: 0 },
          { id: 'route-next', type: 'waypoint', position: { x: 4, y: 0 }, floor: 0 },
        ],
        edges: [{ id: 'route-edge', from: 'route-start', to: 'route-next', type: 'walk', distance: 4 }],
      },
      entranceAccess: [{
        entranceId: 'entrance-1',
        outdoorNodeId: 'access-road-1',
        indoorRouteNodeId: 'route-start',
        outdoorRouteId: 'road-1',
        outdoorPosition: { ...POINTS_A[1] },
      }],
      connectorStops: [],
      metadata: {},
    }],
    aliases: [],
    verticalConnectors: [],
    color: '#2563eb',
    metadata: {},
  }
}

describe('Road routing graph snapshot round trip', () => {
  it('keeps a legacy Road and Trace routing-absent', () => {
    const road = makeRoad('legacy-road')
    const { snapshot, reloadedDocument } = roundTrip(makeDocument([road]))

    expect(snapshot.traces[0]).not.toHaveProperty('routing')
    expect(reloadedDocument.roads[0]).not.toHaveProperty('routing')
    expect(reloadedDocument.roads[0].id).toBe(road.id)
    expect(reloadedDocument.roads[0].polyline).toEqual(road.polyline)
  })

  it.each<RoadRoutingFeature>(['normal', 'stairs', 'ramp', 'bridge'])(
    'round-trips feature=%s',
    (feature) => {
      const road = makeRoad('feature-road', { feature })
      const { snapshot, reloadedDocument } = roundTrip(makeDocument([road]))

      expect(snapshot.traces[0].routing).toEqual({ feature })
      expect(reloadedDocument.roads[0].routing).toEqual({ feature })
      expect(reloadedDocument.roads[0].polyline).toEqual(road.polyline)
    },
  )

  it.each<RoadSlope>(['level', 'gentle', 'moderate', 'steep'])(
    'round-trips slope=%s',
    (slope) => {
      const road = makeRoad('slope-road', { slope })
      expect(roundTrip(makeDocument([road])).reloadedDocument.roads[0].routing).toEqual({ slope })
    },
  )

  it.each<RoadDirection>(['both', 'forward', 'reverse'])(
    'round-trips direction=%s',
    (direction) => {
      const road = makeRoad('direction-road', { direction })
      expect(roundTrip(makeDocument([road])).reloadedDocument.roads[0].routing).toEqual({ direction })
    },
  )

  it.each([true, false])('round-trips walkable=%s', (walkable) => {
    const road = makeRoad('walkable-road', { walkable })
    expect(roundTrip(makeDocument([road])).reloadedDocument.roads[0].routing).toEqual({ walkable })
  })

  it.each([undefined, true, false])(
    'round-trips wheelchairAccessible=%s without collapsing unknown',
    (wheelchairAccessible) => {
      const road = makeRoad('wheelchair-road', { feature: 'ramp', wheelchairAccessible })
      const routing = roundTrip(makeDocument([road])).reloadedDocument.roads[0].routing

      expect(routing?.feature).toBe('ramp')
      expect(routing?.wheelchairAccessible).toBe(wheelchairAccessible)
    },
  )

  it.each([
    ['start only', { startElevationMeters: 12.5 }],
    ['end only', { endElevationMeters: 18.25 }],
    ['both elevations', { startElevationMeters: 12.5, endElevationMeters: 18.25 }],
    ['numeric zero', { startElevationMeters: 0, endElevationMeters: 0 }],
    ['negative elevation', { startElevationMeters: -3.5, endElevationMeters: -1 }],
    ['cleared elevation', { feature: 'bridge' }],
  ] as const)('round-trips %s', (_label, routing) => {
    const road = makeRoad('elevation-road', routing)
    const restored = roundTrip(makeDocument([road])).reloadedDocument.roads[0]

    expect(restored.routing).toEqual(routing)
    expect(restored.id).toBe(road.id)
    expect(restored.polyline).toEqual(road.polyline)
  })

  it('round-trips a fully populated routing object as one structured payload', () => {
    const routing: RoadRouting = {
      feature: 'stairs',
      slope: 'steep',
      direction: 'reverse',
      startElevationMeters: 0,
      endElevationMeters: -7.5,
      walkable: false,
      wheelchairAccessible: false,
    }
    const road = makeRoad('full-road', routing)
    const { snapshot, reloadedDocument } = roundTrip(makeDocument([road]))

    expect(snapshot.traces[0].routing).toEqual(routing)
    expect(reloadedDocument.roads[0].routing).toEqual(routing)
    expect(snapshot.traces[0].metadata).toEqual({
      provenance: 'phase-3-test',
      manualColor: '#123456',
      surface: 'paved',
    })
  })

  it('round-trips multiple routed Roads mixed with a legacy Road in source order', () => {
    const roads = [
      makeRoad('stairs-road', { feature: 'stairs', slope: 'steep' }),
      makeRoad('legacy-road'),
      makeRoad('ramp-road', { feature: 'ramp', wheelchairAccessible: true }),
    ].map((road, index) => ({
      ...road,
      polyline: {
        points: road.polyline.points.map(point => ({ ...point, lat: point.lat + index * 0.01 })),
      },
    }))
    const { reloadedDocument } = roundTrip(makeDocument(roads))

    expect(reloadedDocument.roads.map(road => road.id)).toEqual(roads.map(road => road.id))
    expect(reloadedDocument.roads.map(road => road.routing)).toEqual([
      { feature: 'stairs', slope: 'steep' },
      undefined,
      { feature: 'ramp', wheelchairAccessible: true },
    ])
    expect(reloadedDocument.roads.map(road => road.polyline)).toEqual(roads.map(road => road.polyline))
  })

  it('discards malformed persisted members while preserving valid siblings', () => {
    const road = makeRoad('malformed-road', {
      feature: 'stairs',
      slope: 'cliff',
      direction: 'forward',
      startElevationMeters: Number.POSITIVE_INFINITY,
      endElevationMeters: -2,
      walkable: 'yes',
      wheelchairAccessible: false,
    } as unknown as RoadRouting)
    const { snapshot, reloadedDocument } = roundTrip(makeDocument([road]))
    const expected = {
      feature: 'stairs',
      direction: 'forward',
      endElevationMeters: -2,
      wheelchairAccessible: false,
    }

    expect(snapshot.traces[0].routing).toEqual(expected)
    expect(reloadedDocument.roads[0].routing).toEqual(expected)
  })

  it('treats a malformed whole routing payload as semantic absence', () => {
    const road = makeRoad('malformed-road', 'stairs' as unknown as RoadRouting)
    const { snapshot, reloadedDocument } = roundTrip(makeDocument([road]))

    expect(snapshot.traces[0]).not.toHaveProperty('routing')
    expect(reloadedDocument.roads[0]).not.toHaveProperty('routing')
  })

  it('defensively normalizes malformed routing received from a persisted Trace', () => {
    const sourceGraph = syncDocument(makeDocument([makeRoad('persisted-malformed')]))
    const snapshot = JSON.parse(JSON.stringify(sourceGraph.toJSON()))
    snapshot.traces[0].routing = {
      feature: 'bridge',
      slope: 'precipice',
      direction: 'reverse',
      startElevationMeters: Number.NEGATIVE_INFINITY,
      endElevationMeters: -8,
      walkable: false,
      wheelchairAccessible: 'unknown',
    }

    const reloadedDocument = createDocument(Graph.fromJSON(snapshot))

    expect(reloadedDocument.roads[0].routing).toEqual({
      feature: 'bridge',
      direction: 'reverse',
      endElevationMeters: -8,
      walkable: false,
    })
    expect(reloadedDocument.roads[0].polyline).toEqual(makeRoad('persisted-malformed').polyline)
  })

  it('does not resurrect a deleted Road or its removed junction during reload', () => {
    const retainedRoad = makeRoad('retained-road', { feature: 'ramp' })
    const { snapshot, reloadedDocument } = roundTrip(makeDocument([retainedRoad]))

    expect(snapshot.traces.map((trace: { id: string }) => trace.id)).toEqual(['retained-road'])
    expect(reloadedDocument.roads.map(road => road.id)).toEqual(['retained-road'])
    expect(reloadedDocument.roadJunctions).toBeUndefined()
  })
})

describe('Road routing persistence topology invariants', () => {
  it.each([
    ['feature', { feature: 'stairs' }],
    ['slope', { slope: 'steep' }],
    ['elevation', { startElevationMeters: -2, endElevationMeters: 5 }],
    ['direction', { direction: 'reverse' }],
    ['accessibility', { walkable: false, wheelchairAccessible: false }],
  ] as const)('keeps geometry, junctions, access, and connectivity unchanged for %s metadata', (_label, routing) => {
    const roadA = makeRoad('road-1', { feature: 'normal' })
    const roadB: Road = {
      ...makeRoad('road-2'),
      polyline: {
        points: [
          { lat: 33.4205, lng: -111.9295 },
          { lat: 33.4215, lng: -111.9295 },
        ],
      },
    }
    const junction: RoadJunction = {
      id: 'junction-authored',
      position: { ...POINTS_A[1] },
      roadIds: ['road-1', 'road-2'],
      source: 'authored',
    }
    const baseline = roundTrip(makeDocument([roadA, roadB], [junction], [makeAccessBuilding()]))
    const changedRoad = { ...roadA, routing }
    const changed = roundTrip(makeDocument([changedRoad, roadB], [junction], [makeAccessBuilding()]))

    expect(topologyDigest(changed.restoredGraph)).toEqual(topologyDigest(baseline.restoredGraph))
    expect(changed.reloadedDocument.roads[0].id).toBe(roadA.id)
    expect(changed.reloadedDocument.roads[0].polyline).toEqual(roadA.polyline)
    expect(changed.reloadedDocument.roadJunctions).toEqual(baseline.reloadedDocument.roadJunctions)
    expect(changed.restoredGraph.edges.filter(edge => edge.id.startsWith('E-access-')).map(edge => edge.id))
      .toEqual(baseline.restoredGraph.edges.filter(edge => edge.id.startsWith('E-access-')).map(edge => edge.id))
  })

  it('keeps outdoor stairs out of indoor staircase and vertical-connector structures', () => {
    const { reloadedDocument } = roundTrip(makeDocument([
      makeRoad('outdoor-stairs', { feature: 'stairs' }),
    ], undefined, [makeAccessBuilding()]))

    expect(reloadedDocument.roads[0].routing?.feature).toBe('stairs')
    expect(reloadedDocument.buildings[0].floors[0].staircases).toEqual([])
    expect(reloadedDocument.buildings[0].verticalConnectors).toEqual([])
  })
})
