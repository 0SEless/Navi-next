import { describe, it, expect } from 'vitest'
import { distanceMeters, resolveNearestNode } from '../location-resolver'
import type { NavNode, LatLng } from '@/types/nav-types'

const node = (id: string, lat: number, lng: number): NavNode => ({
  id,
  label: id,
  position: { lat, lng },
  floor: 0,
  buildingId: '',
  campusId: 'asu-ibajay',
  type: 'room',
})

describe('distanceMeters', () => {
  it('is ~0 for identical points', () => {
    expect(distanceMeters({ lat: 11.82, lng: 122.168 }, { lat: 11.82, lng: 122.168 })).toBeLessThan(1)
  })

  it('approximates 111m per degree of latitude', () => {
    const d = distanceMeters({ lat: 11.82, lng: 122.168 }, { lat: 11.821, lng: 122.168 })
    expect(d).toBeGreaterThan(100)
    expect(d).toBeLessThan(125)
  })
})

describe('resolveNearestNode', () => {
  const nodes = [
    node('north', 11.822, 122.168),
    node('south', 11.818, 122.168),
  ]

  it('finds the nearest node', () => {
    const result = resolveNearestNode(nodes, { lat: 11.8215, lng: 122.168 })
    expect(result?.node.id).toBe('north')
    expect(result!.distanceMeters).toBeLessThan(100)
  })

  it('returns null for empty graph', () => {
    expect(resolveNearestNode([], { lat: 11.82, lng: 122.168 })).toBeNull()
  })

  it('returns null beyond maxDistance (GPS garbage)', () => {
    expect(resolveNearestNode(nodes, { lat: 20, lng: 100 })).toBeNull()
  })
})
