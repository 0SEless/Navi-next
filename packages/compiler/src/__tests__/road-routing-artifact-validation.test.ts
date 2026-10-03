import { describe, expect, it } from 'vitest'
import type { RoadEdgeRouting } from '@navi/core'
import { validateNavigationArtifacts } from '../validation/artifact-validator'

const VALID_ROUTING: RoadEdgeRouting = {
  sourceRoadId: 'road-1',
  authoredOrientation: 'forward',
  authored: {
    feature: 'stairs',
    slope: 'steep',
    direction: 'forward',
    startElevationMeters: -1,
    endElevationMeters: 5,
    walkable: true,
    wheelchairAccessible: false,
  },
}

function artifacts(routing: unknown = undefined) {
  return {
    graph: {
      version: '1.0.0',
      campusId: 'phase4-campus',
      createdAt: '',
      checksum: 'checksum',
      nodes: [
        { id: 'n1', label: 'A', type: 'waypoint', position: { lat: 14, lng: 121 }, floor: 0, buildingId: '__outdoor__', properties: {} },
        { id: 'n2', label: 'B', type: 'waypoint', position: { lat: 14.0001, lng: 121.0001 }, floor: 0, buildingId: '__outdoor__', properties: {} },
      ],
      edges: [{
        id: 'e1', from: 'n1', to: 'n2', type: 'walk', distance: 10, weight: 10,
        ...(routing === undefined ? {} : { routing }),
      }],
      metadata: {
        nodeCount: 2,
        edgeCount: 1,
        buildings: 0,
        floors: 1,
        boundingBox: { minLat: 14, maxLat: 14.0001, minLng: 121, maxLng: 121.0001 },
      },
    },
    searchIndex: { version: '1.0.0', entries: [] },
    spatialIndex: { version: '1.0.0', cells: {}, cellSize: 10 },
    buildingIndex: { version: '1.0.0', buildings: [] },
    poiIndex: { version: '1.0.0', points: [] },
    components: [],
    doors: [],
    metadata: {
      campusId: 'phase4-campus',
      compilerVersion: '1.0.0',
      revision: '1',
      sourceDocumentVersion: '1',
      compiledAt: '',
    },
    extensions: {},
  }
}

describe('Phase 4 artifact Road routing validation', () => {
  it('accepts legacy absence and the valid additive contract', () => {
    expect(validateNavigationArtifacts(artifacts()).valid).toBe(true)
    expect(validateNavigationArtifacts(artifacts(VALID_ROUTING)).valid).toBe(true)
  })

  it.each([
    ['primitive wrapper', 'stairs'],
    ['blank Road ID', { ...VALID_ROUTING, sourceRoadId: ' ' }],
    ['unsupported orientation', { ...VALID_ROUTING, authoredOrientation: 'reverse' }],
    ['invalid feature', { ...VALID_ROUTING, authored: { feature: 'lava' } }],
    ['non-finite elevation', { ...VALID_ROUTING, authored: { startElevationMeters: Number.POSITIVE_INFINITY } }],
    ['empty authored payload', { ...VALID_ROUTING, authored: {} }],
  ])('rejects malformed present routing: %s', (_label, routing) => {
    const result = validateNavigationArtifacts(artifacts(routing))
    expect(result.valid).toBe(false)
    expect(result.errors.map(error => error.code)).toContain('ARTIFACT_INVALID_EDGE_ROUTING')
  })
})

