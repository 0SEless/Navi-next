import { describe, expect, it } from 'vitest'
import { CoordinateTransformer, projectWorldPoiAnchor, rotateWorldPoiGeometry } from '@navi/core'
import type { CampusDocument, Floor, OutdoorPointOfInterest, PoiApproachAnchor, PointOfInterest } from '@navi/core'
import { buildArtifacts } from '../emitter/artifacts'
import type { ConnectivityGraph, NavNode, NavigationGraph } from '../types'

function makeFloor(overrides: Partial<Floor> = {}): Floor {
  return {
    id: 'f1',
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
    ...overrides,
  }
}

function makeDocument(pois: PointOfInterest[]): CampusDocument {
  return {
    schemaVersion: 2,
    version: 7,
    metadata: {
      campusId: 'campus-4a',
      name: 'Phase 4A fixture',
      description: '',
      lastModified: '',
      editorVersion: '',
    },
    buildings: [
      {
        id: 'b1',
        name: 'Building One',
        code: 'B1',
        category: 'academic',
        description: '',
        footprint: {
          points: [
            { lat: 14, lng: 121 },
            { lat: 14, lng: 121.001 },
            { lat: 14.001, lng: 121.001 },
            { lat: 14.001, lng: 121 },
          ],
        },
        baseElevation: 0,
        height: 12,
        rotation: 17,
        floors: [
          makeFloor({
            id: 'f1',
            offset: { x: 8, y: -3 },
            rotation: 11,
            pois,
          }),
        ],
        verticalConnectors: [],
        color: '#ffffff',
        aliases: [],
        metadata: {},
      },
    ],
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
  }
}

function makeNavGraph(nodes: NavNode[] = []): NavigationGraph {
  return {
    version: '1.0.0',
    campusId: 'campus-4a',
    createdAt: '2026-09-12T00:00:00.000Z',
    checksum: 'fixture',
    nodes,
    edges: [],
    metadata: {
      nodeCount: nodes.length,
      edgeCount: 0,
      buildings: 1,
      floors: 1,
      boundingBox: { minLng: 121, maxLng: 121.001, minLat: 14, maxLat: 14.001 },
    },
  }
}

function makeConnectivityGraph(): ConnectivityGraph {
  return {
    nodes: [],
    edges: [],
    metadata: { campusId: 'campus-4a', buildingCount: 0, floorCount: 0, generatedAt: 0 },
    diagnostics: [],
  }
}

function makePoiNode(): NavNode {
  return {
    id: 'graph-node',
    label: 'Graph-derived landmark',
    type: 'poi',
    position: { lat: 14.0004, lng: 121.0004 },
    floor: 0,
    buildingId: 'b1',
    properties: { legacy: true },
  }
}

function expectedWorld(local: { x: number; y: number }): { lat: number; lng: number } {
  const transformer = new CoordinateTransformer()
  transformer.registerBuilding({
    buildingId: 'b1',
    origin: { lat: 14.0005, lng: 121.0005 },
    rotation: 17,
  })
  transformer.registerFloor('b1', 0, { offset: { x: 8, y: -3 }, rotation: 11 })
  return transformer.floorLocalToWorld(local, 'b1', 0)!
}

const authoredPois: PointOfInterest[] = [
  {
    id: 'legacy-point',
    name: 'Legacy point',
    category: 'information',
    position: { x: 1, y: 2 },
    metadata: { source: 'legacy', rank: 1 },
  },
  {
    id: 'explicit-point',
    name: 'Explicit point',
    category: 'study_area',
    geometry: { type: 'point', position: { x: -1, y: 3 } },
    appearance: { mode: 'marker' },
  },
  {
    id: 'circle-poi',
    name: 'Circle POI',
    category: 'waiting_area',
    geometry: { type: 'circle', center: { x: 2, y: 4 }, radius: 2.5 },
    metadata: { source: 'authoring' },
    appearance: { mode: '2.5d', height: 4 },
  },
  {
    id: 'rectangle-poi',
    name: 'Rectangle POI',
    category: 'food',
    geometry: { type: 'rectangle', min: { x: -2, y: -1 }, max: { x: 4, y: 3 } },
  },
  {
    id: 'polygon-poi',
    name: 'Polygon POI',
    category: 'other',
    geometry: { type: 'polygon', points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 4 }] },
  },
]

