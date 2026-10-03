import { describe, expect, it } from 'vitest'
import type {
  Area,
  Building,
  CampusDocument,
  Floor,
  GraphSnapshot,
  PointOfInterest,
  Road,
  RouteNetwork,
} from '@navi/core'
import { CoordinateTransformer } from '@navi/core'
import { Graph } from '@/engine/graph'
import { serializeSnapshot } from '@/services/graph-snapshot-serializer'
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

function makeRouteNetwork(): RouteNetwork {
  return {
    nodes: [
      { id: 'route-a', type: 'waypoint', position: { x: 0, y: 0 }, floor: 0 },
      { id: 'route-b', type: 'waypoint', position: { x: 10, y: 0 }, floor: 0 },
    ],
    edges: [
      { id: 'route-edge-ab', from: 'route-a', to: 'route-b', type: 'walk', distance: 10 },
    ],
  }
}

function makeFixture(): CampusDocument {
  const pois: PointOfInterest[] = [
    {
      id: 'poi-printer-1',
      name: 'Engineering Printer',
      category: 'printer',
      position: { x: 4.25, y: -2.5 },
      metadata: { vendor: 'acme', accessible: true },
    },
    {
      id: 'poi-study-1',
      name: 'Quiet Study Area',
      category: 'study_area',
      position: { x: 8.75, y: 6.125 },
      metadata: { seats: 24, aliases: ['silent room'] },
    },
  ]

  const floor: Floor = {
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
    routeNetwork: makeRouteNetwork(),
    pois,
    metadata: { wing: 'east' },
  }

  const building: Building = {
    id: 'building-poi-fixture',
    name: 'POI Fixture Building',
    code: 'POI',
    category: 'academic',
    description: 'Phase 2 persistence fixture',
    footprint: { points: FOOTPRINT },
    baseElevation: 0,
    height: 18,
    floors: [floor],
    aliases: ['POI Building'],
    verticalConnectors: [],
    color: '#336699',
    metadata: { fixture: true },
  }

  const roads: Road[] = [
    {
      id: 'road-east-west',
      name: 'East West Road',
      polyline: { points: [{ lat: 33.4205, lng: -111.931 }, { lat: 33.4205, lng: -111.928 }] },
      width: 5,
      surface: 'paved',
      type: 'arterial',
      metadata: { lanes: 2 },
    },
    {
      id: 'road-north-south',
      name: 'North South Road',
      polyline: { points: [{ lat: 33.4195, lng: -111.9295 }, { lat: 33.4215, lng: -111.9295 }] },
      width: 4,
      surface: 'concrete',
      type: 'arterial',
      metadata: { lanes: 1 },
    },
  ]

  const area: Area = {
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
  }

  return {
    schemaVersion: 1,
    version: 7,
    metadata: {
      campusId: 'phase-2-poi-fixture',
      name: 'Phase 2 POI Fixture',
      description: 'Lossless POI persistence fixture',
      lastModified: '2026-09-11T00:00:00.000Z',
      editorVersion: 'phase-2-test',
    },
    buildings: [building],
    roads,
    panoramas: [],
    qrCheckpoints: [],
    areas: [area],
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
  const graph = new Graph(document.metadata.campusId)
  new GraphAdapter(graph, transformer).sync(document)
  const rpcPayload = serializeSnapshot(graph.toJSON())
  const persisted = JSON.parse(JSON.stringify(rpcPayload)) as GraphSnapshot
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

describe('Phase 2 canonical POI persistence', () => {
  it('preserves multiple POIs, metadata, local coordinates, and migrates Areas to outdoor POIs on reload', () => {
    const document = makeFixture()
    const transformer = new CoordinateTransformer()
    registerBuilding(transformer)

    const { graph, restored } = graphRoundTrip(document, transformer)

    expect(graph.buildings[0].floorData?.[0]?.pois).toEqual(document.buildings[0].floors[0].pois)
    expect(restored.buildings[0].floors[0].pois).toEqual(document.buildings[0].floors[0].pois)
    // Area records are migrated into outdoor 2D polygon POIs; canonical saves
    // no longer emit a parallel areas[] collection.
    expect(restored.areas).toBeUndefined()
    const migrated = (restored.pois ?? []).find((poi) => poi.id === document.areas![0].id)
    expect(migrated).toMatchObject({
      id: document.areas![0].id,
      name: document.areas![0].name,
      scope: 'outdoor',
      appearance: { mode: '2d', color: document.areas![0].color },
    })
    expect(migrated?.geometry).toEqual({ type: 'polygon', points: document.areas![0].points.slice(0, -1) })
  })

  it('keeps legacy documents with absent POIs absent while migrating legacy Areas', () => {
    const document = makeFixture()
    delete document.buildings[0].floors[0].pois
    const transformer = new CoordinateTransformer()
    registerBuilding(transformer)

    const { restored } = graphRoundTrip(document, transformer)

    expect(restored.buildings[0].floors[0].pois).toBeUndefined()
    expect(restored.areas).toBeUndefined()
    expect(restored.pois).toHaveLength(1)
    expect(restored.pois![0]).toMatchObject({
      id: document.areas![0].id,
      name: document.areas![0].name,
      scope: 'outdoor',
      appearance: { mode: '2d', color: document.areas![0].color },
    })
    expect(restored.pois![0].geometry).toEqual({ type: 'polygon', points: document.areas![0].points.slice(0, -1) })
  })

  it('retains exact POI state through specialized create, update, delete, undo, and redo', () => {
    const document = makeFixture()
    document.buildings[0].floors[0].pois = []
    const { dispatcher, history } = makeHistory(document)
    const createCommand = {
      id: 'poi.create',
      label: 'Create POI',
      payload: {
        id: 'poi-history-1',
        buildingId: 'building-poi-fixture',
        floorId: 'floor-ground',
        name: 'History Printer',
        category: 'printer',
        position: { x: 12.5, y: -4.75 },
        metadata: { source: 'history-test', counter: 2 },
      },
    }

    expect(dispatcher.execute(createCommand).success).toBe(true)
    const created = structuredClone(document.buildings[0].floors[0].pois![0])
    expect(created).toEqual({
      id: 'poi-history-1',
      name: 'History Printer',
      category: 'printer',
      position: { x: 12.5, y: -4.75 },
      metadata: { source: 'history-test', counter: 2 },
    })

    expect(history.undo()).toBe(true)
    expect(document.buildings[0].floors[0].pois).toEqual([])
    expect(history.redo()).toBe(true)
    expect(document.buildings[0].floors[0].pois).toEqual([created])

    expect(dispatcher.execute({
      id: 'poi.update',
      label: 'Update POI',
      payload: {
        poiId: 'poi-history-1',
        patch: {
          name: 'History Printer Updated',
          category: 'information',
          position: { x: 13, y: -5 },
        },
      },
    }).success).toBe(true)
    const updated = {
      ...created,
      name: 'History Printer Updated',
      category: 'information',
      position: { x: 13, y: -5 },
    }
    expect(document.buildings[0].floors[0].pois).toEqual([updated])
    expect(history.undo()).toBe(true)
    expect(document.buildings[0].floors[0].pois).toEqual([created])
    expect(history.redo()).toBe(true)
    expect(document.buildings[0].floors[0].pois).toEqual([updated])

    expect(dispatcher.execute({
      id: 'poi.delete',
      label: 'Delete POI',
      payload: { poiId: 'poi-history-1' },
    }).success).toBe(true)
    expect(document.buildings[0].floors[0].pois).toEqual([])
    expect(history.undo()).toBe(true)
    expect(document.buildings[0].floors[0].pois).toEqual([updated])
    expect(history.redo()).toBe(true)
    expect(document.buildings[0].floors[0].pois).toEqual([])
  })

  it('keeps authored and derived routing topology unchanged during POI operations and save/reload', () => {
    const document = makeFixture()
    const transformer = new CoordinateTransformer()
    registerBuilding(transformer)
    const graph = new Graph(document.metadata.campusId)
    const adapter = new GraphAdapter(graph, transformer)
    adapter.sync(document)
    const authoredBefore = topologySnapshot(document)
    const derivedBefore = derivedTopologySnapshot(graph)
    const existingPois = structuredClone(document.buildings[0].floors[0].pois)
    const { dispatcher, history } = makeHistory(document)

    const executeAndAssertUnchanged = (command: Parameters<CommandDispatcher['execute']>[0]) => {
      expect(dispatcher.execute(command).success).toBe(true)
      adapter.sync(document)
      expect(topologySnapshot(document)).toEqual(authoredBefore)
      expect(derivedTopologySnapshot(graph)).toEqual(derivedBefore)
    }

    executeAndAssertUnchanged({
      id: 'poi.create',
      label: 'Create POI',
      payload: {
        id: 'poi-topology-1',
        buildingId: 'building-poi-fixture',
        floorId: 'floor-ground',
        name: 'Topology Marker',
        category: 'other',
        position: { x: 2, y: 3 },
      },
    })
    executeAndAssertUnchanged({
      id: 'poi.update',
      label: 'Update POI',
      payload: { poiId: 'poi-topology-1', patch: { position: { x: 3, y: 4 } } },
    })
    executeAndAssertUnchanged({
      id: 'poi.delete',
      label: 'Delete POI',
      payload: { poiId: 'poi-topology-1' },
    })

    expect(history.undo()).toBe(true)
    adapter.sync(document)
    expect(topologySnapshot(document)).toEqual(authoredBefore)
    expect(derivedTopologySnapshot(graph)).toEqual(derivedBefore)
    expect(history.redo()).toBe(true)
    adapter.sync(document)
    expect(topologySnapshot(document)).toEqual(authoredBefore)
    expect(derivedTopologySnapshot(graph)).toEqual(derivedBefore)

    const reloaded = graphRoundTrip(document, transformer)
    expect(topologySnapshot(reloaded.restored)).toEqual(authoredBefore)
    expect(derivedTopologySnapshot(reloaded.graph)).toEqual(derivedBefore)
    expect(reloaded.restored.buildings[0].floors[0].pois).toEqual(existingPois)
  })
})
