/**
 * Ghost Junction After Road Delete — Characterization Tests
 *
 * Tests the cascade cleanup when a road is deleted:
 * - RoadJunction cleanup (2-road, 3-road, 4-road)
 * - SeparatedCrossing cleanup
 * - Unrelated junction preservation
 * - Navigation-only road handling
 * - GraphAdapter stale trace validation
 * - Snapshot ghost-node cleanup
 */
import { describe, it, expect } from 'vitest'
import type { CampusDocument } from '@navi/core'
import { Graph } from '@/engine/graph'
import { GraphAdapter } from '../graph-adapter'
import { roadDeleteHandler } from './road-handlers'
import { entityDeleteHandler } from './entity-delete-handler'
import type { TracePath, NavNode } from '@/types/nav-types'

// ── Helpers ──

function createBaseDoc(): CampusDocument {
  return {
    schemaVersion: 1,
    version: 0,
    metadata: {
      campusId: 'test',
      name: 'test',
      description: '',
      lastModified: '',
      editorVersion: '0.1.0',
    },
    buildings: [],
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
  }
}

function addRoad(
  doc: CampusDocument,
  id: string,
  points: Array<{ lat: number; lng: number }>,
  opts?: { displayMode?: 'visible' | 'navigation-only' },
) {
  doc.roads.push({
    id,
    name: id,
    polyline: { points },
    width: 6,
    surface: 'paved',
    type: 'arterial',
    displayMode: opts?.displayMode ?? 'visible',
    metadata: {},
  })
}

function addJunction(
  doc: CampusDocument,
  id: string,
  roadIds: string[],
  position: { lat: number; lng: number },
  source?: 'authored' | 'legacy-inferred',
) {
  if (!doc.roadJunctions) doc.roadJunctions = []
  doc.roadJunctions.push({ id, position, roadIds, source })
}

function addSeparatedCrossing(
  doc: CampusDocument,
  id: string,
  roadIds: [string, string],
  position: { lat: number; lng: number },
) {
  if (!doc.separatedCrossings) doc.separatedCrossings = []
  doc.separatedCrossings.push({ id, roadIds, position })
}

function findJunctionNode(graph: Graph, traceIds: string[]): NavNode | undefined {
  return graph.nodes.find(n =>
    n.metadata?.connectionNode === true &&
    Array.isArray(n.metadata?.traceIds) &&
    traceIds.every(tid => (n.metadata.traceIds as string[]).includes(tid)),
  )
}

const CROSS_POINTS_A = [{ lat: 0, lng: -0.001 }, { lat: 0, lng: 0.001 }]
const CROSS_POINTS_B = [{ lat: -0.001, lng: 0 }, { lat: 0.001, lng: 0 }]
const CROSS_POINTS_C = [{ lat: 0.001, lng: 0.001 }, { lat: -0.001, lng: -0.001 }]
const CROSS_POINTS_D = [{ lat: 0.001, lng: -0.001 }, { lat: -0.001, lng: 0.001 }]

// ── Case 1: Two-road junction — delete one → junction removed ──

describe('Case 1: Two-road junction deletion', () => {
  it('removes junction when one of two participants is deleted', () => {
    const doc = createBaseDoc()
    addRoad(doc, 'road-a', CROSS_POINTS_A)
    addRoad(doc, 'road-b', CROSS_POINTS_B)
    addJunction(doc, 'j-1', ['road-a', 'road-b'], { lat: 0, lng: 0 }, 'authored')

    roadDeleteHandler.execute(doc, { roadId: 'road-a' })

    expect(doc.roads.find(r => r.id === 'road-a')).toBeUndefined()
    expect(doc.roadJunctions).toHaveLength(0)
  })

  it('no ghost junction node after GraphAdapter.sync', () => {
    const doc = createBaseDoc()
    addRoad(doc, 'road-a', CROSS_POINTS_A)
    addRoad(doc, 'road-b', CROSS_POINTS_B)
    addJunction(doc, 'j-1', ['road-a', 'road-b'], { lat: 0, lng: 0 }, 'authored')

    roadDeleteHandler.execute(doc, { roadId: 'road-a' })

    const graph = new Graph()
    new GraphAdapter(graph).sync(doc)

    const ghost = findJunctionNode(graph, ['road-a', 'road-b'])
    expect(ghost).toBeUndefined()

    // road-b should still have its trace
    const roadBTrace = graph.traces.find(t => t.id === 'road-b')
    expect(roadBTrace).toBeDefined()
  })
})

