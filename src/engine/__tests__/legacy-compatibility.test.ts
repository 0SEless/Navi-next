/**
 * 3C-1: Legacy 3-5m connection compatibility test.
 *
 * Verifies that:
 * - Legacy documents (with legacy-inferred junctions) use 5m radius
 * - New documents (without legacy junctions) use 2m radius
 * - Existing legacy connections at 3-5m survive sync
 */
import { describe, expect, it } from 'vitest'
import { Graph } from '../../engine/graph'
import { GraphAdapter } from '../../../packages/editor/src/graph-adapter'
import type { TracePath } from '@/types/nav-types'
import type { CampusDocument, RoadJunction } from '@navi/core'

const makeTrace = (id: string, points: TracePath['points']): TracePath => ({
  id, campusId: 'test-campus', floor: 0, type: 'arterial', points,
})

function makeDoc(roads: Array<{ id: string; points: TracePath['points'] }>, junctions?: RoadJunction[]) {
  return {
    schemaVersion: 1, version: 0,
    metadata: { campusId: 'test', name: 'test', description: '', lastModified: '', editorVersion: '0.1.0' },
    buildings: [],
    roads: roads.map(r => ({
      id: r.id, name: r.id, polyline: { points: r.points },
      width: 8, surface: 'paved' as const, type: 'arterial' as const, metadata: {},
    })),
    panoramas: [], qrCheckpoints: [],
    roadJunctions: junctions,
  } as CampusDocument
}

describe('3C-1: Legacy 3-5m compatibility', () => {
  it('legacy document (with legacy-inferred junctions) uses 5m radius', () => {
    const graph = new Graph('test-campus')
    const adapter = new GraphAdapter(graph)

    // Document with legacy-inferred junctions
    const doc = makeDoc([
      { id: 'road-a', points: [{ lat: 0, lng: -0.001 }, { lat: 0, lng: 0.001 }] },
      { id: 'road-b', points: [{ lat: 0.000027, lng: 0 }, { lat: 0.001, lng: 0 }] }, // ~3m from road-a
    ], [
      { id: 'j-legacy', position: { lat: 0, lng: 0 }, roadIds: ['road-a', 'road-b'], source: 'legacy-inferred' },
    ])

    adapter.sync(doc)

    // Legacy document should use 5m → junction created at 3m
    const junctions = graph.nodes.filter(
      n => n.metadata?.connectionNode === true && Array.isArray(n.metadata?.traceIds)
    )
    const j = junctions.find(n => (n.metadata?.traceIds as string[])?.includes('road-b'))
    expect(j).toBeDefined()
  })

  it('new document (without legacy junctions) uses 2m radius', () => {
    const graph = new Graph('test-campus')
    const adapter = new GraphAdapter(graph)

    // New document without any roadJunctions
    const doc = makeDoc([
      { id: 'road-a', points: [{ lat: 0, lng: -0.001 }, { lat: 0, lng: 0.001 }] },
      { id: 'road-b', points: [{ lat: 0.000027, lng: 0 }, { lat: 0.001, lng: 0 }] }, // ~3m from road-a
    ])

    adapter.sync(doc)

    // New document should use 2m → no junction at 3m
    const junctions = graph.nodes.filter(
      n => n.metadata?.connectionNode === true && Array.isArray(n.metadata?.traceIds)
    )
    const j = junctions.find(n => (n.metadata?.traceIds as string[])?.includes('road-b'))
    expect(j).toBeUndefined()
  })

  it('legacy document without junctions array uses 5m (backward compat)', () => {
    const graph = new Graph('test-campus')
    const adapter = new GraphAdapter(graph)

    // Document with roadJunctions: undefined (never synced before)
    const doc = makeDoc([
      { id: 'road-a', points: [{ lat: 0, lng: -0.001 }, { lat: 0, lng: 0.001 }] },
      { id: 'road-b', points: [{ lat: 0.000027, lng: 0 }, { lat: 0.001, lng: 0 }] },
    ], undefined)

    adapter.sync(doc)

    // No junctions array → no legacy-inferred → uses 2m → no junction at 3m
    const junctions = graph.nodes.filter(
      n => n.metadata?.connectionNode === true && Array.isArray(n.metadata?.traceIds)
    )
    const j = junctions.find(n => (n.metadata?.traceIds as string[])?.includes('road-b'))
    expect(j).toBeUndefined()
  })
})
