import { describe, expect, it } from 'vitest'
import type { Area as _Area, CampusDocument, WorldPOIGeometry } from '@navi/core'
import {
  CoordinateTransformer,
  resizeWorldRectangle,
  rotateWorldPoiGeometry,
  setLocalCircleRadius,
  setWorldCircleRadius,
  translateLocalPoiGeometry,
  translateWorldPoiGeometry,
  moveWorldPolygonVertex,
  moveLocalPolygonVertex,
} from '@navi/core'
import { Graph } from '@/engine/graph'
import { serializeSnapshot } from '@/services/graph-snapshot-serializer'
import { CommandDispatcher } from '../dispatcher'
import { CommandRegistry } from '../registry'
import { poiCreateHandler, poiDeleteHandler, poiUpdateHandler } from '../feature-handlers'
import { DocumentEventBus } from '../../eventbus'
import { HistoryStack } from '../../history'
import { GraphAdapter } from '../../graph-adapter'
import { DocumentStore } from '../../context/document-store'
import { createDocument } from '../../context/create-editor-context'

const ORIGIN = { lat: 25.633, lng: 122.927 }
const d = 0.0001

function makeDocument(): CampusDocument {
  return {
    schemaVersion: 2,
    version: 1,
    metadata: { campusId: 'poi-editing', name: 'POI Editing', description: '', lastModified: '', editorVersion: '1.0.0' },
    buildings: [{
      id: 'bld-1',
      name: 'Hall',
      code: 'H',
      category: 'academic',
      description: '',
      footprint: {
        points: [
          { lat: ORIGIN.lat - 0.001, lng: ORIGIN.lng - 0.001 },
          { lat: ORIGIN.lat - 0.001, lng: ORIGIN.lng + 0.001 },
          { lat: ORIGIN.lat + 0.001, lng: ORIGIN.lng + 0.001 },
          { lat: ORIGIN.lat + 0.001, lng: ORIGIN.lng - 0.001 },
          { lat: ORIGIN.lat - 0.001, lng: ORIGIN.lng - 0.001 },
        ],
      },
      baseElevation: 0,
      height: 12,
      floors: [{
        id: 'flr-0', level: 0, label: 'Ground', elevation: 0,
        rooms: [], hallways: [], staircases: [], elevators: [], entrances: [], connectorStops: [], metadata: {},
        pois: [
          { id: 'indoor-circle', name: 'Indoor Circle', category: 'other', geometry: { type: 'circle', center: { x: 5, y: 5 }, radius: 3 }, appearance: { mode: '2d', color: '#22C55E' } },
          { id: 'indoor-polygon', name: 'Indoor Polygon', category: 'other', geometry: { type: 'polygon', points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }] } },
        ],
      }],
      verticalConnectors: [], aliases: [], color: '#1C6BEB', metadata: {},
    }],
    roads: [
      { id: 'road-1', name: 'Main', polyline: { points: [{ lat: ORIGIN.lat - 0.002, lng: ORIGIN.lng }, { lat: ORIGIN.lat - 0.002, lng: ORIGIN.lng + 0.002 }] }, width: 5, surface: 'paved', type: 'arterial', metadata: {} },
      { id: 'road-2', name: 'Side', polyline: { points: [{ lat: ORIGIN.lat - 0.003, lng: ORIGIN.lng + 0.001 }, { lat: ORIGIN.lat - 0.001, lng: ORIGIN.lng + 0.001 }] }, width: 3, surface: 'concrete', type: 'service', metadata: {} },
    ],
    roadJunctions: [{ id: 'jct-1', position: { lat: ORIGIN.lat - 0.002, lng: ORIGIN.lng + 0.001 }, roadIds: ['road-1', 'road-2'], source: 'authored' }],
    separatedCrossings: [{ id: 'sep-1', roadIds: ['road-1', 'road-2'], position: { lat: ORIGIN.lat - 0.0025, lng: ORIGIN.lng + 0.0005 } }],
    panoramas: [],
    qrCheckpoints: [],
    pois: [
      { id: 'outdoor-point', name: 'Guard Post', category: 'other', scope: 'outdoor', geometry: { type: 'point', position: { lat: ORIGIN.lat + 0.003, lng: ORIGIN.lng + 0.003 } } },
      { id: 'outdoor-circle', name: 'Gazebo', category: 'other', scope: 'outdoor', geometry: { type: 'circle', center: { lat: ORIGIN.lat + 0.004, lng: ORIGIN.lng + 0.004 }, radius: 4 }, appearance: { mode: '2d', color: '#EF4444' } },
      { id: 'outdoor-rectangle', name: 'Waiting Shed', category: 'other', scope: 'outdoor', geometry: { type: 'rectangle', points: [
        { lat: ORIGIN.lat + 0.005, lng: ORIGIN.lng + 0.005 },
        { lat: ORIGIN.lat + 0.005, lng: ORIGIN.lng + 0.005 + d },
        { lat: ORIGIN.lat + 0.005 + d, lng: ORIGIN.lng + 0.005 + d },
        { lat: ORIGIN.lat + 0.005 + d, lng: ORIGIN.lng + 0.005 },
      ] }, appearance: { mode: '2.5d', height: 3.5 } },
      { id: 'outdoor-polygon', name: 'Study Area', category: 'other', scope: 'outdoor', geometry: { type: 'polygon', points: [
        { lat: ORIGIN.lat + 0.006, lng: ORIGIN.lng + 0.006 },
        { lat: ORIGIN.lat + 0.007, lng: ORIGIN.lng + 0.006 },
        { lat: ORIGIN.lat + 0.007, lng: ORIGIN.lng + 0.007 },
      ] }, appearance: { mode: '2d', color: '#0EA5E9' } },
    ],
  } as CampusDocument
}

