import { describe, it, expect } from 'vitest'
import { compileComponent } from '../component-compiler'
import type { Component, Building } from '@/types/nav-types'

describe('compileComponent polygon output', () => {
  const building: Building = {
    id: 'BLD01', name: 'Test', description: '',
    campusId: 'asu-ibajay', center: { lat: 11.8195, lng: 122.0922 },
    floors: [0, 1, 2], footprint: [{ lat: 11.8195, lng: 122.0922 }], baseElevation: 0, height: 10,
  }
  const buildings = new Map<string, Building>([['BLD01', building]])

  it('compileRoom returns polygon with 4 vertices', () => {
    const room: Component = {
      id: 'C001', type: 'room', name: 'Room 101',
      buildingId: 'BLD01', floor: 1,
      position: { lat: 11.8195, lng: 122.0922 },
      dimensions: { width: 6, height: 8 },
    }
    const result = compileComponent(room, {
      buildings,
      existingNodes: [],
      existingEdges: [],
      componentId: 'C001',
    })
    expect(result.polygon).toBeDefined()
    expect(result.polygon!.length).toBe(4)
    // Polygon should form a closed rectangle around the center
    const poly = result.polygon!
    expect(poly[0].lat).toBeLessThan(room.position.lat) // SW
    expect(poly[2].lat).toBeGreaterThan(room.position.lat) // NE
  })

  it('compileRoom outputs only a room_door node (no interior/corner nodes, no wall edges)', () => {
    const room: Component = {
      id: 'C002', type: 'room', name: 'Lab 1',
      buildingId: 'BLD01', floor: 1,
      position: { lat: 11.8195, lng: 122.0922 },
      dimensions: { width: 4, height: 5 },
    }
    const result = compileComponent(room, {
      buildings,
      existingNodes: [],
      existingEdges: [],
      componentId: 'C002',
    })
    // New routing model: room interior/corners/walls are NOT routing nodes.
    // Only the room door node is created (1 node, no edges without a hallway).
    expect(result.nodes.length).toBe(1)
    expect(result.nodes[0].type).toBe('room_door')
    expect(result.nodes.filter(n => n.type === 'room')).toHaveLength(0)
    expect(result.nodes.filter(n => n.type === 'corner')).toHaveLength(0)
    // No wall edges — walls are obstacles, not routing space
    const wallEdges = result.edges.filter(e => e.type === 'wall')
    expect(wallEdges).toHaveLength(0)
  })

  it('compileRoom connects room_door ONLY to hallway nodes (not entrances/outdoor)', () => {
    const room: Component = {
      id: 'C005', type: 'room', name: 'Room 204',
      buildingId: 'BLD01', floor: 1,
      position: { lat: 11.8196, lng: 122.0923 },
      dimensions: { width: 4, height: 5 },
    }
    const hallwayNode = {
      id: 'N001', label: 'Hallway', name: 'Hallway', type: 'hallway' as const,
      buildingId: 'BLD01', campusId: '', floor: 1,
      position: { lat: 11.8196, lng: 122.0922 },
    }
    const entranceNode = {
      id: 'N002', label: 'Entrance', name: 'Entrance', type: 'building_entrance' as const,
      buildingId: 'BLD01', campusId: '', floor: 1,
      position: { lat: 11.81955, lng: 122.09225 },
    }
    const result = compileComponent(room, {
      buildings,
      existingNodes: [hallwayNode, entranceNode],
      existingEdges: [],
      componentId: 'C005',
    })
    expect(result.nodes).toHaveLength(1)
    // Edge must connect to the hallway, never to the entrance
    expect(result.edges).toHaveLength(1)
    const e = result.edges[0]
    expect(e.to === hallwayNode.id || e.from === hallwayNode.id).toBe(true)
    expect(e.to === entranceNode.id || e.from === entranceNode.id).toBe(false)
  })

  it('compileEntrance creates only its architectural node without inferred links', () => {
    const entrance: Component = {
      id: 'C006', type: 'entrance', name: 'Main Entrance',
      buildingId: 'BLD01', floor: 1,
      position: { lat: 11.8196, lng: 122.0923 },
    }
    const result = compileComponent(entrance, {
      buildings,
      existingNodes: [
        {
          id: 'outdoor-1', label: 'Campus Walk', name: 'Campus Walk', type: 'outdoor',
          buildingId: '', campusId: '', floor: 0, position: { lat: 11.81961, lng: 122.09231 },
        },
        {
          id: 'hallway-1', label: 'Hallway', name: 'Hallway', type: 'hallway',
          buildingId: 'BLD01', campusId: '', floor: 1, position: { lat: 11.81961, lng: 122.09231 },
        },
      ],
      existingEdges: [],
      componentId: 'C006',
    })

    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0].type).toBe('building_entrance')
    expect(result.edges).toEqual([])
  })

  it('compileRestroom also returns polygon', () => {
    const restroom: Component = {
      id: 'C003', type: 'restroom', name: 'CR 1',
      buildingId: 'BLD01', floor: 1,
      position: { lat: 11.8195, lng: 122.0922 },
      dimensions: { width: 3, height: 3 },
    }
    const result = compileComponent(restroom, {
      buildings,
      existingNodes: [],
      existingEdges: [],
      componentId: 'C003',
    })
    expect(result.polygon).toBeDefined()
    expect(result.polygon!.length).toBe(4)
  })

  it('compileStair does not return polygon', () => {
    const stair: Component = {
      id: 'C004', type: 'stair', name: 'Stair A',
      buildingId: 'BLD01', floor: 0,
      position: { lat: 11.8195, lng: 122.0922 },
    }
    const result = compileComponent(stair, {
      buildings,
      existingNodes: [],
      existingEdges: [],
      componentId: 'C004',
    })
    expect(result.polygon).toBeUndefined()
  })
})
