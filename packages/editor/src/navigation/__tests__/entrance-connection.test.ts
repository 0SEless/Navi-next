import { describe, it, expect, vi } from 'vitest'
import type { Entrance, Road } from '@navi/core'
import {
  connectEntranceToRoad,
  validateEntranceConnection,
  disconnectEntrance,
} from '../entrance-connection'

function makeEntrance(id: string, x: number, y: number, level = 0): Entrance {
  return {
    id,
    label: `Entrance ${id}`,
    position: { x, y },
    level,
    type: 'main',
    hasQR: false,
    hasPanorama: false,
  }
}

function makeRoad(id: string, points: Array<{ lat: number; lng: number }>): Road {
  return {
    id,
    name: `Road ${id}`,
    polyline: { points },
    width: 5,
    surface: 'paved',
    type: 'arterial',
    metadata: {},
  }
}

function mockTransformer(lookup: Record<string, { lat: number; lng: number }>) {
  return {
    buildingLocalToWorld: vi.fn().mockImplementation((_local: { x: number; y: number }, buildingId: string) => {
      return lookup[buildingId] ?? null
    }),
  } as any
}

describe('connectEntranceToRoad', () => {
  it('connects to nearest road within max distance', () => {
    const road1 = makeRoad('road-1', [
      { lat: 33.4205, lng: -111.9295 },
      { lat: 33.4215, lng: -111.9295 },
    ])
    const road2 = makeRoad('road-2', [
      { lat: 33.4300, lng: -111.9300 },
      { lat: 33.4310, lng: -111.9300 },
    ])
    const entrance = makeEntrance('ent-1', 5, 5)
    const tf = mockTransformer({ 'bld-1': { lat: 33.4205, lng: -111.9295 } })

    const result = connectEntranceToRoad(entrance, [road1, road2], tf, 'bld-1')

    expect(result.connected).toBe(true)
    expect(result.roadId).toBe('road-1')
    expect(result.distance).toBeLessThan(200)
    expect(entrance.connectorRoadId).toBe('road-1')
    expect(road1.connectorEntranceId).toBe('ent-1')
  })

  it('returns disconnected when no road within max distance', () => {
    const road = makeRoad('road-1', [
      { lat: 34.0000, lng: -112.0000 },
      { lat: 34.0010, lng: -112.0000 },
    ])
    const entrance = makeEntrance('ent-1', 5, 5)
    const tf = mockTransformer({ 'bld-1': { lat: 33.4205, lng: -111.9295 } })

    const result = connectEntranceToRoad(entrance, [road], tf, 'bld-1')

    expect(result.connected).toBe(false)
    expect(result.error).toContain('No road')
    expect(entrance.connectorRoadId).toBeUndefined()
  })

  it('returns error when transformer fails', () => {
    const road = makeRoad('road-1', [
      { lat: 33.4205, lng: -111.9295 },
      { lat: 33.4215, lng: -111.9295 },
    ])
    const entrance = makeEntrance('ent-1', 5, 5)
    const tf = mockTransformer({})

    const result = connectEntranceToRoad(entrance, [road], tf, 'bld-1')

    expect(result.connected).toBe(false)
    expect(result.error).toContain('transform')
  })

  it('skips roads with insufficient polyline points', () => {
    const roadShort = makeRoad('road-short', [{ lat: 33.4205, lng: -111.9295 }])
    const roadGood = makeRoad('road-good', [
      { lat: 33.4205, lng: -111.9295 },
      { lat: 33.4215, lng: -111.9295 },
    ])
    const entrance = makeEntrance('ent-1', 5, 5)
    const tf = mockTransformer({ 'bld-1': { lat: 33.4205, lng: -111.9295 } })

    const result = connectEntranceToRoad(entrance, [roadShort, roadGood], tf, 'bld-1')

    expect(result.connected).toBe(true)
    expect(result.roadId).toBe('road-good')
  })

  it('finds nearest point on multi-segment road', () => {
    const road = makeRoad('road-1', [
      { lat: 33.4200, lng: -111.9290 },
      { lat: 33.4205, lng: -111.9295 },
      { lat: 33.4210, lng: -111.9300 },
    ])
    const entrance = makeEntrance('ent-1', 5, 5)
    const tf = mockTransformer({ 'bld-1': { lat: 33.4205, lng: -111.9295 } })

    const result = connectEntranceToRoad(entrance, [road], tf, 'bld-1')

    expect(result.connected).toBe(true)
    expect(result.roadId).toBe('road-1')
  })

  it('respects custom max distance', () => {
    const road = makeRoad('road-1', [
      { lat: 33.4300, lng: -111.9300 },
      { lat: 33.4310, lng: -111.9300 },
    ])
    const entrance = makeEntrance('ent-1', 5, 5)
    const tf = mockTransformer({ 'bld-1': { lat: 33.4205, lng: -111.9295 } })

    const result = connectEntranceToRoad(entrance, [road], tf, 'bld-1', 1)

    expect(result.connected).toBe(false)
    expect(result.error).toContain('No road')
  })

  it('handles empty road network', () => {
    const entrance = makeEntrance('ent-1', 5, 5)
    const tf = mockTransformer({ 'bld-1': { lat: 33.4205, lng: -111.9295 } })

    const result = connectEntranceToRoad(entrance, [], tf, 'bld-1')

    expect(result.connected).toBe(false)
  })
})

