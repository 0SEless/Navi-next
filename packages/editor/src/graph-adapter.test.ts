import { describe, it, expect } from 'vitest'
import type { CampusDocument, Building, Floor, Entrance, Road, Panorama, QRCheckpoint, RoomAttributes, RoomDoor } from '@navi/core'
import { CoordinateTransformer } from '@navi/core'
import { Graph } from '@/engine/graph'
import { GraphAdapter } from './graph-adapter'
import { createDocument } from './context/create-editor-context'

function createTestDocument(extraBuilding?: Building): CampusDocument {
  const buildings: Building[] = [
    {
      id: 'bld-1',
      name: 'Test Building',
      code: 'TB',
      category: 'academic',
      description: '',
      footprint: {
        points: [
          { lat: 33.42, lng: -111.93 },
          { lat: 33.421, lng: -111.93 },
          { lat: 33.421, lng: -111.929 },
          { lat: 33.42, lng: -111.929 },
          { lat: 33.42, lng: -111.93 },
        ],
      },
      baseElevation: 0,
      height: 20,
      floors: [
        {
          id: 'flr-0',
          level: 0,
          label: 'Ground',
          elevation: 0,
          rooms: [],
          hallways: [],
          staircases: [],
          elevators: [],
          entrances: [
            {
              id: 'ent-1',
              label: 'Main Entrance',
              position: { lat: 33.4205, lng: -111.9295 } as any,
              level: 0,
              type: 'main',
              hasQR: true,
              hasPanorama: true,
            },
          ],
          connectorStops: [
            { id: 'cs-stairA', connectorId: 'conn-stairA', position: { x: 1, y: 1 }, anchors: [], accessible: true, metadata: {} },
          ],
          metadata: {},
        },
      ],
      aliases: [],
      verticalConnectors: [
        { id: 'conn-stairA', type: 'staircase', name: 'Stair A', stopIds: ['cs-stairA'], accessible: true, metadata: {} },
      ],
      color: '#ff0000',
      metadata: {},
    },
  ]

  if (extraBuilding) {
    buildings.push(extraBuilding)
  }

  const roads: Road[] = [
    {
      id: 'road-1',
      name: 'Main Road',
      polyline: {
        points: [
          { lat: 33.42, lng: -111.93 },
          { lat: 33.421, lng: -111.929 },
          { lat: 33.422, lng: -111.928 },
        ],
      },
      width: 5,
      surface: 'paved',
      type: 'arterial',
      metadata: {},
    },
  ]

  const panoramas: Panorama[] = [
    {
      id: 'pano-1',
      label: 'Front Gate',
      position: { lat: 33.42, lng: -111.93 } as any,
      heading: 180,
      imageAssetId: 'asset-pano-1',
      hotspots: [],
    },
  ]

  const qrCheckpoints: QRCheckpoint[] = [
    {
      id: 'qr-1',
      label: 'Building Entrance QR',
      position: { lat: 33.4205, lng: -111.9295 } as any,
      floor: 0,
      buildingId: 'bld-1',
      code: 'https://navi.app/checkin/bld-1',
      metadata: {},
    },
  ]

  return {
    schemaVersion: 1,
    version: 1,
    metadata: {
      campusId: 'Test Campus',
      name: 'Test Campus',
      description: '',
      lastModified: '2026-07-08T00:00:00Z',
      editorVersion: '1.0.0',
    },
    buildings,
    roads,
    panoramas,
    qrCheckpoints,
  }
}

