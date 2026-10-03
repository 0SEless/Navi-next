import { describe, expect, it } from 'vitest'
import { findNavRoute } from '../findRoute'
import { getRouteSelectedEntrance } from '../public-navigation-context'
import type { NavEdge, NavNode } from '@/types/nav-types'

function makeNode(
  id: string,
  overrides: Partial<NavNode> = {},
): NavNode {
  return {
    id,
    label: id,
    position: { lat: 11.82, lng: 122.168 },
    floor: 0,
    buildingId: '',
    campusId: 'campus-a',
    type: 'walkway',
    ...overrides,
  }
}

function makeEdge(from: string, to: string, distance = 10, type: NavEdge['type'] = 'walkway'): NavEdge {
  return { id: `${from}-${to}`, from, to, distance, type }
}

describe('graph-authoritative entrance and floor routing contract', () => {
  it('routes outdoors through the named 1F entrance before the indoor destination', () => {
    const nodes = [
      makeNode('outdoor', { type: 'outdoor' }),
      makeNode('entrance-1f', { type: 'building_entrance', buildingId: 'b1', floor: 1 }),
      makeNode('room-1f', { type: 'room', buildingId: 'b1', floor: 1 }),
    ]
    const route = findNavRoute(nodes, [
      makeEdge('outdoor', 'entrance-1f'),
      makeEdge('entrance-1f', 'room-1f'),
    ], 'outdoor', 'room-1f')!

    expect(route.path).toEqual(['outdoor', 'entrance-1f', 'room-1f'])
    expect(route.steps.map((step) => step.floor)).toEqual([0, 1, 1])
    expect(getRouteSelectedEntrance(route, 'b1')?.nodeId).toBe('entrance-1f')
  })

  it('can enter a named 3F entrance directly without inventing a GF or 1F step', () => {
    const nodes = [
      makeNode('outdoor', { type: 'outdoor' }),
      makeNode('entrance-3f', { type: 'entrance', buildingId: 'b1', floor: 3, name: 'Library 3F Entrance' }),
      makeNode('room-3f', { type: 'room', buildingId: 'b1', floor: 3 }),
    ]
    const route = findNavRoute(nodes, [
      makeEdge('outdoor', 'entrance-3f'),
      makeEdge('entrance-3f', 'room-3f'),
    ], 'outdoor', 'room-3f')!

    expect(route.path).toEqual(['outdoor', 'entrance-3f', 'room-3f'])
    expect(route.steps.slice(1).every((step) => step.floor === 3)).toBe(true)
    expect(route.steps.slice(1).map((step) => step.floor)).not.toContain(1)
    expect(route.steps.slice(1).map((step) => step.floor)).not.toContain(0)
  })

  it('preserves a lower-floor entrance to stair/elevator transition before a higher-floor destination', () => {
    const nodes = [
      makeNode('outdoor', { type: 'outdoor' }),
      makeNode('entrance-1f', { type: 'entrance', buildingId: 'b1', floor: 1 }),
      makeNode('stairs-1f', { type: 'stair', buildingId: 'b1', floor: 1 }),
      makeNode('stairs-3f', { type: 'stair', buildingId: 'b1', floor: 3 }),
      makeNode('room-3f', { type: 'room', buildingId: 'b1', floor: 3 }),
    ]
    const route = findNavRoute(nodes, [
      makeEdge('outdoor', 'entrance-1f'),
      makeEdge('entrance-1f', 'stairs-1f'),
      makeEdge('stairs-1f', 'stairs-3f', 20, 'stair'),
      makeEdge('stairs-3f', 'room-3f'),
    ], 'outdoor', 'room-3f')!

    expect(route.path).toEqual(['outdoor', 'entrance-1f', 'stairs-1f', 'stairs-3f', 'room-3f'])
    expect(route.steps.map((step) => step.floor)).toEqual([0, 1, 1, 3, 3])
    expect(route.steps.map((step) => step.type)).toContain('stairs')
  })

  it('uses the graph-selected entrance rather than the first entrance in a building list', () => {
    const nodes = [
      makeNode('outdoor', { type: 'outdoor' }),
      makeNode('first-entrance', { type: 'entrance', buildingId: 'b1', floor: 1 }),
      makeNode('graph-entrance', { type: 'entrance', buildingId: 'b1', floor: 3 }),
      makeNode('room-3f', { type: 'room', buildingId: 'b1', floor: 3 }),
    ]
    const route = findNavRoute(nodes, [
      makeEdge('outdoor', 'first-entrance', 100),
      makeEdge('first-entrance', 'room-3f', 100),
      makeEdge('outdoor', 'graph-entrance', 10),
      makeEdge('graph-entrance', 'room-3f', 10),
    ], 'outdoor', 'room-3f')!

    expect(route.path).toContain('graph-entrance')
    expect(route.path).not.toContain('first-entrance')
    expect(getRouteSelectedEntrance(route, 'b1')?.nodeId).toBe('graph-entrance')
  })
})
