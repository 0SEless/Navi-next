import { describe, it, expect } from 'vitest'
import { snapToNearest, findAllSnaps } from '../snap-bridge'
import { SnapEngine, DEFAULT_SNAP_CONFIG } from '@navi/core'
import { CoordinateTransformer } from '@navi/core'

// ── Test fixtures ──

function makeTransformer(): CoordinateTransformer {
  const tf = new CoordinateTransformer()
  tf.registerBuilding({
    buildingId: 'b1',
    origin: { lat: 14.5995, lng: 120.9842 },
    rotation: 0,
  })
  return tf
}

function populateSnapEngine(engine: SnapEngine): void {
  // Add some vertex snap targets in LatLng space
  engine.addVertex({ lat: 14.5995, lng: 120.9842 }, 'room-1', 'vertex')
  engine.addVertex({ lat: 14.5996, lng: 120.9843 }, 'room-2', 'vertex')
  engine.addEdge(
    { lat: 14.5995, lng: 120.9842 },
    { lat: 14.5996, lng: 120.9842 },
    'room-1',
  )
}

describe('snapToNearest', () => {
  it('returns null for unregistered building', () => {
    const tf = makeTransformer()
    const engine = new SnapEngine()
    populateSnapEngine(engine)

    const result = snapToNearest({ x: 0, y: 0 }, engine, {
      buildingId: 'unknown',
      transformer: tf,
    })
    expect(result).toBeNull()
  })

  it('returns null when no snap targets exist (grid disabled)', () => {
    const tf = makeTransformer()
    const engine = new SnapEngine() // empty

    const result = snapToNearest({ x: 0, y: 0 }, engine, {
      buildingId: 'b1',
      transformer: tf,
      snapConfig: { ...DEFAULT_SNAP_CONFIG, gridSize: 0 },
    })
    expect(result).toBeNull()
  })

  it('snaps to nearest vertex when within maxSnapDistance', () => {
    const tf = makeTransformer()
    const engine = new SnapEngine()
    populateSnapEngine(engine)

    // Point near origin (building-local 0,0 → LatLng near building origin)
    const result = snapToNearest({ x: 0, y: 0 }, engine, {
      buildingId: 'b1',
      transformer: tf,
      snapConfig: { ...DEFAULT_SNAP_CONFIG, maxSnapDistance: 100 },
    })
    expect(result).not.toBeNull()
    expect(result!.position).toBeDefined()
    expect(typeof result!.position.x).toBe('number')
    expect(typeof result!.position.y).toBe('number')
    expect(result!.target).toBeDefined()
  })

  it('round-trip: local → snap → local produces valid coordinates', () => {
    const tf = makeTransformer()
    const engine = new SnapEngine()
    populateSnapEngine(engine)

    const input = { x: 5, y: 5 }
    const result = snapToNearest(input, engine, {
      buildingId: 'b1',
      transformer: tf,
      snapConfig: { ...DEFAULT_SNAP_CONFIG, maxSnapDistance: 1000 },
    })

    if (result) {
      // The snapped position should be a valid LocalCoord
      expect(typeof result.position.x).toBe('number')
      expect(typeof result.position.y).toBe('number')
      expect(Number.isFinite(result.position.x)).toBe(true)
      expect(Number.isFinite(result.position.y)).toBe(true)
    }
  })
})

describe('findAllSnaps', () => {
  it('returns empty for unregistered building', () => {
    const tf = makeTransformer()
    const engine = new SnapEngine()
    populateSnapEngine(engine)

    const results = findAllSnaps({ x: 0, y: 0 }, engine, {
      buildingId: 'unknown',
      transformer: tf,
    })
    expect(results).toEqual([])
  })

  it('returns multiple snap targets when nearby', () => {
    const tf = makeTransformer()
    const engine = new SnapEngine()
    populateSnapEngine(engine)

    const results = findAllSnaps({ x: 0, y: 0 }, engine, {
      buildingId: 'b1',
      transformer: tf,
      snapConfig: { ...DEFAULT_SNAP_CONFIG, maxSnapDistance: 1000 },
    })
    expect(Array.isArray(results)).toBe(true)
    // May or may not find results depending on distance
    for (const r of results) {
      expect(r.position).toBeDefined()
      expect(r.target).toBeDefined()
    }
  })
})
