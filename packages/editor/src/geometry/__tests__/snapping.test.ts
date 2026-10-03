import { describe, it, expect } from 'vitest'
import { snapPoint } from '../snapping'
import type { Point2D, SnapConfig } from '../snapping'

const defaultConfig: SnapConfig = {
  gridSize: 1,
  endpointSnap: 0.5,
  gridSnap: 0.2,
  orthogonalSnap: true,
  angle45Snap: true,
}

describe('snapPoint - endpoint snapping', () => {
  it('snaps to nearest existing point within threshold', () => {
    const existing: Point2D[] = [{ x: 2, y: 3 }, { x: 5, y: 5 }]
    const result = snapPoint({ x: 2.1, y: 3.1 }, defaultConfig, existing)
    expect(result.position).toEqual({ x: 2, y: 3 })
    expect(result.snapType).toBe('endpoint')
    expect(result.snapTarget).toEqual({ x: 2, y: 3 })
  })

  it('does not snap when point is beyond threshold', () => {
    const existing: Point2D[] = [{ x: 2, y: 3 }]
    const result = snapPoint({ x: 3, y: 4 }, defaultConfig, existing)
    expect(result.snapType).not.toBe('endpoint')
  })

  it('picks closest endpoint when multiple are within range', () => {
    const existing: Point2D[] = [{ x: 1, y: 1 }, { x: 2, y: 1 }]
    const result = snapPoint({ x: 1.3, y: 1 }, defaultConfig, existing)
    expect(result.position).toEqual({ x: 1, y: 1 })
    expect(result.snapType).toBe('endpoint')
  })
})

describe('snapPoint - wall segment snapping', () => {
  it('projects a nearby point onto the interior of an existing wall segment', () => {
    const segment = { id: 'boundary', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }
    const result = snapPoint({ x: 5, y: 0.08 }, defaultConfig, [], undefined, [segment])

    expect(result.position).toEqual({ x: 5, y: 0 })
    expect(result.snapType).toBe('segment')
    expect(result.snapTarget).toEqual({ x: 5, y: 0 })
  })

  it('does not project a point beyond the configured endpoint threshold', () => {
    const segment = { id: 'boundary', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }
    const result = snapPoint({ x: 5, y: 0.51 }, defaultConfig, [], undefined, [segment])

    expect(result.snapType).not.toBe('segment')
  })
})

describe('snapPoint - grid snapping', () => {
  it('snaps to nearest grid point within gridSnap threshold', () => {
    const result = snapPoint({ x: 1.08, y: 0.95 }, defaultConfig, [])
    expect(result.position).toEqual({ x: 1, y: 1 })
    expect(result.snapType).toBe('grid')
  })

  it('snaps to 0.5m grid', () => {
    const config: SnapConfig = { ...defaultConfig, gridSize: 0.5, gridSnap: 0.1 }
    const result = snapPoint({ x: 1.05, y: 0.45 }, config, [])
    expect(result.position).toEqual({ x: 1, y: 0.5 })
    expect(result.snapType).toBe('grid')
  })

  it('returns none when beyond gridSnap threshold', () => {
    const result = snapPoint({ x: 2.3, y: 3.4 }, defaultConfig, [])
    expect(result.snapType).toBe('none')
    expect(result.position).toEqual({ x: 2.3, y: 3.4 })
  })
})

describe('snapPoint - orthogonal snapping', () => {
  it('snaps to horizontal alignment from last point', () => {
    const lastPoint: Point2D = { x: 0, y: 0 }
    const result = snapPoint({ x: 5.3, y: 0.1 }, defaultConfig, [], lastPoint)
    expect(result.position).toEqual({ x: 5.3, y: 0 })
    expect(result.snapType).toBe('orthogonal')
  })

  it('snaps to vertical alignment from last point', () => {
    const lastPoint: Point2D = { x: 0, y: 0 }
    const result = snapPoint({ x: 0.1, y: 5.3 }, defaultConfig, [], lastPoint)
    expect(result.position).toEqual({ x: 0, y: 5.3 })
    expect(result.snapType).toBe('orthogonal')
  })

  it('does not snap when orthogonal is disabled', () => {
    const config: SnapConfig = { ...defaultConfig, orthogonalSnap: false }
    const lastPoint: Point2D = { x: 0, y: 0 }
    const result = snapPoint({ x: 5.3, y: 0.1 }, config, [], lastPoint)
    expect(result.snapType).not.toBe('orthogonal')
  })
})

