import { describe, it, expect } from 'vitest'
import { CampusCompiler } from '../pipeline/campus-compiler'
import type { CampusDocument, RoadJunction } from '@navi/core'

/**
 * Campus with one small building explicitly linked to the first road and the
 * given roads. Explicit RoadJunction records — never geometric crossing alone
 * — authorize cross-road connectivity.
 */
function campusWithRoads(
  roads: Array<{ id: string; points: Array<{ lat: number; lng: number }> }>,
  roadJunctions: RoadJunction[] = [],
): CampusDocument {
  return {
    schemaVersion: 1,
    version: 1,
    metadata: { campusId: 'junc-univ', name: 'junc-univ', description: 'Junction test campus', lastModified: '', editorVersion: '1.0' },
    buildings: [
      {
        id: 'bld-x',
        name: 'Bld X',
        code: 'BX',
        category: 'academic',
        description: '',
        footprint: {
          points: [
            { lat: 14.5, lng: 121.485 },
            { lat: 14.505, lng: 121.485 },
            { lat: 14.505, lng: 121.495 },
            { lat: 14.5, lng: 121.495 },
          ],
        },
        baseElevation: 0,
        height: 10,
        floors: [
          {
            id: 'bld-x-f1',
            level: 1,
            label: 'Ground',
            elevation: 0,
            rooms: [],
            hallways: [],
            staircases: [],
            elevators: [],
            entrances: [
              { id: 'bld-x-e1', label: 'Main', position: { lat: 14.5, lng: 121.49 } as any, level: 1, type: 'main', hasQR: false, hasPanorama: false, connectorRoadId: roads[0]?.id },
            ],
            connectorStops: [],
            metadata: {},
          },
        ],
        verticalConnectors: [],
        aliases: [],
        color: '#ff0000',
        metadata: {},
      },
    ],
    panoramas: [],
    qrCheckpoints: [],
    roads: roads.map((r) => ({
      id: r.id,
      name: r.id,
      polyline: { points: r.points },
      width: 8,
      surface: 'paved',
      type: 'arterial',
      metadata: {},
    })),
    roadJunctions,
  }
}

function compileRoads(
  roads: Parameters<typeof campusWithRoads>[0],
  roadJunctions: RoadJunction[] = [],
) {
  const compiler = new CampusCompiler({ nodeInterval: 10 })
  return compiler.compileV2(campusWithRoads(roads, roadJunctions))
}

/** Adjacency map from graph edges (undirected). */
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

describe('road junction authority (T2a)', () => {
  it('connects two crossing roads through an explicit authored RoadJunction', () => {
    // Road A: horizontal (east-west), Road B: vertical (north-south), crossing at (14.5, 121.5)
    const result = compileRoads(
      [
        { id: 'rd-a', points: [{ lat: 14.5, lng: 121.49 }, { lat: 14.5, lng: 121.51 }] },
        { id: 'rd-b', points: [{ lat: 14.49, lng: 121.5 }, { lat: 14.51, lng: 121.5 }] },
      ],
      [{ id: 'junction-ab', position: { lat: 14.5, lng: 121.5 }, roadIds: ['rd-a', 'rd-b'], source: 'authored' }],
    )

    expect(result.success).toBe(true)
    const graph = result.graph!
    expect(graph.nodes.length).toBeGreaterThan(0)

    // Diagnostics should report the junction
    expect(result.report.diagnostics.some((d) => d.code === 'ROAD_JUNCTION')).toBe(true)

    // The junction node exists near the crossing point
    const junctionNodes = graph.nodes.filter(
      (n) => Math.abs(n.position.lat - 14.5) < 0.0005 && Math.abs(n.position.lng - 121.5) < 0.0005,
    )
    expect(junctionNodes.length).toBeGreaterThanOrEqual(1)

    // Flood fill from the junction must reach waypoints on BOTH roads
    const seen = reachableIds(adjacency(graph), junctionNodes[0].id)
    const reachedA = graph.nodes.filter((n) => seen.has(n.id) && Math.abs(n.position.lat - 14.5) < 0.001 && n.position.lng < 121.5)
    const reachedB = graph.nodes.filter((n) => seen.has(n.id) && Math.abs(n.position.lng - 121.5) < 0.001 && n.position.lat < 14.5)
    expect(reachedA.length).toBeGreaterThan(0)
    expect(reachedB.length).toBeGreaterThan(0)
  })

  it('keeps non-crossing roads disconnected (no junction diagnostic)', () => {
    const result = compileRoads([
      { id: 'rd-a', points: [{ lat: 14.5, lng: 121.49 }, { lat: 14.5, lng: 121.51 }] },
      { id: 'rd-b', points: [{ lat: 14.2, lng: 121.5 }, { lat: 14.3, lng: 121.5 }] },
    ])

    expect(result.graph).not.toBeNull()
    expect(result.report.diagnostics.some((d) => d.code === 'ROAD_JUNCTION')).toBe(false)
    // rd-b is an isolated component → the validator reports it as disconnected
    expect(result.errors.some((e) => e.code === 'HALLWAY_DISCONNECTED')).toBe(true)
  })

  it('produces the expected waypoint chain for a single road (no forced points)', () => {
    const result = compileRoads([
      { id: 'rd-a', points: [{ lat: 14.5, lng: 121.49 }, { lat: 14.5, lng: 121.51 }] },
    ])

    expect(result.success).toBe(true)
    expect(result.report.diagnostics.some((d) => d.code === 'ROAD_JUNCTION')).toBe(false)
    const graph = result.graph!
    // 0.02° lng at lat 14.5 ≈ 2.15 km → at 10m interval ≈ 215 interior waypoints + 2 endpoints
    const roadNodes = graph.nodes.filter((n) => n.type === 'waypoint')
    expect(roadNodes.length).toBeGreaterThan(200)
    // All waypoints on the road chain are connected (one component)
    const seen = reachableIds(adjacency(graph), roadNodes[0].id)
    expect(roadNodes.every((n) => seen.has(n.id))).toBe(true)
  })
})
