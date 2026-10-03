import { describe, it, expect } from 'vitest'
import { findConnectivityCandidates, EDITOR_SNAP_RADIUS_METERS } from '../road-connectivity'

const BASE = { lat: 11.8175, lng: 122.17 }
const mPerLat = 111320
const mPerLng = 111320 * Math.cos((BASE.lat * Math.PI) / 180)
const pt = (east: number, north: number) => ({ lat: BASE.lat + north / mPerLat, lng: BASE.lng + east / mPerLng })
const road = (id: string, points: { lat: number; lng: number }[]) => ({ id, name: id, polyline: { points } })

/**
 * Fix 1 invariant: connection discovery is a 0.5 m intent check.
 * No magnetic discovery of targets that are merely nearby.
 */
describe('road connection discovery radius (0.5 m)', () => {
  it('reports the central discovery radius as 0.5 m', () => {
    expect(EDITOR_SNAP_RADIUS_METERS).toBe(0.5)
  })

  it('finds a road segment when released exactly on it', () => {
    const target = road('road-h', [pt(-50, 0), pt(50, 0)])
    const result = findConnectivityCandidates(pt(10, 0), { roads: [target] })
    expect(result.best).not.toBeNull()
    expect(result.best?.kind).toBe('road-segment')
  })

  it('does not discover a segment 1.5 m away (no magnetic proximity)', () => {
    const target = road('road-h', [pt(-50, 0), pt(50, 0)])
    const result = findConnectivityCandidates(pt(10, 1.5), { roads: [target] })
    expect(result.best).toBeNull()
  })

  it('does not discover a segment 2.5 m away', () => {
    const target = road('road-h', [pt(-50, 0), pt(50, 0)])
    const result = findConnectivityCandidates(pt(10, 2.5), { roads: [target] })
    expect(result.best).toBeNull()
  })

  it('discovers an endpoint 0.4 m away as an intent candidate', () => {
    const target = road('road-e', [pt(10, 0), pt(60, 0)])
    const result = findConnectivityCandidates(pt(10, 0.4), { roads: [target] })
    expect(result.best).not.toBeNull()
    expect(result.best?.kind).toBe('road-endpoint')
  })

  it('does not discover an endpoint 0.9 m away', () => {
    const target = road('road-e', [pt(10, 0), pt(60, 0)])
    const result = findConnectivityCandidates(pt(10, 0.9), { roads: [target] })
    expect(result.best).toBeNull()
  })

  it('discovers an existing junction within 0.5 m', () => {
    const target = road('road-h', [pt(-50, 0), pt(50, 0)])
    const junction = { id: 'j-1', position: pt(10, 0), roadIds: ['road-h', 'road-z'], source: 'authored' as const }
    const result = findConnectivityCandidates(pt(10, 0.4), { roads: [target], junctions: [junction] })
    expect(result.best).not.toBeNull()
    expect(result.best?.kind).toBe('existing-junction')
  })

  it('does not discover an existing junction beyond 0.5 m', () => {
    const target = road('road-h', [pt(-50, 0), pt(50, 0)])
    const junction = { id: 'j-1', position: pt(10, 0), roadIds: ['road-h', 'road-z'], source: 'authored' as const }
    const result = findConnectivityCandidates(pt(10, 0.8), { roads: [target], junctions: [junction] })
    expect(result.candidates.filter((c) => c.kind === 'existing-junction')).toHaveLength(0)
  })
})