function makeTransformer(): CoordinateTransformer {
  const transformer = new CoordinateTransformer()
  transformer.registerBuilding({ buildingId: 'bld-1', origin: ORIGIN, rotation: 0 })
  transformer.registerFloor('bld-1', 0, { offset: { x: 0, y: 0 }, rotation: 0 })
  return transformer
}

function makeHistory(document: CampusDocument) {
  const registry = new CommandRegistry()
  registry.register(poiCreateHandler)
  registry.register(poiUpdateHandler)
  registry.register(poiDeleteHandler)
  const eventBus = new DocumentEventBus()
  const documentStore = new DocumentStore(document, eventBus)
  const dispatcher = new CommandDispatcher(registry, document, eventBus)
  const history = new HistoryStack(dispatcher, document, registry, 50, documentStore)
  dispatcher.addPreHook(history)
  dispatcher.addPostHook(history)
  return { dispatcher, history }
}

function updateGeometry(dispatcher: CommandDispatcher, poiId: string, geometry: unknown) {
  return dispatcher.execute({ id: 'poi.update', label: 'Edit POI', payload: { poiId, patch: { geometry } } })
}

const outdoorPoi = (doc: CampusDocument, id: string) => doc.pois!.find((poi) => poi.id === id)!
const indoorPoi = (doc: CampusDocument, id: string) => doc.buildings[0].floors[0].pois!.find((poi) => poi.id === id)!