describe('Phase 4A/4B authored POI compiler projection', () => {
  it('projects every supported authored form through the authoritative transformer', () => {
    const document = makeDocument(authoredPois)
    const documentBefore = structuredClone(document)
    const navGraph = makeNavGraph([makePoiNode()])
    const navGraphBefore = structuredClone(navGraph)

    const artifacts = buildArtifacts(makeConnectivityGraph(), navGraph, document)

    expect(artifacts.poiIndex.points.map(point => point.id)).toEqual([
      'graph-node_poi',
      'legacy-point',
      'explicit-point',
      'circle-poi',
      'rectangle-poi',
      'polygon-poi',
    ])

    const legacy = artifacts.poiIndex.points.find(point => point.id === 'legacy-point')!
    expect(legacy).toMatchObject({
      id: 'legacy-point',
      label: 'Legacy point',
      category: 'information',
      buildingId: 'b1',
      floor: 0,
      floorId: 'f1',
      source: 'authored',
      sourceId: 'legacy-point',
      properties: { source: 'legacy', rank: 1 },
    })
    expect(legacy.nodeId).toBeUndefined()
    expect(legacy.position).toEqual(expectedWorld({ x: 1, y: 2 }))
    expect(legacy.geometry).toEqual({ type: 'point', position: expectedWorld({ x: 1, y: 2 }) })

    const explicitPoint = artifacts.poiIndex.points.find(point => point.id === 'explicit-point')!
    expect(explicitPoint.position).toEqual(expectedWorld({ x: -1, y: 3 }))
    expect(explicitPoint.geometry).toEqual({ type: 'point', position: expectedWorld({ x: -1, y: 3 }) })
    expect(explicitPoint.appearance).toEqual({ mode: 'marker' })

    const circle = artifacts.poiIndex.points.find(point => point.id === 'circle-poi')!
    expect(circle.position).toEqual(expectedWorld({ x: 2, y: 4 }))
    expect(circle.geometry).toEqual({ type: 'circle', center: expectedWorld({ x: 2, y: 4 }), radius: 2.5 })
    expect(circle.appearance).toEqual({ mode: '2.5d', height: 4 })

    const rectangle = artifacts.poiIndex.points.find(point => point.id === 'rectangle-poi')!
    expect(rectangle.position).toEqual(expectedWorld({ x: 1, y: 1 }))
    expect(rectangle.geometry).toEqual({
      type: 'rectangle',
      points: [
        expectedWorld({ x: -2, y: -1 }),
        expectedWorld({ x: 4, y: -1 }),
        expectedWorld({ x: 4, y: 3 }),
        expectedWorld({ x: -2, y: 3 }),
      ],
    })

    const polygon = artifacts.poiIndex.points.find(point => point.id === 'polygon-poi')!
    expect(polygon.position).toEqual(expectedWorld({ x: 4 / 3, y: 4 / 3 }))
    expect(polygon.geometry).toEqual({
      type: 'polygon',
      points: [
        expectedWorld({ x: 0, y: 0 }),
        expectedWorld({ x: 4, y: 0 }),
        expectedWorld({ x: 0, y: 4 }),
      ],
    })

    const floorPois = artifacts.floorGeometry!.buildings[0].floors[0].pois
    expect(floorPois.map(poi => poi.id)).toEqual(authoredPois.map(poi => poi.id))
    expect(floorPois.find(poi => poi.id === 'rectangle-poi')!.position).toEqual({ x: 9, y: -2 })

    const authoredSearch = artifacts.searchIndex.entries.filter(entry =>
      entry.type === 'poi' && authoredPois.some(poi => entry.id === poi.id),
    )
    expect(authoredSearch.map(entry => entry.id)).toEqual(authoredPois.map(poi => poi.id))
    expect(new Set(authoredSearch.map(entry => entry.id)).size).toBe(authoredPois.length)
    expect(authoredSearch.every(entry => entry.nodeId === undefined)).toBe(true)
    expect(authoredSearch.find(entry => entry.id === 'legacy-point')).toMatchObject({
      id: 'legacy-point',
      label: 'Legacy point',
      type: 'poi',
      category: 'information',
      source: 'authored',
      sourceId: 'legacy-point',
      buildingId: 'b1',
      floor: 0,
      floorId: 'f1',
      position: expectedWorld({ x: 1, y: 2 }),
      tags: expect.arrayContaining(['legacy', 'point', 'information', 'source', 'rank']),
    })
    expect(authoredSearch.find(entry => entry.id === 'circle-poi')!.tags)
      .toEqual(expect.arrayContaining(['circle', 'poi', 'waiting', 'area', 'authoring']))
    expect(Object.values(artifacts.spatialIndex.cells).flat()).toEqual(['graph-node'])
    expect(document).toEqual(documentBefore)
    expect(navGraph).toEqual(navGraphBefore)
  })

  it('keeps graph-derived POIs and rejects authored ID collisions deterministically', () => {
    const graph = makeNavGraph([makePoiNode()])
    const graphArtifacts = buildArtifacts(makeConnectivityGraph(), graph, makeDocument([]))
    const graphPoi = graphArtifacts.poiIndex.points[0]
    expect(graphPoi).toMatchObject({
      id: 'graph-node_poi',
      nodeId: 'graph-node',
      source: 'graph-derived',
      sourceId: 'graph-node',
      geometry: { type: 'point', position: makePoiNode().position },
    })

    const collisionDocument = makeDocument([{
      id: 'graph-node_poi',
      name: 'Collision',
      category: 'other',
      position: { x: 0, y: 0 },
    }])
    expect(() => buildArtifacts(makeConnectivityGraph(), graph, collisionDocument))
      .toThrow(/POI_ID_COLLISION.*graph-node_poi/)
  })
})

