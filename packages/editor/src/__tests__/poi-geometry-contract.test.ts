import { describe, expect, it } from 'vitest'
import type { CampusDocument, Floor } from '@navi/core'
import { CoordinateTransformer } from '@navi/core'
import { Graph } from '@/engine/graph'
import { serializeSnapshot, type GraphSnapshotLike } from '@/services/graph-snapshot-serializer'
import type { GraphSnapshot } from '@/types/nav-types'
import { CommandDispatcher } from '../commands/dispatcher'
import { CommandRegistry } from '../commands/registry'
import { poiCreateHandler, poiDeleteHandler, poiUpdateHandler } from '../commands/feature-handlers'
import { DocumentEventBus } from '../eventbus'
import { HistoryStack } from '../history'
import { GraphAdapter } from '../graph-adapter'
import { DocumentStore } from '../context/document-store'
import { createDocument } from '../context/create-editor-context'

const FOOTPRINT = [
  { lat: 33.42, lng: -111.93 },
  { lat: 33.421, lng: -111.93 },
  { lat: 33.421, lng: -111.929 },
  { lat: 33.42, lng: -111.929 },
  { lat: 33.42, lng: -111.93 },
]

const SHAPES = [
  { type: 'point', position: { x: 1, y: 2 } },
  { type: 'circle', center: { x: 3, y: 4 }, radius: 2.5 },
  { type: 'rectangle', min: { x: -2, y: -1 }, max: { x: 5, y: 6 } },
  { type: 'polygon', points: [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 5, y: 4 }, { x: 1, y: 5 }] },
] as const

function makeFloor(): Floor {
  return {
    id: 'floor-ground',
    level: 0,
    label: 'Ground Floor',
    elevation: 0,
    height: 3.5,
    rooms: [],
    hallways: [],
    staircases: [],
    elevators: [],
    entrances: [],
    connectorStops: [],
    parametricComponents: [],
    routeNetwork: {
      nodes: [
        { id: 'route-a', type: 'waypoint', position: { x: 0, y: 0 }, floor: 0 },
        { id: 'route-b', type: 'waypoint', position: { x: 10, y: 0 }, floor: 0 },
      ],
      edges: [
        { id: 'route-edge-ab', from: 'route-a', to: 'route-b', type: 'walk', distance: 10 },
      ],
    },
    pois: [],
    metadata: { fixture: 'phase-3b' },
  }
}

function makeDocument(): CampusDocument {
  const roads = [
    {
      id: 'road-east-west',
      name: 'East West Road',
      polyline: { points: [{ lat: 33.4205, lng: -111.931 }, { lat: 33.4205, lng: -111.928 }] },
      width: 5,
      surface: 'paved' as const,
      type: 'arterial' as const,
      metadata: { lanes: 2 },
    },
    {
      id: 'road-north-south',
      name: 'North South Road',
      polyline: { points: [{ lat: 33.4195, lng: -111.9295 }, { lat: 33.4215, lng: -111.9295 }] },
      width: 4,
      surface: 'concrete' as const,
      type: 'arterial' as const,
      metadata: { lanes: 1 },
    },
  ]

  return {
    schemaVersion: 1,
    version: 0,
    metadata: {
      campusId: 'phase-3b-poi-contract',
      name: 'Phase 3B POI Contract',
      description: 'Unified geometry contract fixture',
      lastModified: '2026-09-12T00:00:00.000Z',
      editorVersion: 'phase-3b-test',
    },
    buildings: [{
      id: 'building-poi-fixture',
      name: 'POI Fixture Building',
      code: 'POI',
      category: 'academic',
      description: 'Phase 3B fixture',
      footprint: { points: FOOTPRINT },
      baseElevation: 0,
      height: 18,
      floors: [makeFloor()],
      verticalConnectors: [],
      aliases: [],
      color: '#336699',
      metadata: { fixture: true },
    }],
    roads,
    panoramas: [],
    qrCheckpoints: [],
    areas: [{
      id: 'area-plaza-1',
      name: 'Engineering Plaza',
      points: [
        { lat: 33.4202, lng: -111.9298 },
        { lat: 33.4202, lng: -111.9292 },
        { lat: 33.4208, lng: -111.9292 },
        { lat: 33.4208, lng: -111.9298 },
        { lat: 33.4202, lng: -111.9298 },
      ],
      color: '#8B5CF6',
    }],
    roadJunctions: [{
      id: 'junction-poi-fixture',
      position: { lat: 33.4205, lng: -111.9295 },
      roadIds: roads.map(road => road.id),
      source: 'authored',
    }],
  }
}

