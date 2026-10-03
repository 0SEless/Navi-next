import { describe, it, expect } from 'vitest'
import { aStar, haversine, getAdjacencyList } from '../a-star'
import type { NavNode, NavEdge } from '@/types/nav-types'

const origin: NavNode = {
  id: 'N001', label: 'Origin', name: 'Origin', type: 'building_entrance',
  buildingId: 'BLD01', campusId: 'asu-ibajay', floor: 0, position: { lat: 11.8195, lng: 122.0922 },
}
const mid1: NavNode = {
  id: 'N002', label: 'Mid 1', name: 'Mid 1', type: 'intersection',
  buildingId: 'BLD01', campusId: 'asu-ibajay', floor: 0, position: { lat: 11.8196, lng: 122.0923 },
}
const mid2: NavNode = {
  id: 'N003', label: 'Mid 2', name: 'Mid 2', type: 'intersection',
  buildingId: 'BLD01', campusId: 'asu-ibajay', floor: 0, position: { lat: 11.8197, lng: 122.0924 },
}
const dest: NavNode = {
  id: 'N004', label: 'Destination', name: 'Destination', type: 'building_entrance',
  buildingId: 'BLD01', campusId: 'asu-ibajay', floor: 0, position: { lat: 11.8198, lng: 122.0925 },
}

const nodes = [origin, mid1, mid2, dest]

const edges: NavEdge[] = [
  { id: 'E001', from: 'N001', to: 'N002', type: 'walkway', distance: 15, weight: 15, campusId: 'asu-ibajay' },
  { id: 'E002', from: 'N002', to: 'N003', type: 'walkway', distance: 20, weight: 20, campusId: 'asu-ibajay' },
  { id: 'E003', from: 'N003', to: 'N004', type: 'walkway', distance: 15, weight: 15, campusId: 'asu-ibajay' },
]

describe('haversine', () => {
  it('returns 0 for identical points', () => {
    expect(haversine(origin.position, origin.position)).toBe(0)
  })

  it('returns positive distance for different points', () => {
    const d = haversine(origin.position, dest.position)
    expect(d).toBeGreaterThan(0)
    expect(d).toBeLessThan(100)
  })
})

describe('aStar', () => {
  it('finds a path between connected nodes', () => {
    const result = aStar(nodes, edges, 'N001', 'N004')
    expect(result).not.toBeNull()
    expect(result!.path).toEqual(['N001', 'N002', 'N003', 'N004'])
    expect(result!.cost).toBeGreaterThan(0)
  })

  it('returns path with steps', () => {
    const result = aStar(nodes, edges, 'N001', 'N004')
    expect(result!.steps.length).toBe(4)
    expect(result!.steps[0].instruction).toBe('Start here (GF)')
    expect(result!.steps[3].instruction).toBe('Destination reached \u2014 Destination (GF)')
  })

  it('returns null when start node does not exist', () => {
    expect(aStar(nodes, edges, 'N999', 'N004')).toBeNull()
  })

  it('returns null when no path exists', () => {
    const isolated: NavEdge[] = [
      { id: 'E001', from: 'N001', to: 'N002', type: 'walkway', distance: 15, weight: 15, campusId: 'asu-ibajay' },
    ]
    expect(aStar(nodes, isolated, 'N001', 'N004')).toBeNull()
  })

  it('finds direct path between adjacent nodes', () => {
    const result = aStar(nodes, edges, 'N001', 'N002')
    expect(result).not.toBeNull()
    expect(result!.path).toEqual(['N001', 'N002'])
  })

  it('returns path with cost 0 when start equals end', () => {
    const result = aStar(nodes, edges, 'N001', 'N001')
    expect(result).not.toBeNull()
    expect(result!.path).toEqual(['N001'])
    expect(result!.cost).toBe(0)
  })

  it('returns null when end node does not exist', () => {
    expect(aStar(nodes, edges, 'N001', 'N999')).toBeNull()
  })

  it('returns null with empty nodes array', () => {
    expect(aStar([], edges, 'N001', 'N004')).toBeNull()
  })

  it('returns null with empty edges array', () => {
    expect(aStar(nodes, [], 'N001', 'N004')).toBeNull()
  })

  it('returns null when graph is disconnected (nodes exist but no edges connect them)', () => {
    const disconnectedNodes = [
      { ...origin },
      { ...dest, id: 'N004' },
    ]
    expect(aStar(disconnectedNodes, [], 'N001', 'N004')).toBeNull()
  })

  it('returns smallest cost when multiple paths exist', () => {
    const multiPathEdges: NavEdge[] = [
      ...edges,
      { id: 'E004', from: 'N001', to: 'N003', type: 'walkway', distance: 10, weight: 10, campusId: 'asu-ibajay' },
    ]
    const result = aStar(nodes, multiPathEdges, 'N001', 'N004')
    expect(result).not.toBeNull()
    expect(result!.cost).toBe(25) // N001->N003(10) + N003->N004(15)
    expect(result!.path).toEqual(['N001', 'N003', 'N004'])
  })

  it('finds path with bidirectional edges', () => {
    const result = aStar(nodes, edges, 'N004', 'N001')
    expect(result).not.toBeNull()
    expect(result!.path).toEqual(['N004', 'N003', 'N002', 'N001'])
  })
})

describe('getAdjacencyList', () => {
  it('builds adjacency list from edges', () => {
    const adj = getAdjacencyList(edges)
    expect(adj['N001']).toContainEqual({ nodeId: 'N002', weight: 15 })
    expect(adj['N002']).toContainEqual({ nodeId: 'N001', weight: 15 })
    expect(adj['N002']).toContainEqual({ nodeId: 'N003', weight: 20 })
  })
})
