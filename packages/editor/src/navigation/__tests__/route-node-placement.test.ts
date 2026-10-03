import { describe, it, expect } from 'vitest'
import type { RouteNetwork } from '@navi/core'
import { placeRouteNode, removeRouteNode, findNearestNode } from '../route-node-placement'

function emptyNetwork(): RouteNetwork {
  return { nodes: [], edges: [] }
}

describe('placeRouteNode', () => {
  it('adds a node with generated id', () => {
    const net = emptyNetwork()
    const node = placeRouteNode({ x: 1, y: 2 }, 0, net)
    expect(net.nodes).toHaveLength(1)
    expect(net.nodes[0].id).toBe(node.id)
    expect(node.position).toEqual({ x: 1, y: 2 })
    expect(node.floor).toBe(0)
    expect(node.type).toBe('waypoint')
  })

  it('uses specified type', () => {
    const net = emptyNetwork()
    const node = placeRouteNode({ x: 0, y: 0 }, 1, net, 'entrance')
    expect(node.type).toBe('entrance')
  })

  it('does not mutate the position object passed in', () => {
    const net = emptyNetwork()
    const pos = { x: 5, y: 5 }
    placeRouteNode(pos, 0, net)
    pos.x = 99
    expect(net.nodes[0].position.x).toBe(5)
  })
})

describe('removeRouteNode', () => {
  it('removes the node and its incident edges', () => {
    const net = emptyNetwork()
    const n1 = placeRouteNode({ x: 0, y: 0 }, 0, net)
    const n2 = placeRouteNode({ x: 1, y: 0 }, 0, net)
    net.edges.push({ id: 'e1', from: n1.id, to: n2.id, type: 'walk', distance: 1 })

    const removed = removeRouteNode(n1.id, net)
    expect(removed).toBe(true)
    expect(net.nodes).toHaveLength(1)
    expect(net.edges).toHaveLength(0)
  })

  it('returns false for unknown id', () => {
    const net = emptyNetwork()
    expect(removeRouteNode('nope', net)).toBe(false)
  })
})

describe('findNearestNode', () => {
  it('finds the closest node', () => {
    const net = emptyNetwork()
    placeRouteNode({ x: 0, y: 0 }, 0, net)
    placeRouteNode({ x: 10, y: 0 }, 0, net)

    const found = findNearestNode({ x: 2, y: 0 }, net)
    expect(found).not.toBeNull()
    expect(found!.position.x).toBe(0)
  })

  it('returns null when no nodes exist', () => {
    const net = emptyNetwork()
    expect(findNearestNode({ x: 0, y: 0 }, net)).toBeNull()
  })

  it('respects threshold', () => {
    const net = emptyNetwork()
    placeRouteNode({ x: 10, y: 0 }, 0, net)

    expect(findNearestNode({ x: 0, y: 0 }, net, 5)).toBeNull()
    expect(findNearestNode({ x: 0, y: 0 }, net, 11)).not.toBeNull()
  })
})
