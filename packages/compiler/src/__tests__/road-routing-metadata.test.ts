import { describe, expect, it } from 'vitest'
import type { CampusDocument, RoadRouting } from '@navi/core'
import { normalizeDocument } from '../normalize'
import { PolylineSkeletonGenerator } from '../primitives/skeleton-generator'
import { CampusCompiler } from '../pipeline/campus-compiler'

const FULL_ROUTING: RoadRouting = {
  feature: 'stairs',
  slope: 'steep',
  direction: 'forward',
  startElevationMeters: -2,
  endElevationMeters: 8,
  walkable: true,
  wheelchairAccessible: false,
}

function campusWithRoadRouting(routing?: unknown): CampusDocument {
  return {
    schemaVersion: 1,
    version: 1,
    metadata: {
      campusId: 'phase4-campus',
      name: 'Phase 4 Campus',
      description: 'Compiler metadata fixture',
      lastModified: '',
      editorVersion: '1.0',
    },
    buildings: [],
    roads: [{
      id: 'road-terrain',
      name: 'Terrain Road',
      polyline: {
        // Deliberately westbound: authored order, not geography or node IDs,
        // defines the required forward orientation.
        points: [
          { lat: 14.5, lng: 121.5004 },
          { lat: 14.5001, lng: 121.5002 },
          { lat: 14.5, lng: 121.5 },
        ],
      },
      width: 3,
      surface: 'paved',
      type: 'connector',
      metadata: {},
      ...(routing === undefined ? {} : { routing }),
    }],
    roadJunctions: [],
    panoramas: [],
    qrCheckpoints: [],
  } as CampusDocument
}

function edgeRouting(edge: unknown): unknown {
  return (edge as { routing?: unknown }).routing
}

function expectPositionClose(
  actual: { lat: number; lng: number } | undefined,
  expected: { lat: number; lng: number } | undefined,
): void {
  expect(actual).toBeDefined()
  expect(expected).toBeDefined()
  expect(actual!.lat).toBeCloseTo(expected!.lat, 10)
  expect(actual!.lng).toBeCloseTo(expected!.lng, 10)
}

function compile(routing?: unknown) {
  return new CampusCompiler({ nodeInterval: 8 }).compileV2(campusWithRoadRouting(routing))
}

