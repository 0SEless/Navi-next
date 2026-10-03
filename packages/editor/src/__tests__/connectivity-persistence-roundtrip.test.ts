import { describe, expect, it } from 'vitest'
import type { CampusDocument, Road, RoadJunction, SeparatedCrossing } from '@navi/core'
import { Graph } from '../../../../src/engine/graph'
import { aStar } from '../../../../src/engine/a-star'
import { GraphAdapter } from '../graph-adapter'
import { createDocument } from '../context/create-editor-context'

// ── Shared fixtures ──

const ROAD_A: Road = {
  id: 'road-a',
  name: 'Road A',
  polyline: {
    points: [
      { lat: 0, lng: -0.001 },
      { lat: 0, lng: 0.001 },
    ],
  },
  width: 8,
  surface: 'paved',
  type: 'arterial',
  metadata: {},
}

const ROAD_B: Road = {
  id: 'road-b',
  name: 'Road B',
  polyline: {
    points: [
      { lat: 0, lng: 0 },
      { lat: 0.001, lng: 0 },
    ],
  },
  width: 8,
  surface: 'paved',
  type: 'arterial',
  metadata: {},
}

function makeRoad(id: string, points: Array<{ lat: number; lng: number }>): Road {
  return {
    id,
    name: id,
    polyline: { points },
    width: 8,
    surface: 'paved',
    type: 'arterial',
    metadata: {},
  }
}

function makeJunction(
  id: string,
  position: { lat: number; lng: number },
  roadIds: string[],
  source?: 'authored' | 'legacy-inferred',
): RoadJunction {
  return { id, position, roadIds, source }
}

function makeDocument(
  roads: Road[] = [ROAD_A, ROAD_B],
  roadJunctions: RoadJunction[] = [],
  separatedCrossings?: SeparatedCrossing[],
): CampusDocument {
  return {
    schemaVersion: 1,
    version: 0,
    metadata: {
      campusId: 'test-campus',
      name: 'Test Campus',
      description: '',
      lastModified: '',
      editorVersion: 'test',
    },
    buildings: [],
    roads,
    panoramas: [],
    qrCheckpoints: [],
    roadJunctions: roadJunctions.map(junction => ({ ...junction, roadIds: [...junction.roadIds] })),
    separatedCrossings,
  }
}

function syncDocument(document: CampusDocument): Graph {
  const graph = new Graph('test-campus')
  new GraphAdapter(graph).sync(document)
  return graph
}

function syncThroughReload(document: CampusDocument): { graph: Graph; reloadedDocument: CampusDocument } {
  const graph = syncDocument(document)

  const serialized = JSON.parse(JSON.stringify(graph.toJSON()))
  const restoredGraph = Graph.fromJSON(serialized)
  const reloadedDocument = createDocument(restoredGraph)

  const reloadedGraph = new Graph('test-campus')
  new GraphAdapter(reloadedGraph).sync(reloadedDocument)
  return { graph: reloadedGraph, reloadedDocument }
}

function nodesForTrace(graph: Graph, traceId: string) {
  return graph.nodes.filter(node =>
    node.metadata?.traceId === traceId ||
    (Array.isArray(node.metadata?.traceIds) && (node.metadata.traceIds as string[]).includes(traceId))
  )
}

function hasUndirectedEdge(graph: Graph, nodeA: string, nodeB: string): boolean {
  return graph.edges.some(edge =>
    (edge.from === nodeA && edge.to === nodeB) ||
    (edge.from === nodeB && edge.to === nodeA)
  )
}

function degree(graph: Graph, nodeId: string): number {
  return graph.edges.filter(edge => edge.from === nodeId || edge.to === nodeId).length
}

// ── Suite 1: RoadJunction round-trip ──

