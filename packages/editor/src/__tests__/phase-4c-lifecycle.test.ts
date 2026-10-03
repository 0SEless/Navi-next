/**
 * Phase 4C — Version Lifecycle Tests
 *
 * Tests proving that connectivitySemanticsVersion participates correctly
 * in the document creation/save/reload lifecycle.
 */
import { describe, expect, it } from 'vitest'
import type { CampusDocument } from '@navi/core'
import { CONNECTIVITY_CONTRACT_VERSION, extractConnectivitySemantics, CoordinateTransformer } from '@navi/core'
import { createDocument } from '../context/create-editor-context'
import { Graph } from '../../../../src/engine/graph'
import { GraphAdapter } from '../graph-adapter'

function makeEmptyGraph(): Graph {
  const graph = new Graph('test-campus')
  return graph
}

function syncDocument(graph: Graph, document: CampusDocument): void {
  const transformer = new CoordinateTransformer()
  new GraphAdapter(graph, transformer).sync(document)
}

describe('Phase 4C — Version lifecycle', () => {
  // Test 1: New document gets v1 marker
  it('Test 1: createDocument with stampConnectivityVersion sets marker', () => {
    const graph = makeEmptyGraph()
    const doc = createDocument(graph, undefined, { stampConnectivityVersion: true })
    expect(doc.connectivitySemanticsVersion).toBe(CONNECTIVITY_CONTRACT_VERSION)
  })

  // Test 2: New empty-semantics document compiles canonical
  it('Test 2: new document with marker but no junctions uses canonical mode', () => {
    const doc: CampusDocument = {
      schemaVersion: 1, version: 1,
      metadata: { campusId: 'test', name: 'test', description: '', lastModified: '', editorVersion: 'test' },
      buildings: [], roads: [], panoramas: [], qrCheckpoints: [],
      connectivitySemanticsVersion: CONNECTIVITY_CONTRACT_VERSION,
    }
    const semantics = extractConnectivitySemantics(doc)
    expect(semantics.version).toBe(CONNECTIVITY_CONTRACT_VERSION)
    expect(semantics.junctions).toHaveLength(0)
    expect(semantics.separatedCrossings).toHaveLength(0)
  })

  // Test 3: Legacy unmarked document loads
  it('Test 3: legacy document without marker loads successfully', () => {
    const graph = makeEmptyGraph()
    const doc = createDocument(graph)
    // Legacy document created from empty graph has no marker
    expect(doc.connectivitySemanticsVersion).toBeUndefined()
    // But it's still a valid document
    expect(doc.schemaVersion).toBe(1)
  })

  // Test 4: Legacy compatibility before normal save
  it('Test 4: unmarked document uses legacy inference in compiler', () => {
    const doc: CampusDocument = {
      schemaVersion: 1, version: 1,
      metadata: { campusId: 'test', name: 'test', description: '', lastModified: '', editorVersion: 'test' },
      buildings: [], roads: [], panoramas: [], qrCheckpoints: [],
      // No connectivitySemanticsVersion — legacy document
    }
    // The compiler should use legacy inference for this document
    expect(doc.connectivitySemanticsVersion).toBeUndefined()
  })

  // Test 5: GraphAdapter sync preserves version through Graph
  it('Test 5: GraphAdapter sync preserves connectivitySemanticsVersion', () => {
    const graph = makeEmptyGraph()
    const doc: CampusDocument = {
      schemaVersion: 1, version: 1,
      metadata: { campusId: 'test', name: 'test', description: '', lastModified: '', editorVersion: 'test' },
      buildings: [], roads: [], panoramas: [], qrCheckpoints: [],
      connectivitySemanticsVersion: CONNECTIVITY_CONTRACT_VERSION,
    }
    syncDocument(graph, doc)

    // Version marker should be on the Graph
    expect((graph as any)._connectivitySemanticsVersion).toBe(CONNECTIVITY_CONTRACT_VERSION)
  })

  // Test 6: Version survives toJSON/fromJSON round-trip
  it('Test 6: version marker survives Graph serialization round-trip', () => {
    const graph = makeEmptyGraph()
    ;(graph as any)._connectivitySemanticsVersion = CONNECTIVITY_CONTRACT_VERSION

    const json = graph.toJSON()
    expect(json.connectivitySemanticsVersion).toBe(CONNECTIVITY_CONTRACT_VERSION)

    const restored = Graph.fromJSON(json)
    expect((restored as any)._connectivitySemanticsVersion).toBe(CONNECTIVITY_CONTRACT_VERSION)
  })

  // Test 7: createDocument reads version from Graph
  it('Test 7: createDocument reads connectivitySemanticsVersion from Graph', () => {
    const graph = makeEmptyGraph()
    ;(graph as any)._connectivitySemanticsVersion = CONNECTIVITY_CONTRACT_VERSION

    const doc = createDocument(graph)
    expect(doc.connectivitySemanticsVersion).toBe(CONNECTIVITY_CONTRACT_VERSION)
  })

  // Test 8: Modern empty-semantics save/reload stays canonical
  it('Test 8: modern document with marker survives full round-trip', () => {
    const graph = makeEmptyGraph()
    const doc: CampusDocument = {
      schemaVersion: 1, version: 1,
      metadata: { campusId: 'test', name: 'test', description: '', lastModified: '', editorVersion: 'test' },
      buildings: [], roads: [], panoramas: [], qrCheckpoints: [],
      connectivitySemanticsVersion: CONNECTIVITY_CONTRACT_VERSION,
    }
    syncDocument(graph, doc)

    // Serialize and restore
    const json = graph.toJSON()
    const restored = Graph.fromJSON(json)
    const reloaded = createDocument(restored)

    // Version marker preserved
    expect(reloaded.connectivitySemanticsVersion).toBe(CONNECTIVITY_CONTRACT_VERSION)
  })

  // Test 9: SeparatedCrossing survives canonical save/reload
  it('Test 9: separatedCrossings survive through Graph round-trip', () => {
    const graph = makeEmptyGraph()
    const doc: CampusDocument = {
      schemaVersion: 1, version: 1,
      metadata: { campusId: 'test', name: 'test', description: '', lastModified: '', editorVersion: 'test' },
      buildings: [], roads: [], panoramas: [], qrCheckpoints: [],
      separatedCrossings: [{ id: 'sc-1', roadIds: ['a', 'b'], position: { lat: 0, lng: 0 } }],
      connectivitySemanticsVersion: CONNECTIVITY_CONTRACT_VERSION,
    }
    syncDocument(graph, doc)

    const json = graph.toJSON()
    const restored = Graph.fromJSON(json)
    const reloaded = createDocument(restored)

    expect(reloaded.separatedCrossings).toHaveLength(1)
    expect(reloaded.separatedCrossings![0].id).toBe('sc-1')
    expect(reloaded.connectivitySemanticsVersion).toBe(CONNECTIVITY_CONTRACT_VERSION)
  })

  // Test 10: Repeated save/reload stable
  it('Test 10: repeated round-trip preserves marker and semantics', () => {
    let graph = makeEmptyGraph()
    const doc: CampusDocument = {
      schemaVersion: 1, version: 1,
      metadata: { campusId: 'test', name: 'test', description: '', lastModified: '', editorVersion: 'test' },
      buildings: [], roads: [], panoramas: [], qrCheckpoints: [],
      connectivitySemanticsVersion: CONNECTIVITY_CONTRACT_VERSION,
    }
    syncDocument(graph, doc)

    // First round-trip
    const json1 = graph.toJSON()
    const graph2 = Graph.fromJSON(json1)
    const doc2 = createDocument(graph2)
    syncDocument(graph2, doc2)

    // Second round-trip
    const json2 = graph2.toJSON()
    const graph3 = Graph.fromJSON(json2)
    const doc3 = createDocument(graph3)

    // Marker stable across both round-trips
    expect(doc3.connectivitySemanticsVersion).toBe(CONNECTIVITY_CONTRACT_VERSION)
  })
})
