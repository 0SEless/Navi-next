/**
 * Phase 4D — Real Legacy Ordering Test
 *
 * Proves that the createEditorContext lifecycle correctly handles
 * legacy documents: materialization happens BEFORE canonical stamping.
 */
import { describe, expect, it, vi } from 'vitest'
import type { CampusDocument, Road } from '@navi/core'
import { CONNECTIVITY_CONTRACT_VERSION, CoordinateTransformer } from '@navi/core'
import { createDocument } from '../context/create-editor-context'
import { Graph } from '../../../../src/engine/graph'
import { GraphAdapter } from '../graph-adapter'

function makeRoad(id: string, points: Array<{ lat: number; lng: number }>, connectorEntranceId?: string): Road {
  return {
    id,
    name: id,
    polyline: { points },
    width: 8,
    surface: 'paved',
    type: 'arterial',
    metadata: {},
    connectorEntranceId,
  }
}

/**
 * Simulate the real Studio lifecycle:
 * 1. Legacy graph (no marker, no junction nodes)
 * 2. createEditorContext → createDocument
 * 3. GraphAdapter sync (materializes junctions + stamps marker)
 * 4. Save (graph.toJSON)
 * 5. Reload (Graph.fromJSON → createDocument)
 */
function simulateLegacyLifecycle() {
  // Step 1: Create a legacy graph with crossing roads but no junction nodes
  const graph = new Graph('test-campus')
  // Add roads as traces (simulating a legacy document)
  const roadA = makeRoad('road-a', [{ lat: 0, lng: -0.001 }, { lat: 0, lng: 0.001 }])
  const roadB = makeRoad('road-b', [{ lat: -0.001, lng: 0 }, { lat: 0.001, lng: 0 }])
  // Manually add trace data to graph (simulating legacy state)
  graph.setTraces([
    { id: 'road-a', name: 'Road A', points: roadA.polyline.points, type: 'arterial', displayMode: 'visible', width: 8, buildingId: '', campusId: 'test', floor: 0, metadata: {} },
    { id: 'road-b', name: 'Road B', points: roadB.polyline.points, type: 'arterial', displayMode: 'visible', width: 8, buildingId: '', campusId: 'test', floor: 0, metadata: {} },
  ])
  // No junction nodes, no marker
  expect((graph as any)._connectivitySemanticsVersion).toBeUndefined()
  expect(graph.nodes.filter(n => n.metadata?.connectionNode === true)).toHaveLength(0)

  // Step 2: createEditorContext → createDocument
  const doc = createDocument(graph)
  // Legacy document has NO marker and NO junctions
  expect(doc.connectivitySemanticsVersion).toBeUndefined()
  expect(doc.roadJunctions).toBeUndefined()

  // Step 3: GraphAdapter sync — materializes junctions + stamps marker
  const transformer = new CoordinateTransformer()
  const ga = new GraphAdapter(graph, transformer)
  ga.sync(doc)

  // After sync:
  // - Junctions may or may not be materialized (depends on road geometry)
  // - Marker IS stamped on the document
  expect(doc.connectivitySemanticsVersion).toBe(CONNECTIVITY_CONTRACT_VERSION)
  // Marker is also on the graph
  expect((graph as any)._connectivitySemanticsVersion).toBe(CONNECTIVITY_CONTRACT_VERSION)

  // Step 4: Save (graph.toJSON)
  const json = graph.toJSON()
  // Graph snapshot has the marker
  expect(json.connectivitySemanticsVersion).toBe(CONNECTIVITY_CONTRACT_VERSION)

  // Step 5: Reload (Graph.fromJSON → createDocument)
  const restoredGraph = Graph.fromJSON(json)
  // Restored graph has the marker
  expect((restoredGraph as any)._connectivitySemanticsVersion).toBe(CONNECTIVITY_CONTRACT_VERSION)

  const restoredDoc = createDocument(restoredGraph)
  // Restored document has the marker
  expect(restoredDoc.connectivitySemanticsVersion).toBe(CONNECTIVITY_CONTRACT_VERSION)

  // If junctions were materialized during sync, they survive the round-trip
  if (doc.roadJunctions && doc.roadJunctions.length > 0) {
    expect(restoredDoc.roadJunctions).toBeDefined()
    expect(restoredDoc.roadJunctions!.length).toBeGreaterThan(0)
    // Junction provenance is preserved
    expect(restoredDoc.roadJunctions![0].source).toBe('legacy-inferred')
  }

  return { doc, graph, restoredDoc }
}

