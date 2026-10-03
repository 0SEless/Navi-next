import { describe, it, expect } from 'vitest'
import type { RouteNetwork } from '@navi/core'
import { placeRouteNode } from '../route-node-placement'
import { createRouteEdge, removeRouteEdge, validateEdge } from '../route-edge-creation'

function networkWithNodes(): RouteNetwork & { n1: string; n2: string; n3: string } {
  const net: RouteNetwork = { nodes: [], edges: [] }
  const n1 = placeRouteNode({ x: 0, y: 0 }, 0, net)
  const n2 = placeRouteNode({ x: 3, y: 4 }, 0, net)
  const n3 = placeRouteNode({ x: 0, y: 0 }, 1, net)
  return Object.assign(net, { n1: n1.id, n2: n2.id, n3: n3.id })
}

describe('createRouteEdge', () => {
  it('creates an edge between two same-floor nodes', () => {
    const { n1, n2, ...net } = networkWithNodes()
    const edge = createRouteEdge(n1, n2, net)
    expect(edge).not.toBeNull()
    expect(edge!.from).toBe(n1)
    expect(edge!.to).toBe(n2)
    expect(edge!.distance).toBeCloseTo(5)
    expect(net.edges).toHaveLength(1)
  })

  it('returns null for invalid edge', () => {
    const { n1, n2, n3, ...net } = networkWithNodes()
    expect(createRouteEdge(n1, n3, net)).toBeNull()
    expect(createRouteEdge(n1, 'missing', net)).toBeNull()
    expect(createRouteEdge(n1, n1, net)).toBeNull()
  })

  it('returns null when duplicate edge exists', () => {
    const { n1, n2, ...net } = networkWithNodes()
    createRouteEdge(n1, n2, net)
    expect(createRouteEdge(n2, n1, net)).toBeNull()
  })

  it('uses specified edge type', () => {
    const { n1, n2, ...net } = networkWithNodes()
    const edge = createRouteEdge(n1, n2, net, 'elevator')
    expect(edge!.type).toBe('elevator')
  })
})

describe('removeRouteEdge', () => {
  it('removes the edge', () => {
    const { n1, n2, ...net } = networkWithNodes()
    const edge = createRouteEdge(n1, n2, net)!
    expect(removeRouteEdge(edge.id, net)).toBe(true)
    expect(net.edges).toHaveLength(0)
  })

  it('returns false for unknown edge id', () => {
    const net: RouteNetwork = { nodes: [], edges: [] }
    expect(removeRouteEdge('nope', net)).toBe(false)
  })
})

describe('validateEdge', () => {
  it('rejects same-node edge', () => {
    const { n1, ...net } = networkWithNodes()
    expect(validateEdge(n1, n1, net)).toBe(false)
  })

  it('rejects missing nodes', () => {
    const { n1, ...net } = networkWithNodes()
    expect(validateEdge(n1, 'missing', net)).toBe(false)
  })

  it('rejects cross-floor edge', () => {
    const { n1, n3, ...net } = networkWithNodes()
    expect(validateEdge(n1, n3, net)).toBe(false)
  })

  it('rejects duplicate edge', () => {
    const { n1, n2, ...net } = networkWithNodes()
    createRouteEdge(n1, n2, net)
    expect(validateEdge(n1, n2, net)).toBe(false)
    expect(validateEdge(n2, n1, net)).toBe(false)
  })

  it('accepts valid same-floor edge', () => {
    const { n1, n2, ...net } = networkWithNodes()
    expect(validateEdge(n1, n2, net)).toBe(true)
  })
})
