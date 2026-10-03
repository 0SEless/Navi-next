import { describe, it, expect } from 'vitest'
import { deriveLanding, vertexCentroid } from '../level-geometry'
import type { LocalPolygon } from '../../types/coordinates'

describe('vertexCentroid (mean of vertices)', () => {
  it('returns the mean of vertices for an open ring', () => {
    const poly: LocalPolygon = {
      points: [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
        { x: 0, y: 4 },
      ],
    }
    expect(vertexCentroid(poly)).toEqual({ x: 2, y: 2 })
  })

  it('excludes the duplicated closing point of a closed ring', () => {
    const closed: LocalPolygon = {
      points: [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
        { x: 0, y: 4 },
        { x: 0, y: 0 },
      ],
    }
    // If the closing duplicate were included, the mean would be skewed to (1.6, 1.6).
    expect(vertexCentroid(closed)).toEqual({ x: 2, y: 2 })
  })

  it('centers a symmetric rect polygon at its center', () => {
    const rect: LocalPolygon = {
      points: [
        { x: -1, y: -1 },
        { x: 1, y: -1 },
        { x: 1, y: 1 },
        { x: -1, y: 1 },
        { x: -1, y: -1 },
      ],
    }
    expect(vertexCentroid(rect)).toEqual({ x: 0, y: 0 })
  })

  it('returns (0,0) for an empty polygon instead of NaN', () => {
    const c = vertexCentroid({ points: [] })
    expect(Number.isFinite(c.x)).toBe(true)
    expect(Number.isFinite(c.y)).toBe(true)
    expect(c).toEqual({ x: 0, y: 0 })
  })
})

describe('deriveLanding (micro-decision 3 — the ONE shared rule)', () => {
  it('branch 1: authored landing present → returned unchanged (wins over polygon)', () => {
    const level = {
      position: { x: 1, y: 1 },
      rotation: 45,
      polygon: {
        points: [
          { x: 0, y: 0 },
          { x: 4, y: 0 },
          { x: 4, y: 4 },
          { x: 0, y: 4 },
          { x: 0, y: 0 },
        ],
      },
    }
    const authored = { position: { x: 7, y: 8 }, rotation: 90, polygon: { points: [{ x: 6, y: 7 }] } }
    const result = deriveLanding(level, authored)
    expect(result).toEqual(authored)
    expect(result).toBe(authored) // returned unchanged, not cloned
  })

  it('branch 2: no authored landing, polygon present → centroid of polygon + level rotation', () => {
    const level = {
      position: { x: 1, y: 1 },
      rotation: 30,
      polygon: {
        points: [
          { x: 0, y: 0 },
          { x: 4, y: 0 },
          { x: 4, y: 4 },
          { x: 0, y: 4 },
          { x: 0, y: 0 },
        ],
      },
    }
    expect(deriveLanding(level)).toEqual({ position: { x: 2, y: 2 }, rotation: 30 })
  })

  it('branch 3: no authored landing, no polygon → level position + level rotation', () => {
    const level = { position: { x: 3, y: -2 }, rotation: 15 }
    expect(deriveLanding(level)).toEqual({ position: { x: 3, y: -2 }, rotation: 15 })
  })

  it('is deterministic — same input always yields the same output', () => {
    const level = {
      position: { x: 3, y: -2 },
      rotation: 15,
      polygon: {
        points: [
          { x: 0, y: 0 },
          { x: 4, y: 0 },
          { x: 4, y: 4 },
          { x: 0, y: 4 },
          { x: 0, y: 0 },
        ],
      },
    }
    expect(deriveLanding(level)).toEqual(deriveLanding(level))
  })
})