import { describe, it, expect } from 'vitest'
import { CampusCompiler } from '../pipeline/campus-compiler'
import { compile as compileLegacy } from '../pipeline/compile'
import type { CampusDocument, NavigationGraph } from '@navi/core'

/**
 * Entrance↔road linking (T2b).
 *
 * Priority in connector.ts step 6:
 *   1. Explicit link: entrance.connectorRoadId (forward) or road.connectorEntranceId (reverse)
 *   2. Nothing — ENTRANCE_NO_ROAD diagnostic (no proximity-based edge)
 *
 * NOTE: assertions run against the EMITTED NavigationGraph, where:
 *  - entrance portals become a 'outdoor' node (outdoor position) + 'entrance' node
 *  - all access edges become type 'walk'; source metadata is stripped
 *  - road waypoints are type 'waypoint' (identified by position, no road id)
 *
 * Building sits near (14.5, 121.49) with entrance bld-x-e1 at (14.5, 121.49).
 * A "far" road at lat 14.55 is ~5.5km away — far beyond the 50m bound.
 */
interface RoadSpec {
  id: string
  points: Array<{ lat: number; lng: number }>
  connectorEntranceId?: string
}

function campusWithRoads(
  roads: RoadSpec[],
  entrance: { connectorRoadId?: string } = {},
): CampusDocument {
  return {
    schemaVersion: 1,
    version: 1,
    metadata: { campusId: 'link-univ', name: 'link-univ', description: 'Entrance-road link test campus', lastModified: '', editorVersion: '1.0' },
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
              {
                id: 'bld-x-e1',
                label: 'Main',
                position: { lat: 14.5, lng: 121.49 } as any,
                level: 1,
                type: 'main',
                hasQR: false,
                hasPanorama: false,
                ...entrance,
              },
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
      ...(r.connectorEntranceId ? { connectorEntranceId: r.connectorEntranceId } : {}),
    })),
  }
}

function compile(roads: RoadSpec[], entrance?: { connectorRoadId?: string }) {
  const compiler = new CampusCompiler({ nodeInterval: 10 })
  return compiler.compileV2(campusWithRoads(roads, entrance))
}

function compileOldPath(roads: RoadSpec[], entrance?: { connectorRoadId?: string }) {
  return compileLegacy(campusWithRoads(roads, entrance), {
    nodeInterval: 10,
    mergeThreshold: 0.5,
    optimizationLevel: 'none',
    includeAccessibility: false,
  })
}

/** The outdoor NavNode produced from the entrance portal. */
function outdoorNode(graph: NavigationGraph) {
  return graph.nodes.find((n) => n.type === 'outdoor')
}

/** Edges incident to the outdoor node, paired with the other endpoint's node. */
function outdoorEdges(graph: NavigationGraph) {
  const outdoor = outdoorNode(graph)
  if (!outdoor) return []
  return graph.edges
    .filter((e) => e.from === outdoor.id || e.to === outdoor.id)
    .map((e) => ({
      edge: e,
      other: graph.nodes.find((n) => n.id === (e.from === outdoor.id ? e.to : e.from))!,
    }))
}

/** A road 0.02° (~2.15km) wide, ~5.5km south of the campus — beyond any bound. */
const FAR_ROAD: RoadSpec = {
  id: 'rd-far',
  points: [
    { lat: 14.55, lng: 121.49 },
    { lat: 14.55, lng: 121.51 },
  ],
}

/** True if a node lies on rd-far (waypoints sampled along lat ≈ 14.55). */
function onFarRoad(node: { position: { lat: number } }): boolean {
  return Math.abs(node.position.lat - 14.55) < 0.001
}