describe('validateEntranceConnection', () => {
  it('returns valid for a proper connection', () => {
    const road = makeRoad('road-1', [
      { lat: 33.4205, lng: -111.9295 },
      { lat: 33.4215, lng: -111.9295 },
    ])
    road.connectorEntranceId = 'ent-1'
    const entrance = makeEntrance('ent-1', 5, 5)
    entrance.connectorRoadId = 'road-1'
    const tf = mockTransformer({ 'bld-1': { lat: 33.4205, lng: -111.9295 } })

    const result = validateEntranceConnection(entrance, [road], tf, 'bld-1')

    expect(result.valid).toBe(true)
  })

  it('returns invalid when entrance has no connectorRoadId', () => {
    const road = makeRoad('road-1', [
      { lat: 33.4205, lng: -111.9295 },
      { lat: 33.4215, lng: -111.9295 },
    ])
    const entrance = makeEntrance('ent-1', 5, 5)
    const tf = mockTransformer({ 'bld-1': { lat: 33.4205, lng: -111.9295 } })

    const result = validateEntranceConnection(entrance, [road], tf, 'bld-1')

    expect(result.valid).toBe(false)
    expect(result.error).toContain('no road connection')
  })

  it('returns invalid when connected road not in network', () => {
    const entrance = makeEntrance('ent-1', 5, 5)
    entrance.connectorRoadId = 'road-missing'
    const tf = mockTransformer({ 'bld-1': { lat: 33.4205, lng: -111.9295 } })

    const result = validateEntranceConnection(entrance, [], tf, 'bld-1')

    expect(result.valid).toBe(false)
    expect(result.error).toContain('not found')
  })

  it('returns invalid when road does not reference back', () => {
    const road = makeRoad('road-1', [
      { lat: 33.4205, lng: -111.9295 },
      { lat: 33.4215, lng: -111.9295 },
    ])
    const entrance = makeEntrance('ent-1', 5, 5)
    entrance.connectorRoadId = 'road-1'
    const tf = mockTransformer({ 'bld-1': { lat: 33.4205, lng: -111.9295 } })

    const result = validateEntranceConnection(entrance, [road], tf, 'bld-1')

    expect(result.valid).toBe(false)
    expect(result.error).toContain('connectorEntranceId')
  })

  it('returns invalid when entrance too far from road', () => {
    const road = makeRoad('road-1', [
      { lat: 34.0000, lng: -112.0000 },
      { lat: 34.0010, lng: -112.0000 },
    ])
    road.connectorEntranceId = 'ent-1'
    const entrance = makeEntrance('ent-1', 5, 5)
    entrance.connectorRoadId = 'road-1'
    const tf = mockTransformer({ 'bld-1': { lat: 33.4205, lng: -111.9295 } })

    const result = validateEntranceConnection(entrance, [road], tf, 'bld-1')

    expect(result.valid).toBe(false)
    expect(result.error).toContain('from connected road')
  })

  it('returns invalid when transformer fails', () => {
    const road = makeRoad('road-1', [
      { lat: 33.4205, lng: -111.9295 },
      { lat: 33.4215, lng: -111.9295 },
    ])
    road.connectorEntranceId = 'ent-1'
    const entrance = makeEntrance('ent-1', 5, 5)
    entrance.connectorRoadId = 'road-1'
    const tf = mockTransformer({})

    const result = validateEntranceConnection(entrance, [road], tf, 'bld-1')

    expect(result.valid).toBe(false)
    expect(result.error).toContain('transform')
  })
})

describe('disconnectEntrance', () => {
  it('removes connection from both entrance and road', () => {
    const road = makeRoad('road-1', [
      { lat: 33.4205, lng: -111.9295 },
      { lat: 33.4215, lng: -111.9295 },
    ])
    road.connectorEntranceId = 'ent-1'
    const entrance = makeEntrance('ent-1', 5, 5)
    entrance.connectorRoadId = 'road-1'

    disconnectEntrance(entrance, [road])

    expect(entrance.connectorRoadId).toBeUndefined()
    expect(road.connectorEntranceId).toBeUndefined()
  })

  it('does nothing when entrance has no connection', () => {
    const road = makeRoad('road-1', [
      { lat: 33.4205, lng: -111.9295 },
      { lat: 33.4215, lng: -111.9295 },
    ])
    const entrance = makeEntrance('ent-1', 5, 5)

    disconnectEntrance(entrance, [road])

    expect(entrance.connectorRoadId).toBeUndefined()
    expect(road.connectorEntranceId).toBeUndefined()
  })

  it('only clears road if it references this entrance', () => {
    const road = makeRoad('road-1', [
      { lat: 33.4205, lng: -111.9295 },
      { lat: 33.4215, lng: -111.9295 },
    ])
    road.connectorEntranceId = 'ent-other'
    const entrance = makeEntrance('ent-1', 5, 5)
    entrance.connectorRoadId = 'road-1'

    disconnectEntrance(entrance, [road])

    expect(entrance.connectorRoadId).toBeUndefined()
    expect(road.connectorEntranceId).toBe('ent-other')
  })

  it('handles missing road gracefully', () => {
    const entrance = makeEntrance('ent-1', 5, 5)
    entrance.connectorRoadId = 'road-missing'

    disconnectEntrance(entrance, [])

    expect(entrance.connectorRoadId).toBeUndefined()
  })
})