describe('GraphAdapter', () => {
  function roadOnlyDocument(roads: Road[], roadJunctions?: CampusDocument['roadJunctions']): CampusDocument {
    const doc = createTestDocument()
    doc.buildings = []
    doc.roads = roads
    doc.panoramas = []
    doc.qrCheckpoints = []
    doc.roadJunctions = roadJunctions
    return doc
  }

  const road = (id: string, points: Road['polyline']['points']): Road => ({
    id,
    name: id,
    polyline: { points },
    width: 5,
    surface: 'paved',
    type: 'arterial',
    metadata: {},
  })

  function endpointNode(graph: Graph, traceId: string, position: { lat: number; lng: number }) {
    return graph.nodes.find(node =>
      (node.metadata?.traceId === traceId || (node.metadata?.traceIds as string[] | undefined)?.includes(traceId)) &&
      Math.abs(node.position.lat - position.lat) < 1e-10 &&
      Math.abs(node.position.lng - position.lng) < 1e-10
    )
  }

  it.each([
    ['10 cm apart', road('road-b', [{ lat: 0.0000009, lng: 0 }, { lat: 0.001, lng: 0 }])],
    ['exactly touching', road('road-b', [{ lat: 0, lng: 0 }, { lat: 0.001, lng: 0 }])],
    ['geometrically crossing', road('road-b', [{ lat: -0.001, lng: 0 }, { lat: 0.001, lng: 0 }])],
  ])('does not infer road connectivity for %s geometry', (_label, roadB) => {
    const roadA = road('road-a', [{ lat: 0, lng: -0.001 }, { lat: 0, lng: 0.001 }])
    const doc = roadOnlyDocument([roadA, roadB])
    const graph = new Graph('test-campus')

    new GraphAdapter(graph).sync(doc)

    const aStart = endpointNode(graph, 'road-a', roadA.polyline.points[0])
    const bEnd = endpointNode(graph, 'road-b', roadB.polyline.points[roadB.polyline.points.length - 1])
    expect(aStart).toBeDefined()
    expect(bEnd).toBeDefined()
    expect(graph.findPath(aStart!.id, bEnd!.id)).toBeNull()
    expect(graph.connectedComponentCount).toBe(2)
    expect(doc.roadJunctions).toBeUndefined()
  })

  it('reconstructs and routes through an explicit authored RoadJunction', () => {
    const roadA = road('road-a', [{ lat: 0, lng: -0.001 }, { lat: 0, lng: 0.001 }])
    const roadB = road('road-b', [{ lat: -0.001, lng: 0 }, { lat: 0.001, lng: 0 }])
    const doc = roadOnlyDocument([roadA, roadB], [{
      id: 'junction-authored',
      position: { lat: 0, lng: 0 },
      roadIds: ['road-a', 'road-b'],
      source: 'authored',
    }])
    const graph = new Graph('test-campus')

    new GraphAdapter(graph).sync(doc)

    const aStart = endpointNode(graph, 'road-a', roadA.polyline.points[0])
    const bEnd = endpointNode(graph, 'road-b', roadB.polyline.points[roadB.polyline.points.length - 1])
    expect(graph.nodes.find(node => node.id === 'junction-authored')).toBeDefined()
    expect(graph.findPath(aStart!.id, bEnd!.id)).not.toBeNull()
    expect(doc.roadJunctions).toEqual([expect.objectContaining({
      id: 'junction-authored',
      roadIds: ['road-a', 'road-b'],
      source: 'authored',
    })])
  })

  it('does not promote a generated shared graph node into a RoadJunction record', () => {
    const roadA = road('road-a', [{ lat: 0, lng: -0.001 }, { lat: 0, lng: 0.001 }])
    const roadB = road('road-b', [{ lat: 0.0000009, lng: 0 }, { lat: 0.001, lng: 0 }])
    const doc = roadOnlyDocument([roadA, roadB])
    const graph = new Graph('test-campus')
    graph.setTraces([
      { id: 'road-a', name: 'road-a', campusId: 'test-campus', floor: 0, type: 'arterial', points: roadA.polyline.points },
      { id: 'road-b', name: 'road-b', campusId: 'test-campus', floor: 0, type: 'arterial', points: roadB.polyline.points },
    ])
    graph.setNodes([{
      id: 'generated-nearby-node',
      label: 'Generated nearby node',
      name: 'Generated nearby node',
      type: 'intersection',
      campusId: 'test-campus',
      buildingId: '',
      floor: 0,
      position: { lat: 0, lng: 0 },
      metadata: { connectionNode: true, traceIds: ['road-a', 'road-b'] },
    }])

    ;(new GraphAdapter(graph) as unknown as {
      _persistJunctions(document: CampusDocument): void
    })._persistJunctions(doc)

    expect(doc.roadJunctions).toBeUndefined()
  })

  it('preserves navigation-only road mode through graph save/reload projection', () => {
    const doc = createTestDocument()
    ;(doc.roads[0] as any).displayMode = 'navigation-only'
    doc.roads[0].metadata = { color: '#EF4444' }

    const graph = new Graph()
    new GraphAdapter(graph).sync(doc)
    expect((graph.traces[0] as any).displayMode).toBe('navigation-only')
    expect((graph.traces[0] as any).metadata).toMatchObject({ color: '#EF4444', surface: 'paved' })

    const restored = createDocument(graph)
    expect((restored.roads[0] as any).displayMode).toBe('navigation-only')
    expect(restored.roads[0].metadata).toMatchObject({ color: '#EF4444' })
  })

  it('rebuilds both road endpoint markers at edited positions', () => {
    const doc = createTestDocument()
    const editedRoad: Road = {
      id: 'road-2',
      name: 'Edited Road',
      polyline: {
        points: [
          { lat: 33.4205, lng: -111.9295 },
          { lat: 33.419, lng: -111.928 },
        ],
      },
      width: 4,
      surface: 'concrete',
      type: 'arterial',
      metadata: { color: '#22C55E' },
    }
    doc.roads.push(editedRoad)

    const graph = new Graph()
    const adapter = new GraphAdapter(graph)
    adapter.sync(doc)

    let endpointNodes = graph.nodes.filter((node) => node.metadata?.traceId === editedRoad.id)
    expect(endpointNodes.filter((node) => node.metadata?.roadEndpoint === true)).toHaveLength(2)
    expect(endpointNodes.find((node) => node.position.lat === editedRoad.polyline.points[0].lat)?.metadata?.connectionNode).not.toBe(true)
    expect(endpointNodes.find((node) => node.position.lat === editedRoad.polyline.points[1].lat)?.metadata?.connectionNode).not.toBe(true)

    const movedEnd = { lat: 33.4185, lng: -111.9275 }
    editedRoad.polyline.points[1] = movedEnd
    adapter.sync(doc)

    endpointNodes = graph.nodes.filter((node) => node.metadata?.traceId === editedRoad.id)
    expect(endpointNodes.some((node) => node.metadata?.roadEndpoint === true && node.position.lat === movedEnd.lat && node.position.lng === movedEnd.lng)).toBe(true)
    expect(graph.getTrace(editedRoad.id)?.points[1]).toEqual(movedEnd)

    const restored = createDocument(graph)
    expect(restored.roads.find((road) => road.id === editedRoad.id)).toMatchObject({
      polyline: { points: editedRoad.polyline.points },
      metadata: { color: '#22C55E' },
      surface: 'concrete',
    })
  })

  it('sync() preserves canonical semantic RoomAttributes through save/reload', () => {
    const roomAttributes: RoomAttributes = {
      roomId: 'room-semantic-1',
      faceId: 'face-1',
      name: 'Science Laboratory',
      type: 'laboratory',
      code: 'SCI-204',
      description: 'Chemistry and physics workspace',
      searchable: true,
    }
    const doc = createTestDocument()
    doc.buildings[0].floors[0].roomAttributes = [roomAttributes]

    const graph = new Graph()
    new GraphAdapter(graph).sync(doc)
    const restored = createDocument(graph)

    expect(restored.buildings[0].floors[0].roomAttributes).toEqual([roomAttributes])
  })

  it('sync() populates graph from document', () => {
    const graph = new Graph()
    const adapter = new GraphAdapter(graph)
    const doc = createTestDocument()

    adapter.sync(doc)

    expect(graph.buildingCount).toBe(1)
    expect(graph.nodeCount).toBeGreaterThan(0)
    expect(graph.edgeCount).toBeGreaterThan(0)
    expect(graph.componentCount).toBe(1)
    expect(graph.traces.length).toBe(1)

    const building = graph.buildings[0]
    expect(building.name).toBe('Test Building')
    expect(building.floors).toEqual([0])

    const panoNodes = graph.nodes.filter(n => n.label.startsWith('Panorama:'))
    expect(panoNodes.length).toBe(1)
    expect(panoNodes[0].label).toBe('Panorama: Front Gate')

    const qrNodes = graph.nodes.filter(n => n.type === 'qr_marker')
    expect(qrNodes.length).toBe(1)
    expect(qrNodes[0].label).toBe('QR: Building Entrance QR')
  })

  it('sync() does not infer an Entrance-to-road edge before explicit access assignment', () => {
    const graph = new Graph()
    new GraphAdapter(graph).sync(createTestDocument())

    const entrance = graph.nodes.find((node) => node.type === 'building_entrance')
    expect(entrance).toBeDefined()
    expect(graph.edges.some((edge) => edge.id.startsWith('E-ent-'))).toBe(false)
    expect(graph.edges.some((edge) => edge.from === entrance!.id || edge.to === entrance!.id)).toBe(false)
  })

  it('sync() projects an explicit route-segment EntranceAccess through a stable junction', () => {
    const doc = createTestDocument()
    const floor = doc.buildings[0].floors[0]
    floor.routeNetwork = {
      nodes: [
        { id: 'route-start', type: 'waypoint', position: { x: 1, y: 1 }, floor: 0 },
        { id: 'route-next', type: 'waypoint', position: { x: 8, y: 1 }, floor: 0 },
      ],
      edges: [{ id: 'route-edge-1', from: 'route-start', to: 'route-next', type: 'walk', distance: 7 }],
    }
    floor.entranceAccess = [{
      entranceId: 'ent-1',
      outdoorNodeId: 'N-entrance-access-ent-1',
      indoorRouteNodeId: 'route-start',
      outdoorRouteId: 'road-1',
      outdoorPosition: { lat: 33.4205, lng: -111.9295 },
    }]

    const graph = new Graph()
    new GraphAdapter(graph).sync(doc)

    const junction = graph.getNode('N-entrance-access-ent-1')
    expect(junction).toMatchObject({ type: 'intersection', position: { lat: 33.4205, lng: -111.9295 } })
    expect(graph.edges.filter((edge) => edge.id.startsWith('E-access-ent-1-'))).toHaveLength(2)
    expect(graph.edges.some((edge) => edge.id.startsWith('E-ent-'))).toBe(false)
    expect(graph.edges.some((edge) => edge.from === junction!.id || edge.to === junction!.id)).toBe(true)

    const rebuilt = new Graph()
    new GraphAdapter(rebuilt).sync(doc)
    expect(rebuilt.getNode('N-entrance-access-ent-1')).toBeDefined()
    expect(rebuilt.edges.filter((edge) => edge.id.startsWith('E-access-ent-1-'))).toHaveLength(2)
  })

  it('sync() creates connector stop nodes and vertical connector edges with transformer', () => {
    const tf = new CoordinateTransformer()
    tf.registerBuilding({ buildingId: 'bld-1', origin: { lat: 33.4205, lng: -111.9295 }, rotation: 0 })

    const graph = new Graph()
    const adapter = new GraphAdapter(graph, tf)
    const doc = createTestDocument()

    // Add a second floor with matching connector stop
    const building = doc.buildings[0]
    building.floors.push({
      id: 'flr-1',
      level: 1,
      label: 'Second Floor',
      elevation: 4,
      rooms: [],
      hallways: [],
      staircases: [],
      elevators: [],
      entrances: [],
      connectorStops: [
        { id: 'cs-stairA-f1', connectorId: 'conn-stairA', position: { x: 1, y: 1 }, anchors: [], accessible: true, metadata: {} },
      ],
      metadata: {},
    })

    adapter.sync(doc)

    const stopNodes = graph.nodes.filter(n => n.type === 'connector_stop')
    expect(stopNodes.length).toBe(2)

    // Should have a vertical connector edge connecting the two stops
    const connEdges = graph.edges.filter(e => e.id.startsWith('E-vconn-conn-stairA'))
    expect(connEdges.length).toBe(1)
    expect(connEdges[0].type).toBe('stair')
  })

  it('sync() handles empty document gracefully', () => {
    const graph = new Graph()
    const adapter = new GraphAdapter(graph)
    const emptyDoc: CampusDocument = {
      schemaVersion: 1,
      version: 1,
      metadata: { campusId: '', name: '', description: '', lastModified: '', editorVersion: '' },
      buildings: [],
      roads: [],
      panoramas: [],
      qrCheckpoints: [],
    }

    adapter.sync(emptyDoc)

    expect(graph.buildingCount).toBe(0)
    expect(graph.nodeCount).toBe(0)
    expect(graph.edgeCount).toBe(0)
    expect(graph.componentCount).toBe(0)
    expect(graph.traces.length).toBe(0)
  })

  it('syncEntity() re-syncs entire document', () => {
    const graph = new Graph()
    const adapter = new GraphAdapter(graph)
    const doc = createTestDocument()

    adapter.sync(doc)
    expect(graph.buildingCount).toBe(1)

    const extraBuilding: Building = {
      id: 'bld-2',
      name: 'Second Building',
      code: 'SB',
      category: 'library',
      description: '',
      footprint: {
        points: [
          { lat: 33.43, lng: -111.92 },
          { lat: 33.431, lng: -111.92 },
          { lat: 33.431, lng: -111.919 },
          { lat: 33.43, lng: -111.919 },
          { lat: 33.43, lng: -111.92 },
        ],
      },
      baseElevation: 0,
      height: 15,
      floors: [],
      verticalConnectors: [],
      aliases: [],
      color: '#00ff00',
      metadata: {},
    }

    const extendedDoc = createTestDocument(extraBuilding)
    adapter.syncEntity('bld-2', extendedDoc)

    expect(graph.buildingCount).toBe(2)
    const names = graph.buildings.map(b => b.name).sort()
    expect(names).toEqual(['Second Building', 'Test Building'])
  })

  it('sync() emits components for Staircase feature entities across levels with featureId, polygon, and landing metadata', () => {
    const tf = new CoordinateTransformer()
    tf.registerBuilding({ buildingId: 'bld-1', origin: { lat: 33.4205, lng: -111.9295 }, rotation: 0 })

    const graph = new Graph()
    const adapter = new GraphAdapter(graph, tf)
    const doc = createTestDocument()

    // Add F1 to building and add a 2-level stair feature with polygons
    const building = doc.buildings[0]
    building.floors.push({
      id: 'flr-1',
      level: 1,
      label: 'Second Floor',
      elevation: 4,
      rooms: [],
      hallways: [],
      staircases: [],
      elevators: [],
      entrances: [],
      connectorStops: [],
      metadata: {},
    })

    building.staircases = [
      {
        id: 'stair-main',
        buildingId: 'bld-1',
        name: 'Main Stair',
        type: 'standard',
        accessible: true,
        fromLevel: 0,
        toLevel: 1,
        levels: {
          0: {
            position: { x: 5, y: 5 },
            rotation: 0,
            polygon: {
              points: [
                { x: 4, y: 4 },
                { x: 6, y: 4 },
                { x: 6, y: 6 },
                { x: 4, y: 6 },
                { x: 4, y: 4 },
              ],
            },
          },
          1: {
            position: { x: 5, y: 5 },
            rotation: 0,
            polygon: {
              points: [
                { x: 4, y: 4 },
                { x: 6, y: 4 },
                { x: 6, y: 6 },
                { x: 4, y: 6 },
                { x: 4, y: 4 },
              ],
            },
          },
        },
      },
    ]

    adapter.sync(doc)

    const stairComps = graph.components.filter(c => c.type === 'stair')
    expect(stairComps.length).toBe(2)

    const compF0 = stairComps.find(c => c.floor === 0)!
    expect(compF0).toBeDefined()
    expect(compF0.id).toBe('stair-main-0')
    expect(compF0.featureId).toBe('stair-main')
    expect(compF0.range).toEqual({ from: 0, to: 1 })
    expect(compF0.polygon).toBeDefined()
    expect(compF0.polygon!.length).toBe(5)
    expect(compF0.metadata?.landing).toBeDefined()

    const compF1 = stairComps.find(c => c.floor === 1)!
    expect(compF1).toBeDefined()
    expect(compF1.id).toBe('stair-main-1')
    expect(compF1.featureId).toBe('stair-main')
    expect(compF1.range).toEqual({ from: 0, to: 1 })
    expect(compF1.polygon).toBeDefined()
  })

  it('sync() emits position-only components when stair level has no polygon', () => {
    const tf = new CoordinateTransformer()
    tf.registerBuilding({ buildingId: 'bld-1', origin: { lat: 33.4205, lng: -111.9295 }, rotation: 0 })

    const graph = new Graph()
    const adapter = new GraphAdapter(graph, tf)
    const doc = createTestDocument()

    const building = doc.buildings[0]
    building.staircases = [
      {
        id: 'stair-nopoly',
        buildingId: 'bld-1',
        name: 'No Poly Stair',
        type: 'standard',
        accessible: true,
        fromLevel: 0,
        toLevel: 0,
        levels: {
          0: {
            position: { x: 10, y: 10 },
            rotation: 0,
          },
        },
      },
    ]

    adapter.sync(doc)

    const stairComp = graph.components.find(c => c.featureId === 'stair-nopoly')
    expect(stairComp).toBeDefined()
    expect(stairComp?.id).toBe('stair-nopoly-0')
    expect(stairComp?.polygon).toBeUndefined()
    expect(stairComp?.metadata?.landing).toEqual({ position: { x: 10, y: 10 }, rotation: 0 })
  })

  it('sync() emits Elevator feature components with featureId and range', () => {
    const tf = new CoordinateTransformer()
    tf.registerBuilding({ buildingId: 'bld-1', origin: { lat: 33.4205, lng: -111.9295 }, rotation: 0 })

    const graph = new Graph()
    const adapter = new GraphAdapter(graph, tf)
    const doc = createTestDocument()

    const building = doc.buildings[0]
    building.elevators = [
      {
        id: 'elev-main',
        buildingId: 'bld-1',
        name: 'Main Elevator',
        type: 'passenger',
        accessible: true,
        fromLevel: 0,
        toLevel: 0,
        levels: {
          0: {
            position: { x: 8, y: 8 },
            rotation: 0,
          },
        },
      },
    ]

    adapter.sync(doc)

    const elevComp = graph.components.find(c => c.type === 'elevator')
    expect(elevComp).toBeDefined()
    expect(elevComp?.id).toBe('elev-main-0')
    expect(elevComp?.featureId).toBe('elev-main')
    expect(elevComp?.range).toEqual({ from: 0, to: 0 })
  })
})