function registerBuilding(transformer: CoordinateTransformer): void {
  transformer.registerBuilding({
    buildingId: 'building-poi-fixture',
    origin: FOOTPRINT[0],
    rotation: 0,
  })
}

function makeHistory(document: CampusDocument): {
  dispatcher: CommandDispatcher
  history: HistoryStack
} {
  const eventBus = new DocumentEventBus()
  const documentStore = new DocumentStore(document, eventBus)
  const registry = new CommandRegistry()
  registry.register(poiCreateHandler)
  registry.register(poiUpdateHandler)
  registry.register(poiDeleteHandler)
  const dispatcher = new CommandDispatcher(registry, document, eventBus)
  const history = new HistoryStack(dispatcher, document, registry, 20, documentStore)
  dispatcher.addPreHook(history)
  dispatcher.addPostHook(history)
  return { dispatcher, history }
}

function graphRoundTrip(document: CampusDocument, transformer: CoordinateTransformer): {
  graph: Graph
  restored: CampusDocument
} {
  const graph = new Graph()
  graph.campusId = document.metadata.campusId
  new GraphAdapter(graph, transformer).sync(document)
  const rpcPayload = serializeSnapshot(graph.toJSON() as unknown as GraphSnapshotLike)
  const persisted = JSON.parse(JSON.stringify(rpcPayload)) as unknown as GraphSnapshot
  const reloadedGraph = Graph.fromJSON(persisted)
  return {
    graph,
    restored: createDocument(reloadedGraph, transformer),
  }
}

function topologySnapshot(document: CampusDocument): unknown {
  return {
    roads: document.roads.map(road => ({
      id: road.id,
      polyline: structuredClone(road.polyline),
      width: road.width,
      surface: road.surface,
      type: road.type,
    })),
    roadJunctions: structuredClone(document.roadJunctions),
    separatedCrossings: structuredClone(document.separatedCrossings),
    routeNetworks: document.buildings.flatMap(building => building.floors.map(floor => ({
      buildingId: building.id,
      floorId: floor.id,
      routeNetwork: structuredClone(floor.routeNetwork),
    }))),
  }
}

function stableNodeKey(node: Graph['nodes'][number]): string {
  const metadata = node.metadata ?? {}
  const traceId = typeof metadata.traceId === 'string' ? metadata.traceId : ''
  const traceIds = Array.isArray(metadata.traceIds)
    ? metadata.traceIds.filter((value): value is string => typeof value === 'string').sort().join(',')
    : ''
  const roadEndpoint = metadata.roadEndpoint === true ? 'endpoint' : ''
  const authoredJunction = node.id === 'junction-poi-fixture' ? node.id : ''
  return [
    authoredJunction,
    node.type,
    node.buildingId,
    node.floor,
    node.position.lat.toFixed(12),
    node.position.lng.toFixed(12),
    traceId,
    traceIds,
    roadEndpoint,
  ].join('|')
}

