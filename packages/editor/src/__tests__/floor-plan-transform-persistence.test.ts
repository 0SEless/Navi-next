import { describe, expect, it } from 'vitest'
import { CoordinateTransformer, deserializeDocument, serializeDocument, type CampusDocument, type PlanAlignment } from '@navi/core'
import { Graph } from '@/engine/graph'
import { serializeSnapshot } from '@/services/graph-snapshot-serializer'
import { GraphAdapter } from '../graph-adapter'
import { createDocument } from '../context/create-editor-context'
import { loadStoredCampus } from '../context/campus-loader'

const alignment: PlanAlignment = {
  offset: { x: 2.25, y: -1.5 },
  scale: 1.25,
  scaleX: 1.4,
  scaleY: 0.8,
  rotation: 18,
  opacity: 0.6,
  locked: true,
}

function makeDocument(planAlignment: PlanAlignment | undefined): CampusDocument {
  const footprint = [
    { lat: 14, lng: 121 },
    { lat: 14, lng: 121.001 },
    { lat: 14.001, lng: 121.001 },
    { lat: 14.001, lng: 121 },
    { lat: 14, lng: 121 },
  ]
  return {
    schemaVersion: 1,
    version: 1,
    metadata: { campusId: 'campus-visuals', name: 'Visuals', description: '', lastModified: '', editorVersion: 'test' },
    buildings: [{
      id: 'bld-visuals',
      name: 'Visuals Hall',
      code: 'VH',
      category: 'academic',
      description: '',
      footprint: { points: footprint },
      baseElevation: 0,
      height: 12,
      floors: [{
        id: 'floor-visuals-0',
        level: 0,
        label: 'Ground',
        elevation: 0,
        height: 3.5,
        planImageId: 'plan-visuals.png',
        ...(planAlignment !== undefined ? { planAlignment } : {}),
        rooms: [],
        hallways: [],
        staircases: [],
        elevators: [],
        entrances: [],
        connectorStops: [],
        parametricComponents: [],
        metadata: {},
      }],
      aliases: [],
      verticalConnectors: [],
      color: '#1C6BEB',
      metadata: {},
    }],
    roads: [{
      id: 'road-visuals',
      name: 'Visuals Walk',
      polyline: { points: [{ lat: 14.0002, lng: 121.0002 }, { lat: 14.0008, lng: 121.0008 }] },
      width: 3,
      surface: 'paved',
      type: 'arterial',
      metadata: {},
    }],
    panoramas: [],
    qrCheckpoints: [],
  }
}

function topologyFingerprint(graph: Graph): string {
  const nodeKey = (node: Graph['nodes'][number] | undefined): string => node
    ? JSON.stringify({ buildingId: node.buildingId, floor: node.floor, position: node.position, type: node.type })
    : '<missing>'
  return JSON.stringify({
    nodes: graph.nodes.map(nodeKey).sort(),
    edges: graph.edges.map(({ from, to, type, distance, weight }) => ({
      from: nodeKey(graph.getNode(from)),
      to: nodeKey(graph.getNode(to)),
      type,
      distance,
      weight,
    })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  })
}

function graphFromDocument(document: CampusDocument): Graph {
  const graph = new Graph()
  const transformer = new CoordinateTransformer()
  new GraphAdapter(graph, transformer).sync(document)
  return graph
}

describe('floor-plan transform persistence', () => {
  it('preserves legacy and axis alignment fields through document JSON', () => {
    const restored = deserializeDocument(serializeDocument(makeDocument(alignment)))
    expect(restored.buildings[0].floors[0].planAlignment).toEqual(alignment)
  })

  it('preserves alignment through GraphAdapter, legacy graph JSON, and snapshot serialization', () => {
    const document = makeDocument(alignment)
    const graph = graphFromDocument(document)
    const snapshot = graph.toJSON()
    const snapshotJson = JSON.stringify(snapshot)
    const reloadedDocument = createDocument(Graph.fromJSON(JSON.parse(snapshotJson)))
    const reloadedAlignment = reloadedDocument.buildings[0].floors[0].planAlignment
    const loadedStored = loadStoredCampus(snapshotJson)

    expect(reloadedAlignment).toEqual(alignment)
    expect(loadedStored.document.buildings[0].floors[0].planAlignment).toEqual(alignment)
    const rpc = serializeSnapshot(JSON.parse(snapshotJson))
    expect((rpc.buildings[0] as any).floorData[0].planAlignment).toEqual(alignment)
  })

  it('keeps route topology identical when visual metadata is added or removed', () => {
    const withoutVisual = graphFromDocument(makeDocument(undefined))
    const withVisual = graphFromDocument(makeDocument(alignment))

    expect(topologyFingerprint(withVisual)).toBe(topologyFingerprint(withoutVisual))
  })
})
