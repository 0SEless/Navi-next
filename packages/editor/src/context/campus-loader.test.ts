import { describe, it, expect } from 'vitest'
import { Graph } from '@/engine/graph'
import { loadStoredCampus } from './campus-loader'
import { createDocument } from './create-editor-context'
import { CoordinateTransformer, serializeDocument, deserializeDocument, type CampusDocument } from '@navi/core'

function makeGraph(): Graph {
  const graph = new Graph()
  graph.addBuilding({
    id: 'b1',
    name: 'Main Hall',
    campusId: 'campus-1',
    footprint: {
      type: 'Polygon',
      coordinates: [[{ lat: 1, lng: 1 }, { lat: 1, lng: 2 }, { lat: 2, lng: 2 }, { lat: 2, lng: 1 }, { lat: 1, lng: 1 }]],
    },
  } as any)
  graph.addComponent({
    id: 'c1',
    type: 'room',
    buildingId: 'b1',
    floor: '1',
    name: 'Room 101',
    polygon: [{ lat: 1.1, lng: 1.1 }, { lat: 1.1, lng: 1.2 }, { lat: 1.2, lng: 1.2 }, { lat: 1.2, lng: 1.1 }],
  } as any)
  graph.addTrace({
    id: 't1',
    name: 'Road A',
    path: [{ lat: 1.5, lng: 1.5 }, { lat: 1.6, lng: 1.6 }],
    confidence: 1,
  } as any)
  graph.addNode({
    id: 'n1',
    type: 'qr_marker',
    lat: 1.3,
    lng: 1.3,
    buildingId: 'b1',
    floor: '1',
    status: 'active',
  } as any)
  return graph
}

describe('loadStoredCampus', () => {
  it('loads a serialized CampusDocument and regenerates a graph', () => {
    const graph = makeGraph()
    const doc = createDocument(graph)
    const raw = serializeDocument(doc)

    const result = loadStoredCampus(raw)
    expect(result.wasLegacy).toBe(false)
    expect(result.document.buildings.length).toBe(1)
    expect(result.document.roads.length).toBe(1)
    expect(result.document.qrCheckpoints.length).toBe(1)
    expect(result.graph.buildings.length).toBe(1)
  })

  it('detects a legacy graph and converts it to a CampusDocument', () => {
    const graph = makeGraph()
    const legacyRaw = JSON.stringify(graph.toJSON())

    const result = loadStoredCampus(legacyRaw)
    expect(result.wasLegacy).toBe(true)
    expect(result.document.buildings.length).toBe(1)
    expect(result.document.roads.length).toBe(1)
    expect(result.document.qrCheckpoints.length).toBe(1)
    expect(result.graph.buildings.length).toBe(1)
  })

  it('round-trips a converted document back to a document without legacy flag', () => {
    const graph = makeGraph()
    const legacyRaw = JSON.stringify(graph.toJSON())
    const converted = loadStoredCampus(legacyRaw)
    const reloaded = loadStoredCampus(serializeDocument(converted.document))
    expect(reloaded.wasLegacy).toBe(false)
    expect(reloaded.document.buildings.length).toBe(converted.document.buildings.length)
  })
})
