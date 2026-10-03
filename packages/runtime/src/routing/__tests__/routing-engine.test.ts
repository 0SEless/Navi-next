import { describe, it, expect } from 'vitest'
import { RoutingEngine } from '../routing-engine'
import type { NavEdge, NavigationGraph, RoadRouting } from '@navi/core'

function makeGraph(overrides?: Partial<NavigationGraph>): NavigationGraph {
  return {
    version: '1.0.0',
    campusId: 'test',
    createdAt: '',
    checksum: '',
    nodes: [
      { id: 'a', label: 'Entrance', type: 'transition', position: { lng: 121.0, lat: 14.0 }, floor: 1, buildingId: 'b1', properties: {} },
      { id: 'b', label: 'Hallway', type: 'corridor', position: { lng: 121.0005, lat: 14.0 }, floor: 1, buildingId: 'b1', properties: {} },
      { id: 'c', label: 'Room 101', type: 'space', position: { lng: 121.001, lat: 14.0 }, floor: 1, buildingId: 'b1', properties: {} },
    ],
    edges: [
      { id: 'e1', from: 'a', to: 'b', type: 'walk', distance: 50, weight: 50 },
      { id: 'e2', from: 'b', to: 'c', type: 'walk', distance: 40, weight: 40 },
    ],
    metadata: { nodeCount: 3, edgeCount: 2, buildings: 1, floors: 1, boundingBox: { minLng: 121, maxLng: 121.001, minLat: 14, maxLat: 14.001 } },
    ...overrides,
  }
}

function terrainEdge(
  id: string,
  from: string,
  to: string,
  distance: number,
  authored?: RoadRouting,
): NavEdge {
  return {
    id,
    from,
    to,
    type: authored?.feature === 'stairs' ? 'stairs' : 'walk',
    distance,
    weight: distance,
    ...(authored
      ? {
          routing: {
            sourceRoadId: id,
            authoredOrientation: 'forward' as const,
            authored,
          },
        }
      : {}),
  }
}

function terrainGraph(edges: NavEdge[]): NavigationGraph {
  const position = { lng: 121, lat: 14 }
  return makeGraph({
    nodes: [
      { id: 'a', label: 'A', type: 'outdoor', position, floor: 0, buildingId: '', properties: {} },
      { id: 'b', label: 'B', type: 'outdoor', position, floor: 0, buildingId: '', properties: {} },
      { id: 'c', label: 'C', type: 'outdoor', position, floor: 0, buildingId: '', properties: {} },
    ],
    edges,
  })
}

describe('RoutingEngine', () => {
  it('finds a route between two connected nodes', () => {
    const engine = new RoutingEngine(makeGraph())
    const route = engine.findRoute('a', 'c')
    expect(route).not.toBeNull()
    expect(route!.path.map(s => s.nodeId)).toEqual(['a', 'b', 'c'])
  })

  it('returns null for unreachable nodes', () => {
    const engine = new RoutingEngine(makeGraph())
    const route = engine.findRoute('a', 'nonexistent')
    expect(route).toBeNull()
  })

  it('returns instructions with arrive at end', () => {
    const engine = new RoutingEngine(makeGraph())
    const route = engine.findRoute('a', 'c')!
    expect(route.instructions[route.instructions.length - 1].type).toBe('arrive')
  })

  it('computes total distance and duration', () => {
    const engine = new RoutingEngine(makeGraph())
    const route = engine.findRoute('a', 'c')!
    expect(route.totalDistance).toBeGreaterThan(0)
    expect(route.totalDuration).toBeGreaterThan(0)
  })

  it('includes fromLabel and toLabel', () => {
    const engine = new RoutingEngine(makeGraph())
    const route = engine.findRoute('a', 'c')!
    expect(route.fromLabel).toBe('Entrance')
    expect(route.toLabel).toBe('Room 101')
  })

  it('routing API works through engine', async () => {
    const { RuntimeEngine } = await import('../../engine/runtime-engine')
    const { load } = await import('../../loader')
    const { resolve } = await import('path')

    const fixturesDir = resolve(__dirname, '../../../test/fixtures')
    const result = await load(fixturesDir)
    expect(result.success).toBe(true)
    if (!result.success) return
    const engine = new RuntimeEngine(result.package)
    const route = engine.navigation.findRoute('n1', 'n3')
    expect(route).not.toBeNull()
  })

  it('selects the lower generalized-cost route while reporting physical distance', () => {
    const engine = new RoutingEngine(terrainGraph([
      terrainEdge('steep-shortcut', 'a', 'c', 100, { slope: 'steep' }),
      terrainEdge('level-a-b', 'a', 'b', 55),
      terrainEdge('level-b-c', 'b', 'c', 55),
    ]))

    const route = engine.findRoute('a', 'c')!

    expect(route.path.map((step) => step.nodeId)).toEqual(['a', 'b', 'c'])
    expect(route.totalDistance).toBe(110)
  })

  it('still selects a steep shortcut when its generalized cost is lower', () => {
    const engine = new RoutingEngine(terrainGraph([
      terrainEdge('steep-shortcut', 'a', 'c', 120, { slope: 'steep' }),
      terrainEdge('level-a-b', 'a', 'b', 75),
      terrainEdge('level-b-c', 'b', 'c', 75),
    ]))

    const route = engine.findRoute('a', 'c')!

    expect(route.path.map((step) => step.nodeId)).toEqual(['a', 'c'])
    expect(route.totalDistance).toBe(120)
    expect(route.generalizedCost).toBe(144)
  })

  it('enforces Road direction and walkability without mutating topology', () => {
    const forward = new RoutingEngine(terrainGraph([
      terrainEdge('forward', 'a', 'c', 100, { direction: 'forward' }),
    ]))
    expect(forward.findRoute('a', 'c')).not.toBeNull()
    expect(forward.findRoute('c', 'a')).toBeNull()

    const reverse = new RoutingEngine(terrainGraph([
      terrainEdge('reverse', 'a', 'c', 100, { direction: 'reverse' }),
    ]))
    expect(reverse.findRoute('a', 'c')).toBeNull()
    expect(reverse.findRoute('c', 'a')).not.toBeNull()

    const blocked = new RoutingEngine(terrainGraph([
      terrainEdge('blocked', 'a', 'c', 100, { walkable: false }),
    ]))
    expect(blocked.findRoute('a', 'c')).toBeNull()
  })

  it('reports physical edge distance for reverse traversal', () => {
    const engine = new RoutingEngine(terrainGraph([
      terrainEdge('both', 'a', 'c', 42, { direction: 'both' }),
    ]))

    expect(engine.findRoute('c', 'a')?.totalDistance).toBe(42)
  })

  it('reports the exact eligible parallel edge selected by A*', () => {
    const blockedShortcut = terrainEdge('blocked-shortcut', 'a', 'c', 5, { walkable: false })
    const eligibleParallel = terrainEdge('eligible-parallel', 'a', 'c', 20)
    const engine = new RoutingEngine(terrainGraph([blockedShortcut, eligibleParallel]))

    const route = engine.findRoute('a', 'c')!

    expect(route.totalDistance).toBe(20)
    expect(route.instructions[0]).toMatchObject({ type: 'walk', distance: 20 })
  })
})
