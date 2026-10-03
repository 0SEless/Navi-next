/**
 * Phase 4E — Normalizer Separated-Crossing Defect Test
 *
 * Directly tests the connectivity normalizer to find why
 * separated-crossing waypoints are being merged.
 */
import { describe, expect, it } from 'vitest'
import { normalizeConnectivity } from '../connectivity/normalizer'
import type { PrimitiveGraph, PrimitiveNode } from '../types'
import type { ConnectivitySemantics } from '@navi/core'

function makeWaypoint(id: string, lat: number, lng: number, entityId: string): PrimitiveNode {
  return {
    id,
    kind: 'waypoint',
    position: { lat, lng },
    floor: 0,
    buildingId: '__outdoor__',
    source: { entityId, entityType: 'road', generatorId: 'builtin:polyline-skeleton' },
  }
}

function makePrimitiveGraph(nodes: PrimitiveNode[]): PrimitiveGraph {
  // Add skeleton edges so waypoints aren't dangling
  const edges = []
  for (let i = 0; i < nodes.length - 1; i++) {
    edges.push({
      id: `e-${i}`,
      kind: 'skeleton',
      from: nodes[i].id,
      to: nodes[i + 1].id,
      distance: 10,
      source: { entityId: '', entityType: 'skeleton', generatorId: 'test' },
    })
  }
  return {
    nodes,
    edges,
    metadata: { campusId: 'test' },
    diagnostics: [],
  }
}

describe('Normalizer separated-crossing defect', () => {
  it('NEGATIVE: waypoints from separated roads MUST NOT merge', () => {
    // Two waypoints at the same position, from different roads
    const nodeA = makeWaypoint('w-a1', 0, 0, 'road-a')
    const nodeB = makeWaypoint('w-b1', 0, 0.000001, 'road-b') // ~0.1m away

    const graph = makePrimitiveGraph([nodeA, nodeB])

    const semantics: ConnectivitySemantics = {
      version: '1.0.0',
      campusId: 'test',
      junctions: [],
      separatedCrossings: [{
        id: 'sc-ab',
        position: { lat: 0, lng: 0 },
        roadIds: ['road-a', 'road-b'],
      }],
    }

    const result = normalizeConnectivity(graph, 0.5, semantics)

    // The two waypoints should NOT be merged
    expect(result.nodes.length).toBe(2)
    // Check no merge happened
    const mergedDiags = result.diagnostics.filter(d => d.code === 'WAYPOINT_MERGED')
    expect(mergedDiags.length).toBe(0)
  })

  it('POSITIVE: compatible waypoints SHOULD merge', () => {
    // Two waypoints at the same position, from the SAME road
    const nodeA = makeWaypoint('w-a1', 0, 0, 'road-a')
    const nodeB = makeWaypoint('w-a2', 0, 0.000001, 'road-a') // same road

    const graph = makePrimitiveGraph([nodeA, nodeB])

    const semantics: ConnectivitySemantics = {
      version: '1.0.0',
      campusId: 'test',
      junctions: [],
      separatedCrossings: [{
        id: 'sc-ab',
        position: { lat: 0, lng: 0 },
        roadIds: ['road-a', 'road-b'],
      }],
    }

    const result = normalizeConnectivity(graph, 0.5, semantics)

    // Same-road waypoints should still merge
    expect(result.nodes.length).toBe(1)
  })

  it('NEGATIVE: no explicit junction — waypoints from different roads MUST NOT merge', () => {
    const nodeA = makeWaypoint('w-a1', 0, 0, 'road-a')
    const nodeB = makeWaypoint('w-b1', 0, 0.000001, 'road-b')

    const graph = makePrimitiveGraph([nodeA, nodeB])

    // No separated crossings
    const result = normalizeConnectivity(graph, 0.5)

    // Absence of a separation record is not positive authorization.
    expect(result.nodes.length).toBe(2)
  })

  it('POSITIVE: an explicit junction authorizes different-road waypoint merge', () => {
    const nodeA = makeWaypoint('w-a1', 0, 0, 'road-a')
    const nodeB = makeWaypoint('w-b1', 0, 0.000001, 'road-b')
    const graph = makePrimitiveGraph([nodeA, nodeB])
    const semantics: ConnectivitySemantics = {
      version: '1.0.0',
      campusId: 'test',
      junctions: [{
        id: 'j-ab',
        position: { lat: 0, lng: 0 },
        roadIds: ['road-a', 'road-b'],
        source: 'authored',
      }],
      separatedCrossings: [],
    }

    const result = normalizeConnectivity(graph, 0.5, semantics)

    expect(result.nodes.length).toBe(1)
  })

  it('MISSING_PROVENANCE: waypoints with empty entityId do not merge', () => {
    // Test what happens when source.entityId is empty string
    const nodeA = makeWaypoint('w-a1', 0, 0, 'road-a')
    const nodeB = makeWaypoint('w-b1', 0, 0.000001, '') // empty entityId

    const graph = makePrimitiveGraph([nodeA, nodeB])

    const semantics: ConnectivitySemantics = {
      version: '1.0.0',
      campusId: 'test',
      junctions: [],
      separatedCrossings: [{
        id: 'sc-ab',
        position: { lat: 0, lng: 0 },
        roadIds: ['road-a', 'road-b'],
      }],
    }

    const result = normalizeConnectivity(graph, 0.5, semantics)

    // Missing identity is not authorization to join topology.
    expect(result.nodes.length).toBe(2)
  })
})
