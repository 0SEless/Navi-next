import { describe, it, expect } from 'vitest'
import { GpsResolver } from '../gps-resolver'
import { PositionEngine } from '../position-engine'
import type { NavNode } from '@navi/core'

const nodes: NavNode[] = [
  { id: 'n1', label: 'Entrance', type: 'transition', position: { lng: 121.0, lat: 14.0 }, floor: 1, buildingId: 'b1', properties: {} },
  { id: 'n2', label: 'Hallway', type: 'corridor', position: { lng: 121.0005, lat: 14.0 }, floor: 1, buildingId: 'b1', properties: {} },
  { id: 'n3', label: 'Room 201', type: 'space', position: { lng: 121.001, lat: 14.001 }, floor: 2, buildingId: 'b1', properties: {} },
]

describe('GpsResolver', () => {
  it('snaps to nearest node', () => {
    const resolver = new GpsResolver(nodes)
    const result = resolver.snap({ lng: 121.0, lat: 14.0 })
    expect(result?.node.id).toBe('n1')
  })

  it('filters by floor', () => {
    const resolver = new GpsResolver(nodes)
    const result = resolver.snap({ lng: 121.001, lat: 14.001 }, 2)
    expect(result?.node.id).toBe('n3')
  })
})

describe('PositionEngine', () => {
  it('updates and returns current position', () => {
    const engine = new PositionEngine(nodes)
    engine.updateGps({ lng: 121.0, lat: 14.0 })
    const pos = engine.getCurrentPosition()
    expect(pos).not.toBeNull()
    expect(pos!.nodeId).toBe('n1')
  })

  it('returns floor from snapped position', () => {
    const engine = new PositionEngine(nodes)
    engine.updateGps({ lng: 121.0, lat: 14.0 })
    expect(engine.getCurrentFloor()).toBe(1)
  })
})