function topologySignature(result: ReturnType<typeof compile>) {
  const graph = result.graph!
  const positions = new Map(graph.nodes.map(node => [
    node.id,
    `${node.position.lat.toFixed(10)},${node.position.lng.toFixed(10)},${node.floor},${node.buildingId},${node.type}`,
  ]))

  return {
    nodes: [...positions.values()].sort(),
    edges: graph.edges.map(edge => ({
      from: positions.get(edge.from),
      to: positions.get(edge.to),
      type: edge.type,
      distance: edge.distance,
      weight: edge.weight,
    })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  }
}

describe('Phase 4 Road routing compiler metadata', () => {
  it('normalizes valid sparse Road routing and preserves legacy absence', () => {
    const routed = normalizeDocument(campusWithRoadRouting(FULL_ROUTING)).document.roads[0]
    const legacy = normalizeDocument(campusWithRoadRouting()).document.roads[0]

    expect((routed as { routing?: RoadRouting }).routing).toEqual(FULL_ROUTING)
    expect(legacy).not.toHaveProperty('routing')
  })

  it('uses shared partial normalization for malformed Road routing', () => {
    const road = normalizeDocument(campusWithRoadRouting({
      feature: 'lava',
      slope: 'moderate',
      direction: 'reverse',
      startElevationMeters: Number.POSITIVE_INFINITY,
      endElevationMeters: 0,
      walkable: false,
      wheelchairAccessible: 'sometimes',
    })).document.roads[0]

    expect((road as { routing?: RoadRouting }).routing).toEqual({
      slope: 'moderate',
      direction: 'reverse',
      endElevationMeters: 0,
      walkable: false,
    })
  })

  it.each([null, false, 'stairs', []])('normalizes malformed primitive/array routing to absence: %j', routing => {
    const road = normalizeDocument(campusWithRoadRouting(routing)).document.roads[0]
    expect(road).not.toHaveProperty('routing')
  })

  it('attaches exact Road-level semantics and authored-order provenance to every sampled Road edge', () => {
    const normalized = normalizeDocument(campusWithRoadRouting(FULL_ROUTING)).document
    const contribution = new PolylineSkeletonGenerator().generate(normalized, {
      nodeInterval: 8,
      mergeThreshold: 0.5,
    })
    const roadEdges = contribution.edges?.filter(edge => edge.kind === 'skeleton') ?? []
    const positions = new Map(contribution.nodes?.map(node => [node.id, node.position]) ?? [])

    expect(roadEdges.length).toBeGreaterThan(2)
    expectPositionClose(positions.get(roadEdges[0].from), normalized.roads[0].polyline[0])
    expectPositionClose(positions.get(roadEdges.at(-1)!.to), normalized.roads[0].polyline.at(-1))
    for (let index = 0; index < roadEdges.length - 1; index++) {
      expect(roadEdges[index].to).toBe(roadEdges[index + 1].from)
    }
    for (const edge of roadEdges) {
      expect(edge.source).toMatchObject({ entityId: 'road-terrain', entityType: 'road' })
      expect(edgeRouting(edge)).toEqual({
        sourceRoadId: 'road-terrain',
        authoredOrientation: 'forward',
        authored: FULL_ROUTING,
      })
    }
  })

  it('retains per-Road metadata through an authored junction split without leaking it to the other Road', () => {
    const routed = campusWithRoadRouting(FULL_ROUTING)
    const legacy = campusWithRoadRouting()
    const crossingRoad = {
      id: 'road-crossing',
      name: 'Crossing Road',
      polyline: { points: [{ lat: 14.4999, lng: 121.5002 }, { lat: 14.5003, lng: 121.5002 }] },
      width: 3,
      surface: 'paved' as const,
      type: 'connector' as const,
      metadata: {},
    }
    const junction = {
      id: 'junction-1',
      position: { lat: 14.5001, lng: 121.5002 },
      roadIds: ['road-terrain', 'road-crossing'],
      source: 'authored' as const,
    }
    routed.roads.push(crossingRoad)
    legacy.roads.push(crossingRoad)
    routed.roadJunctions = [junction]
    legacy.roadJunctions = [junction]

    const contribution = new PolylineSkeletonGenerator().generate(normalizeDocument(routed).document, {
      nodeInterval: 8,
      mergeThreshold: 0.5,
    })
    const skeletonEdges = contribution.edges?.filter(edge => edge.kind === 'skeleton') ?? []
    const terrainEdges = skeletonEdges.filter(edge => edge.source.entityId === 'road-terrain')
    const crossingEdges = skeletonEdges.filter(edge => edge.source.entityId === 'road-crossing')
    const positions = new Map(contribution.nodes?.map(node => [node.id, node.position]) ?? [])

    expect(terrainEdges.length).toBeGreaterThan(1)
    expect(terrainEdges.every(edge => edgeRouting(edge) !== undefined)).toBe(true)
    expectPositionClose(positions.get(terrainEdges[0].from), routed.roads[0].polyline.points[0])
    expectPositionClose(positions.get(terrainEdges.at(-1)!.to), routed.roads[0].polyline.points.at(-1))
    for (let index = 0; index < terrainEdges.length - 1; index++) {
      expect(terrainEdges[index].to).toBe(terrainEdges[index + 1].from)
    }
    expect(crossingEdges.length).toBeGreaterThan(1)
    expect(crossingEdges.every(edge => edgeRouting(edge) === undefined)).toBe(true)

    const compiler = new CampusCompiler({ nodeInterval: 8 })
    expect(topologySignature(compiler.compileV2(routed))).toEqual(topologySignature(compiler.compileV2(legacy)))
  })

  it('emits the exact metadata on canonical NavEdges and serialized artifacts', () => {
    const result = compile(FULL_ROUTING)
    const graphEdges = result.graph!.edges.filter(edge => edge.type === 'walk')
    const artifactEdges = result.artifacts!.graph.edges.filter(edge => edge.type === 'walk')

    expect(graphEdges.length).toBeGreaterThan(2)
    expect(artifactEdges).toHaveLength(graphEdges.length)
    for (const edge of [...graphEdges, ...artifactEdges]) {
      expect(edgeRouting(edge)).toEqual({
        sourceRoadId: 'road-terrain',
        authoredOrientation: 'forward',
        authored: FULL_ROUTING,
      })
    }
    expect(JSON.parse(JSON.stringify(result.artifacts)).graph.edges[0].routing).toEqual({
      sourceRoadId: 'road-terrain',
      authoredOrientation: 'forward',
      authored: FULL_ROUTING,
    })
  })

  it.each([
    ['normal', { feature: 'normal' }],
    ['stairs', { feature: 'stairs' }],
    ['ramp', { feature: 'ramp' }],
    ['bridge', { feature: 'bridge' }],
    ['level', { slope: 'level' }],
    ['gentle', { slope: 'gentle' }],
    ['moderate', { slope: 'moderate' }],
    ['steep', { slope: 'steep' }],
    ['both', { direction: 'both' }],
    ['forward', { direction: 'forward' }],
    ['reverse', { direction: 'reverse' }],
    ['walkable true', { walkable: true }],
    ['walkable false', { walkable: false }],
    ['wheelchair true', { wheelchairAccessible: true }],
    ['wheelchair false', { wheelchairAccessible: false }],
    ['elevations', { startElevationMeters: -4, endElevationMeters: 12 }],
  ] satisfies Array<[string, RoadRouting]>)('keeps topology, distance, and weight unchanged for %s metadata', (_label, routing) => {
    const legacy = compile()
    const enriched = compile(routing)

    expect(topologySignature(enriched)).toEqual(topologySignature(legacy))
    expect(enriched.graph!.edges.map(edge => edge.distance)).toEqual(legacy.graph!.edges.map(edge => edge.distance))
    expect(enriched.graph!.edges.map(edge => edge.weight)).toEqual(legacy.graph!.edges.map(edge => edge.weight))
  })

  it('keeps an outdoor stair Road as ordinary outdoor walk edges', () => {
    const result = compile({ feature: 'stairs' })

    expect(result.graph!.edges.length).toBeGreaterThan(0)
    expect(result.graph!.edges.every(edge => edge.type === 'walk')).toBe(true)
    expect(result.graph!.nodes.every(node => node.type !== 'transition')).toBe(true)
    expect(result.graph!.edges.some(edge => edge.type === 'stairs' || edge.type === 'elevator' || edge.type === 'transition')).toBe(false)
  })

  it('does not materialize routing on legacy road edges', () => {
    const result = compile()
    expect(result.graph!.edges.length).toBeGreaterThan(0)
    expect(result.graph!.edges.every(edge => edgeRouting(edge) === undefined)).toBe(true)
  })
})
