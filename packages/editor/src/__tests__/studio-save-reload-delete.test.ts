import { describe, it, expect } from 'vitest'
import {
  CampusDocument,
  CoordinateTransformer,
  serializeDocument,
  deserializeDocument,
} from '@navi/core'
import { CommandDispatcher, CommandRegistry, DocumentEventBus } from '@navi/editor'
import { buildingDeleteHandler } from '../commands/building-handlers'
import {
  featureCreateHandler,
  featureUpdateHandler,
  featureDeleteHandler,
} from '../commands/feature-handlers'
import { GraphAdapter } from '../graph-adapter'
import { Graph } from '@/engine/graph'
import { createDocument } from '../context/create-editor-context'

describe('Studio Save/Reload Persistence & Feature Deletion', () => {
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
            { id: 'flr-0', level: 0, rooms: [], hallways: [], staircases: [], elevators: [], entrances: [] },
            { id: 'flr-1', level: 1, rooms: [], hallways: [], staircases: [], elevators: [], entrances: [] },
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

  it('preserves staircase polygon geometry through GraphAdapter.sync -> Graph -> createDocument reload without turning into a dot', () => {
    const doc = createTestDoc()
    const registry = new CommandRegistry()
    registry.register(featureCreateHandler)
    registry.register(featureUpdateHandler)
    registry.register(featureDeleteHandler)
    const eventBus = new DocumentEventBus()
    const dispatcher = new CommandDispatcher(registry, doc, eventBus)

    const transformer = new CoordinateTransformer()
    transformer.registerBuilding({ buildingId: 'bld-1', origin, rotation: 0 })

    // 1. Create staircase
    const res = dispatcher.execute({
      id: 'feature.create',
      label: 'Create Staircase',
      payload: {
        buildingId: 'bld-1',
        floor: 0,
        id: 'stair-north',
        name: 'North Stairs',
        featureType: 'staircase',
        position: { x: 5, y: 5 },
        rotation: 0,
        fromLevel: 0,
        toLevel: 1,
        drawing: {
          definitionId: 'stair',
          properties: { stepCount: 8, stepWidth: 2.5, stepDepth: 0.3 },
        },
      },
    })
    expect(res.success).toBe(true)

    const createdStair = doc.buildings[0].staircases![0]
    expect(createdStair.levels[0].polygon?.points.length).toBeGreaterThanOrEqual(4)
    expect(createdStair.levels[0].drawing?.definitionId).toBe('stair')

    // 2. EditorBridge / Studio sync to Graph
    const graph = new Graph()
    const ga = new GraphAdapter(graph, transformer)
    ga.sync(doc)

    const legacyBld = graph.buildings.find((b) => b.id === 'bld-1')
    expect(legacyBld).toBeDefined()
    expect(legacyBld?.staircases).toBeDefined()
    expect(legacyBld?.staircases?.length).toBe(1)
    expect(legacyBld?.staircases?.[0].id).toBe('stair-north')

    // 3. Studio reload from Graph (createDocument)
    const reloadedDoc = createDocument(graph, transformer)
    const reloadedBld = reloadedDoc.buildings.find((b) => b.id === 'bld-1')
    expect(reloadedBld?.staircases).toHaveLength(1)

    const reloadedStair = reloadedBld!.staircases![0]
    expect(reloadedStair.id).toBe('stair-north')
    expect(reloadedStair.levels[0]).toBeDefined()
    expect(reloadedStair.levels[0].polygon?.points.length).toBeGreaterThanOrEqual(4)
    expect(reloadedStair.levels[0].drawing?.definitionId).toBe('stair')
  })

  it('allows deleting stairs using either featureId or per-floor component id', () => {
    const doc = createTestDoc()
    const registry = new CommandRegistry()
    registry.register(featureCreateHandler)
    registry.register(featureDeleteHandler)
    const eventBus = new DocumentEventBus()
    const dispatcher = new CommandDispatcher(registry, doc, eventBus)

    // 1. Create staircase
    dispatcher.execute({
      id: 'feature.create',
      label: 'Create Staircase',
      payload: {
        buildingId: 'bld-1',
        floor: 0,
        id: 'stair-delete-test',
        name: 'Stairs to delete',
        featureType: 'staircase',
        position: { x: 5, y: 5 },
        fromLevel: 0,
        toLevel: 1,
        drawing: { definitionId: 'stair', properties: { stepCount: 6 } },
      },
    })
    expect(doc.buildings[0].staircases).toHaveLength(1)

    // 2. Delete using per-floor component ID e.g. "stair-delete-test-0" (from canvas click)
    const deleteRes = dispatcher.execute({
      id: 'feature.delete',
      label: 'Delete Staircase',
      payload: { featureId: 'stair-delete-test-0' },
    })
    expect(deleteRes.success).toBe(true)
    expect(doc.buildings[0].staircases).toHaveLength(0)

    // 3. Undo delete restores the staircase with polygon
    const inverseCmd = featureDeleteHandler.inverse({ featureId: 'stair-delete-test-0' }, deleteRes)
    expect(inverseCmd).toBeDefined()
    const undoRes = dispatcher.execute(inverseCmd!)
    expect(undoRes.success).toBe(true)
    expect(doc.buildings[0].staircases).toHaveLength(1)
    expect(doc.buildings[0].staircases![0].id).toBe('stair-delete-test')
  })

  it('reconstructs polygon from graph.components during fallback minting if b.staircases was omitted', () => {
    const transformer = new CoordinateTransformer()
    transformer.registerBuilding({ buildingId: 'bld-1', origin, rotation: 0 })

    const localPoly = [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 4 },
      { x: 0, y: 4 },
    ]
    const worldPoly = localPoly.map((p) => transformer.buildingLocalToWorld(p, 'bld-1')!)

    const legacyGraph = {
      campusId: 'campus-1',
      buildings: [
        {
          id: 'bld-1',
          name: 'Science Hall',
          floors: [0],
          footprint: [origin, { lat: 33.421, lng: -111.93 }, { lat: 33.421, lng: -111.928 }],
          floorData: [{ level: 0, staircases: [{ id: 'stair-legacy', name: 'Legacy Stairs', position: { x: 0, y: 0 }, fromLevel: 0, toLevel: 1 }] }],
          // staircases is omitted on building to trigger fallback minting
        },
      ],
      components: [
        {
          id: 'stair-legacy-0',
          featureId: 'stair-legacy',
          type: 'stair',
          name: 'Legacy Stairs',
          buildingId: 'bld-1',
          floor: 0,
          position: origin,
          polygon: worldPoly,
          metadata: { drawing: { definitionId: 'stair', properties: { stepCount: 8 } } },
        },
      ],
    }

    const doc = createDocument(legacyGraph, transformer)
    const stair = doc.buildings[0].staircases![0]
    expect(stair).toBeDefined()
    expect(stair.id).toBe('stair-legacy')
    expect(stair.levels[0].polygon?.points).toHaveLength(4)
    expect(stair.levels[0].drawing?.definitionId).toBe('stair')
  })

  it('persists a building delete through GraphAdapter sync and hard reload without resurrecting it', () => {
    const doc = createTestDoc()
    const other = structuredClone(doc.buildings[0])
    other.id = 'bld-2'
    other.name = 'Library Hall'
    other.code = 'LIB'
    doc.buildings.push(other)

    const graph = new Graph()
    const adapter = new GraphAdapter(graph)
    adapter.sync(doc)
    expect(graph.buildings.map((building) => building.id)).toEqual(['bld-1', 'bld-2'])

    const registry = new CommandRegistry()
    registry.register(buildingDeleteHandler)
    const dispatcher = new CommandDispatcher(registry, doc, new DocumentEventBus())
    const result = dispatcher.execute({
      id: 'building.delete',
      label: 'Delete Building',
      payload: { buildingId: 'bld-1' },
    })

    expect(result.success).toBe(true)
    expect(doc.buildings.map((building) => building.id)).toEqual(['bld-2'])

    adapter.sync(doc)
    expect(graph.buildings.map((building) => building.id)).toEqual(['bld-2'])

    const reloadedDoc = createDocument(Graph.fromJSON(graph.toJSON()))
    expect(reloadedDoc.buildings.map((building) => building.id)).toEqual(['bld-2'])
  })
})
