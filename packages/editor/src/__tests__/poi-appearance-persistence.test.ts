import { describe, expect, it } from 'vitest'
import type { CampusDocument, PointOfInterest } from '@navi/core'
import { CoordinateTransformer } from '@navi/core'
import { Graph } from '@/engine/graph'
import { serializeSnapshot, type GraphSnapshotLike } from '@/services/graph-snapshot-serializer'
import type { GraphSnapshot } from '@/types/nav-types'
import { GraphAdapter } from '../graph-adapter'
import { createDocument } from '../context/create-editor-context'

function makeDocument(): CampusDocument {
  return {
    schemaVersion: 1,
    version: 1,
    metadata: { campusId: 'poi-appearance-persistence', name: 'POI appearance', description: '', lastModified: '', editorVersion: 'test' },
    buildings: [{
      id: 'building-1', name: 'Main', code: 'MAIN', category: 'academic', description: '',
      footprint: { points: [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.001 }, { lat: 0.001, lng: 0.001 }, { lat: 0.001, lng: 0 }, { lat: 0, lng: 0 }] },
      baseElevation: 10, height: 20, color: '#4A90D9', aliases: [], metadata: {}, verticalConnectors: [],
      floors: [{
        id: 'floor-1', level: 0, label: 'Ground', elevation: 2, height: 3.5,
        rooms: [], hallways: [], staircases: [], elevators: [], entrances: [], connectorStops: [], parametricComponents: [], metadata: {},
        pois: [
          { id: 'poi-point', name: 'Marker', category: 'information', position: { x: 1, y: 2 }, appearance: { mode: 'marker' } },
          { id: 'poi-polygon', name: 'Volume', category: 'other', geometry: { type: 'polygon', points: [{ x: 3, y: 4 }, { x: 7, y: 4 }, { x: 7, y: 8 }] }, appearance: { mode: '2.5d', height: 5.25 } },
        ] satisfies PointOfInterest[],
      }],
    }],
    roads: [], panoramas: [], qrCheckpoints: [], areas: [],
  } as CampusDocument
}

describe('Phase 3D POI appearance persistence', () => {
  it('preserves appearance, canonical geometry, and local coordinates through graph snapshot reload', () => {
    const document = makeDocument()
    const transformer = new CoordinateTransformer()
    transformer.registerBuilding({ buildingId: 'building-1', origin: { lat: 0, lng: 0 }, rotation: 0 })

    const graph = new Graph()
    graph.campusId = document.metadata.campusId
    new GraphAdapter(graph, transformer).sync(document)
    const persisted = JSON.parse(JSON.stringify(serializeSnapshot(graph.toJSON() as unknown as GraphSnapshotLike))) as unknown as GraphSnapshot
    const restored = createDocument(Graph.fromJSON(persisted), transformer)

    expect(graph.buildings[0].floorData?.[0]?.pois).toEqual(document.buildings[0].floors[0].pois)
    expect(restored.buildings[0].floors[0].pois).toEqual(document.buildings[0].floors[0].pois)
  })
})
