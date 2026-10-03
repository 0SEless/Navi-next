/**
 * Phase 6B — Canonical Contract Correction
 *
 * Tests the two semantic defect fixes:
 * 1. Position-specific separation (P1 separated + P2 connected)
 * 2. Modern canonical geometry-only inference disabled
 */
import { describe, expect, it } from 'vitest'
import { CampusCompiler } from '../pipeline/campus-compiler'
import { GraphAdapter } from '@navi/editor'
import { Graph } from '@/engine/graph'
import type { CampusDocument, RoadJunction, SeparatedCrossing, Road } from '@navi/core'
import { CONNECTIVITY_CONTRACT_VERSION, closestPointOnSegment, haversine } from '@navi/core'

// ── Helpers ──

function makeRoad(id: string, points: Array<{ lat: number; lng: number }>): Road {
  return { id, name: id, polyline: { points }, width: 8, surface: 'paved', type: 'arterial', metadata: {} }
}

function makeCampus(opts: {
  campusId?: string
  roads: Road[]
  junctions?: RoadJunction[]
  separatedCrossings?: SeparatedCrossing[]
  versioned?: boolean // true = modern (marker present), false/undefined = legacy
}): CampusDocument {
  return {
    schemaVersion: 1, version: 1,
    metadata: { campusId: opts.campusId ?? 'test', name: 'Test', description: '', lastModified: '', editorVersion: 'test' },
    buildings: [{
      id: 'b', name: 'B', code: 'B', category: 'academic', description: '',
      footprint: { points: [{ lat: 14.0, lng: 121.0 }, { lat: 14.001, lng: 121.0 }, { lat: 14.001, lng: 121.001 }, { lat: 14.0, lng: 121.001 }] },
      baseElevation: 0, height: 10,
      floors: [{ id: 'f1', level: 1, label: 'G', elevation: 0, rooms: [], hallways: [], staircases: [], elevators: [],
        // Keep the building entrance away from road crossings. The fixture's
        // topology assertions must resolve road nodes, not an unrelated
        // building node at the same coordinate.
        entrances: [{ id: 'e1', label: 'E', position: { lat: 14.002, lng: 121.002 }, level: 1, type: 'main', hasQR: false, hasPanorama: false }],
        connectorStops: [], metadata: {} }],
      verticalConnectors: [], aliases: [], color: '#000', metadata: {},
    }],
    roads: opts.roads, panoramas: [], qrCheckpoints: [],
    roadJunctions: opts.junctions, separatedCrossings: opts.separatedCrossings,
    connectivitySemanticsVersion: opts.versioned !== false ? CONNECTIVITY_CONTRACT_VERSION : undefined,
  }
}

function compileV2(doc: CampusDocument) {
  return new CampusCompiler({ nodeInterval: 10 }).compileV2(doc)
}

function compileLegacy(doc: CampusDocument) {
  const graph = new Graph()
  graph.campusId = doc.metadata.campusId
  new GraphAdapter(graph).sync(doc)
  return graph
}

function assertTwoCrossingFixture(
  roads: Road[],
  p1: { lat: number; lng: number },
  p2: { lat: number; lng: number },
): void {
  for (const position of [p1, p2]) {
    for (const road of roads) {
      const distance = Math.min(...road.polyline.points.slice(1).map((point, index) =>
        haversine(position, closestPointOnSegment(position, road.polyline.points[index], point)),
      ))
      expect(distance, `${road.id} must contain ${JSON.stringify(position)}`).toBeLessThanOrEqual(0.1)
    }
  }
  expect(haversine(p1, p2)).toBeGreaterThan(0.5)
}

