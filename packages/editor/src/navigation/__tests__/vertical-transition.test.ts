import { describe, it, expect } from 'vitest'
import type { RouteNetwork, Staircase, Elevator } from '@navi/core'
import { createFloorTransition, removeFloorTransition, validateFloorTransition } from '../vertical-transition'

function emptyNetwork(): RouteNetwork {
  return { nodes: [], edges: [] }
}

function makeStaircase(id: string, levels: Record<number, { position: { x: number; y: number }; rotation: number }>): Staircase {
  return {
    id,
    buildingId: 'building-1',
    name: `Staircase ${id}`,
    type: 'enclosed',
    accessible: true,
    fromLevel: Math.min(...Object.keys(levels).map(Number)),
    toLevel: Math.max(...Object.keys(levels).map(Number)),
    levels,
  }
}

function makeElevator(id: string, levels: Record<number, { position: { x: number; y: number }; rotation: number }>): Elevator {
  return {
    id,
    buildingId: 'building-1',
    name: `Elevator ${id}`,
    type: 'passenger',
    accessible: true,
    fromLevel: Math.min(...Object.keys(levels).map(Number)),
    toLevel: Math.max(...Object.keys(levels).map(Number)),
    levels,
  }
}

describe('createFloorTransition', () => {
  it('creates transition nodes and edge for a staircase', () => {
    const net = emptyNetwork()
    const stair = makeStaircase('stair-1', {
      0: { position: { x: 10, y: 20 }, rotation: 0 },
      1: { position: { x: 10, y: 20 }, rotation: 0 },
    })

    const result = createFloorTransition(stair, 0, 1, net)

    expect(result).not.toBeNull()
    expect(result!.node1.floor).toBe(0)
    expect(result!.node2.floor).toBe(1)
    expect(result!.edge.type).toBe('stairs')
    expect(net.nodes).toHaveLength(2)
    expect(net.edges).toHaveLength(1)
  })

  it('creates transition nodes and edge for an elevator', () => {
    const net = emptyNetwork()
    const elev = makeElevator('elev-1', {
      0: { position: { x: 5, y: 15 }, rotation: 0 },
      1: { position: { x: 5, y: 15 }, rotation: 0 },
    })

    const result = createFloorTransition(elev, 0, 1, net)

    expect(result).not.toBeNull()
    expect(result!.edge.type).toBe('elevator')
  })

  it('returns null when floor positions are missing', () => {
    const net = emptyNetwork()
    const stair = makeStaircase('stair-1', {
      0: { position: { x: 10, y: 20 }, rotation: 0 },
    })

    const result = createFloorTransition(stair, 0, 1, net)

    expect(result).toBeNull()
    expect(net.nodes).toHaveLength(0)
    expect(net.edges).toHaveLength(0)
  })

  it('creates nodes with correct positions', () => {
    const net = emptyNetwork()
    const stair = makeStaircase('stair-1', {
      0: { position: { x: 10, y: 20 }, rotation: 0 },
      1: { position: { x: 15, y: 25 }, rotation: 0 },
    })

    const result = createFloorTransition(stair, 0, 1, net)

    expect(result!.node1.position).toEqual({ x: 10, y: 20 })
    expect(result!.node2.position).toEqual({ x: 15, y: 25 })
  })

  it('calculates correct edge distance', () => {
    const net = emptyNetwork()
    const stair = makeStaircase('stair-1', {
      0: { position: { x: 0, y: 0 }, rotation: 0 },
      1: { position: { x: 3, y: 4 }, rotation: 0 },
    })

    const result = createFloorTransition(stair, 0, 1, net)

    expect(result!.edge.distance).toBe(5)
  })
})

describe('removeFloorTransition', () => {
  it('removes transition nodes and edges for a feature', () => {
    const net = emptyNetwork()
    const stair = makeStaircase('stair-1', {
      0: { position: { x: 10, y: 20 }, rotation: 0 },
      1: { position: { x: 10, y: 20 }, rotation: 0 },
    })

    createFloorTransition(stair, 0, 1, net)
    expect(net.nodes).toHaveLength(2)

    const removed = removeFloorTransition('stair-1', net)
    expect(removed).toBe(2)
    expect(net.nodes).toHaveLength(0)
    expect(net.edges).toHaveLength(0)
  })

  it('returns 0 when no transitions exist', () => {
    const net = emptyNetwork()
    const removed = removeFloorTransition('stair-1', net)
    expect(removed).toBe(0)
  })

  it('only removes nodes for the specified feature', () => {
    const net = emptyNetwork()
    const stair1 = makeStaircase('stair-1', {
      0: { position: { x: 10, y: 20 }, rotation: 0 },
      1: { position: { x: 10, y: 20 }, rotation: 0 },
    })
    const stair2 = makeStaircase('stair-2', {
      0: { position: { x: 30, y: 40 }, rotation: 0 },
      1: { position: { x: 30, y: 40 }, rotation: 0 },
    })

    createFloorTransition(stair1, 0, 1, net)
    createFloorTransition(stair2, 0, 1, net)
    expect(net.nodes).toHaveLength(4)

    const removed = removeFloorTransition('stair-1', net)
    expect(removed).toBe(2)
    expect(net.nodes).toHaveLength(2)
    expect(net.edges).toHaveLength(1)
  })
})

describe('validateFloorTransition', () => {
  it('returns true for a valid transition', () => {
    const net = emptyNetwork()
    const stair = makeStaircase('stair-1', {
      0: { position: { x: 10, y: 20 }, rotation: 0 },
      1: { position: { x: 10, y: 20 }, rotation: 0 },
    })

    createFloorTransition(stair, 0, 1, net)
    expect(validateFloorTransition(stair, net)).toBe(true)
  })

  it('returns false when transition nodes are missing', () => {
    const net = emptyNetwork()
    const stair = makeStaircase('stair-1', {
      0: { position: { x: 10, y: 20 }, rotation: 0 },
      1: { position: { x: 10, y: 20 }, rotation: 0 },
    })

    expect(validateFloorTransition(stair, net)).toBe(false)
  })

  it('returns false when edge type is wrong', () => {
    const net = emptyNetwork()
    const stair = makeStaircase('stair-1', {
      0: { position: { x: 10, y: 20 }, rotation: 0 },
      1: { position: { x: 10, y: 20 }, rotation: 0 },
    })

    const result = createFloorTransition(stair, 0, 1, net)
    if (result) {
      result.edge.type = 'walk'
    }

    expect(validateFloorTransition(stair, net)).toBe(false)
  })

  it('returns false when positions do not match', () => {
    const net = emptyNetwork()
    const stair = makeStaircase('stair-1', {
      0: { position: { x: 10, y: 20 }, rotation: 0 },
      1: { position: { x: 10, y: 20 }, rotation: 0 },
    })

    createFloorTransition(stair, 0, 1, net)

    const node = net.nodes.find((n) => n.floor === 0)
    if (node) {
      node.position = { x: 99, y: 99 }
    }

    expect(validateFloorTransition(stair, net)).toBe(false)
  })

  it('returns false when feature has only one floor', () => {
    const net = emptyNetwork()
    const stair = makeStaircase('stair-1', {
      0: { position: { x: 10, y: 20 }, rotation: 0 },
    })

    expect(validateFloorTransition(stair, net)).toBe(false)
  })
})