describe('POI editing transforms through poi.update + history', () => {
  it('moves point/circle/rectangle/polygon POIs and restores them through undo/redo', () => {
    const document = makeDocument()
    const { dispatcher, history } = makeHistory(document)

    // Outdoor point move.
    const point = outdoorPoi(document, 'outdoor-point')
    expect(updateGeometry(dispatcher, 'outdoor-point', { type: 'point', position: { lat: ORIGIN.lat + 0.01, lng: ORIGIN.lng + 0.01 } }).success).toBe(true)
    expect(outdoorPoi(document, 'outdoor-point').geometry).toEqual({ type: 'point', position: { lat: ORIGIN.lat + 0.01, lng: ORIGIN.lng + 0.01 } })
    history.undo()
    expect(outdoorPoi(document, 'outdoor-point').geometry).toEqual(point.geometry)
    history.redo()
    expect(outdoorPoi(document, 'outdoor-point').geometry).toEqual({ type: 'point', position: { lat: ORIGIN.lat + 0.01, lng: ORIGIN.lng + 0.01 } })

    // Circle move (world) + resize.
    const circleBefore = outdoorPoi(document, 'outdoor-circle').geometry as Extract<WorldPOIGeometry, { type: 'circle' }>
    const circleMoved = translateWorldPoiGeometry(circleBefore, 0.0002, 0.0002)
    updateGeometry(dispatcher, 'outdoor-circle', circleMoved)
    expect(outdoorPoi(document, 'outdoor-circle').geometry).toEqual(circleMoved)
    const circleResized = setWorldCircleRadius(circleMoved, 9)
    updateGeometry(dispatcher, 'outdoor-circle', circleResized)
    expect((outdoorPoi(document, 'outdoor-circle').geometry as Extract<WorldPOIGeometry, { type: 'circle' }>).radius).toBe(9)

    // Rectangle move.
    const rectBefore = outdoorPoi(document, 'outdoor-rectangle').geometry as Extract<WorldPOIGeometry, { type: 'rectangle' }>
    const rectMoved = translateWorldPoiGeometry(rectBefore, -0.0002, 0.0001) as Extract<WorldPOIGeometry, { type: 'rectangle' }>
    updateGeometry(dispatcher, 'outdoor-rectangle', rectMoved)
    expect(outdoorPoi(document, 'outdoor-rectangle').geometry).toEqual(rectMoved)

    // Polygon move + vertex drag.
    const polyBefore = outdoorPoi(document, 'outdoor-polygon').geometry as Extract<WorldPOIGeometry, { type: 'polygon' }>
    const polyMoved = translateWorldPoiGeometry(polyBefore, 0.0001, 0.0001) as Extract<WorldPOIGeometry, { type: 'polygon' }>
    updateGeometry(dispatcher, 'outdoor-polygon', polyMoved)
    const polyVertex = moveWorldPolygonVertex(polyMoved, 1, { lat: ORIGIN.lat + 0.02, lng: ORIGIN.lng + 0.02 }) as Extract<WorldPOIGeometry, { type: 'polygon' }>
    updateGeometry(dispatcher, 'outdoor-polygon', polyVertex)
    expect((outdoorPoi(document, 'outdoor-polygon').geometry as Extract<WorldPOIGeometry, { type: 'polygon' }>).points[1]).toEqual({ lat: ORIGIN.lat + 0.02, lng: ORIGIN.lng + 0.02 })

    // Undo chain returns the polygon to its original shape.
    history.undo()
    history.undo()
    expect(outdoorPoi(document, 'outdoor-polygon').geometry).toEqual(polyBefore)
  })

  it('resizes and rotates an outdoor rectangle preserving the anchored corner', () => {
    const document = makeDocument()
    const { dispatcher } = makeHistory(document)
    const rect = outdoorPoi(document, 'outdoor-rectangle').geometry as Extract<WorldPOIGeometry, { type: 'rectangle' }>
    const anchored = rect.points[0]

    const resized = resizeWorldRectangle(rect, 2, { lat: ORIGIN.lat + 0.005 + 3 * d, lng: ORIGIN.lng + 0.005 + 3 * d })!
    expect(updateGeometry(dispatcher, 'outdoor-rectangle', resized).success).toBe(true)
    const afterResize = outdoorPoi(document, 'outdoor-rectangle').geometry as Extract<WorldPOIGeometry, { type: 'rectangle' }>
    expect(afterResize.points[0].lat).toBeCloseTo(anchored.lat, 9)
    expect(afterResize.points[0].lng).toBeCloseTo(anchored.lng, 9)

    const rotated = rotateWorldPoiGeometry(afterResize, Math.PI / 4)!
    expect(updateGeometry(dispatcher, 'outdoor-rectangle', rotated).success).toBe(true)
    expect(outdoorPoi(document, 'outdoor-rectangle').geometry).toEqual(rotated)
  })

  it('edits indoor geometries in floor-local meters without leaking world coordinates', () => {
    const document = makeDocument()
    const { dispatcher, history } = makeHistory(document)

    const indoorCircle = indoorPoi(document, 'indoor-circle').geometry as Extract<ReturnType<typeof setLocalCircleRadius>, { type: 'circle' }>
    const moved = translateLocalPoiGeometry(indoorCircle, 2, -1)
    updateGeometry(dispatcher, 'indoor-circle', moved)
    const resized = setLocalCircleRadius(moved, 6)
    updateGeometry(dispatcher, 'indoor-circle', resized)

    const stored = indoorPoi(document, 'indoor-circle').geometry as { center: { x?: number; lat?: number }; radius: number }
    expect(stored.radius).toBe(6)
    expect(stored.center).toEqual({ x: 7, y: 4 })
    expect(stored.center).not.toHaveProperty('lat')

    const indoorPolygon = indoorPoi(document, 'indoor-polygon').geometry as { points: Array<{ x: number; y: number }> }
    const vertex = moveLocalPolygonVertex(indoorPolygon, 2, { x: 10, y: 10 })
    updateGeometry(dispatcher, 'indoor-polygon', vertex)
    expect((indoorPoi(document, 'indoor-polygon').geometry as { points: Array<{ x: number; y: number }> }).points[2]).toEqual({ x: 10, y: 10 })
    expect((indoorPoi(document, 'indoor-polygon').geometry as { points: Array<Record<string, number>> }).points[2]).not.toHaveProperty('lat')

    history.undo()
    expect((indoorPoi(document, 'indoor-polygon').geometry as { points: Array<{ x: number; y: number }> }).points[2]).toEqual({ x: 4, y: 4 })
  })

  it('keeps stable POI ids through every edit', () => {
    const document = makeDocument()
    const { dispatcher } = makeHistory(document)
    const idsBefore = document.pois!.map((poi) => poi.id)

    updateGeometry(dispatcher, 'outdoor-circle', setWorldCircleRadius(outdoorPoi(document, 'outdoor-circle').geometry as never, 8))
    updateGeometry(dispatcher, 'outdoor-point', { type: 'point', position: { lat: ORIGIN.lat + 0.02, lng: ORIGIN.lng + 0.02 } })

    expect(document.pois!.map((poi) => poi.id)).toEqual(idsBefore)
    expect(indoorPoi(document, 'indoor-circle').id).toBe('indoor-circle')
  })

  it('persists rotated geometry and authored color through save/reload', () => {
    const document = makeDocument()
    const { dispatcher } = makeHistory(document)
    const transformer = makeTransformer()

    const rect = outdoorPoi(document, 'outdoor-rectangle').geometry as Extract<WorldPOIGeometry, { type: 'rectangle' }>
    const rotated = rotateWorldPoiGeometry(rect, Math.PI / 6)!
    updateGeometry(dispatcher, 'outdoor-rectangle', rotated)
    dispatcher.execute({
      id: 'poi.update',
      label: 'Edit POI',
      payload: { poiId: 'outdoor-polygon', patch: { appearance: { mode: '2d', color: '#8B4513' } } },
    })

    const graph = new Graph(document.metadata.campusId)
    new GraphAdapter(graph, transformer).sync(document)
    const persisted = JSON.parse(JSON.stringify(serializeSnapshot(graph.toJSON())))
    const reloaded = createDocument(Graph.fromJSON(persisted), transformer)

    const reloadedRect = reloaded.pois!.find((poi) => poi.id === 'outdoor-rectangle')!.geometry as Extract<WorldPOIGeometry, { type: 'rectangle' }>
    expect(reloadedRect.points.map((p) => [p.lat, p.lng])).toEqual(rotated.type === 'rectangle' ? rotated.points.map((p) => [p.lat, p.lng]) : [])
    expect(reloaded.pois!.find((poi) => poi.id === 'outdoor-polygon')!.appearance).toEqual({ mode: '2d', color: '#8B4513' })
  })

  it('does not mutate roads, junctions, crossings, or RouteNetworks while editing', () => {
    const document = makeDocument()
    document.buildings[0].floors[0].routeNetwork = { nodes: [{ id: 'rn-1', type: 'waypoint', position: { x: 0, y: 0 }, floor: 0 }], edges: [] }
    const { dispatcher } = makeHistory(document)
    const before = JSON.stringify({
      roads: document.roads,
      roadJunctions: document.roadJunctions,
      separatedCrossings: document.separatedCrossings,
      routeNetwork: document.buildings[0].floors[0].routeNetwork,
    })

    updateGeometry(dispatcher, 'outdoor-rectangle', rotateWorldPoiGeometry(
      outdoorPoi(document, 'outdoor-rectangle').geometry as never,
      Math.PI / 7,
    ))
    updateGeometry(dispatcher, 'indoor-polygon', moveLocalPolygonVertex(
      indoorPoi(document, 'indoor-polygon').geometry as never,
      0,
      { x: -1, y: -1 },
    ))

    const after = JSON.stringify({
      roads: document.roads,
      roadJunctions: document.roadJunctions,
      separatedCrossings: document.separatedCrossings,
      routeNetwork: document.buildings[0].floors[0].routeNetwork,
    })
    expect(after).toBe(before)
  })

  it('persists a preferred anchor and keeps it attached through geometry moves', () => {
    const document = makeDocument()
    const { dispatcher } = makeHistory(document)
    const transformer = makeTransformer()

    dispatcher.execute({
      id: 'poi.update',
      label: 'Set approach anchor',
      payload: {
        poiId: 'outdoor-circle',
        patch: { navigation: { approachMode: 'preferred', anchor: { kind: 'circle-angle', angle: 0 } } },
      },
    })
    expect(outdoorPoi(document, 'outdoor-circle').navigation).toEqual({
      approachMode: 'preferred',
      anchor: { kind: 'circle-angle', angle: 0 },
    })

    const moved = translateWorldPoiGeometry(outdoorPoi(document, 'outdoor-circle').geometry as never, 0.001, 0.001)
    updateGeometry(dispatcher, 'outdoor-circle', moved)

    const graph = new Graph(document.metadata.campusId)
    new GraphAdapter(graph, transformer).sync(document)
    const persisted = JSON.parse(JSON.stringify(serializeSnapshot(graph.toJSON())))
    const reloaded = createDocument(Graph.fromJSON(persisted), transformer)
    const reloadedPoi = reloaded.pois!.find((poi) => poi.id === 'outdoor-circle')!

    expect(reloadedPoi.navigation).toEqual({ approachMode: 'preferred', anchor: { kind: 'circle-angle', angle: 0 } })
    expect(reloadedPoi.geometry).toEqual(moved)
  })
})