describe('GraphAdapter — P1-T7 route network projection', () => {
  it('sync() projects floor.routeNetwork into NavNodes/NavEdges alongside room-derived nodes (W8)', () => {
    const base = createTestDocument()
    const withNetwork = createTestDocument()
    ;((withNetwork.buildings[0].floors[0] as unknown) as Record<string, unknown>).routeNetwork = {
      nodes: [
        { id: 'route-node-a', type: 'waypoint', position: { x: 0, y: 0 }, floor: 0 },
        { id: 'route-node-b', type: 'outdoor', position: { x: 10, y: 0 }, floor: 0 },
      ],
      edges: [
        { id: 'route-edge-1', from: 'route-node-a', to: 'route-node-b', type: 'portal', distance: 10 },
      ],
    }

    const g1 = new Graph()
    const g2 = new Graph()
    const adapter1 = new GraphAdapter(g1)
    const adapter2 = new GraphAdapter(g2)
    adapter1.sync(base)
    adapter2.sync(withNetwork)

    // W8: route network nodes/edges are now projected into the graph
    // g2 should have MORE nodes/edges than g1 (room-derived + route-derived)
    expect(g2.nodes.length).toBeGreaterThan(g1.nodes.length)
    expect(g2.edges.length).toBeGreaterThan(g1.edges.length)

    // Route-* IDs should appear in the graph
    const routeNodes = g2.nodes.filter(n => n.id.startsWith('N-route-'))
    const routeEdges = g2.edges.filter(e => e.id.startsWith('E-route-'))
    expect(routeNodes.length).toBe(2)
    expect(routeEdges.length).toBe(1)

    // Room-derived nodes should still be present (no regression)
    const roomNodes = g1.nodes.filter(n => !n.id.startsWith('N-route-'))
    expect(roomNodes.length).toBeGreaterThan(0)
  })
})