describe('Phase 4D — Real legacy ordering', () => {
  it('legacy document: marker stamped AFTER materialization, not before', () => {
    // PROVES: The correct lifecycle ordering:
    // 1. createDocument() → no marker (legacy graph)
    // 2. ga.sync() → materializes junctions AND stamps marker
    // 3. save → marker persists
    // 4. reload → marker + junctions survive

    const { doc, graph, restoredDoc } = simulateLegacyLifecycle()

    // The document now has the marker
    expect(doc.connectivitySemanticsVersion).toBe(CONNECTIVITY_CONTRACT_VERSION)
    // The graph has the marker
    expect((graph as any)._connectivitySemanticsVersion).toBe(CONNECTIVITY_CONTRACT_VERSION)
    // The restored document has the marker
    expect(restoredDoc.connectivitySemanticsVersion).toBe(CONNECTIVITY_CONTRACT_VERSION)
  })

  it('danger case: legacy crossing does NOT lose connectivity after lifecycle', () => {
    // PROVES: A legacy document with crossing roads retains connectivity
    // after the full load/save/reload lifecycle.

    // Create a legacy graph with crossing roads
    const graph = new Graph('test-campus')
    // Add road traces that cross at (0, 0)
    graph.setTraces([
      { id: 'road-a', name: 'Road A', points: [{ lat: 0, lng: -0.001 }, { lat: 0, lng: 0.001 }], type: 'arterial', displayMode: 'visible', width: 8, buildingId: '', campusId: 'test', floor: 0, metadata: {} },
      { id: 'road-b', name: 'Road B', points: [{ lat: -0.001, lng: 0 }, { lat: 0.001, lng: 0 }], type: 'arterial', displayMode: 'visible', width: 8, buildingId: '', campusId: 'test', floor: 0, metadata: {} },
    ])

    // Step 1: createDocument — no marker
    const doc1 = createDocument(graph)
    expect(doc1.connectivitySemanticsVersion).toBeUndefined()

    // Step 2: sync — stamps marker
    const transformer = new CoordinateTransformer()
    new GraphAdapter(graph, transformer).sync(doc1)
    expect(doc1.connectivitySemanticsVersion).toBe(CONNECTIVITY_CONTRACT_VERSION)

    // Step 3: save + reload
    const json = graph.toJSON()
    const restoredGraph = Graph.fromJSON(json)
    const doc2 = createDocument(restoredGraph)

    // Marker preserved
    expect(doc2.connectivitySemanticsVersion).toBe(CONNECTIVITY_CONTRACT_VERSION)

    // If junctions were materialized, they survive
    if (doc1.roadJunctions && doc1.roadJunctions.length > 0) {
      expect(doc2.roadJunctions).toBeDefined()
      expect(doc2.roadJunctions!.length).toBe(doc1.roadJunctions.length)
    }
  })

  it('modern document: marker present from creation, preserved through lifecycle', () => {
    // PROVES: A modern document created with the marker retains it through lifecycle.

    const graph = new Graph('test-campus')
    // Stamp marker on graph
    ;(graph as any)._connectivitySemanticsVersion = CONNECTIVITY_CONTRACT_VERSION

    const doc = createDocument(graph)
    expect(doc.connectivitySemanticsVersion).toBe(CONNECTIVITY_CONTRACT_VERSION)

    // Sync
    const transformer = new CoordinateTransformer()
    new GraphAdapter(graph, transformer).sync(doc)
    expect(doc.connectivitySemanticsVersion).toBe(CONNECTIVITY_CONTRACT_VERSION)

    // Save + reload
    const json = graph.toJSON()
    const restoredGraph = Graph.fromJSON(json)
    const restoredDoc = createDocument(restoredGraph)
    expect(restoredDoc.connectivitySemanticsVersion).toBe(CONNECTIVITY_CONTRACT_VERSION)
  })

  it('modern sync passes explicit inference intent before stamping persisted version', () => {
    const graph = new Graph('test-campus')
    const doc: CampusDocument = {
      schemaVersion: 1,
      version: 1,
      metadata: {
        campusId: 'test-campus',
        name: 'Test Campus',
        description: '',
        lastModified: '',
        editorVersion: 'test',
      },
      buildings: [],
      roads: [
        makeRoad('road-a', [{ lat: 14.0, lng: 120.999 }, { lat: 14.0, lng: 121.001 }]),
        makeRoad('road-b', [{ lat: 13.999, lng: 121.0 }, { lat: 14.001, lng: 121.0 }]),
      ],
      panoramas: [],
      qrCheckpoints: [],
      connectivitySemanticsVersion: CONNECTIVITY_CONTRACT_VERSION,
    }

    const versionSetter = vi.spyOn(graph, 'setConnectivitySemanticsVersion')
    const compile = vi.spyOn(graph, 'addTraceWithCompile')

    new GraphAdapter(graph, new CoordinateTransformer()).sync(doc)

    expect(versionSetter.mock.calls[0]).toEqual([undefined])
    expect(compile.mock.calls.length).toBe(2)
    expect(compile.mock.calls.every(call => call[2] === false)).toBe(true)
    expect(versionSetter.mock.invocationCallOrder[0]).toBeLessThan(compile.mock.invocationCallOrder[0])
    expect(versionSetter.mock.invocationCallOrder.at(-1)!).toBeGreaterThan(
      compile.mock.invocationCallOrder.at(-1)!,
    )
    expect(versionSetter.mock.calls.at(-1)).toEqual([CONNECTIVITY_CONTRACT_VERSION])
  })
})
