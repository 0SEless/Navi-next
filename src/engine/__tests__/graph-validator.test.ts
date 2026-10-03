import { describe, it, expect } from 'vitest'
import { validateGraph } from '../graph-validator'
import type { NavNode, NavEdge, Building } from '@/types/nav-types'

const building: Building = {
  id: 'BLD01', name: 'Admin', description: '',
  campusId: 'asu-ibajay', center: { lat: 11.8195, lng: 122.0922 },
  floors: [0, 1], footprint: [{ lat: 11.8195, lng: 122.0922 }], baseElevation: 0, height: 10,
}

const nodeA: NavNode = {
  id: 'N001', label: 'Entrance', name: 'Entrance', type: 'building_entrance',
  buildingId: 'BLD01', campusId: 'asu-ibajay', floor: 0,
  position: { lat: 11.8195, lng: 122.0922 },
}
const nodeB: NavNode = {
  id: 'N002', label: 'Hall', name: 'Hall', type: 'intersection',
  buildingId: 'BLD01', campusId: 'asu-ibajay', floor: 0,
  position: { lat: 11.8196, lng: 122.0923 },
}

const edge: NavEdge = {
  id: 'E001', from: 'N001', to: 'N002', type: 'walkway', distance: 15, weight: 15, campusId: 'asu-ibajay',
}

describe('validateGraph', () => {
  it('passes a valid graph', () => {
    const results = validateGraph([nodeA, nodeB], [edge], [building])
    for (const r of results) {
      expect(r.status).not.toBe('fail')
    }
  })

  it('detects missing node references in edges', () => {
    const badEdge: NavEdge = { ...edge, from: 'N999' }
    const results = validateGraph([nodeA, nodeB], [badEdge], [building])
    const refResult = results.find((r) => r.category === 'Edge References')
    expect(refResult?.status).toBe('fail')
  })

  it('detects disconnected nodes', () => {
    const isolated: NavNode = {
      ...nodeA, id: 'N003', name: 'Isolated',
    }
    const results = validateGraph([nodeA, nodeB, isolated], [edge], [building])
    const connResult = results.find((r) => r.category === 'Graph Connectivity')
    expect(connResult?.status).toBe('warn')
    expect(connResult?.affectedIds).toContain('N003')
  })

  it('detects out-of-bounds coordinates', () => {
    const badNode: NavNode = {
      ...nodeA, id: 'N099', position: { lat: 200, lng: 122.0922 },
    }
    const results = validateGraph([badNode], [], [building])
    const coordResult = results.find((r) => r.category === 'Coordinate Bounds')
    expect(coordResult?.status).toBe('fail')
  })

  it('detects zero-distance edges', () => {
    const zeroEdge: NavEdge = { ...edge, distance: 0 }
    const results = validateGraph([nodeA, nodeB], [zeroEdge], [building])
    const distResult = results.find((r) => r.category === 'Edge Distances')
    expect(distResult?.status).toBe('warn')
  })

  it('detects missing building entrances', () => {
    const noEntrance: NavNode = {
      ...nodeA, type: 'room', id: 'N003',
    }
    const results = validateGraph([noEntrance], [], [building])
    const entResult = results.find((r) => r.category === 'Building Entrances')
    expect(entResult?.status).toBe('warn')
  })

  it('detects duplicate IDs', () => {
    const results = validateGraph([nodeA, nodeA], [edge, edge], [building])
    const dupResult = results.find((r) => r.category === 'Duplicate IDs')
    expect(dupResult?.status).toBe('fail')
  })
})