describe('GraphAdapter — spatial Door persistence', () => {
  it('rebuilds the derived door projection without accumulating across repeated syncs', () => {
    const document = createTestDocument()
    const door: RoomDoor = {
      id: 'door-idempotent-1',
      roomId: 'room-1',
      name: 'Idempotent Door',
      doorType: 'standard',
      position: { x: 4, y: 3 },
      width: 1.8,
      depth: 0.45,
      rotation: 0,
      geometry: {
        type: 'rectangle' as const,
        min: { x: 3.1, y: 2.775 },
        max: { x: 4.9, y: 3.225 },
        rotation: 0,
      },
      ownership: { status: 'assigned' },
      metadata: {},
    }
    document.buildings[0].floors[0].doors = [door]
    const canonicalBefore = structuredClone(document.buildings[0].floors[0].doors)

    const graph = new Graph()
    const adapter = new GraphAdapter(graph)
    adapter.sync(document)
    const firstProjection = structuredClone(graph.doors)

    adapter.sync(document)

    expect(graph.doors).toEqual(firstProjection)
    expect(graph.doors).toHaveLength(canonicalBefore!.length)
    expect(document.buildings[0].floors[0].doors).toEqual(canonicalBefore)
  })

  it('rebuilds exactly one derived door projection after serialize and reload', () => {
    const document = createTestDocument()
    const door: RoomDoor = {
      id: 'door-roundtrip-1',
      roomId: 'room-1',
      name: 'Roundtrip Door',
      doorType: 'standard',
      position: { x: 4, y: 3 },
      width: 1.8,
      depth: 0.45,
      rotation: 0,
      geometry: {
        type: 'rectangle' as const,
        min: { x: 3.1, y: 2.775 },
        max: { x: 4.9, y: 3.225 },
        rotation: 0,
      },
      ownership: { status: 'assigned' },
      metadata: {},
    }
    document.buildings[0].floors[0].doors = [door]

    const graph = new Graph()
    new GraphAdapter(graph).sync(document)
    const snapshot = graph.toJSON()
    const reloadedGraph = Graph.fromJSON(snapshot)
    const reloadedDocument = createDocument(snapshot)

    new GraphAdapter(reloadedGraph).sync(reloadedDocument)

    expect(reloadedGraph.doors).toHaveLength(1)
    expect(reloadedGraph.doors[0]?.id).toBe(door.id)
    expect(reloadedDocument.buildings[0].floors[0].doors).toEqual([door])
  })

  it('keeps the canonical Floor.doors record intact across graph save/reload', () => {
    const document = createTestDocument()
    const door: RoomDoor = {
      id: 'door-spatial-1',
      roomId: 'room-1',
      name: 'Main Door',
      doorType: 'standard',
      position: { x: 4, y: 3 },
      width: 1.8,
      depth: 0.45,
      rotation: Math.PI / 6,
      geometry: {
        type: 'rectangle' as const,
        min: { x: 3.1, y: 2.775 },
        max: { x: 4.9, y: 3.225 },
        rotation: Math.PI / 6,
      },
      ownership: { status: 'assigned' },
      routeConnection: {
        anchorNodeId: 'door-anchor-1',
        targetRouteNodeId: 'route-node-1',
        connectorEdgeId: 'door-edge-1',
      },
      metadata: { accessible: true },
    }
    document.buildings[0].floors[0].doors = [door]

    const graph = new Graph()
    new GraphAdapter(graph).sync(document)
    const snapshot = graph.toJSON()

    expect(snapshot.buildings[0].floorData?.[0]?.doors).toEqual([door])
    expect(createDocument(snapshot).buildings[0].floors[0].doors).toEqual([door])
  })
})
