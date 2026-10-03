import { describe, it, expect } from 'vitest'
import { CampusCompiler } from '../pipeline/campus-compiler'
import type { CampusDocument, RoadJunction } from '@navi/core'

/**
 * Fix 1 / compiler parity: a confirmed authored junction — created exactly on
 * the target geometry, as `Connect` does — must compile into shared
 * traversable topology. A junction that is merely NEAR the roads (beyond the
 * 0.5 m discovery radius) must not create cross-road connectivity.
 *
 * Explicit authored junction = connected. No authored junction = not connected.
 */

function campusWithRoads(
  roads: Array<{ id: string; points: Array<{ lat: number; lng: number }> }>,
  roadJunctions: RoadJunction[] = [],
): CampusDocument {
  return {
    schemaVersion: 1,
    version: 1,
    metadata: { campusId: 'junc-parity', name: 'junc-parity', description: '', lastModified: '', editorVersion: '1.0' },
    buildings: [
      {
        id: 'bld-x', name: 'Bld X', code: 'BX', category: 'academic', description: '',
        footprint: {
          points: [
            { lat: 14.5, lng: 121.485 },
            { lat: 14.505, lng: 121.485 },
            { lat: 14.505, lng: 121.495 },
            { lat: 14.5, lng: 121.495 },
          ],
        },
        baseElevation: 0, height: 10,
        floors: [
          {
            id: 'bld-x-f1', level: 1, label: 'Ground', elevation: 0,
            rooms: [], hallways: [], staircases: [], elevators: [],
            entrances: [{ id: 'bld-x-e1', label: 'Main', position: { lat: 14.5, lng: 121.49 } as any, level: 1, type: 'main', hasQR: false, hasPanorama: false, connectorRoadId: roads[0]?.id }],
            connectorStops: [], metadata: {},
          },
        ],
        verticalConnectors: [], aliases: [], color: '#ff0000', metadata: {},
      },
    ],
    panoramas: [],
    qrCheckpoints: [],
    roads: roads.map((r) => ({
      id: r.id, name: r.id, polyline: { points: r.points }, width: 8, surface: 'paved', type: 'arterial', metadata: {},
    })),
    roadJunctions,
  }
}

function compileRoads(roads: Parameters<typeof campusWithRoads>[0], roadJunctions: RoadJunction[] = []) {
  const compiler = new CampusCompiler({ nodeInterval: 10 })
  return compiler.compileV2(campusWithRoads(roads, roadJunctions))
}

function adjacency(graph: NonNullable<ReturnType<CampusCompiler['compileV2']>['graph']>): Map<string, string[]> {
  const adj = new Map<string, string[]>()
  for (const n of graph.nodes) adj.set(n.id, [])
  for (const e of graph.edges) {
    adj.get(e.from)?.push(e.to)
    adj.get(e.to)?.push(e.from)
  }
  return adj
}

function reachableIds(adj: Map<string, string[]>, startId: string): Set<string> {
  const seen = new Set<string>()
  const stack = [startId]
  while (stack.length) {
    const cur = stack.pop()!
    if (seen.has(cur)) continue
    seen.add(cur)
    for (const next of adj.get(cur) || []) if (!seen.has(next)) stack.push(next)
  }
  return seen
}

const ROAD_A = { id: 'rd-a', points: [{ lat: 14.5, lng: 121.49 }, { lat: 14.5, lng: 121.51 }] }

