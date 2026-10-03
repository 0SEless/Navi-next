import { describe, expect, it } from 'vitest'
import type { CampusDocument, LocalCoord, RoadJunction } from '@navi/core'
import { roadCreateHandler } from '../../../editor/src/commands/road-handlers'
import { GraphAdapter } from '../../../editor/src/graph-adapter'
import { Graph } from '../../../../src/engine/graph'
import { AStar as RuntimeAStar } from '../../../runtime/src/routing/astar'
import { CampusCompiler } from '../pipeline/campus-compiler'

function emptyDocument(): CampusDocument {
  return {
    schemaVersion: 1,
    version: 0,
    metadata: {
      campusId: 'phase1-boundary',
      name: 'Phase 1 boundary',
      description: '',
      lastModified: '',
      editorVersion: '1.0.0',
    },
    buildings: [{
      id: 'boundary-building',
      name: 'Boundary Building',
      code: 'BB',
      category: 'other',
      description: '',
      footprint: { points: [
        { lat: -0.0001, lng: -0.0011 },
        { lat: -0.0001, lng: 0.0001 },
        { lat: 0.0011, lng: 0.0001 },
        { lat: 0.0011, lng: -0.0011 },
      ] },
      baseElevation: 0,
      height: 4,
      floors: [{
        id: 'boundary-floor',
        level: 0,
        label: 'Ground',
        elevation: 0,
        height: 4,
        rooms: [],
        hallways: [],
        staircases: [],
        elevators: [],
        entrances: [
          {
            id: 'entrance-a',
            label: 'Road A entrance',
            position: { lat: 0, lng: -0.001 } as unknown as LocalCoord,
            level: 0,
            type: 'main',
            hasQR: false,
            hasPanorama: false,
            connectorRoadId: 'road-a',
          },
          {
            id: 'entrance-b',
            label: 'Road B entrance',
            position: { lat: 0.001, lng: 0 } as unknown as LocalCoord,
            level: 0,
            type: 'side',
            hasQR: false,
            hasPanorama: false,
            connectorRoadId: 'road-b',
          },
        ],
        connectorStops: [],
        metadata: {},
      }],
      aliases: [],
      verticalConnectors: [],
      color: '#64748b',
      metadata: {},
    }],
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
  }
}

function authorRoads(junction?: RoadJunction, roadBStartLat = 0.0000009): CampusDocument {
  const document = emptyDocument()
  expect(roadCreateHandler.execute(document, {
    id: 'road-a',
    name: 'Road A',
    points: [{ lat: 0, lng: -0.001 }, { lat: 0, lng: 0.001 }],
  }).success).toBe(true)
  expect(roadCreateHandler.execute(document, {
    id: 'road-b',
    name: 'Road B',
    points: [{ lat: roadBStartLat, lng: 0 }, { lat: 0.001, lng: 0 }],
  }).success).toBe(true)
  if (junction) document.roadJunctions = [junction]
  return document
}

function nodeAt(
  nodes: Array<{ id: string; position: { lat: number; lng: number } }>,
  position: { lat: number; lng: number },
) {
  return nodes.find(node =>
    Math.abs(node.position.lat - position.lat) < 1e-10 &&
    Math.abs(node.position.lng - position.lng) < 1e-10
  )
}

function runBoundary(document: CampusDocument) {
  const editorGraph = new Graph(document.metadata.campusId)
  new GraphAdapter(editorGraph).sync(document)

  const editorReload = Graph.fromJSON(JSON.parse(JSON.stringify(editorGraph.toJSON())))
  const editorStart = editorReload.nodes.find(node =>
    node.metadata?.traceId === 'road-a' && node.position.lat === 0 && node.position.lng === -0.001
  )
  const editorGoal = editorReload.nodes.find(node =>
    node.metadata?.traceId === 'road-b' && node.position.lat === 0.001 && node.position.lng === 0
  )
  expect(editorStart).toBeDefined()
  expect(editorGoal).toBeDefined()

  const reloadedDocument = JSON.parse(JSON.stringify(document)) as CampusDocument
  const compiled = new CampusCompiler({ nodeInterval: 10, mergeThreshold: 0.5 }).compileV2(reloadedDocument)
  expect(compiled.success, JSON.stringify(compiled.errors)).toBe(true)
  expect(compiled.graph).not.toBeNull()

  const runtimeGraph = JSON.parse(JSON.stringify(compiled.artifacts!.graph))
  const runtimeStart = nodeAt(runtimeGraph.nodes, { lat: 0, lng: -0.001 })
  const runtimeGoal = nodeAt(runtimeGraph.nodes, { lat: 0.001, lng: 0 })
  expect(runtimeStart).toBeDefined()
  expect(runtimeGoal).toBeDefined()

  return {
    editorPath: editorReload.findPath(editorStart!.id, editorGoal!.id),
    runtimePath: new RuntimeAStar(runtimeGraph).findPath(runtimeStart!.id, runtimeGoal!.id),
    reloadedDocument,
  }
}

describe('Phase 1 explicit connectivity boundary', () => {
  it('keeps roads 10 cm apart disconnected through authoring, reload, Compiler V2, and runtime A*', () => {
    const document = authorRoads()
    expect(document.roads[1].polyline.points[0]).toEqual({ lat: 0.0000009, lng: 0 })
    expect(document.roadJunctions).toBeUndefined()

    const result = runBoundary(document)

    expect(result.editorPath).toBeNull()
    expect(result.runtimePath).toBeNull()
    expect(result.reloadedDocument.roadJunctions).toBeUndefined()
  })

  it('routes touching roads through an explicit authored RoadJunction', () => {
    const document = authorRoads({
      id: 'junction-ab',
      position: { lat: 0, lng: 0 },
      roadIds: ['road-a', 'road-b'],
      source: 'authored',
    }, 0)

    const result = runBoundary(document)

    expect(result.editorPath).not.toBeNull()
    expect(result.runtimePath).not.toBeNull()
    expect(result.reloadedDocument.roadJunctions).toEqual([
      expect.objectContaining({ id: 'junction-ab', source: 'authored' }),
    ])
  })
})