function derivedTopologySnapshot(graph: Graph): unknown {
  return {
    nodes: graph.nodes.map(node => stableNodeKey(node)).sort(),
    edges: graph.edges.map(edge => ({
      from: stableNodeKey(graph.nodes.find(node => node.id === edge.from)!),
      to: stableNodeKey(graph.nodes.find(node => node.id === edge.to)!),
      type: edge.type,
      distance: edge.distance,
      weight: edge.weight,
    })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  }
}

describe('Phase 3B unified POI geometry contract', () => {
  it('creates legacy points and all four geometry variants in canonical Floor.pois only', () => {
    const document = makeDocument()
    const { dispatcher } = makeHistory(document)

    expect(dispatcher.execute({
      id: 'poi.create',
      label: 'Create legacy point',
      payload: {
        id: 'poi-legacy-point',
        buildingId: 'building-poi-fixture',
        floorId: 'floor-ground',
        name: 'Legacy Point',
        category: 'other',
        position: { x: 1, y: 2 },
      },
    }).success).toBe(true)

    for (const [index, geometry] of SHAPES.entries()) {
      expect(dispatcher.execute({
        id: 'poi.create',
        label: `Create ${geometry.type}`,
        payload: {
          id: `poi-${geometry.type}-${index}`,
          buildingId: 'building-poi-fixture',
          floorId: 'floor-ground',
          name: `${geometry.type} POI`,
          category: 'information',
          geometry,
          metadata: { authoredBy: 'phase-3b-test' },
        },
      }).success).toBe(true)
    }

    const pois = document.buildings[0].floors[0].pois!
    expect(pois).toHaveLength(5)
    expect(pois[0]).toMatchObject({ id: 'poi-legacy-point', position: { x: 1, y: 2 } })
    expect(pois[0]).not.toHaveProperty('geometry')
    expect(pois.slice(1).map(poi => poi.geometry)).toEqual(SHAPES)
    expect(pois.slice(1).every(poi => !('position' in poi))).toBe(true)
    expect((document as CampusDocument & { pois?: unknown }).pois).toBeUndefined()
  })

  it('rejects invalid and dual-source create/update payloads without mutation', () => {
    const document = makeDocument()
    const { dispatcher } = makeHistory(document)
    const before = structuredClone(document)

    const invalidCreate = dispatcher.execute({
      id: 'poi.create',
      label: 'Reject invalid circle',
      payload: {
        id: 'poi-invalid',
        buildingId: 'building-poi-fixture',
        floorId: 'floor-ground',
        name: 'Invalid Circle',
        category: 'other',
        geometry: { type: 'circle', center: { x: 0, y: 0 }, radius: 0 },
      },
    })
    expect(invalidCreate.success).toBe(false)
    expect(document).toEqual(before)

    const validCreate = dispatcher.execute({
      id: 'poi.create',
      label: 'Create point',
      payload: {
        id: 'poi-dual-source',
        buildingId: 'building-poi-fixture',
        floorId: 'floor-ground',
        name: 'Dual Source',
        category: 'other',
        position: { x: 2, y: 3 },
      },
    })
    expect(validCreate.success).toBe(true)
    const beforeDualUpdate = structuredClone(document)

    const invalidUpdate = dispatcher.execute({
      id: 'poi.update',
      label: 'Reject dual source update',
      payload: {
        poiId: 'poi-dual-source',
        patch: {
          position: { x: 4, y: 5 },
          geometry: { type: 'circle', center: { x: 4, y: 5 }, radius: 1 },
        },
      },
    })
    expect(invalidUpdate.success).toBe(false)
    expect(document).toEqual(beforeDualUpdate)
  })

  it('switches geometry through specialized commands while undo/redo restores the exact representation and stable ID', () => {
    const document = makeDocument()
    const { dispatcher, history } = makeHistory(document)
    const create = dispatcher.execute({
      id: 'poi.create',
      label: 'Create circle',
      payload: {
        id: 'poi-history-shape',
        buildingId: 'building-poi-fixture',
        floorId: 'floor-ground',
        name: 'History Shape',
        category: 'other',
        geometry: SHAPES[1],
      },
    })
    expect(create.success).toBe(true)
    const circle = structuredClone(document.buildings[0].floors[0].pois![0])

    expect(dispatcher.execute({
      id: 'poi.update',
      label: 'Update to polygon',
      payload: {
        poiId: 'poi-history-shape',
        patch: { geometry: SHAPES[3], name: 'Updated Shape' },
      },
    }).success).toBe(true)
    const polygon = structuredClone(document.buildings[0].floors[0].pois![0])
    expect(polygon.id).toBe(circle.id)
    expect(polygon).toMatchObject({ geometry: SHAPES[3], name: 'Updated Shape' })
    expect(polygon).not.toHaveProperty('position')

    expect(history.undo()).toBe(true)
    expect(document.buildings[0].floors[0].pois).toEqual([circle])
    expect(history.redo()).toBe(true)
    expect(document.buildings[0].floors[0].pois).toEqual([polygon])

    expect(dispatcher.execute({
      id: 'poi.delete',
      label: 'Delete shape',
      payload: { poiId: 'poi-history-shape' },
    }).success).toBe(true)
    expect(document.buildings[0].floors[0].pois).toEqual([])
    expect(history.undo()).toBe(true)
    expect(document.buildings[0].floors[0].pois).toEqual([polygon])
    expect(history.redo()).toBe(true)
    expect(document.buildings[0].floors[0].pois).toEqual([])
  })

  it('round-trips legacy and explicit point/shape records while migrating legacy Areas', () => {
    const document = makeDocument()
    const floor = document.buildings[0].floors[0]
    floor.pois = [
      { id: 'poi-legacy', name: 'Legacy', category: 'other', position: { x: 1, y: 2 } },
      { id: 'poi-point', name: 'Point', category: 'other', geometry: SHAPES[0] } as never,
      { id: 'poi-circle', name: 'Circle', category: 'other', geometry: SHAPES[1] } as never,
      { id: 'poi-rectangle', name: 'Rectangle', category: 'other', geometry: SHAPES[2] } as never,
      { id: 'poi-polygon', name: 'Polygon', category: 'other', geometry: SHAPES[3] } as never,
    ]
    const transformer = new CoordinateTransformer()
    registerBuilding(transformer)

    const { restored } = graphRoundTrip(document, transformer)

    expect(restored.buildings[0].floors[0].pois).toEqual(floor.pois)
    // The legacy Area fixture is migrated to one outdoor 2D polygon POI.
    expect(restored.areas).toBeUndefined()
    expect(restored.pois).toHaveLength(1)
    expect(restored.pois![0]).toMatchObject({ scope: 'outdoor', appearance: { mode: '2d' } })
  })

  it('keeps authored and derived topology unchanged during shape commands and reload', () => {
    const document = makeDocument()
    const transformer = new CoordinateTransformer()
    registerBuilding(transformer)
    const graph = new Graph()
    graph.campusId = document.metadata.campusId
    const adapter = new GraphAdapter(graph, transformer)
    adapter.sync(document)
    const authoredBefore = topologySnapshot(document)
    const derivedBefore = derivedTopologySnapshot(graph)
    const { dispatcher, history } = makeHistory(document)

    const assertTopologyUnchanged = () => {
      adapter.sync(document)
      expect(topologySnapshot(document)).toEqual(authoredBefore)
      expect(derivedTopologySnapshot(graph)).toEqual(derivedBefore)
    }

    expect(dispatcher.execute({
      id: 'poi.create',
      label: 'Create topology-neutral polygon',
      payload: {
        id: 'poi-topology-neutral',
        buildingId: 'building-poi-fixture',
        floorId: 'floor-ground',
        name: 'Topology Neutral',
        category: 'other',
        geometry: SHAPES[3],
      },
    }).success).toBe(true)
    assertTopologyUnchanged()

    expect(dispatcher.execute({
      id: 'poi.update',
      label: 'Update topology-neutral shape',
      payload: { poiId: 'poi-topology-neutral', patch: { geometry: SHAPES[2] } },
    }).success).toBe(true)
    assertTopologyUnchanged()

    expect(dispatcher.execute({
      id: 'poi.delete',
      label: 'Delete topology-neutral shape',
      payload: { poiId: 'poi-topology-neutral' },
    }).success).toBe(true)
    assertTopologyUnchanged()

    expect(history.undo()).toBe(true)
    assertTopologyUnchanged()
    expect(history.redo()).toBe(true)
    assertTopologyUnchanged()

    const reloaded = graphRoundTrip(document, transformer)
    expect(topologySnapshot(reloaded.restored)).toEqual(authoredBefore)
    expect(derivedTopologySnapshot(reloaded.graph)).toEqual(derivedBefore)
  })
})