describe('snapPoint - 45 degree angle snapping', () => {
  it('snaps to 45 degree angle from last point', () => {
    const config: SnapConfig = { ...defaultConfig, orthogonalSnap: false }
    const lastPoint: Point2D = { x: 0, y: 0 }
    const result = snapPoint({ x: 4.3, y: 4.2 }, config, [], lastPoint)
    expect(result.snapType).toBe('45deg')
    const dist = Math.sqrt(4.3 * 4.3 + 4.2 * 4.2)
    expect(result.position.x).toBeCloseTo(dist * Math.cos(Math.PI / 4), 10)
    expect(result.position.y).toBeCloseTo(dist * Math.sin(Math.PI / 4), 10)
  })

  it('snaps to -45 degree angle from last point', () => {
    const config: SnapConfig = { ...defaultConfig, orthogonalSnap: false }
    const lastPoint: Point2D = { x: 0, y: 0 }
    const result = snapPoint({ x: 4.3, y: -4.2 }, config, [], lastPoint)
    expect(result.snapType).toBe('45deg')
    const dist = Math.sqrt(4.3 * 4.3 + 4.2 * 4.2)
    expect(result.position.x).toBeCloseTo(dist * Math.cos(-Math.PI / 4), 10)
    expect(result.position.y).toBeCloseTo(dist * Math.sin(-Math.PI / 4), 10)
  })

  it('does not snap when 45 snap is disabled', () => {
    const config: SnapConfig = { ...defaultConfig, orthogonalSnap: false, angle45Snap: false }
    const lastPoint: Point2D = { x: 0, y: 0 }
    const result = snapPoint({ x: 4.3, y: 4.2 }, config, [], lastPoint)
    expect(result.snapType).not.toBe('45deg')
  })
})

describe('snapPoint - no snap', () => {
  it('returns no snap when far from all targets', () => {
    const result = snapPoint({ x: 1.37, y: 4.62 }, defaultConfig, [{ x: 10, y: 10 }])
    expect(result.snapType).toBe('none')
    expect(result.position).toEqual({ x: 1.37, y: 4.62 })
  })
})

describe('snapPoint - priority', () => {
  it('endpoint takes priority over grid', () => {
    const existing: Point2D[] = [{ x: 1, y: 1 }]
    const result = snapPoint({ x: 1.05, y: 1 }, defaultConfig, existing)
    expect(result.snapType).toBe('endpoint')
  })

  it('endpoint takes priority over a wall segment body', () => {
    const existing: Point2D[] = [{ x: 0, y: 0 }]
    const segment = { id: 'wall', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }
    const result = snapPoint({ x: 0.05, y: 0.05 }, defaultConfig, existing, undefined, [segment])

    expect(result.snapType).toBe('endpoint')
  })

  it('grid takes priority over orthogonal', () => {
    const lastPoint: Point2D = { x: 0, y: 0 }
    const result = snapPoint({ x: 5.05, y: 0.05 }, defaultConfig, [], lastPoint)
    expect(result.snapType).toBe('grid')
  })

  it('orthogonal takes priority over 45deg', () => {
    const lastPoint: Point2D = { x: 0, y: 0 }
    const result = snapPoint({ x: 5.3, y: 0.1 }, defaultConfig, [], lastPoint)
    expect(result.snapType).toBe('orthogonal')
  })
})
