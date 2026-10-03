import { describe, expect, it } from 'vitest'
import type { NavigationArtifacts, RoadEdgeRouting } from '@navi/core'
import { build } from '../package-builder'

const ROUTING: RoadEdgeRouting = {
  sourceRoadId: 'road-1',
  authoredOrientation: 'forward',
  authored: {
    feature: 'bridge',
    slope: 'gentle',
    direction: 'reverse',
    startElevationMeters: 0,
    endElevationMeters: -3,
    walkable: false,
    wheelchairAccessible: true,
  },
}

function artifacts(routing?: RoadEdgeRouting): NavigationArtifacts {
  return {
    graph: {
      version: '1.0.0', campusId: 'phase4-campus', createdAt: '', checksum: 'checksum',
      nodes: [
        { id: 'n1', label: '', type: 'waypoint', position: { lat: 14, lng: 121 }, floor: 0, buildingId: '__outdoor__', properties: {} },
        { id: 'n2', label: '', type: 'waypoint', position: { lat: 14.1, lng: 121.1 }, floor: 0, buildingId: '__outdoor__', properties: {} },
      ],
      edges: [{
        id: 'e1', from: 'n1', to: 'n2', type: 'walk', distance: 17, weight: 17,
        ...(routing ? { routing } : {}),
      }],
      metadata: { nodeCount: 2, edgeCount: 1, buildings: 0, floors: 1, boundingBox: { minLat: 14, maxLat: 14.1, minLng: 121, maxLng: 121.1 } },
    },
    searchIndex: { version: '1.0.0', entries: [] },
    spatialIndex: { version: '1.0.0', cells: {}, cellSize: 10 },
    buildingIndex: { version: '1.0.0', buildings: [] },
    poiIndex: { version: '1.0.0', points: [] },
    extensions: {},
  }
}

describe('Phase 4 publisher Road routing metadata', () => {
  it('preserves valid edge metadata, distance, and weight in package JSON', () => {
    const pkg = build(artifacts(ROUTING), { campusId: 'phase4-campus', campusName: 'Phase 4', outputDir: 'unused' })
    const serialized = JSON.parse(JSON.stringify(pkg.graph))

    expect(serialized.edges[0]).toMatchObject({ distance: 17, weight: 17, routing: ROUTING })
  })

  it('keeps routing absent in legacy package edges', () => {
    const pkg = build(artifacts(), { campusId: 'phase4-campus', campusName: 'Phase 4', outputDir: 'unused' })
    expect(pkg.graph.edges[0]).not.toHaveProperty('routing')
  })
})