// ── Case 2: Three-road junction — delete one → junction survives ──

describe('Case 2: Three-road junction preservation', () => {
  it('preserves junction with updated roadIds when one of three is deleted', () => {
    const doc = createBaseDoc()
    addRoad(doc, 'road-a', CROSS_POINTS_A)
    addRoad(doc, 'road-b', CROSS_POINTS_B)
    addRoad(doc, 'road-c', CROSS_POINTS_C)
    addJunction(doc, 'j-1', ['road-a', 'road-b', 'road-c'], { lat: 0, lng: 0 }, 'authored')

    roadDeleteHandler.execute(doc, { roadId: 'road-a' })

    expect(doc.roads.find(r => r.id === 'road-a')).toBeUndefined()
    expect(doc.roadJunctions).toHaveLength(1)
    expect(doc.roadJunctions![0].id).toBe('j-1')
    expect(doc.roadJunctions![0].roadIds).toEqual(['road-b', 'road-c'])
  })

  it('B and C remain connected through J after A is deleted', () => {
    const doc = createBaseDoc()
    addRoad(doc, 'road-a', CROSS_POINTS_A)
    addRoad(doc, 'road-b', CROSS_POINTS_B)
    addRoad(doc, 'road-c', CROSS_POINTS_C)
    addJunction(doc, 'j-1', ['road-a', 'road-b', 'road-c'], { lat: 0, lng: 0 }, 'authored')

    roadDeleteHandler.execute(doc, { roadId: 'road-a' })

    const graph = new Graph()
    new GraphAdapter(graph).sync(doc)

    // Junction should exist with road-b and road-c
    const junction = graph.nodes.find(n => n.id === 'j-1')
    expect(junction).toBeDefined()
    expect(junction!.metadata?.traceIds).toEqual(expect.arrayContaining(['road-b', 'road-c']))
    expect((junction!.metadata?.traceIds as string[])).not.toContain('road-a')
  })
})

// ── Case 3: Four-road junction — delete one ──

describe('Case 3: Four-road junction preservation', () => {
  it('preserves junction with remaining participants after deleting one', () => {
    const doc = createBaseDoc()
    addRoad(doc, 'road-a', CROSS_POINTS_A)
    addRoad(doc, 'road-b', CROSS_POINTS_B)
    addRoad(doc, 'road-c', CROSS_POINTS_C)
    addRoad(doc, 'road-d', CROSS_POINTS_D)
    addJunction(doc, 'j-1', ['road-a', 'road-b', 'road-c', 'road-d'], { lat: 0, lng: 0 }, 'authored')

    roadDeleteHandler.execute(doc, { roadId: 'road-a' })

    expect(doc.roadJunctions).toHaveLength(1)
    expect(doc.roadJunctions![0].id).toBe('j-1')
    expect(doc.roadJunctions![0].roadIds).toEqual(['road-b', 'road-c', 'road-d'])
  })
})

// ── Case 4: SeparatedCrossing — delete one road → crossing removed ──

describe('Case 4: SeparatedCrossing cleanup', () => {
  it('removes SeparatedCrossing when one participating road is deleted', () => {
    const doc = createBaseDoc()
    addRoad(doc, 'road-a', CROSS_POINTS_A)
    addRoad(doc, 'road-b', CROSS_POINTS_B)
    addSeparatedCrossing(doc, 'sc-1', ['road-a', 'road-b'], { lat: 0, lng: 0 })

    roadDeleteHandler.execute(doc, { roadId: 'road-a' })

    expect(doc.separatedCrossings).toHaveLength(0)
  })
})

// ── Case 5: Unrelated road delete — other junctions unchanged ──