describe('Outdoor/campus POI compiler projection', () => {
  const outdoorPois: OutdoorPointOfInterest[] = [
    {
      id: 'outdoor-point',
      name: 'Guard Post',
      category: 'other',
      scope: 'outdoor',
      geometry: { type: 'point', position: { lat: 14.01, lng: 121.01 } },
      metadata: { source: 'campus' },
    },
    {
      id: 'outdoor-circle',
      name: 'Garden',
      category: 'other',
      scope: 'outdoor',
      geometry: { type: 'circle', center: { lat: 14.02, lng: 121.02 }, radius: 12 },
      appearance: { mode: '2.5d', height: 3 },
    },
    {
      id: 'outdoor-rectangle',
      name: 'Parking',
      category: 'other',
      scope: 'outdoor',
      geometry: {
        type: 'rectangle',
        points: [
          { lat: 14.03, lng: 121.03 },
          { lat: 14.03, lng: 121.031 },
          { lat: 14.031, lng: 121.031 },
          { lat: 14.031, lng: 121.03 },
        ],
      },
    },
    {
      id: 'outdoor-polygon',
      name: 'Plaza',
      category: 'other',
      scope: 'outdoor',
      geometry: {
        type: 'polygon',
        points: [
          { lat: 14.04, lng: 121.04 },
          { lat: 14.041, lng: 121.04 },
          { lat: 14.041, lng: 121.041 },
        ],
      },
    },
  ]

  function makeOutdoorDocument(): CampusDocument {
    const document = makeDocument([])
    document.pois = structuredClone(outdoorPois)
    return document
  }

  it('projects outdoor POIs verbatim with world geometry, scope, and no building/floor identity', () => {
    const document = makeOutdoorDocument()
    const before = structuredClone(document)
    const artifacts = buildArtifacts(makeConnectivityGraph(), makeNavGraph(), document)

    const outdoor = artifacts.poiIndex.points.filter(point => point.scope === 'outdoor')
    expect(outdoor.map(point => point.id)).toEqual(outdoorPois.map(poi => poi.id))

    const point = outdoor.find(poi => poi.id === 'outdoor-point')!
    expect(point).toMatchObject({
      label: 'Guard Post',
      position: { lat: 14.01, lng: 121.01 },
      source: 'authored',
      sourceId: 'outdoor-point',
      scope: 'outdoor',
      geometry: { type: 'point', position: { lat: 14.01, lng: 121.01 } },
    })
    expect(point.buildingId).toBeUndefined()
    expect(point.floor).toBeUndefined()
    expect(point.nodeId).toBeUndefined()

    // World geometry is passed through without a coordinate rewrite.
    expect(outdoor.find(poi => poi.id === 'outdoor-circle')!.geometry).toEqual(outdoorPois[1].geometry)
    expect(outdoor.find(poi => poi.id === 'outdoor-rectangle')!.geometry).toEqual(outdoorPois[2].geometry)
    expect(outdoor.find(poi => poi.id === 'outdoor-polygon')!.geometry).toEqual(outdoorPois[3].geometry)

    // Search entries preserve identity, scope, and category with no nodeId.
    const search = artifacts.searchIndex.entries.filter(entry => entry.id.startsWith('outdoor-'))
    expect(search.map(entry => entry.id).sort()).toEqual(outdoorPois.map(poi => poi.id).sort())
    expect(search.every(entry => entry.type === 'poi' && entry.nodeId === undefined && entry.scope === 'outdoor')).toBe(true)
    expect(search.find(entry => entry.id === 'outdoor-point')).toMatchObject({
      label: 'Guard Post',
      category: 'other',
      source: 'authored',
      sourceId: 'outdoor-point',
      position: { lat: 14.01, lng: 121.01 },
    })

    expect(document).toEqual(before)
  })

  it('keeps indoor and outdoor projections in one index with distinct scope', () => {
    const document = makeOutdoorDocument()
    document.buildings[0].floors[0].pois = structuredClone(authoredPois)

    const artifacts = buildArtifacts(makeConnectivityGraph(), makeNavGraph(), document)
    const ids = artifacts.poiIndex.points.map(point => point.id)

    expect(ids).toContain('legacy-point')
    expect(ids).toContain('outdoor-point')
    const indoor = artifacts.poiIndex.points.find(point => point.id === 'legacy-point')!
    expect(indoor.scope).toBeUndefined()
    expect(indoor.buildingId).toBe('b1')
    expect(artifacts.poiIndex.points.find(point => point.id === 'outdoor-point')!.scope).toBe('outdoor')
  })

  it('rejects collisions between an outdoor POI id and an indoor authored id', () => {
    const document = makeOutdoorDocument()
    document.buildings[0].floors[0].pois = [{
      id: 'outdoor-point',
      name: 'Indoor collision',
      category: 'other',
      position: { x: 0, y: 0 },
    }]

    expect(() => buildArtifacts(makeConnectivityGraph(), makeNavGraph(), document))
      .toThrow(/POI_ID_COLLISION.*outdoor-point/)
  })

  it('rejects invalid outdoor world geometry at compile time', () => {
    const document = makeDocument([])
    document.pois = [{
      id: 'outdoor-bad',
      name: 'Bad',
      category: 'other',
      scope: 'outdoor',
      geometry: { type: 'circle', center: { lat: 14, lng: 121 }, radius: 0 },
    } as OutdoorPointOfInterest]

    expect(() => buildArtifacts(makeConnectivityGraph(), makeNavGraph(), document))
      .toThrow(/POI_INVALID_GEOMETRY.*outdoor-bad/)
  })

  it('projects visibility and excludes non-searchable authored POIs from the search index', () => {
    const document = makeDocument([
      {
        id: 'poi-hidden-searchable',
        name: 'Hidden Lobby',
        category: 'other',
        position: { x: 1, y: 1 },
        visibility: { showOnMap: false, searchable: true },
      },
      {
        id: 'poi-visible-private',
        name: 'Private Zone',
        category: 'other',
        position: { x: 2, y: 2 },
        visibility: { showOnMap: true, searchable: false },
      },
    ])

    const artifacts = buildArtifacts(makeConnectivityGraph(), makeNavGraph(), document)
    const hidden = artifacts.poiIndex.points.find(point => point.id === 'poi-hidden-searchable')!
    expect(hidden.visibility).toEqual({ showOnMap: false, searchable: true })

    const searchIds = artifacts.searchIndex.entries.map(entry => entry.id)
    expect(searchIds).toContain('poi-hidden-searchable')
    expect(searchIds).not.toContain('poi-visible-private')

    // Defaults stay additive-absent for legacy records.
    const legacyDocument = makeDocument([{ id: 'poi-legacy-default', name: 'Legacy', category: 'other', position: { x: 0, y: 0 } }])
    const legacyArtifacts = buildArtifacts(makeConnectivityGraph(), makeNavGraph(), legacyDocument)
    expect(legacyArtifacts.poiIndex.points[0].visibility).toBeUndefined()
    expect(legacyArtifacts.searchIndex.entries.map(entry => entry.id)).toContain('poi-legacy-default')
  })

  it('resolves a preferred geometry-relative anchor and keeps it attached through move/resize/rotate', () => {
    const anchored = (geometry: OutdoorPointOfInterest['geometry'], anchor: PoiApproachAnchor): OutdoorPointOfInterest => ({
      id: 'poi-anchored',
      name: 'Anchored',
      category: 'other',
      scope: 'outdoor',
      geometry,
      navigation: { approachMode: 'preferred', anchor },
    })

    const circleDoc = makeDocument([])
    circleDoc.pois = [anchored({ type: 'circle', center: { lat: 14.05, lng: 121.05 }, radius: 10 }, { kind: 'circle-angle', angle: 0 })]
    const circleApproach = buildArtifacts(makeConnectivityGraph(), makeNavGraph(), circleDoc).poiIndex.points[0].approach!
    expect(circleApproach.mode).toBe('preferred')
    expect(circleApproach.position.lat).toBeCloseTo(14.05, 6)
    expect(circleApproach.position.lng).toBeGreaterThan(121.05)

    // Moving/resizing the circle moves the anchor (same relative angle).
    const movedDoc = makeDocument([])
    movedDoc.pois = [anchored({ type: 'circle', center: { lat: 14.06, lng: 121.06 }, radius: 5 }, { kind: 'circle-angle', angle: 0 })]
    const movedApproach = buildArtifacts(makeConnectivityGraph(), makeNavGraph(), movedDoc).poiIndex.points[0].approach!
    expect(movedApproach.position.lat).toBeCloseTo(14.06, 6)
    expect(movedApproach.position.lng).toBeGreaterThan(121.06)
    expect(movedApproach.position).not.toEqual(circleApproach.position)

    // Rotating the rectangle rotates the edge anchor with it.
    const rect: OutdoorPointOfInterest['geometry'] = {
      type: 'rectangle',
      points: [
        { lat: 14.05, lng: 121.05 },
        { lat: 14.05, lng: 121.051 },
        { lat: 14.0501, lng: 121.051 },
        { lat: 14.0501, lng: 121.05 },
      ],
    }
    const rectDoc = makeDocument([])
    rectDoc.pois = [anchored(rect, { kind: 'rectangle-edge', edge: 0, t: 0.5 })]
    const before = buildArtifacts(makeConnectivityGraph(), makeNavGraph(), rectDoc).poiIndex.points[0].approach!
    const rotatedGeometry = rotateWorldPoiGeometry(rect, Math.PI / 2) as OutdoorPointOfInterest['geometry']
    const rotatedDoc = makeDocument([])
    rotatedDoc.pois = [anchored(rotatedGeometry, { kind: 'rectangle-edge', edge: 0, t: 0.5 })]
    const rotated = buildArtifacts(makeConnectivityGraph(), makeNavGraph(), rotatedDoc).poiIndex.points[0].approach!
    expect(rotated.position).not.toEqual(before.position)
    expect(rotated.position).toEqual(projectWorldPoiAnchor(rotatedGeometry, { kind: 'rectangle-edge', edge: 0, t: 0.5 }))
  })
})
