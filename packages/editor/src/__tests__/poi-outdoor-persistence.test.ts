import { describe, expect, it } from 'vitest'
import type { CampusDocument, OutdoorPointOfInterest, PointOfInterest } from '@navi/core'
import { CoordinateTransformer } from '@navi/core'
import { Graph } from '@/engine/graph'
import { serializeSnapshot } from '@/services/graph-snapshot-serializer'
import { GraphAdapter } from '../graph-adapter'
import { createDocument } from '../context/create-editor-context'
import { findEntity } from '../context/selectors'
import { findEntityById } from '../panels/properties/property-utils'

const OUTDOOR: OutdoorPointOfInterest = {
  id: 'poi-guard-post',
  name: 'Guard Post',
  category: 'other',
  scope: 'outdoor',
  geometry: { type: 'point', position: { lat: 25.6328, lng: 122.9278 } },
  metadata: { shift: 'day' },
  appearance: undefined,
}

const OUTDOOR_SHAPE: OutdoorPointOfInterest = {
  id: 'poi-court',
  name: 'Court',
  category: 'other',
  scope: 'outdoor',
  geometry: {
    type: 'polygon',
    points: [
      { lat: 25.632, lng: 122.927 },
      { lat: 25.633, lng: 122.927 },
      { lat: 25.633, lng: 122.928 },
    ],
  },
  appearance: { mode: '2.5d', height: 4 },
}

const INDOOR: PointOfInterest = {
  id: 'poi-printer',
  name: 'Printer',
  category: 'printer',
  position: { x: 2, y: 3 },
}

function makeDocument(): CampusDocument {
  return {
    schemaVersion: 2,
    version: 1,
    metadata: { campusId: 'outdoor-poi-campus', name: 'Outdoor POI Campus', description: '', lastModified: '', editorVersion: '1.0.0' },
    buildings: [
      {
        id: 'bld-1',
        name: 'Hall',
        code: 'H',
        category: 'academic',
        description: '',
        footprint: {
          points: [
            { lat: 25.632, lng: 122.927 },
            { lat: 25.633, lng: 122.927 },
            { lat: 25.633, lng: 122.928 },
            { lat: 25.632, lng: 122.928 },
            { lat: 25.632, lng: 122.927 },
          ],
        },
        baseElevation: 0,
        height: 12,
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
            entrances: [],
            connectorStops: [],
            metadata: {},
            pois: [structuredClone(INDOOR)],
          },
        ],
        verticalConnectors: [],
        aliases: [],
        color: '#1C6BEB',
        metadata: {},
      },
    ],
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
    pois: [structuredClone(OUTDOOR), structuredClone(OUTDOOR_SHAPE)],
  }
}

function makeTransformer(): CoordinateTransformer {
  const transformer = new CoordinateTransformer()
  transformer.registerBuilding({ buildingId: 'bld-1', origin: { lat: 25.6325, lng: 122.9275 }, rotation: 0 })
  transformer.registerFloor('bld-1', 0, { offset: { x: 0, y: 0 }, rotation: 0 })
  return transformer
}