describe('Case 5: Unrelated road deletion', () => {
  it('does not affect unrelated junctions or crossings', () => {
    const doc = createBaseDoc()
    addRoad(doc, 'road-a', CROSS_POINTS_A)
    addRoad(doc, 'road-b', CROSS_POINTS_B)
    addRoad(doc, 'road-x', [{ lat: 10, lng: 10 }, { lat: 10.001, lng: 10.001 }])
    addJunction(doc, 'j-1', ['road-a', 'road-b'], { lat: 0, lng: 0 }, 'authored')
    addSeparatedCrossing(doc, 'sc-1', ['road-a', 'road-b'], { lat: 0, lng: 0 })

    roadDeleteHandler.execute(doc, { roadId: 'road-x' })

    expect(doc.roadJunctions).toHaveLength(1)
    expect(doc.roadJunctions![0].id).toBe('j-1')
    expect(doc.separatedCrossings).toHaveLength(1)
    expect(doc.separatedCrossings![0].id).toBe('sc-1')
  })
})

// ── Case 8: Navigation-only road ──

describe('Case 8: Navigation-only road deletion', () => {
  it('applies same cleanup rules when deleting a navigation-only participant', () => {
    const doc = createBaseDoc()
    addRoad(doc, 'road-a', CROSS_POINTS_A)
    addRoad(doc, 'road-nav', CROSS_POINTS_B, { displayMode: 'navigation-only' })
    addJunction(doc, 'j-1', ['road-a', 'road-nav'], { lat: 0, lng: 0 }, 'authored')

    roadDeleteHandler.execute(doc, { roadId: 'road-nav' })

    expect(doc.roads.find(r => r.id === 'road-nav')).toBeUndefined()
    expect(doc.roadJunctions).toHaveLength(0)
  })
})

// ── Case 9: Save / reload — ghost does not return ──

describe('Case 9: Save/reload cycle', () => {
  it('ghost junction does not return after GraphAdapter re-sync', () => {
    const doc = createBaseDoc()
    addRoad(doc, 'road-a', CROSS_POINTS_A)
    addRoad(doc, 'road-b', CROSS_POINTS_B)
    addJunction(doc, 'j-1', ['road-a', 'road-b'], { lat: 0, lng: 0 }, 'authored')

    // Delete road
    roadDeleteHandler.execute(doc, { roadId: 'road-a' })

    // First sync
    const graph1 = new Graph()
    new GraphAdapter(graph1).sync(doc)

    // Serialize and deserialize (simulating save/reload)
    const snapshot = graph1.toJSON()
    const graph2 = Graph.fromJSON(snapshot)

    // Re-sync from the same document (simulating Studio reload)
    const graph3 = new Graph()
    new GraphAdapter(graph3).sync(doc)

    // Ghost junction should not appear in any graph
    expect(findJunctionNode(graph1, ['road-a', 'road-b'])).toBeUndefined()
    expect(findJunctionNode(graph3, ['road-a', 'road-b'])).toBeUndefined()
  })
})

// ── Case 10: Snapshot — no ghost nodes ──

describe('Case 10: Snapshot ghost-node cleanup', () => {
  it('serialized snapshot does not contain deleted road trace or invalid junction', () => {
    const doc = createBaseDoc()
    addRoad(doc, 'road-a', CROSS_POINTS_A)
    addRoad(doc, 'road-b', CROSS_POINTS_B)
    addJunction(doc, 'j-1', ['road-a', 'road-b'], { lat: 0, lng: 0 }, 'authored')

    roadDeleteHandler.execute(doc, { roadId: 'road-a' })

    const graph = new Graph()
    new GraphAdapter(graph).sync(doc)
    const snapshot = graph.toJSON()

    // No trace for deleted road
    const traces = (snapshot as any).traces ?? []
    expect(traces.find((t: any) => t.id === 'road-a')).toBeUndefined()

    // No junction node for deleted combination
    const nodes = snapshot.nodes as NavNode[]
    const ghostNode = nodes.find(n =>
      n.metadata?.connectionNode === true &&
      (n.metadata?.traceIds as string[])?.includes('road-a'),
    )
    expect(ghostNode).toBeUndefined()
  })
})