describe('authored junction compiler parity', () => {
  it('confirmed endpoint→segment junction compiles to shared traversable topology', () => {
    // Connect output model: branch endpoint and junction coincide exactly at
    // (14.5, 121.5), which lies on rd-a's segment interior.
    const branch = { id: 'rd-b', points: [{ lat: 14.5, lng: 121.5 }, { lat: 14.51, lng: 121.5 }] }
    const junction: RoadJunction = {
      id: 'j-confirmed',
      position: { lat: 14.5, lng: 121.5 },
      roadIds: ['rd-a', 'rd-b'],
      source: 'authored',
    }

    const result = compileRoads([ROAD_A, branch], [junction])

    expect(result.success).toBe(true)
    const graph = result.graph!
    const junctionNodes = graph.nodes.filter(
      (n) => Math.abs(n.position.lat - 14.5) < 0.0005 && Math.abs(n.position.lng - 121.5) < 0.0005,
    )
    expect(junctionNodes.length).toBeGreaterThanOrEqual(1)

    const seen = reachableIds(adjacency(graph), junctionNodes[0].id)
    const reachedWest = graph.nodes.filter((n) => seen.has(n.id) && Math.abs(n.position.lat - 14.5) < 0.001 && n.position.lng < 121.499)
    const reachedEast = graph.nodes.filter((n) => seen.has(n.id) && Math.abs(n.position.lat - 14.5) < 0.001 && n.position.lng > 121.501)
    const reachedBranch = graph.nodes.filter((n) => seen.has(n.id) && Math.abs(n.position.lng - 121.5) < 0.001 && n.position.lat > 14.5005)
    expect(reachedWest.length).toBeGreaterThan(0)
    expect(reachedEast.length).toBeGreaterThan(0)
    expect(reachedBranch.length).toBeGreaterThan(0)
  })

  it('confirmed endpoint→endpoint junction compiles to shared traversable topology', () => {
    // Connect output model: two roads share the exact endpoint (14.5, 121.51).
    const branch = { id: 'rd-b', points: [{ lat: 14.5, lng: 121.51 }, { lat: 14.51, lng: 121.51 }] }
    const junction: RoadJunction = {
      id: 'j-endpoint',
      position: { lat: 14.5, lng: 121.51 },
      roadIds: ['rd-a', 'rd-b'],
      source: 'authored',
    }

    const result = compileRoads([ROAD_A, branch], [junction])

    expect(result.success).toBe(true)
    const graph = result.graph!
    const seen = reachableIds(adjacency(graph), graph.nodes[0].id)
    const west = graph.nodes.filter((n) => seen.has(n.id) && Math.abs(n.position.lat - 14.5) < 0.001 && n.position.lng < 121.499)
    const branchNodes = graph.nodes.filter((n) => seen.has(n.id) && Math.abs(n.position.lng - 121.51) < 0.001 && n.position.lat > 14.5005)
    expect(west.length).toBeGreaterThan(0)
    expect(branchNodes.length).toBeGreaterThan(0)
  })

  it('junction beyond 0.5 m of the roads does NOT create cross-road connectivity', () => {
    // A junction ~1.5 m away — not produced by Connect, must not merge.
    const branch = { id: 'rd-b', points: [{ lat: 14.5000135, lng: 121.5 }, { lat: 14.51, lng: 121.5 }] }
    const junction: RoadJunction = {
      id: 'j-too-far',
      position: { lat: 14.5000135, lng: 121.500012 },
      roadIds: ['rd-a', 'rd-b'],
      source: 'authored',
    }

    const result = compileRoads([ROAD_A, branch], [junction])

    expect(result.graph).not.toBeNull()
    const graph = result.graph!
    // No waypoint coincides with the off-road junction position.
    const junctionWaypoints = graph.nodes.filter(
      (n) => Math.abs(n.position.lat - junction.position.lat) < 0.000005 && Math.abs(n.position.lng - junction.position.lng) < 0.000005,
    )
    expect(junctionWaypoints).toHaveLength(0)

    // A waypoint on rd-a cannot reach the far side of rd-b.
    const startA = graph.nodes.find((n) => n.type === 'waypoint' && Math.abs(n.position.lat - 14.5) < 0.001 && n.position.lng < 121.499)
    expect(startA).toBeDefined()
    const seen = reachableIds(adjacency(graph), startA!.id)
    const reachedBranchFar = graph.nodes.filter((n) => seen.has(n.id) && Math.abs(n.position.lng - 121.5) < 0.001 && n.position.lat > 14.5005)
    expect(reachedBranchFar).toHaveLength(0)
  })
})
