import { describe, it, expect } from 'vitest'
import { ArtifactHydrator, type HydrateFailure } from '../artifact-hydrator'
import { graphValidator } from '../validators/graph-validator'
import { searchValidator } from '../validators/search-validator'
import { buildingValidator } from '../validators/building-validator'
import { poiValidator } from '../validators/poi-validator'

const hydrator = new ArtifactHydrator()

function validGraph(): string {
  return JSON.stringify({
    schemaVersion: '1.0.0',
    campusId: 'campus-1',
    checksum: 'abc',
    nodes: [{ id: 'n1', type: 'waypoint', lat: 1, lng: 2, floor: 0, buildingId: 'b1' }],
    edges: [{ id: 'e1', from: 'n1', to: 'n2', type: 'walk', distance: 10, weight: 1 }],
  })
}

function validSearch(): string {
  return JSON.stringify({
    schemaVersion: '1.0.0',
    entries: [{ id: 's1', label: 'Room 101', type: 'room', nodeId: 'n1', lat: 1, lng: 2, tags: [] }],
  })
}

function validBuilding(): string {
  return JSON.stringify({
    schemaVersion: '1.0.0',
    buildings: [{ id: 'b1', name: 'Bldg A', code: 'A', position: { lat: 1, lng: 2 }, floors: [], entrances: [] }],
  })
}

function validPoi(): string {
  return JSON.stringify({
    schemaVersion: '1.0.0',
    points: [{ id: 'p1', label: 'Cafe', category: 'food', lat: 1, lng: 2, nodeId: 'n1', properties: {} }],
  })
}

describe('ArtifactHydrator', () => {
  it('hydrates valid graph JSON', async () => {
    const result = await hydrator.hydrate(validGraph(), graphValidator)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.artifact.nodes).toHaveLength(1)
      expect(result.artifact.edges).toHaveLength(1)
    }
  })

  it('hydrates valid search index', async () => {
    const result = await hydrator.hydrate(validSearch(), searchValidator)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.artifact.entries).toHaveLength(1)
    }
  })

  it('hydrates valid building index', async () => {
    const result = await hydrator.hydrate(validBuilding(), buildingValidator)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.artifact.buildings).toHaveLength(1)
    }
  })

  it('hydrates valid POI index', async () => {
    const result = await hydrator.hydrate(validPoi(), poiValidator)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.artifact.points).toHaveLength(1)
    }
  })

  it('rejects invalid JSON', async () => {
    const result = await hydrator.hydrate('not json', graphValidator)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.code).toBe('INVALID_JSON')
    }
  })

  it('rejects missing schemaVersion', async () => {
    const json = JSON.stringify({ nodes: [], edges: [] })
    const result = await hydrator.hydrate(json, graphValidator)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.code).toBe('INVALID_SCHEMA')
    }
  })

  it('rejects wrong schema version', async () => {
    const json = JSON.stringify({ schemaVersion: '2.0', nodes: [], edges: [] })
    const result = await hydrator.hydrate(json, graphValidator)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.code).toBe('UNSUPPORTED_VERSION')
    }
  })

  it('rejects missing required fields', async () => {
    const json = JSON.stringify({ schemaVersion: '1.0.0', nodes: [] })
    const result = await hydrator.hydrate(json, graphValidator)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.code).toBe('INVALID_SCHEMA')
    }
  })

  it('rejects wrong top-level type (array instead of object)', async () => {
    const result = await hydrator.hydrate('["not", "an", "object"]', graphValidator)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.code).toBe('INVALID_SCHEMA')
    }
  })

  it('rejects null', async () => {
    const result = await hydrator.hydrate('null', graphValidator)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.code).toBe('INVALID_SCHEMA')
    }
  })
})