// ── Case 11: entityDeleteHandler — same cleanup ──

describe('Case 11: entityDeleteHandler cascade', () => {
  it('entity.delete cleans up junctions for deleted roads', () => {
    const doc = createBaseDoc()
    addRoad(doc, 'road-a', CROSS_POINTS_A)
    addRoad(doc, 'road-b', CROSS_POINTS_B)
    addJunction(doc, 'j-1', ['road-a', 'road-b'], { lat: 0, lng: 0 }, 'authored')

    const result = entityDeleteHandler.execute(doc, { entityId: 'road-a' })
    expect(result.success).toBe(true)
    expect(doc.roads.find(r => r.id === 'road-a')).toBeUndefined()
    expect(doc.roadJunctions).toHaveLength(0)
  })

  it('entity.delete cleans up separated crossings for deleted roads', () => {
    const doc = createBaseDoc()
    addRoad(doc, 'road-a', CROSS_POINTS_A)
    addRoad(doc, 'road-b', CROSS_POINTS_B)
    addSeparatedCrossing(doc, 'sc-1', ['road-a', 'road-b'], { lat: 0, lng: 0 })

    entityDeleteHandler.execute(doc, { entityId: 'road-a' })
    expect(doc.separatedCrossings).toHaveLength(0)
  })
})

// ── Case 12: Existing connectivity tests still pass ──

describe('Case 12: Existing junction semantics preserved', () => {
  it('three-road junction still works after fix', () => {
    const graph = new Graph()
    graph.addTraceWithCompile({
      id: 'road-a', campusId: 'test', floor: 0, type: 'arterial',
      points: CROSS_POINTS_A,
    }, 2)
    graph.addTraceWithCompile({
      id: 'road-b', campusId: 'test', floor: 0, type: 'arterial',
      points: CROSS_POINTS_B,
    }, 2)
    graph.addTraceWithCompile({
      id: 'road-c', campusId: 'test', floor: 0, type: 'arterial',
      points: CROSS_POINTS_C,
    }, 2)

    // All three traces should exist
    expect(graph.traces.find(t => t.id === 'road-a')).toBeDefined()
    expect(graph.traces.find(t => t.id === 'road-b')).toBeDefined()
    expect(graph.traces.find(t => t.id === 'road-c')).toBeDefined()

    // Connection nodes should exist for these roads
    const connectionNodes = graph.nodes.filter(n => n.metadata?.connectionNode === true)
    expect(connectionNodes.length).toBeGreaterThanOrEqual(1)
  })

  it('pre-seeded junction with stale traceIds is cleaned by GraphAdapter', () => {
    const doc = createBaseDoc()
    addRoad(doc, 'road-a', CROSS_POINTS_A)
    // Pre-seed a junction that references a non-existent road
    addJunction(doc, 'j-1', ['road-a', 'deleted-road'], { lat: 0, lng: 0 }, 'legacy-inferred')

    const graph = new Graph()
    new GraphAdapter(graph).sync(doc)

    // The junction should be removed because 'deleted-road' has no trace
    const junction = graph.nodes.find(n => n.id === 'j-1')
    expect(junction).toBeUndefined()
  })

  it('pre-seeded junction with 2 valid survivors is cleaned and preserved', () => {
    const doc = createBaseDoc()
    addRoad(doc, 'road-a', CROSS_POINTS_A)
    addRoad(doc, 'road-b', CROSS_POINTS_B)
    // Pre-seed junction with a stale traceId plus two valid ones
    addJunction(doc, 'j-1', ['deleted-road', 'road-a', 'road-b'], { lat: 0, lng: 0 }, 'legacy-inferred')

    const graph = new Graph()
    new GraphAdapter(graph).sync(doc)

    // Junction should survive with only valid traceIds
    const junction = graph.nodes.find(n => n.id === 'j-1')
    expect(junction).toBeDefined()
    expect(junction!.metadata?.traceIds).toEqual(expect.arrayContaining(['road-a', 'road-b']))
    expect((junction!.metadata?.traceIds as string[])).not.toContain('deleted-road')
  })
})
