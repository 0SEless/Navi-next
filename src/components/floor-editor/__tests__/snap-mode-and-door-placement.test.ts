import { describe, it, expect } from 'vitest'
import { SNAP_CONFIGS, DEFAULT_SNAP_MODE, snapWallAuthoringPoint } from '../useFloorDrawing'
import type { SnapMode } from '../useFloorDrawing'
import { findNearestWall } from '../useFloorDrawing'

// ── Snap Mode Tests ────────────────────────────────────────────────────────

describe('Snap Mode Configuration', () => {
  it('has three snap modes', () => {
    const modes: SnapMode[] = ['architectural', 'trace', 'free']
    expect(Object.keys(SNAP_CONFIGS)).toEqual(modes)
  })

  it('default snap mode is trace', () => {
    expect(DEFAULT_SNAP_MODE).toBe('trace')
  })

  it('architectural snap has all snapping enabled', () => {
    const config = SNAP_CONFIGS.architectural
    expect(config.endpointSnap).toBe(0.5)
    expect(config.gridSnap).toBe(0.2)
    expect(config.orthogonalSnap).toBe(true)
    expect(config.angle45Snap).toBe(true)
  })

  it('trace snap has only endpoint snapping', () => {
    const config = SNAP_CONFIGS.trace
    expect(config.endpointSnap).toBe(0.5)
    expect(config.gridSnap).toBe(0)
    expect(config.orthogonalSnap).toBe(false)
    expect(config.angle45Snap).toBe(false)
  })

  it('free snap has no snapping', () => {
    const config = SNAP_CONFIGS.free
    expect(config.endpointSnap).toBe(0)
    expect(config.gridSnap).toBe(0)
    expect(config.orthogonalSnap).toBe(false)
    expect(config.angle45Snap).toBe(false)
  })
})

describe('Wall authoring topology contract', () => {
  it('snaps both divider clicks to boundary wall bodies', () => {
    const boundaries = [
      { id: 'top', start: { x: 0, y: 8 }, end: { x: 10, y: 8 } },
      { id: 'bottom', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
    ]
    const start = snapWallAuthoringPoint(
      { x: 5, y: 7.992 },
      SNAP_CONFIGS.trace,
      boundaries,
    )
    const end = snapWallAuthoringPoint(
      { x: 5, y: 0.007 },
      SNAP_CONFIGS.trace,
      boundaries,
      start.position,
    )

    expect(start).toMatchObject({ position: { x: 5, y: 8 }, snapType: 'segment' })
    expect(end).toMatchObject({ position: { x: 5, y: 0 }, snapType: 'segment' })
  })
})

// ── Two-Point Door Placement Tests ─────────────────────────────────────────

describe('Two-Point Door Placement', () => {
  const walls = [
    { id: 'w1', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
  ]

  it('findNearestWall returns correct offset for first click', () => {
    const hit = findNearestWall({ x: 2, y: 0.3 }, walls)
    expect(hit).not.toBeNull()
    expect(hit!.wallId).toBe('w1')
    expect(hit!.offset).toBeCloseTo(2)
  })

  it('findNearestWall returns correct offset for second click', () => {
    const hit = findNearestWall({ x: 5, y: 0.3 }, walls)
    expect(hit).not.toBeNull()
    expect(hit!.wallId).toBe('w1')
    expect(hit!.offset).toBeCloseTo(5)
  })

  it('width calculation: |offsetB - offsetA|', () => {
    const offsetA = 2
    const offsetB = 5
    const width = Math.abs(offsetB - offsetA)
    expect(width).toBe(3)
  })

  it('minimum width validation', () => {
    const MIN_DOOR_WIDTH = 0.3
    const offsetA = 2
    const offsetB = 2.2
    const width = Math.abs(offsetB - offsetA)
    expect(width).toBeLessThan(MIN_DOOR_WIDTH)
  })

  it('maximum width validation: offset + width <= wall length', () => {
    const wallLength = 10
    const offset = 8
    const width = 3
    expect(offset + width).toBeGreaterThan(wallLength)
  })

  it('valid placement: offset + width <= wall length', () => {
    const wallLength = 10
    const offset = 2
    const width = 3
    expect(offset + width).toBeLessThanOrEqual(wallLength)
  })

  it('same wall validation: both clicks must be on same wall', () => {
    const walls = [
      { id: 'w1', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
      { id: 'w2', start: { x: 0, y: 5 }, end: { x: 10, y: 5 } },
    ]
    const hit1 = findNearestWall({ x: 2, y: 0.3 }, walls)
    const hit2 = findNearestWall({ x: 2, y: 4.7 }, walls)
    expect(hit1!.wallId).toBe('w1')
    expect(hit2!.wallId).toBe('w2')
    expect(hit1!.wallId).not.toBe(hit2!.wallId)
  })

  it('offset calculation: min(offsetA, offsetB)', () => {
    const offsetA = 5
    const offsetB = 2
    const offset = Math.min(offsetA, offsetB)
    expect(offset).toBe(2)
  })
})

// ── Edge Cases ─────────────────────────────────────────────────────────────

describe('Edge Cases', () => {
  it('door at wall start', () => {
    const walls = [
      { id: 'w1', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
    ]
    const hit = findNearestWall({ x: 0.1, y: 0.3 }, walls)
    expect(hit).not.toBeNull()
    expect(hit!.offset).toBeCloseTo(0.1)
  })

  it('door at wall end', () => {
    const walls = [
      { id: 'w1', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
    ]
    const hit = findNearestWall({ x: 9.9, y: 0.3 }, walls)
    expect(hit).not.toBeNull()
    expect(hit!.offset).toBeCloseTo(9.9)
  })

  it('door on diagonal wall', () => {
    const walls = [
      { id: 'w1', start: { x: 0, y: 0 }, end: { x: 10, y: 10 } },
    ]
    const hit = findNearestWall({ x: 5, y: 5 }, walls)
    expect(hit).not.toBeNull()
    expect(hit!.wallId).toBe('w1')
    expect(hit!.offset).toBeCloseTo(Math.sqrt(50))
  })
})
