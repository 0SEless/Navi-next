import { describe, it, expect } from 'vitest'
import { resolve } from 'path'
import { compile } from '@navi/compiler'
import { RuntimeEngine, AStar, SearchEngine } from '@navi/runtime'
import { load } from '@navi/runtime/loader'
import type { CampusDocument } from '@navi/core'
import type { CompilerConfig, NavigationGraph } from '@navi/compiler'

const FIXTURES = resolve(__dirname, '../../packages/runtime/test/fixtures')

function generateCampus(): CampusDocument {
  return {
    schemaVersion: 1,
    version: 0,
    metadata: {
      campusId: 'regression-test-campus',
      name: 'regression-test-campus',
      description: 'Campus for regression testing',
      lastModified: new Date().toISOString(),
      editorVersion: '0.1.0',
    },
    buildings: [{
      id: 'bld-reg-1',
      name: 'Regression Building',
      code: 'REG1',
      category: 'academic',
      description: 'Test building',
      footprint: {
        points: [
          { lat: 14.0, lng: 121.0 },
          { lat: 14.001, lng: 121.0 },
          { lat: 14.001, lng: 121.001 },
          { lat: 14.0, lng: 121.001 },
          { lat: 14.0, lng: 121.0 },
        ],
      },
      baseElevation: 10,
      height: 8,
      verticalConnectors: [],
      floors: [{
        id: 'flr-reg-g',
        level: 0,
        label: 'Ground Floor',
        elevation: 0,
        rooms: [
          { id: 'rm-reg-101', name: 'Room 101', number: '101', category: 'classroom', polygon: { points: [{ x: 2, y: 2 }, { x: 8, y: 2 }, { x: 8, y: 8 }, { x: 2, y: 8 }, { x: 2, y: 2 }] }, capacity: 30, roomDoors: [], metadata: {} },
          { id: 'rm-reg-102', name: 'Room 102', number: '102', category: 'classroom', polygon: { points: [{ x: 10, y: 2 }, { x: 16, y: 2 }, { x: 16, y: 8 }, { x: 10, y: 8 }, { x: 10, y: 2 }] }, capacity: 30, roomDoors: [], metadata: {} },
        ],
        hallways: [{ id: 'hlw-reg-g', name: 'Main Hallway', polyline: { points: [{ x: 9, y: 0 }, { x: 9, y: 10 }] }, width: 3 }],
        staircases: [],
        elevators: [],
        entrances: [{ id: 'ent-reg', label: 'Main Entrance', position: { lat: 14.0, lng: 121.0 } as any, level: 0, type: 'main', hasQR: true, hasPanorama: false }],
        connectorStops: [],
        metadata: {},
      }],
      color: '#ff0000',
      aliases: [],
      metadata: {},
    }],
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
  }
}

describe('Full Pipeline Regression', () => {
  it('Stage 1: Compiler runs without errors', () => {
    const doc = generateCampus()
    const config: CompilerConfig = { nodeInterval: 5, mergeThreshold: 3, optimizationLevel: 'moderate', includeAccessibility: true }
    const result = compile(doc, config)

    expect(result.graph).toBeDefined()
    expect(result.report).toBeDefined()
    expect(result.duration).toBeGreaterThanOrEqual(0)
  })

  it('Stage 2: Runtime loads from published artifacts', async () => {
    const result = await load(FIXTURES)
    expect(result.success).toBe(true)
    if (!result.success) return
    const engine = new RuntimeEngine(result.package)

    expect(engine).toBeDefined()
    expect(engine.data.getCampusId()).toBe('test-campus')
    expect(engine.data.getBuildings().buildings).toHaveLength(1)
  })

  it('Stage 3: Search returns results from index', async () => {
    const result = await load(FIXTURES)
    expect(result.success).toBe(true)
    if (!result.success) return
    const engine = new RuntimeEngine(result.package)

    const results = engine.search.search('Room 101')
    expect(results.length).toBeGreaterThanOrEqual(1)
    expect(results[0].title).toContain('Room')
  })

  it('Stage 4: AStar routes between arbitrary nodes', () => {
    const graph = {
      version: '1.0.0',
      campusId: 'regression',
      createdAt: '',
      checksum: '',
      nodes: [
        { id: 'a', label: 'A', type: 'space', position: { lng: 121.0, lat: 14.0 }, floor: 1, buildingId: 'b1', properties: {} },
        { id: 'b', label: 'B', type: 'corridor', position: { lng: 121.001, lat: 14.0 }, floor: 1, buildingId: 'b1', properties: {} },
        { id: 'c', label: 'C', type: 'space', position: { lng: 121.002, lat: 14.0 }, floor: 1, buildingId: 'b1', properties: {} },
      ],
      edges: [
        { id: 'ab', from: 'a', to: 'b', type: 'walk', distance: 100, weight: 100 },
        { id: 'bc', from: 'b', to: 'c', type: 'walk', distance: 100, weight: 100 },
      ],
      metadata: { nodeCount: 3, edgeCount: 2, buildings: 1, floors: 1, boundingBox: { minLng: 121.0, maxLng: 121.002, minLat: 14.0, maxLat: 14.0 } },
    }

    const astar = new AStar(graph as unknown as NavigationGraph)
    const route = astar.findPath('a', 'c')

    expect(route).not.toBeNull()
    expect(route!.path).toEqual(['a', 'b', 'c'])
    expect(route!.distance).toBe(200)
  })

  it('Stage 5: Runtime routing produces turn-by-turn instructions', async () => {
    const result = await load(FIXTURES)
    expect(result.success).toBe(true)
    if (!result.success) return
    const engine = new RuntimeEngine(result.package)

    const route = engine.navigation.findRoute('n1', 'n5')

    expect(route).not.toBeNull()
    expect(route!.instructions.length).toBeGreaterThanOrEqual(1)
    expect(route!.instructions[0].type).toBe('walk')
    expect(route!.instructions[route!.instructions.length - 1].type).toBe('arrive')
    expect(route!.totalDistance).toBeGreaterThan(0)
  })

  it('Stage 6: Navigation flow — search → route → instructions', async () => {
    const result = await load(FIXTURES)
    expect(result.success).toBe(true)
    if (!result.success) return
    const engine = new RuntimeEngine(result.package)

    const results = engine.search.search('Room 101')
    expect(results.length).toBeGreaterThanOrEqual(1)

    const fromNode = 'n1'
    const toNode = 'n5'
    const route = engine.navigation.findRoute(fromNode, toNode)

    expect(route).not.toBeNull()
    expect(route!.fromLabel).toBeDefined()
    expect(route!.toLabel).toBeDefined()
    expect(route!.instructions.length).toBeGreaterThanOrEqual(2)
    expect(route!.totalDistance).toBeGreaterThan(0)
  })
})
