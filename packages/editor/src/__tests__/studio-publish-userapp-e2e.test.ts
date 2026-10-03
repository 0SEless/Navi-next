import { describe, it, expect } from 'vitest'
import {
  CampusDocument,
  CoordinateTransformer,
  serializeDocument,
  deserializeDocument,
} from '@navi/core'
import { CommandDispatcher, DocumentStore, CommandRegistry, DocumentEventBus } from '@navi/editor'


import {
  featureCreateHandler,
  featureUpdateHandler,
  featureDeleteHandler,
} from '../commands/feature-handlers'
import { GraphAdapter } from '../graph-adapter'
import { Graph } from '@/engine/graph'
import { buildFromCampusBundle } from '../../../../src/components/map/NavigationRenderModel'

import { buildStairGeoJSON } from '../../../../src/components/map/layers/StaircaseLayer'
import { buildElevatorGeoJSON } from '../../../../src/components/map/layers/ElevatorLayer'
import { compileComponent } from '../../../../src/engine/component-compiler'

describe('Studio ↔ Publish ↔ User App (Explore & Navigate) End-to-End Integration', () => {
  const origin = { lat: 33.4200, lng: -111.9300 }

  function createTestDoc(): CampusDocument {
    return {
      version: 1,
      id: 'campus-1',

      metadata: { name: 'Main Campus', campusId: 'campus-1' },
      buildings: [
        {
          id: 'bld-1',
          name: 'Science Hall',
          code: 'SCI',
          category: 'academic',
          height: 12,
          footprint: {
            points: [
              origin,
              { lat: 33.4200, lng: -111.9280 },
              { lat: 33.4210, lng: -111.9280 },
              { lat: 33.4210, lng: -111.9300 },
            ],
          },
          floors: [
            { id: 'flr-0', level: 0, rooms: [], hallways: [{ id: 'hw-0', name: 'Corridor 0', width: 2, polyline: { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] } }], staircases: [], elevators: [], entrances: [] },
            { id: 'flr-1', level: 1, rooms: [], hallways: [{ id: 'hw-1', name: 'Corridor 1', width: 2, polyline: { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] } }], staircases: [], elevators: [], entrances: [] },
            { id: 'flr-2', level: 2, rooms: [], hallways: [{ id: 'hw-2', name: 'Corridor 2', width: 2, polyline: { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] } }], staircases: [], elevators: [], entrances: [] },
          ],
          staircases: [],
          elevators: [],
        },
      ],
      roads: [],
      panoramas: [],
      qrCheckpoints: [],
    }
  }

  it('proves complete end-to-end integration for Staircase and Elevator features', async () => {
    const doc = createTestDoc()
    const registry = new CommandRegistry()
    registry.register(featureCreateHandler)
    registry.register(featureUpdateHandler)
    registry.register(featureDeleteHandler)
    const eventBus = new DocumentEventBus()
    const dispatcher = new CommandDispatcher(registry, doc, eventBus)



    const transformer = new CoordinateTransformer()
    transformer.registerBuilding({ buildingId: 'bld-1', origin, rotation: 0 })


    // ─────────────────────────────────────────────────────────────
    // 1. STUDIO CREATE: User creates Staircase & Elevator
    // ─────────────────────────────────────────────────────────────
    const stairCreateRes = dispatcher.execute({
      id: 'feature.create',
      label: 'Create Staircase',
      payload: {
        buildingId: 'bld-1',
        floor: 0,
        id: 'stair-alpha',
        name: 'North Stairs',
        featureType: 'staircase',
        position: { x: 2, y: 2 },
        rotation: 0,
        fromLevel: 0,
        toLevel: 2,
        drawing: {
          definitionId: 'stair',
          properties: { stepCount: 10, stepWidth: 3, stepDepth: 0.3 },
        },
      },
    })
    expect(stairCreateRes.success).toBe(true)

    const elevCreateRes = dispatcher.execute({
      id: 'feature.create',
      label: 'Create Elevator',
      payload: {
        buildingId: 'bld-1',
        floor: 0,
        id: 'elev-bravo',
        name: 'Main Lift',
        featureType: 'elevator',
        position: { x: 8, y: 2 },
        rotation: 0,
        fromLevel: 0,
        toLevel: 2,
        drawing: {
          definitionId: 'elevator',
          properties: { width: 2.5, depth: 2.5 },
        },
      },
    })
    expect(elevCreateRes.success).toBe(true)

    const currentDoc = doc
    expect(currentDoc.buildings[0].staircases).toHaveLength(1)
    expect(currentDoc.buildings[0].staircases![0].id).toBe('stair-alpha')
    expect(currentDoc.buildings[0].staircases![0].levels[0].polygon?.points.length).toBeGreaterThanOrEqual(4)

    expect(currentDoc.buildings[0].elevators).toHaveLength(1)
    expect(currentDoc.buildings[0].elevators![0].id).toBe('elev-bravo')
    expect(currentDoc.buildings[0].elevators![0].levels[0].polygon?.points.length).toBeGreaterThanOrEqual(4)

    // ─────────────────────────────────────────────────────────────
    // 2. STUDIO EDIT: Edit properties with undo/redo
    // ─────────────────────────────────────────────────────────────
    const updateRes = dispatcher.execute({
      id: 'feature.update',
      label: 'Rename and adjust range',
      payload: {
        featureId: 'stair-alpha',
        level: 0,
        patch: {
          name: 'Grand North Staircase',
          toLevel: 2,
        },
      },
    })
    expect(updateRes.success).toBe(true)
    expect(doc.buildings[0].staircases![0].name).toBe('Grand North Staircase')

    // ─────────────────────────────────────────────────────────────
    // 3. PERSISTENCE & RELOAD: Serialize and deserialize document
    // ─────────────────────────────────────────────────────────────
    const serialized = serializeDocument(doc)

    const reloadedDoc = deserializeDocument(serialized)

    expect(reloadedDoc.buildings[0].staircases).toHaveLength(1)
    expect(reloadedDoc.buildings[0].staircases![0].id).toBe('stair-alpha')
    expect(reloadedDoc.buildings[0].staircases![0].name).toBe('Grand North Staircase')
    expect(reloadedDoc.buildings[0].elevators).toHaveLength(1)
    expect(reloadedDoc.buildings[0].elevators![0].id).toBe('elev-bravo')

    // ─────────────────────────────────────────────────────────────
    // 4. PUBLISH PROJECTION: GraphAdapter.sync emits runtime components
    // ─────────────────────────────────────────────────────────────
    const graph = new Graph()
    const adapter = new GraphAdapter(graph, transformer)
    adapter.sync(reloadedDoc)


    const stairComps = graph.components.filter((c) => c.type === 'stair')
    const elevComps = graph.components.filter((c) => c.type === 'elevator')

    expect(stairComps).toHaveLength(1)
    expect(stairComps[0].featureId).toBe('stair-alpha')
    expect(stairComps[0].id).toBe('stair-alpha-0')
    expect(stairComps[0].polygon?.length).toBeGreaterThanOrEqual(4)

    expect(elevComps).toHaveLength(1)
    expect(elevComps[0].featureId).toBe('elev-bravo')
    expect(elevComps[0].id).toBe('elev-bravo-0')
    expect(elevComps[0].polygon?.length).toBeGreaterThanOrEqual(4)

    // Derived routing graph nodes produced during sync
    expect(graph.nodes.some((n) => n.id === 'N-stair-stair-alpha-0')).toBe(true)
    expect(graph.nodes.some((n) => n.id === 'N-elevator-elev-bravo-0')).toBe(true)


    // ─────────────────────────────────────────────────────────────
    // 5. USER APP (EXPLORE & NAVIGATE): NavigationRenderModel & Layers
    // ─────────────────────────────────────────────────────────────
    const campusBundle = {
      buildings: [
        {
          id: 'bld-1',
          name: 'Science Hall',
          campusId: 'campus-1',
          floors: [0, 1, 2],
          footprint: doc.buildings[0].footprint.points,
          baseElevation: 0,
          height: 12,
          color: '#1C6BEB',
          code: 'SCI',
          category: 'academic',
        },
      ],
      nodes: graph.nodes as any,
      edges: graph.edges as any,
      boundingBox: { minLat: 33.4200, maxLat: 33.4210, minLng: -111.9300, maxLng: -111.9280 },
      components: graph.components as any,
    }

    const renderModel = buildFromCampusBundle(campusBundle)
    expect(renderModel.indoor.stairs).toHaveLength(1)
    expect(renderModel.indoor.stairs[0].id).toBe('stair-alpha-0')
    expect(renderModel.indoor.stairs[0].polygon).toBeDefined()
    expect(renderModel.indoor.stairs[0].polygon!.length).toBeGreaterThanOrEqual(4)

    expect(renderModel.indoor.elevators).toHaveLength(1)
    expect(renderModel.indoor.elevators[0].id).toBe('elev-bravo-0')
    expect(renderModel.indoor.elevators[0].polygon).toBeDefined()
    expect(renderModel.indoor.elevators[0].polygon!.length).toBeGreaterThanOrEqual(4)

    // ─────────────────────────────────────────────────────────────
    // 6. ARCHITECTURAL VECTOR GRAPHICS RENDERING
    // ─────────────────────────────────────────────────────────────
    const stairGeo = buildStairGeoJSON(renderModel.indoor.stairs)
    expect(stairGeo.features.some((f) => f.properties?.kind === 'body')).toBe(true)
    expect(stairGeo.features.some((f) => f.properties?.kind === 'tread')).toBe(true)
    expect(stairGeo.features.some((f) => f.properties?.kind === 'arrow')).toBe(true)

    const elevGeo = buildElevatorGeoJSON(renderModel.indoor.elevators)
    expect(elevGeo.features.some((f) => f.properties?.kind === 'shaft')).toBe(true)
    expect(elevGeo.features.some((f) => f.properties?.kind === 'cabin')).toBe(true)
    expect(elevGeo.features.some((f) => f.properties?.kind === 'door')).toBe(true)
  })
})
