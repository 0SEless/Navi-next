import { describe, it, expect } from 'vitest'
import { resolveLevelGeometry } from '../resolve-level-geometry'
import type { Elevator, LocalCoord, LocalPolygon, Staircase } from '@navi/core'

function stair(levels: Staircase['levels'], overrides: Partial<Staircase> = {}): Staircase {
  return {
    id: 'stair-1',
    buildingId: 'b1',
    name: 'Stair A',
    type: 'open',
    accessible: true,
    fromLevel: 0,
    toLevel: 1,
    levels,
    ...overrides,
  }
}

function elevator(levels: Elevator['levels'], overrides: Partial<Elevator> = {}): Elevator {
  return {
    id: 'elev-1',
    buildingId: 'b1',
    name: 'Elev A',
    type: 'passenger',
    accessible: true,
    fromLevel: 0,
    toLevel: 1,
    levels,
    ...overrides,
  }
}

function expectClose(polygon: LocalPolygon | undefined, expected: LocalCoord[]): void {
  expect(polygon).toBeDefined()
  expect(polygon!.points).toHaveLength(expected.length)
  polygon!.points.forEach((p, i) => {
    expect(p.x).toBeCloseTo(expected[i].x, 10)
    expect(p.y).toBeCloseTo(expected[i].y, 10)
  })
}

describe('resolveLevelGeometry — parametric stair', () => {
  it('resolves geometry() rect output into a 4-corner polygon with exact coords (rotation 0)', () => {
    const f = stair({
      0: {
        position: { x: 10, y: 20 },
        rotation: 0,
        drawing: { definitionId: 'stair', properties: { stepCount: 4, stepWidth: 2, stepDepth: 0.5, direction: 'east', preset: 'straight' } },
      },
    })
    const out = resolveLevelGeometry(f, 0)
    expect(out.polygon).toEqual({
      points: [
        { x: 11, y: 21 },
        { x: 9, y: 21 },
        { x: 9, y: 19 },
        { x: 11, y: 19 },
        { x: 11, y: 21 }, // closed ring
      ],
    })
  })

  it('regenerates the polygon when a drawing property changes (width 2m → 3m)', () => {
    const base = {
      position: { x: 10, y: 20 },
      rotation: 0,
      drawing: { definitionId: 'stair' as const, properties: { stepCount: 4, stepWidth: 2, stepDepth: 0.5, direction: 'east' as const, preset: 'straight' as const } },
    }
    const narrow = resolveLevelGeometry(stair({ 0: base }), 0)
    const wide = resolveLevelGeometry(
      stair({ 0: { ...base, drawing: { ...base.drawing, properties: { ...base.drawing.properties, stepWidth: 3 } } } }),
      0,
    )
    expect(narrow.polygon).not.toEqual(wide.polygon)
    // wide: x extent = width 3 → half-width 1.5
    const xs = wide.polygon!.points.map((p) => p.x)
    expect(Math.min(...xs)).toBeCloseTo(8.5, 10)
    expect(Math.max(...xs)).toBeCloseTo(11.5, 10)
  })

  it('is deterministic — same input twice yields an identical polygon', () => {
    const f = stair({
      0: {
        position: { x: 10, y: 20 },
        rotation: 30,
        drawing: { definitionId: 'stair', properties: { stepCount: 4, stepWidth: 2, stepDepth: 0.5, direction: 'east', preset: 'straight' } },
      },
    })
    expect(resolveLevelGeometry(f, 0)).toEqual(resolveLevelGeometry(f, 0))
  })

  it('honors level rotation — rect corners rotated by level.rotation', () => {
    const f = stair({
      0: {
        position: { x: 10, y: 20 },
        rotation: 90,
        drawing: { definitionId: 'stair', properties: { stepCount: 4, stepWidth: 2, stepDepth: 0.5, direction: 'east', preset: 'straight' } },
      },
    })
    const out = resolveLevelGeometry(f, 0)
    // rect 2x2 centered at (10,20) rotated 90°: corners (9,21),(9,19),(11,19),(11,21)
    expectClose(out.polygon, [
      { x: 9, y: 21 },
      { x: 9, y: 19 },
      { x: 11, y: 19 },
      { x: 11, y: 21 },
      { x: 9, y: 21 },
    ])
  })
})

describe('resolveLevelGeometry — parametric elevator', () => {
  it('resolves the elevator rect (width/depth/doorSide) into a polygon', () => {
    const f = elevator({
      0: {
        position: { x: 5, y: 5 },
        rotation: 0,
        drawing: { definitionId: 'elevator', properties: { width: 1.5, depth: 1.5, doorSide: 'front' } },
      },
    })
    const out = resolveLevelGeometry(f, 0)
    expect(out.polygon).toEqual({
      points: [
        { x: 5.75, y: 5.75 },
        { x: 4.25, y: 5.75 },
        { x: 4.25, y: 4.25 },
        { x: 5.75, y: 4.25 },
        { x: 5.75, y: 5.75 },
      ],
    })
  })
})

describe('resolveLevelGeometry — freeform', () => {
  const authored: LocalPolygon = {
    points: [
      { x: 0, y: 0 },
      { x: 3, y: 1 },
      { x: 2, y: 4 },
      { x: 0, y: 0 },
    ],
  }

  it('passes the authored polygon through unchanged (deep equal)', () => {
    const f = stair({ 1: { position: { x: 2, y: 3 }, rotation: 0, polygon: authored } })
    const out = resolveLevelGeometry(f, 1)
    expect(out.polygon).toEqual(authored)
    expect(out.polygon).toBe(authored)
  })
})

describe('resolveLevelGeometry — missing level', () => {
  it('returns {} when the level is not authored', () => {
    const f = stair({ 0: { position: { x: 0, y: 0 }, rotation: 0 } })
    expect(resolveLevelGeometry(f, 5)).toEqual({})
  })
})

describe('resolveLevelGeometry — landing (ALWAYS via shared deriveLanding)', () => {
  it('authored landing wins over polygon and drawing', () => {
    const f = stair({
      0: {
        position: { x: 10, y: 20 },
        rotation: 0,
        drawing: { definitionId: 'stair', properties: { stepCount: 4, stepWidth: 2, stepDepth: 0.5, direction: 'east', preset: 'straight' } },
        polygon: { points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }, { x: 0, y: 0 }] },
        landing: { position: { x: 7, y: 8 }, rotation: 90, polygon: { points: [{ x: 6, y: 7 }] } },
      },
    })
    const out = resolveLevelGeometry(f, 0)
    expect(out.landing).toEqual({ position: { x: 7, y: 8 }, rotation: 90, polygon: { points: [{ x: 6, y: 7 }] } })
  })

  it('derives landing from the resolved polygon centroid when no landing is authored', () => {
    // freeform asymmetric polygon → centroid (2,2)
    const f = stair({
      1: {
        position: { x: 10, y: 20 },
        rotation: 25,
        polygon: { points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }, { x: 0, y: 0 }] },
      },
    })
    const out = resolveLevelGeometry(f, 1)
    expect(out.landing).toEqual({ position: { x: 2, y: 2 }, rotation: 25 })
  })

  it('falls back to level position when there is no polygon', () => {
    const f = elevator({ 0: { position: { x: 3, y: -2 }, rotation: 15 } })
    const out = resolveLevelGeometry(f, 0)
    expect(out.landing).toEqual({ position: { x: 3, y: -2 }, rotation: 15 })
  })
})