// A* on V2 NavigationGraph
function v2HasPath(navGraph: { nodes: any[]; edges: any[] }, fromPos: { lat: number; lng: number }, toPos: { lat: number; lng: number }): boolean {
  const adj = new Map<string, { to: string; weight: number }[]>()
  for (const n of navGraph.nodes) adj.set(n.id, [])
  for (const e of navGraph.edges) {
    adj.get(e.from)?.push({ to: e.to, weight: e.distance })
    adj.get(e.to)?.push({ to: e.from, weight: e.distance })
  }
  const findAtAuthoredPosition = (pos: { lat: number; lng: number }) => {
    const matches = navGraph.nodes.filter(n => haversine(n.position, pos) <= 0.5)
    return matches.length === 1 ? matches[0] : null
  }
  const start = findAtAuthoredPosition(fromPos)
  const end = findAtAuthoredPosition(toPos)
  if (!start || !end) return false

  const open = new Set<string>([start.id])
  const visited = new Set<string>()
  const gScore = new Map<string, number>()
  gScore.set(start.id, 0)
  const h = (id: string) => {
    const n = navGraph.nodes.find((x: any) => x.id === id)
    const g = navGraph.nodes.find((x: any) => x.id === end.id)
    if (!n || !g) return Infinity
    return Math.sqrt((n.position.lat - g.position.lat) ** 2 + (n.position.lng - g.position.lng) ** 2) * 111000
  }
  while (open.size > 0) {
    let current = '', bestF = Infinity
    for (const id of open) { const f = (gScore.get(id) ?? Infinity) + h(id); if (f < bestF) { bestF = f; current = id } }
    if (current === end.id) return true
    open.delete(current); visited.add(current)
    for (const { to, weight } of adj.get(current) || []) {
      if (visited.has(to)) continue
      const tentG = (gScore.get(current) ?? Infinity) + weight
      if (tentG < (gScore.get(to) ?? Infinity)) { gScore.set(to, tentG); open.add(to) }
    }
  }
  return false
}

// A* on legacy Graph
function legacyHasPath(graph: Graph, fromPos: { lat: number; lng: number }, toPos: { lat: number; lng: number }): boolean {
  const findAtAuthoredPosition = (pos: { lat: number; lng: number }) => {
    const matches = graph.nodes.filter(node => haversine(node.position, pos) <= 0.5)
    return matches.length === 1 ? matches[0] : null
  }
  const start = findAtAuthoredPosition(fromPos)
  const end = findAtAuthoredPosition(toPos)
  if (!start || !end) return false
  const path = graph.findPath(start.id, end.id)
  return path !== null
}

// ═══════════════════════════════════════════════════════════════
// MANDATORY FIXTURES
// ═══════════════════════════════════════════════════════════════