describe('entrance-to-road linking (T2b)', () => {
  it('honors an explicit entrance.connectorRoadId link even beyond the distance bound', () => {
    const result = compile([FAR_ROAD], { connectorRoadId: 'rd-far' })

    expect(result.success).toBe(true)
    const graph = result.graph!
    expect(outdoorNode(graph)).toBeDefined()

    // The outdoor node must have a walk edge reaching a waypoint on rd-far (~5.5km away).
    // Such a long edge can only exist via the explicit link — the bound would reject it.
    const toFarRoad = outdoorEdges(graph).filter(({ other }) => onFarRoad(other))
    expect(toFarRoad.length).toBeGreaterThan(0)
    expect(toFarRoad[0].edge.distance).toBeGreaterThan(5000)
    expect(result.report.diagnostics.some((d) => d.code === 'ENTRANCE_NO_ROAD')).toBe(false)
  })

  it('honors a reverse road.connectorEntranceId link when the entrance has none', () => {
    const result = compile([{ ...FAR_ROAD, connectorEntranceId: 'bld-x-e1' }])

    expect(result.success).toBe(true)
    const graph = result.graph!
    const toFarRoad = outdoorEdges(graph).filter(({ other }) => onFarRoad(other))
    expect(toFarRoad.length).toBeGreaterThan(0)
    expect(toFarRoad[0].edge.distance).toBeGreaterThan(5000)
    expect(result.report.diagnostics.some((d) => d.code === 'ENTRANCE_NO_ROAD')).toBe(false)
  })

  it('does not infer a road edge for an entrance near a road', () => {
    // Road runs ~31m north of the entrance at (14.5, 121.49)
    const NEAR_ROAD: RoadSpec = {
      id: 'rd-near',
      points: [
        { lat: 14.50028, lng: 121.485 },
        { lat: 14.50028, lng: 121.495 },
      ],
    }
    const result = compile([NEAR_ROAD])

    // The nearby road remains a separate component because proximity no
    // longer creates an entrance bridge, so publish is correctly blocked.
    expect(result.success).toBe(false)
    const graph = result.graph!
    const outdoor = outdoorNode(graph)!
    const edge = outdoorEdges(graph).find(({ edge: candidate, other }) => other.type === 'waypoint' && candidate.distance < 50)?.edge
    expect(edge).toBeUndefined()
    expect(result.report.diagnostics.some((d) => d.code === 'ENTRANCE_NO_ROAD')).toBe(true)
  })

  it('does NOT teleport an entrance to a far road without an explicit link', () => {
    const result = compile([FAR_ROAD])

    // The road is unreachable → ENTRANCE_NO_ROAD diagnostic, and the validator
    // flags the isolated road component
    expect(result.report.diagnostics.some((d) => d.code === 'ENTRANCE_NO_ROAD')).toBe(true)
    expect(result.errors.some((e) => e.code === 'HALLWAY_DISCONNECTED')).toBe(true)
    // No edge reaches the far road from the outdoor node
    const graph = result.graph!
    const toFarRoad = outdoorEdges(graph).filter(({ other }) => onFarRoad(other))
    expect(toFarRoad.length).toBe(0)
  })

  it('legacy compile does not infer an entrance edge from a nearby road', () => {
    const NEAR_ROAD: RoadSpec = {
      id: 'rd-near',
      points: [
        { lat: 14.50028, lng: 121.485 },
        { lat: 14.50028, lng: 121.495 },
      ],
    }
    const result = compileOldPath([NEAR_ROAD])
    const entrance = result.graph.nodes.find((node) => node.type === 'transition')!

    const corridorEdge = result.graph.edges.find((edge) => {
      const otherId = edge.from === entrance.id ? edge.to : edge.to === entrance.id ? edge.from : null
      return otherId !== null && result.graph.nodes.find((node) => node.id === otherId)?.type === 'corridor'
    })
    expect(corridorEdge).toBeUndefined()
  })

  it('legacy compile preserves explicit forward and reverse connector fields', () => {
    const forward = compileOldPath([FAR_ROAD], { connectorRoadId: 'rd-far' })
    const reverse = compileOldPath([{ ...FAR_ROAD, connectorEntranceId: 'bld-x-e1' }])

    for (const result of [forward, reverse]) {
      const entrance = result.graph.nodes.find((node) => node.type === 'transition')!
      const farCorridor = result.graph.nodes.find((node) => node.type === 'corridor' && onFarRoad(node))!
      expect(result.graph.edges.some((edge) =>
        (edge.from === entrance.id && edge.to === farCorridor.id) ||
        (edge.to === entrance.id && edge.from === farCorridor.id),
      )).toBe(true)
    }
  })
})
