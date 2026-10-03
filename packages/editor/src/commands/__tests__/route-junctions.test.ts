import { describe, expect, it } from 'vitest'
import type { RouteNetwork } from '@navi/core'
import { applyRouteJunctionSplit } from '../route-junctions'

function lineNetwork(type: 'walk' | 'stairs' = 'walk'): RouteNetwork {
  return {
    nodes: [
      { id: 'n-a', type: 'waypoint', position: { x: 0, y: 0 }, floor: 0 },
      { id: 'n-b', type: 'waypoint', position: { x: 10, y: 0 }, floor: 0 },
    ],
    edges: [{ id: 'e-ab', from: 'n-a', to: 'n-b', type, distance: 10 }],
  }
}

describe('applyRouteJunctionSplit', () => {
  it('splits an edge at the projected point and preserves the edge type', () => {
    const network = lineNetwork('stairs')

    const result = applyRouteJunctionSplit(network, 'e-ab', { x: 4, y: 3 }, 0)

    expect(result.ok).toBe(true)
    if (!result.ok || result.reusedEndpoint) throw new Error('expected a split')
    expect(network.edges.find(e => e.id === 'e-ab')).toBeUndefined()
    const junction = network.nodes.find(n => n.id === result.junctionId)!
    expect(junction).toMatchObject({ type: 'waypoint', position: { x: 4, y: 0 }, floor: 0 })
    const [first, second] = result.createdEdgeIds.map(id => network.edges.find(e => e.id === id)!)
    expect(first).toMatchObject({ from: 'n-a', to: result.junctionId, type: 'stairs', distance: 4 })
    expect(second).toMatchObject({ from: result.junctionId, to: 'n-b', type: 'stairs', distance: 6 })
    expect(network.nodes).toHaveLength(3)
    expect(network.edges).toHaveLength(2)
  })

  it('reuses an endpoint node when the projection lands on it', () => {
    const network = lineNetwork()

    const result = applyRouteJunctionSplit(network, 'e-ab', { x: -5, y: 0 }, 0)

    expect(result).toEqual({ ok: true, junctionId: 'n-a', reusedEndpoint: true })
    expect(network.edges).toHaveLength(1)
    expect(network.nodes).toHaveLength(2)
  })

  it('rejects an unknown edge without mutating the network', () => {
    const network = lineNetwork()
    const before = JSON.parse(JSON.stringify(network))

    const result = applyRouteJunctionSplit(network, 'e-missing', { x: 1, y: 1 }, 0)

    expect(result).toEqual({ ok: false, error: 'Route edge not found: e-missing' })
    expect(network).toEqual(before)
  })
})