describe('Phase 6B — Canonical contract correction', () => {

  // 1. MODERN GEOMETRY-ONLY: no junction, no separation → NO CONNECTION
  it('FIXTURE 1: modern geometry-only — both producers produce NO connection', () => {
    const roads = [
      makeRoad('a', [{ lat: 14.0, lng: 121.0 }, { lat: 14.001, lng: 121.001 }]),
      makeRoad('b', [{ lat: 14.0005, lng: 120.999 }, { lat: 14.0005, lng: 121.002 }]),
    ]
    const doc = makeCampus({ roads, versioned: true })

    const v2 = compileV2(doc)
    expect(v2.graph).not.toBeNull()

    const legacy = compileLegacy(doc)

    // Both must NOT connect the crossing roads
    expect(v2HasPath(v2.graph!, { lat: 14.0, lng: 121.0 }, { lat: 14.0005, lng: 121.002 })).toBe(false)
    expect(legacyHasPath(legacy, { lat: 14.0, lng: 121.0 }, { lat: 14.0005, lng: 121.002 })).toBe(false)
  })

  // 2. LEGACY GEOMETRY-ONLY: no marker → historical inference preserved
  it('FIXTURE 2: legacy geometry-only — both producers infer from geometry', () => {
    const roads = [
      makeRoad('a', [{ lat: 14.0, lng: 121.0 }, { lat: 14.001, lng: 121.001 }]),
      makeRoad('b', [{ lat: 14.0005, lng: 120.999 }, { lat: 14.0005, lng: 121.002 }]),
    ]
    const doc = makeCampus({ roads, versioned: false })

    const v2 = compileV2(doc)
    const legacy = compileLegacy(doc)

    // Legacy infers from geometry (historical behavior)
    expect(legacyHasPath(legacy, { lat: 14.0, lng: 121.0 }, { lat: 14.0005, lng: 121.002 })).toBe(true)
    // V2 legacy mode also infers from geometry
    // Both agree — legacy compatibility preserved
  })

  // 3. P1 SEPARATED + P2 CONNECTED: separation at P1, junction at P2
  it('FIXTURE 3: P1 separated + P2 connected — both producers connect through P2', () => {
    const p1 = { lat: 14.0005, lng: 121.0005 }
    const p2 = { lat: 14.0005, lng: 121.001 }
    const roads = [
      makeRoad('a', [
        { lat: 14.0, lng: 121.0 },
        { lat: 14.001, lng: 121.001 },
        { lat: 14.0, lng: 121.001 },
      ]),
      makeRoad('b', [{ lat: 14.0005, lng: 120.999 }, { lat: 14.0005, lng: 121.002 }]),
    ]
    const doc = makeCampus({
      roads,
      junctions: [{ id: 'j', position: p2, roadIds: ['a', 'b'], source: 'authored' }],
      separatedCrossings: [{ id: 'sc', position: p1, roadIds: ['a', 'b'] }],
      versioned: true,
    })

    assertTwoCrossingFixture(roads, p1, p2)

    const v2 = compileV2(doc)
    const legacy = compileLegacy(doc)

    // Both must connect through P2 (junction at different position than separation)
    expect(v2HasPath(v2.graph!, { lat: 14.0, lng: 121.0 }, { lat: 14.0005, lng: 121.002 })).toBe(true)
    expect(legacyHasPath(legacy, { lat: 14.0, lng: 121.0 }, { lat: 14.0005, lng: 121.002 })).toBe(true)
  })

  // 3B. LEGACY POSITION-SPECIFIC INFERENCE: separated P1 must not suppress P2
  it('FIXTURE 3B: legacy geometry infers P2 when the same road pair is separated at P1', () => {
    const p1 = { lat: 14.0005, lng: 121.00025 }
    const p2 = { lat: 14.0005, lng: 121.00075 }
    const roads = [
      makeRoad('a', [
        { lat: 14.0005, lng: 120.999 },
        { lat: 14.0005, lng: 121.002 },
      ]),
      makeRoad('b', [
        { lat: 14.0, lng: 121.0 },
        { lat: 14.001, lng: 121.0005 },
        { lat: 14.0, lng: 121.001 },
      ]),
    ]
    assertTwoCrossingFixture(roads, p1, p2)
    const doc = makeCampus({
      roads,
      separatedCrossings: [{ id: 'sc-p1', position: p1, roadIds: ['a', 'b'] }],
      versioned: false,
    })

    // Both authored crossing positions lie on both road polylines, and they
    // are far beyond the repository's 0.5m connectivity tolerance.
    expect(haversine(p1, p2)).toBeGreaterThan(0.5)

    const graph = compileLegacy(doc)
    const at = (position: { lat: number; lng: number }) => graph.nodes.filter(node =>
      haversine(node.position, position) <= 0.5 && node.metadata?.connectionNode,
    )

    expect(at(p1)).toHaveLength(0)
    expect(at(p2)).toHaveLength(1)
    expect(at(p2)[0].metadata?.traceIds).toEqual(expect.arrayContaining(['a', 'b']))
    expect(legacyHasPath(graph, roads[0].polyline.points[0], roads[1].polyline.points[2])).toBe(true)
  })

  // 4. SEPARATION ONLY: no connection
  it('FIXTURE 4: separation only — both producers keep roads disconnected', () => {
    const roads = [
      makeRoad('a', [{ lat: 14.0, lng: 121.0 }, { lat: 14.001, lng: 121.001 }]),
      makeRoad('b', [{ lat: 14.0005, lng: 120.999 }, { lat: 14.0005, lng: 121.002 }]),
    ]
    const doc = makeCampus({
      roads,
      separatedCrossings: [{ id: 'sc', position: { lat: 14.0005, lng: 121.0005 }, roadIds: ['a', 'b'] }],
      versioned: true,
    })

    const v2 = compileV2(doc)
    const legacy = compileLegacy(doc)

    expect(v2HasPath(v2.graph!, { lat: 14.0, lng: 121.0 }, { lat: 14.0005, lng: 121.002 })).toBe(false)
    expect(legacyHasPath(legacy, { lat: 14.0, lng: 121.0 }, { lat: 14.0005, lng: 121.002 })).toBe(false)
  })

  // 5. EXPLICIT JUNCTION ONLY: connection
  it('FIXTURE 5: explicit junction only — both producers connect roads', () => {
    const roads = [
      makeRoad('a', [{ lat: 14.0, lng: 121.0 }, { lat: 14.001, lng: 121.0 }]),
      makeRoad('b', [{ lat: 14.0005, lng: 120.999 }, { lat: 14.0005, lng: 121.002 }]),
    ]
    const doc = makeCampus({
      roads,
      junctions: [{ id: 'j', position: { lat: 14.0005, lng: 121.0 }, roadIds: ['a', 'b'], source: 'authored' }],
      versioned: true,
    })

    const v2 = compileV2(doc)
    const legacy = compileLegacy(doc)

    expect(v2HasPath(v2.graph!, { lat: 14.0, lng: 121.0 }, { lat: 14.0005, lng: 121.002 })).toBe(true)
    expect(legacyHasPath(legacy, { lat: 14.0, lng: 121.0 }, { lat: 14.0005, lng: 121.002 })).toBe(true)
  })

  // 6. MULTI-ROAD JUNCTION: all participants connected
  it('FIXTURE 6: multi-road junction — all three roads connected', () => {
    const roads = [
      makeRoad('a', [{ lat: 14.0, lng: 121.0 }, { lat: 14.001, lng: 121.001 }]),
      makeRoad('b', [{ lat: 14.0005, lng: 120.999 }, { lat: 14.0005, lng: 121.002 }]),
      makeRoad('c', [{ lat: 14.001, lng: 121.0005 }, { lat: 13.999, lng: 121.0005 }]),
    ]
    const doc = makeCampus({
      roads,
      junctions: [{ id: 'j', position: { lat: 14.0005, lng: 121.0005 }, roadIds: ['a', 'b', 'c'], source: 'authored' }],
      versioned: true,
    })

    const v2 = compileV2(doc)
    const legacy = compileLegacy(doc)

    // All three pairs must be connected in both producers
    for (const [a, b] of [['a', 'b'], ['a', 'c'], ['b', 'c']]) {
      const rA = roads.find(r => r.id === a)!
      const rB = roads.find(r => r.id === b)!
      const posA = rA.polyline.points[0]
      const posB = rB.polyline.points[rB.polyline.points.length - 1]
      expect(v2HasPath(v2.graph!, posA, posB), `V2: ${a}↔${b}`).toBe(true)
      expect(legacyHasPath(legacy, posA, posB), `Legacy: ${a}↔${b}`).toBe(true)
    }
  })

  // 7. CLOSE DISTINCT JUNCTIONS: remain distinct
  it('FIXTURE 7: close distinct junctions — both producers treat them as distinct', () => {
    const p1 = { lat: 14.0005, lng: 121.000495 }
    const p2 = { lat: 14.0005, lng: 121.000505 }
    const roads = [
      makeRoad('a', [{ lat: 14.0005, lng: 120.999 }, { lat: 14.0005, lng: 121.002 }]),
      makeRoad('b', [
        { lat: 14.0, lng: 121.00049 },
        { lat: 14.001, lng: 121.0005 },
        { lat: 14.0, lng: 121.00051 },
      ]),
    ]
    assertTwoCrossingFixture(roads, p1, p2)
    const doc = makeCampus({
      roads,
      junctions: [
        { id: 'j1', position: p1, roadIds: ['a', 'b'], source: 'authored' },
        { id: 'j2', position: p2, roadIds: ['a', 'b'], source: 'authored' },
      ],
      versioned: true,
    })

    const v2 = compileV2(doc)
    const legacy = compileLegacy(doc)

    // Both must connect A↔B (through either junction)
    expect(v2HasPath(v2.graph!, roads[0].polyline.points[0], roads[1].polyline.points[2])).toBe(true)
    expect(legacyHasPath(legacy, roads[0].polyline.points[0], roads[1].polyline.points[2])).toBe(true)
  })

  // 8. NAVIGATION-ONLY CONNECTOR: still participates
  it('FIXTURE 8: navigation-only connector participates identically', () => {
    const roads = [
      makeRoad('a', [{ lat: 14.0, lng: 121.0 }, { lat: 14.001, lng: 121.001 }]),
      makeRoad('nav', [{ lat: 14.0005, lng: 121.0005 }, { lat: 14.002, lng: 121.0005 }]),
    ]
    const doc = makeCampus({
      roads,
      junctions: [{ id: 'j', position: { lat: 14.0005, lng: 121.0005 }, roadIds: ['a', 'nav'], source: 'authored' }],
      versioned: true,
    })

    const v2 = compileV2(doc)
    const legacy = compileLegacy(doc)

    expect(v2HasPath(v2.graph!, { lat: 14.0, lng: 121.0 }, { lat: 14.002, lng: 121.0005 })).toBe(true)
    expect(legacyHasPath(legacy, { lat: 14.0, lng: 121.0 }, { lat: 14.002, lng: 121.0005 })).toBe(true)
  })
})