describe('Outdoor POI persistence', () => {
  it('round-trips outdoor and indoor POIs through GraphAdapter.sync → Graph → createDocument', () => {
    const document = makeDocument()
    const graph = new Graph()
    new GraphAdapter(graph, makeTransformer()).sync(document)

    // Outdoor POIs are stored as graph.pois; indoor POIs remain on floorData.
    expect(graph.pois).toHaveLength(2)
    expect(graph.buildings[0].floorData?.[0].pois).toHaveLength(1)

    const restored = createDocument(graph, makeTransformer())
    expect(restored.pois).toEqual(document.pois)
    expect(restored.buildings[0].floors[0].pois).toEqual(document.buildings[0].floors[0].pois)
  })

  it('survives graph.toJSON → Graph.fromJSON → createDocument (localStorage snapshot path)', () => {
    const document = makeDocument()
    const graph = new Graph()
    new GraphAdapter(graph, makeTransformer()).sync(document)

    const snapshot = JSON.parse(JSON.stringify(graph.toJSON()))
    expect(snapshot.pois).toHaveLength(2)

    const restoredGraph = Graph.fromJSON(snapshot)
    expect(restoredGraph.pois).toHaveLength(2)
    const restored = createDocument(restoredGraph, makeTransformer())
    expect(restored.pois).toEqual(document.pois)
  })

  it('survives the Supabase/RPC payload passthrough', () => {
    const document = makeDocument()
    const graph = new Graph()
    new GraphAdapter(graph, makeTransformer()).sync(document)

    const payload = serializeSnapshot(graph.toJSON(), document.metadata.campusId) as Record<string, unknown>
    expect(payload.pois).toHaveLength(2)
    expect((payload.pois as OutdoorPointOfInterest[])[0].id).toBe('poi-guard-post')
  })

  it('keeps the pois key additive-absent for legacy documents', () => {
    const document = makeDocument()
    delete document.pois
    const graph = new Graph()
    new GraphAdapter(graph, makeTransformer()).sync(document)

    expect(graph.pois).toHaveLength(0)
    expect(JSON.parse(JSON.stringify(graph.toJSON()))).not.toHaveProperty('pois')
    const restored = createDocument(graph, makeTransformer())
    expect(restored).not.toHaveProperty('pois')
  })

  it('resolves outdoor POIs through findEntity and the Inspector lookup', () => {
    const document = makeDocument()

    const found = findEntity(document, 'poi-guard-post')
    expect(found).toMatchObject({ type: 'poi', path: ['pois.poi-guard-post'] })
    expect(found?.data).toMatchObject({ id: 'poi-guard-post', scope: 'outdoor' })

    const lookup = findEntityById(document, 'poi-court')
    expect(lookup).toMatchObject({ path: 'poi' })
    expect((lookup?.entity as OutdoorPointOfInterest).scope).toBe('outdoor')

    // Indoor resolution remains floor-scoped.
    const indoor = findEntity(document, 'poi-printer')
    expect(indoor?.path).toEqual(['buildings.bld-1', 'floors.flr-0', 'pois.poi-printer'])
  })

  it('does not mutate roads, junctions, crossings, or route networks during the POI sync pass', () => {
    const document = makeDocument()
    document.roads = [
      {
        id: 'road-1',
        name: 'Main',
        polyline: { points: [{ lat: 25.63, lng: 122.92 }, { lat: 25.64, lng: 122.93 }] },
        width: 4,
        surface: 'paved',
        type: 'arterial',
        metadata: {},
      },
      {
        id: 'road-2',
        name: 'Side',
        polyline: { points: [{ lat: 25.64, lng: 122.92 }, { lat: 25.63, lng: 122.93 }] },
        width: 3,
        surface: 'concrete',
        type: 'connector',
        metadata: {},
      },
    ]
    document.roadJunctions = [{ id: 'jct-1', position: { lat: 25.63, lng: 122.92 }, roadIds: ['road-1', 'road-2'], source: 'authored' }]
    document.separatedCrossings = [{ id: 'sep-1', roadIds: ['road-1', 'road-2'], position: { lat: 25.63, lng: 122.92 } }]
    document.buildings[0].floors[0].routeNetwork = {
      nodes: [{ id: 'rn-1', type: 'waypoint', position: { x: 0, y: 0 }, floor: 0 }],
      edges: [],
    }

    const before = JSON.stringify({
      roads: document.roads,
      roadJunctions: document.roadJunctions,
      separatedCrossings: document.separatedCrossings,
      routeNetwork: document.buildings[0].floors[0].routeNetwork,
    })

    const graph = new Graph()
    new GraphAdapter(graph, makeTransformer()).sync(document)
    createDocument(graph, makeTransformer())

    const after = JSON.stringify({
      roads: document.roads,
      roadJunctions: document.roadJunctions,
      separatedCrossings: document.separatedCrossings,
      routeNetwork: document.buildings[0].floors[0].routeNetwork,
    })
    expect(after).toBe(before)
  })
})
