import { describe, it, expect } from 'vitest'
import { componentsToFloorGeometry } from './component-converter'
import type { Component } from '@/types/nav-types'
import type { PathProjection } from '@/lib/path-projection'

// ── Mock PathProjection ──

const mockProj: PathProjection = {
  project: (x, y) => [x, y], // identity for testing
  unproject: (lng, lat) => ({ x: lng, y: lat }), // identity for testing
  toLatLng: (x, y) => ({ lat: y, lng: x }),
}

// ── Test data ──

const roomComponent: Component = {
  id: 'r1',
  type: 'room',
  name: 'Room 101',
  buildingId: 'b1',
  floor: 0,
  position: { lat: 14.5, lng: 121.0 },
  polygon: [
    { lat: 14.5, lng: 121.0 },
    { lat: 14.5, lng: 121.01 },
    { lat: 14.51, lng: 121.01 },
    { lat: 14.51, lng: 121.0 },
  ],
}

const hallwayComponent: Component = {
  id: 'h1',
  type: 'hallway',
  name: 'Main Hall',
  buildingId: 'b1',
  floor: 0,
  position: { lat: 14.5, lng: 121.0 },
  polygon: [
    { lat: 14.5, lng: 121.0 },
    { lat: 14.5, lng: 121.02 },
  ],
}

const stairComponent: Component = {
  id: 's1',
  type: 'stair',
  name: 'Stair A',
  buildingId: 'b1',
  floor: 0,
  position: { lat: 14.505, lng: 121.005 },
}

const elevatorComponent: Component = {
  id: 'e1',
  type: 'elevator',
  name: 'Elevator 1',
  buildingId: 'b1',
  floor: 0,
  position: { lat: 14.506, lng: 121.006 },
}

// ── Tests ──

describe('componentsToFloorGeometry', () => {
  it('converts rooms with polygons', () => {
    const floor = componentsToFloorGeometry([roomComponent], 0, mockProj)
    expect(floor.rooms).toHaveLength(1)
    expect(floor.rooms[0].id).toBe('r1')
    expect(floor.rooms[0].polygon.points).toHaveLength(4)
  })

  it('converts hallways with polylines', () => {
    const floor = componentsToFloorGeometry([hallwayComponent], 0, mockProj)
    expect(floor.hallways).toHaveLength(1)
    expect(floor.hallways[0].id).toBe('h1')
    expect(floor.hallways[0].polyline.points).toHaveLength(2)
  })

  it('converts stairs as features', () => {
    const floor = componentsToFloorGeometry([stairComponent], 0, mockProj)
    expect(floor.staircases).toHaveLength(1)
    expect(floor.staircases[0].id).toBe('s1')
    expect(floor.staircases[0].position).toEqual({ x: 121.005, y: 14.505 })
  })

  it('converts elevators as features', () => {
    const floor = componentsToFloorGeometry([elevatorComponent], 0, mockProj)
    expect(floor.elevators).toHaveLength(1)
    expect(floor.elevators[0].id).toBe('e1')
  })

  it('handles mixed component types', () => {
    const floor = componentsToFloorGeometry(
      [roomComponent, hallwayComponent, stairComponent, elevatorComponent],
      1,
      mockProj,
    )
    expect(floor.rooms).toHaveLength(1)
    expect(floor.hallways).toHaveLength(1)
    expect(floor.staircases).toHaveLength(1)
    expect(floor.elevators).toHaveLength(1)
    expect(floor.level).toBe(1)
  })

  it('filters out components without polygons', () => {
    const noPolyRoom: Component = {
      ...roomComponent,
      id: 'r2',
      polygon: undefined,
    }
    const floor = componentsToFloorGeometry([noPolyRoom], 0, mockProj)
    expect(floor.rooms).toHaveLength(0)
  })

  it('handles empty component array', () => {
    const floor = componentsToFloorGeometry([], 0, mockProj)
    expect(floor.rooms).toHaveLength(0)
    expect(floor.hallways).toHaveLength(0)
    expect(floor.staircases).toHaveLength(0)
    expect(floor.elevators).toHaveLength(0)
  })
})
