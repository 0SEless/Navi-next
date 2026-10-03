import type { NavEdge, NavNode, NavigationGraph } from '@navi/core'
import { describe, expect, it, vi } from 'vitest'
import { AStar } from '../astar'

function node(id: string): NavNode {
  return {
    id,
    label: id,
    type: 'outdoor',
    position: { lat: 14.6, lng: 121 },
    floor: 0,
    buildingId: '',
    properties: {},
  }
}

function edge(id: string, from: string, to: string, weight: number): NavEdge {
  return { id, from, to, type: 'walk', distance: weight, weight }
}

function graph(): NavigationGraph {
  return {
    version: '1',
    campusId: 'campus',
    createdAt: '2026-09-11T00:00:00.000Z',
    checksum: 'test',
    nodes: [node('a'), node('b'), node('c')],
    edges: [
      edge('a-b', 'a', 'b', 1),
      edge('b-c', 'b', 'c', 1),
      edge('a-c', 'a', 'c', 5),
    ],
    metadata: {
      nodeCount: 3,
      edgeCount: 3,
      buildings: 0,
      floors: 0,
      boundingBox: { minLng: 121, maxLng: 121, minLat: 14.6, maxLat: 14.6 },
    },
  }
}

describe('AStar traversal policy injection', () => {
  it('preserves existing edge.weight behavior by default', () => {
    expect(new AStar(graph()).findPath('a', 'c')).toEqual({
      path: ['a', 'b', 'c'],
      edgeIds: ['a-b', 'b-c'],
      cost: 2,
      distance: 2,
    })
  })

  it('uses an injected traversal cost without knowing policy semantics', () => {
    const result = new AStar(graph(), {
      traversalCost: (candidate) => candidate.id === 'a-c' ? 1 : candidate.weight,
    }).findPath('a', 'c')

    expect(result).toEqual({ path: ['a', 'c'], edgeIds: ['a-c'], cost: 1, distance: 1 })
  })

  it('skips traversals rejected by injected eligibility', () => {
    const result = new AStar(graph(), {
      traversalEligibility: (candidate) => candidate.id !== 'a-c',
    }).findPath('a', 'c')

    expect(result).toEqual({
      path: ['a', 'b', 'c'],
      edgeIds: ['a-b', 'b-c'],
      cost: 2,
      distance: 2,
    })
  })

  it('passes the actual current traversal node to both providers', () => {
    const traversalCost = vi.fn((candidate: NavEdge) => candidate.weight)
    const traversalEligibility = vi.fn(() => true)
    const result = new AStar(graph(), {
      traversalCost,
      traversalEligibility,
    }).findPath('c', 'a')

    expect(result?.path).toEqual(['c', 'b', 'a'])
    expect(traversalCost).toHaveBeenCalledWith(expect.objectContaining({ id: 'b-c' }), 'c')
    expect(traversalEligibility).toHaveBeenCalledWith(expect.objectContaining({ id: 'b-c' }), 'c')
  })

  it('uses a zero heuristic by default for arbitrary injected costs', () => {
    const adversarial = graph()
    adversarial.nodes = [
      { ...node('a'), position: { lat: 0, lng: 0 } },
      { ...node('b'), position: { lat: 10, lng: 10 } },
      { ...node('c'), position: { lat: 0, lng: 0.001 } },
    ]

    const result = new AStar(adversarial, {
      traversalCost: (candidate) => candidate.id === 'a-c' ? 5 : 1,
    }).findPath('a', 'c')

    expect(result).toEqual({
      path: ['a', 'b', 'c'],
      edgeIds: ['a-b', 'b-c'],
      cost: 2,
      distance: 2,
    })
  })
})