describe('connectivity persistence round-trip', () => {
  describe('RoadJunction round-trip', () => {
    it('preserves source: authored through full round-trip', () => {
      // PROVES: createDocument() hardcodes source: legacy-inferred (line 646),
      // destroying the authored source marker. An authored junction should
      // survive with source: authored, not become legacy-inferred.
      const document = makeDocument(
        [ROAD_A, ROAD_B],
        [makeJunction('j-auth', { lat: 0, lng: 0 }, ['road-a', 'road-b'], 'authored')],
      )
      const { reloadedDocument } = syncThroughReload(document)

      const junction = reloadedDocument.roadJunctions?.find(j => j.id === 'j-auth')
      expect(junction).toBeDefined()
      expect(junction!.source).toBe('authored')
    })

    it('preserves junction ID through round-trip', () => {
      // PROVES: junction ID stability — the ID assigned during authoring
      // must survive the serialize→deserialize→reconstruct cycle.
      const document = makeDocument(
        [ROAD_A, ROAD_B],
        [makeJunction('j-stable', { lat: 0, lng: 0 }, ['road-a', 'road-b'], 'authored')],
      )
      const { reloadedDocument } = syncThroughReload(document)

      expect(reloadedDocument.roadJunctions?.map(j => j.id)).toContain('j-stable')
    })

    it('preserves junction position through round-trip', () => {
      // PROVES: position fidelity — the exact lat/lng of the junction must
      // not drift through serialization precision or reconstruction.
      const position = { lat: 12.345678, lng: 98.765432 }
      const document = makeDocument(
        [ROAD_A, ROAD_B],
        [makeJunction('j-pos', position, ['road-a', 'road-b'], 'authored')],
      )
      const { reloadedDocument } = syncThroughReload(document)

      const junction = reloadedDocument.roadJunctions?.find(j => j.id === 'j-pos')
      expect(junction).toBeDefined()
      expect(junction!.position.lat).toBe(position.lat)
      expect(junction!.position.lng).toBe(position.lng)
    })

    it('preserves junction roadIds through round-trip', () => {
      // PROVES: roadIds array integrity — the list of participating roads
      // must survive reconstruction without reorder or loss.
      const document = makeDocument(
        [ROAD_A, ROAD_B],
        [makeJunction('j-roads', { lat: 0, lng: 0 }, ['road-a', 'road-b'], 'authored')],
      )
      const { reloadedDocument } = syncThroughReload(document)

      const junction = reloadedDocument.roadJunctions?.find(j => j.id === 'j-roads')
      expect(junction).toBeDefined()
      expect(junction!.roadIds).toEqual(['road-a', 'road-b'])
    })

    it('preserves multiple junctions through round-trip', () => {
      // PROVES: multi-junction fidelity — multiple authored junctions on
      // different roads must all survive without ID collision or merge.
      // Additional auto-detected junctions from geometric crossings are expected.
      const roadC = makeRoad('road-c', [
        { lat: 0, lng: 0.001 },
        { lat: 0, lng: 0.003 },
      ])
      const junctions = [
        makeJunction('j-1', { lat: 0, lng: 0 }, ['road-a', 'road-b'], 'authored'),
        makeJunction('j-2', { lat: 0, lng: 0.002 }, ['road-a', 'road-c'], 'authored'),
      ]
      const document = makeDocument([ROAD_A, ROAD_B, roadC], junctions)
      const { reloadedDocument } = syncThroughReload(document)

      // Both authored junctions must survive (by ID)
      const ids = reloadedDocument.roadJunctions?.map(j => j.id) ?? []
      expect(ids).toContain('j-1')
      expect(ids).toContain('j-2')
      // Authored junctions should have source: authored
      expect(reloadedDocument.roadJunctions?.find(j => j.id === 'j-1')?.source).toBe('authored')
      expect(reloadedDocument.roadJunctions?.find(j => j.id === 'j-2')?.source).toBe('authored')
    })

    it('does NOT merge close distinct junction IDs', () => {
      // PROVES: junction identity stability — two junctions at nearby but
      // distinct positions must remain separate records, not collapse.
      // Additional auto-detected junctions from geometric crossings are expected.
      const roadC = makeRoad('road-c', [
        { lat: 0, lng: 0.001 },
        { lat: 0, lng: 0.003 },
      ])
      const junctions = [
        makeJunction('j-near-1', { lat: 0, lng: 0.0005 }, ['road-a', 'road-b'], 'authored'),
        makeJunction('j-near-2', { lat: 0, lng: 0.0015 }, ['road-a', 'road-c'], 'authored'),
      ]
      const document = makeDocument([ROAD_A, ROAD_B, roadC], junctions)
      const { reloadedDocument } = syncThroughReload(document)

      // Both authored junctions must survive (by ID) — not merged
      const ids = reloadedDocument.roadJunctions?.map(j => j.id) ?? []
      expect(ids).toContain('j-near-1')
      expect(ids).toContain('j-near-2')
      // They should be distinct records
      const j1 = reloadedDocument.roadJunctions?.find(j => j.id === 'j-near-1')
      const j2 = reloadedDocument.roadJunctions?.find(j => j.id === 'j-near-2')
      expect(j1).toBeDefined()
      expect(j2).toBeDefined()
      expect(j1!.id).not.toBe(j2!.id)
    })
  })

  // ── Suite 2: SeparatedCrossing round-trip ──

  describe('SeparatedCrossing round-trip', () => {
    it('preserves separatedCrossings through full round-trip', () => {
      // PROVES: createDocument() does NOT reconstruct separatedCrossings
      // from the graph snapshot. The field is missing from the return object,
      // so separatedCrossings are silently dropped after one round-trip.
      const horizontal = makeRoad('horizontal', [
        { lat: 0, lng: -0.002 },
        { lat: 0, lng: 0.002 },
      ])
      const vertical = makeRoad('vertical', [
        { lat: -0.002, lng: 0 },
        { lat: 0.002, lng: 0 },
      ])
      const document = makeDocument([horizontal, vertical], [], [{
        id: 'sc-1',
        roadIds: ['horizontal', 'vertical'],
        position: { lat: 0, lng: 0 },
      }])
      const { reloadedDocument } = syncThroughReload(document)

      expect(reloadedDocument.separatedCrossings).toBeDefined()
      expect(reloadedDocument.separatedCrossings).toHaveLength(1)
      expect(reloadedDocument.separatedCrossings![0].id).toBe('sc-1')
    })

    it('preserves separatedCrossing ID through round-trip', () => {
      // PROVES: ID stability for separated crossings.
      const horizontal = makeRoad('horizontal', [
        { lat: 0, lng: -0.002 },
        { lat: 0, lng: 0.002 },
      ])
      const vertical = makeRoad('vertical', [
        { lat: -0.002, lng: 0 },
        { lat: 0.002, lng: 0 },
      ])
      const document = makeDocument([horizontal, vertical], [], [{
        id: 'sc-id-stable',
        roadIds: ['horizontal', 'vertical'],
        position: { lat: 0, lng: 0 },
      }])
      const { reloadedDocument } = syncThroughReload(document)

      expect(reloadedDocument.separatedCrossings?.map(sc => sc.id)).toContain('sc-id-stable')
    })

    it('preserves separatedCrossing road pair through round-trip', () => {
      // PROVES: roadIds tuple integrity — the pair of roads must survive
      // reconstruction without reorder or field loss.
      const horizontal = makeRoad('horizontal', [
        { lat: 0, lng: -0.002 },
        { lat: 0, lng: 0.002 },
      ])
      const vertical = makeRoad('vertical', [
        { lat: -0.002, lng: 0 },
        { lat: 0.002, lng: 0 },
      ])
      const document = makeDocument([horizontal, vertical], [], [{
        id: 'sc-roads',
        roadIds: ['horizontal', 'vertical'],
        position: { lat: 0, lng: 0 },
      }])
      const { reloadedDocument } = syncThroughReload(document)

      const sc = reloadedDocument.separatedCrossings?.find(s => s.id === 'sc-roads')
      expect(sc).toBeDefined()
      expect(sc!.roadIds).toEqual(['horizontal', 'vertical'])
    })

    it('preserves separatedCrossing position through round-trip', () => {
      // PROVES: position fidelity for separated crossings.
      const horizontal = makeRoad('horizontal', [
        { lat: 0, lng: -0.002 },
        { lat: 0, lng: 0.002 },
      ])
      const vertical = makeRoad('vertical', [
        { lat: -0.002, lng: 0 },
        { lat: 0.002, lng: 0 },
      ])
      const pos = { lat: 42.123456, lng: -73.654321 }
      const document = makeDocument([horizontal, vertical], [], [{
        id: 'sc-pos',
        roadIds: ['horizontal', 'vertical'],
        position: pos,
      }])
      const { reloadedDocument } = syncThroughReload(document)

      const sc = reloadedDocument.separatedCrossings?.find(s => s.id === 'sc-pos')
      expect(sc).toBeDefined()
      expect(sc!.position.lat).toBe(pos.lat)
      expect(sc!.position.lng).toBe(pos.lng)
    })

    it('Keep Separate still prevents A* traversal after round-trip', () => {
      // PROVES: the semantic meaning of Keep Separate survives — roads that
      // cross but are marked separated must remain disconnected in the graph.
      // After round-trip, separatedCrossings are lost, so the graph reconnects
      // them at the crossing point, breaking the Keep Separate invariant.
      const horizontal = makeRoad('horizontal', [
        { lat: 0, lng: -0.002 },
        { lat: 0, lng: 0.002 },
      ])
      const vertical = makeRoad('vertical', [
        { lat: -0.002, lng: 0 },
        { lat: 0.002, lng: 0 },
      ])
      const document = makeDocument([horizontal, vertical], [], [{
        id: 'sc-keep',
        roadIds: ['horizontal', 'vertical'],
        position: { lat: 0, lng: 0 },
      }])
      const { graph } = syncThroughReload(document)

      // After round-trip, the two roads should still be disconnected
      // because Keep Separate was persisted.
      const hStart = nodesForTrace(graph, 'horizontal').find(n => n.position.lng < -0.001)
      const vEnd = nodesForTrace(graph, 'vertical').find(n => n.position.lat > 0.001)

      expect(hStart).toBeDefined()
      expect(vEnd).toBeDefined()

      // The two road components should NOT be connected
      const connectedComponentCount = graph.connectedComponentCount
      expect(connectedComponentCount).toBe(2)

      // A* should find no path between the crossing roads
      expect(aStar(graph.nodes, graph.edges, hStart!.id, vEnd!.id)).toBeNull()
    })

    it('preserves multiple separatedCrossings through round-trip', () => {
      // PROVES: multi-crossing fidelity — multiple Keep Separate decisions
      // must all survive without collision or loss.
      const horizontal = makeRoad('horizontal', [
        { lat: 0, lng: -0.003 },
        { lat: 0, lng: 0.003 },
      ])
      const vertical1 = makeRoad('vertical1', [
        { lat: -0.002, lng: -0.001 },
        { lat: 0.002, lng: -0.001 },
      ])
      const vertical2 = makeRoad('vertical2', [
        { lat: -0.002, lng: 0.001 },
        { lat: 0.002, lng: 0.001 },
      ])
      const crossings: SeparatedCrossing[] = [
        { id: 'sc-a', roadIds: ['horizontal', 'vertical1'], position: { lat: 0, lng: -0.001 } },
        { id: 'sc-b', roadIds: ['horizontal', 'vertical2'], position: { lat: 0, lng: 0.001 } },
      ]
      const document = makeDocument([horizontal, vertical1, vertical2], [], crossings)
      const { reloadedDocument } = syncThroughReload(document)

      expect(reloadedDocument.separatedCrossings).toHaveLength(2)
      expect(reloadedDocument.separatedCrossings?.map(sc => sc.id)).toEqual(
        expect.arrayContaining(['sc-a', 'sc-b']),
      )
    })
  })

  // ── Suite 3: Navigation-only compatibility ──

  describe('Navigation-only compatibility', () => {
    it('navigation-only road participant in a junction survives round-trip', () => {
      // PROVES: roads with displayMode: navigation-only can participate in
      // junctions and the junction survives reconstruction.
      const navRoad: Road = {
        id: 'road-nav',
        name: 'Nav Road',
        polyline: {
          points: [
            { lat: 0, lng: 0 },
            { lat: 0.001, lng: 0 },
          ],
        },
        width: 8,
        surface: 'paved',
        type: 'arterial',
        displayMode: 'navigation-only',
        metadata: {},
      }
      const visibleRoad: Road = {
        id: 'road-vis',
        name: 'Visible Road',
        polyline: {
          points: [
            { lat: 0, lng: -0.001 },
            { lat: 0, lng: 0.001 },
          ],
        },
        width: 8,
        surface: 'paved',
        type: 'arterial',
        metadata: {},
      }
      const document = makeDocument(
        [navRoad, visibleRoad],
        [makeJunction('j-nav', { lat: 0, lng: 0 }, ['road-nav', 'road-vis'], 'authored')],
      )
      const { reloadedDocument } = syncThroughReload(document)

      const junction = reloadedDocument.roadJunctions?.find(j => j.id === 'j-nav')
      expect(junction).toBeDefined()
      expect(junction!.roadIds).toEqual(expect.arrayContaining(['road-nav', 'road-vis']))
    })
  })

  // ── Suite 4: Repeated save/reload ──

  describe('Repeated save/reload', () => {
    it('double round-trip produces identical results', () => {
      // PROVES: idempotency — if a single round-trip introduces drift,
      // a second round-trip should not compound the corruption. If the
      // first round-trip drops source, the second should at least not
      // make things worse (though both fail the source check).
      const document = makeDocument(
        [ROAD_A, ROAD_B],
        [makeJunction('j-repeat', { lat: 0, lng: 0 }, ['road-a', 'road-b'], 'authored')],
      )

      const first = syncThroughReload(document)
      const second = syncThroughReload(first.reloadedDocument)

      // Junction ID should be stable across both round-trips
      expect(first.reloadedDocument.roadJunctions?.map(j => j.id)).toContain('j-repeat')
      expect(second.reloadedDocument.roadJunctions?.map(j => j.id)).toContain('j-repeat')

      // Junction roadIds should be identical after both round-trips
      const firstJunction = first.reloadedDocument.roadJunctions?.find(j => j.id === 'j-repeat')
      const secondJunction = second.reloadedDocument.roadJunctions?.find(j => j.id === 'j-repeat')
      expect(firstJunction).toBeDefined()
      expect(secondJunction).toBeDefined()
      expect(secondJunction!.roadIds).toEqual(firstJunction!.roadIds)

      // Position should be identical after both round-trips
      expect(secondJunction!.position).toEqual(firstJunction!.position)
    })
  })

  // ── Suite 5: Legacy snapshot compatibility ──

  describe('Legacy snapshot compatibility', () => {
    it('GraphSnapshot without roadJunctions/separatedCrossings loads correctly', () => {
      // PROVES: backward compatibility — a legacy snapshot that lacks
      // roadJunctions and separatedCrossings fields must still load without
      // crashing, and the resulting document should have no junctions or
      // crossings (not undefined-related errors).
      const legacySnapshot = {
        id: 'legacy',
        version: '1.0.0',
        campusId: 'test-campus',
        updatedAt: new Date().toISOString(),
        buildings: [],
        nodes: [],
        edges: [],
        components: [],
        traces: [],
        areas: [],
      } as any

      const graph = Graph.fromJSON(legacySnapshot)
      const document = createDocument(graph)

      // Should not crash, and document should have empty/undefined arrays
      expect(document.roadJunctions).toBeUndefined()
      expect(document.separatedCrossings).toBeUndefined()
      expect(document.roads).toEqual([])
    })

    it('GraphSnapshot with only separatedCrossings (no junctions) loads correctly', () => {
      // PROVES: partial data — a snapshot with separatedCrossings but no
      // roadJunctions should load without errors.
      const snapshot = {
        id: 'partial',
        version: '1.0.0',
        campusId: 'test-campus',
        updatedAt: new Date().toISOString(),
        buildings: [],
        nodes: [],
        edges: [],
        components: [],
        traces: [],
        areas: [],
        separatedCrossings: [{
          id: 'sc-old',
          roadIds: ['road-a', 'road-b'],
          position: { lat: 0, lng: 0 },
        }],
      } as any

      const graph = Graph.fromJSON(snapshot)
      const document = createDocument(graph)

      expect(document.roadJunctions).toBeUndefined()
      // separatedCrossings on the graph should survive fromJSON
      expect(graph.separatedCrossings).toHaveLength(1)
      expect(graph.separatedCrossings[0].id).toBe('sc-old')
    })
  })
})
