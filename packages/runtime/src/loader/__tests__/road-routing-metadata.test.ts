import { describe, expect, it } from 'vitest'
import type { NavigationGraphFile, RoadEdgeRouting } from '@navi/core'
import { ArtifactHydrator } from '../artifact-hydrator'
import { toRuntimeGraph } from '../runtime-converter'
import { graphValidator } from '../validators/graph-validator'
import { AStar } from '../../routing/astar'

const ROUTING: RoadEdgeRouting = {
  sourceRoadId: 'road-1',
  authoredOrientation: 'forward',
  authored: {
    feature: 'ramp', slope: 'moderate', direction: 'both',
    startElevationMeters: -2, endElevationMeters: 4,
    walkable: true, wheelchairAccessible: false,
  },
}

function graph(routing: unknown = undefined): NavigationGraphFile {
  return {
    schemaVersion: '1.0.0',
    campusId: 'phase4-campus',
    checksum: 'checksum',
    nodes: [
      { id: 'n1', type: 'outdoor', lat: 14, lng: 121, floor: 0, buildingId: '__outdoor__' },
      { id: 'n2', type: 'outdoor', lat: 14.1, lng: 121.1, floor: 0, buildingId: '__outdoor__' },
    ],
    edges: [{
      id: 'e1', from: 'n1', to: 'n2', type: 'walk', distance: 19, weight: 19,
      ...(routing === undefined ? {} : { routing }),
    }] as NavigationGraphFile['edges'],
  }
}

describe('Phase 4 runtime Road routing metadata', () => {
  it('hydrates and converts valid additive metadata without changing cost', async () => {
    const hydrated = await new ArtifactHydrator().hydrate(JSON.stringify(graph(ROUTING)), graphValidator)
    expect(hydrated.success).toBe(true)
    if (!hydrated.success) return

    const runtime = toRuntimeGraph(hydrated.artifact)
    expect(runtime.edges[0]).toMatchObject({ distance: 19, weight: 19, routing: ROUTING })
  })

  it('hydrates and converts a legacy graph without materializing routing', async () => {
    const hydrated = await new ArtifactHydrator().hydrate(JSON.stringify(graph()), graphValidator)
    expect(hydrated.success).toBe(true)
    if (!hydrated.success) return

    expect(toRuntimeGraph(hydrated.artifact).edges[0]).not.toHaveProperty('routing')
  })

  it('does not change A* path selection or weighted cost', () => {
    const legacyResult = new AStar(toRuntimeGraph(graph())).findPath('n1', 'n2')
    const routedResult = new AStar(toRuntimeGraph(graph(ROUTING))).findPath('n1', 'n2')

    expect(routedResult).toEqual(legacyResult)
    expect(routedResult).toEqual({ path: ['n1', 'n2'], edgeIds: ['e1'], cost: 19, distance: 19 })
  })

  it.each([
    ['wrong orientation', { ...ROUTING, authoredOrientation: 'reverse' }],
    ['invalid authored enum', { ...ROUTING, authored: { feature: 'tunnel' } }],
    ['non-finite authored elevation', { ...ROUTING, authored: { endElevationMeters: Number.NaN } }],
  ])('rejects malformed present metadata: %s', async (_label, routing) => {
    const hydrated = await new ArtifactHydrator().hydrate(JSON.stringify(graph(routing)), graphValidator)
    expect(hydrated.success).toBe(false)
  })
})
