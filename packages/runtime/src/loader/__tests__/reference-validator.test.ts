import { describe, it, expect } from 'vitest'
import { ReferenceValidator, type ArtifactBundle } from '../reference-validator'
import type { NavigationGraphFile, SearchIndexFile, BuildingIndexFile, POIIndexFile } from '@navi/core'

const validator = new ReferenceValidator()

function validGraph(): NavigationGraphFile {
  return {
    schemaVersion: '1.0.0',
    campusId: 'campus-1',
    checksum: 'abc',
    nodes: [
      { id: 'n1', type: 'waypoint', lat: 1, lng: 2, floor: 0, buildingId: 'b1' },
      { id: 'n2', type: 'waypoint', lat: 3, lng: 4, floor: 0, buildingId: 'b1' },
      { id: 'n3', type: 'entrance', lat: 5, lng: 6, floor: 0, buildingId: 'b1' },
    ],
    edges: [
      { id: 'e1', from: 'n1', to: 'n2', type: 'walk', distance: 10, weight: 1 },
      { id: 'e2', from: 'n2', to: 'n3', type: 'walk', distance: 20, weight: 1 },
    ],
  }
}

describe('ReferenceValidator', () => {
  it('passes valid bundle', () => {
    const bundle: ArtifactBundle = { graph: validGraph() }
    const result = validator.validate(bundle)
    expect(result.success).toBe(true)
  })

  it('passes with all artifact types referencing valid nodes', () => {
    const bundle: ArtifactBundle = {
      graph: validGraph(),
      search: { schemaVersion: '1.0.0', entries: [{ id: 's1', label: 'Room', type: 'room', nodeId: 'n1', lat: 1, lng: 2, tags: [] }] },
      buildings: { schemaVersion: '1.0.0', buildings: [{ id: 'b1', name: 'Bldg', code: 'A', position: { lat: 1, lng: 2 }, floors: [], entrances: [{ id: 'e1', label: 'Main', nodeId: 'n3' }] }] },
      poi: { schemaVersion: '1.0.0', points: [{ id: 'p1', label: 'Cafe', category: 'food', lat: 1, lng: 2, nodeId: 'n2', properties: {} }] },
    }
    const result = validator.validate(bundle)
    expect(result.success).toBe(true)
  })

  it('rejects edge referencing missing node', () => {
    const graph = validGraph()
    graph.edges.push({ id: 'e3', from: 'n1', to: 'missing-node', type: 'walk', distance: 5, weight: 1 })
    const result = validator.validate({ graph })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.code).toBe('REFERENCE_MISSING_NODE')
      expect(result.references).toHaveLength(1)
      expect(result.references[0].missingId).toBe('missing-node')
    }
  })

  it('rejects edge.from referencing missing node', () => {
    const graph = validGraph()
    graph.edges.push({ id: 'e3', from: 'ghost', to: 'n2', type: 'walk', distance: 5, weight: 1 })
    const result = validator.validate({ graph })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.references[0].missingId).toBe('ghost')
    }
  })

  it('rejects search entry referencing missing node', () => {
    const search: SearchIndexFile = {
      schemaVersion: '1.0.0',
      entries: [{ id: 's1', label: 'Ghost', type: 'room', nodeId: 'nonexistent', lat: 1, lng: 2, tags: [] }],
    }
    const result = validator.validate({ graph: validGraph(), search })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.references[0].source).toBe('search.entries')
    }
  })

  it('rejects building entrance referencing missing node', () => {
    const buildings: BuildingIndexFile = {
      schemaVersion: '1.0.0',
      buildings: [{ id: 'b1', name: 'B', code: 'B', position: { lat: 1, lng: 2 }, floors: [], entrances: [{ id: 'e1', label: 'In', nodeId: 'no-such-node' }] }],
    }
    const result = validator.validate({ graph: validGraph(), buildings })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.references[0].source).toBe('buildings.entrances')
    }
  })

  it('rejects POI referencing missing node', () => {
    const poi: POIIndexFile = {
      schemaVersion: '1.0.0',
      points: [{ id: 'p1', label: 'Ghost Cafe', category: 'food', lat: 1, lng: 2, nodeId: 'lost-node', properties: {} }],
    }
    const result = validator.validate({ graph: validGraph(), poi })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.references[0].source).toBe('poi.points')
    }
  })

  it('reports multiple failures together', () => {
    const graph = validGraph()
    graph.edges.push({ id: 'e3', from: 'n1', to: 'bad1', type: 'walk', distance: 5, weight: 1 })
    graph.edges.push({ id: 'e4', from: 'bad2', to: 'n2', type: 'walk', distance: 5, weight: 1 })
    const result = validator.validate({ graph })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.references.length).toBeGreaterThanOrEqual(2)
    }
  })

  it('passes empty graph (no nodes, no edges)', () => {
    const emptyGraph: NavigationGraphFile = {
      schemaVersion: '1.0.0',
      campusId: 'empty',
      checksum: '',
      nodes: [],
      edges: [],
    }
    const result = validator.validate({ graph: emptyGraph })
    expect(result.success).toBe(true)
  })

  it('rejects missing graph artifact', () => {
    const result = validator.validate({})
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.code).toBe('REFERENCE_MISSING_NODE')
    }
  })
})
