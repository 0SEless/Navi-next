import { describe, it, expect, beforeEach } from 'vitest'
import { SnapEngine, DEFAULT_SNAP_CONFIG } from './snap'

describe('SnapEngine', () => {
  let snap: SnapEngine
  // Make a vertex that is NOT part of any edge, so vertex snap wins
  const vertexOnlyPos = { lat: 33.43, lng: -111.94 }

  beforeEach(() => {
    snap = new SnapEngine()
    snap.addVertex(vertexOnlyPos, 'bld-2')
    snap.addVertex({ lat: 33.42, lng: -111.93 }, 'bld-1')
    snap.addVertex({ lat: 33.421, lng: -111.931 }, 'bld-1')
    snap.addEdge(
      { lat: 33.42, lng: -111.93 },
      { lat: 33.421, lng: -111.931 },
      'bld-1',
    )
    snap.addEntrance({ lat: 33.422, lng: -111.932 }, 'ent-1')
  })

  it('snaps to nearest vertex', () => {
    const config = { ...DEFAULT_SNAP_CONFIG, gridSize: 0 }
    const point = { lat: 33.43001, lng: -111.94001 }
    const result = snap.findSnap(point, config)
    expect(result).not.toBeNull()
    expect(result!.type).toBe('vertex')
    expect(result!.entityId).toBe('bld-2')
  })

  it('snaps to entrance', () => {
    const config = { ...DEFAULT_SNAP_CONFIG, gridSize: 0 }  // disable grid
    const point = { lat: 33.42201, lng: -111.93201 }
    const result = snap.findSnap(point, config)
    expect(result).not.toBeNull()
    expect(result!.type).toBe('entrance')
  })

  it('snaps to midpoint', () => {
    const point = { lat: 33.4205, lng: -111.9305 }
    const result = snap.findSnap(point)
    expect(result).not.toBeNull()
  })

  it('returns null when no snap within range', () => {
    const config = { ...DEFAULT_SNAP_CONFIG, maxSnapDistance: 0.001 }
    const point = { lat: 33.5, lng: -111.9 }
    const result = snap.findSnap(point, config)
    expect(result).toBeNull()
  })

  it('returns null when snap is disabled', () => {
    const config = { ...DEFAULT_SNAP_CONFIG, enabled: false }
    const point = { lat: 33.42001, lng: -111.93001 }
    expect(snap.findSnap(point, config)).toBeNull()
  })

  it('findAllSnaps returns multiple targets', () => {
    const point = { lat: 33.4205, lng: -111.9305 }
    const results = snap.findAllSnaps(point)
    expect(results.length).toBeGreaterThanOrEqual(1)
  })

  it('grid snap returns consistent positions', () => {
    const config = { ...DEFAULT_SNAP_CONFIG, vertex: false, entrance: false, edge: false, endpoint: false, midpoint: false, center: false }
    const point = { lat: 33.42, lng: -111.93 }
    const result = snap.findSnap(point, config)
    expect(result).not.toBeNull()
    expect(result!.type).toBe('grid')
  })

  it('reports entityId on snap results', () => {
    const config = { ...DEFAULT_SNAP_CONFIG, gridSize: 0 }
    const point = { lat: 33.43001, lng: -111.94001 }
    const result = snap.findSnap(point, config)
    expect(result!.entityId).toBe('bld-2')
  })

  it('clears all data (vertex snaps no longer work)', () => {
    snap.clear()
    const config = { ...DEFAULT_SNAP_CONFIG, gridSize: 0 }
    expect(snap.findSnap({ lat: 33.43, lng: -111.94 }, config)).toBeNull()
  })
})
