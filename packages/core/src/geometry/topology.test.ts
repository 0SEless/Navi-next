import { describe, it, expect, beforeEach } from 'vitest'
import { TopologyEngine } from './topology'
import type { LocalPolygon } from '../types'

describe('TopologyEngine', () => {
  let topo: TopologyEngine

  beforeEach(() => {
    topo = new TopologyEngine()
  })

  it('detects adjacent rooms sharing a wall', () => {
    const roomA: LocalPolygon = {
      points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 0, y: 0 }],
    }
    const roomB: LocalPolygon = {
      points: [{ x: 10, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 0 }],
    }

    topo.addRoom('room-a', roomA, 'flr-1')
    topo.addRoom('room-b', roomB, 'flr-1')

    const adjacencies = topo.findAdjacentRooms(0.5)
    expect(adjacencies).toHaveLength(1)
    expect(adjacencies[0].roomAId).toBe('room-a')
    expect(adjacencies[0].roomBId).toBe('room-b')
  })

  it('does not report non-adjacent rooms', () => {
    const roomA: LocalPolygon = {
      points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 0, y: 0 }],
    }
    const roomB: LocalPolygon = {
      points: [{ x: 100, y: 0 }, { x: 110, y: 0 }, { x: 110, y: 10 }, { x: 100, y: 10 }, { x: 100, y: 0 }],
    }

    topo.addRoom('room-a', roomA, 'flr-1')
    topo.addRoom('room-b', roomB, 'flr-1')

    expect(topo.findAdjacentRooms(0.5)).toHaveLength(0)
  })

  it('reports floor connectivity via staircases', () => {
    topo.addStaircase('stair-a', { lat: 33.42, lng: -111.93 }, 0, 1, 'bld-1')
    const connections = topo.getFloorConnectivity('bld-1')
    expect(connections).toHaveLength(1)
    expect(connections[0].fromFloor).toBe(0)
    expect(connections[0].toFloor).toBe(1)
    expect(connections[0].via.type).toBe('staircase')
  })

  it('finds overlapping rooms on same floor', () => {
    const roomA: LocalPolygon = {
      points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 0, y: 0 }],
    }
    const roomB: LocalPolygon = {
      points: [{ x: 5, y: 5 }, { x: 15, y: 5 }, { x: 15, y: 15 }, { x: 5, y: 15 }, { x: 5, y: 5 }],
    }

    topo.addRoom('room-a', roomA, 'flr-1')
    topo.addRoom('room-b', roomB, 'flr-1')

    const overlaps = topo.findOverlappingRooms('flr-1')
    expect(overlaps).toHaveLength(1)
  })

  it('does not report rooms on different floors as overlapping', () => {
    const roomA: LocalPolygon = {
      points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 0, y: 0 }],
    }
    const roomB: LocalPolygon = {
      points: [{ x: 5, y: 5 }, { x: 15, y: 5 }, { x: 15, y: 15 }, { x: 5, y: 15 }, { x: 5, y: 5 }],
    }

    topo.addRoom('room-a', roomA, 'flr-1')
    topo.addRoom('room-b', roomB, 'flr-2')

    const overlaps = topo.findOverlappingRooms('flr-1')
    expect(overlaps).toHaveLength(0)
  })
})
