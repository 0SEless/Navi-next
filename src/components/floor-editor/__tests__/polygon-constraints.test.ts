import { describe, it, expect } from 'vitest'
import { validateVertices, minEdgeLength, minArea, deduplicateVertices } from '../polygon-constraints'
import { PolygonEngine } from '../PolygonEngine'

describe('polygon-constraints', () => {
  it('validateVertices passes for 3+ vertices', () => {
    const poly = PolygonEngine.create([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])
    const result = validateVertices(poly)
    expect(result.valid).toBe(true)
  })

  it('validateVertices fails for fewer than 3 vertices', () => {
    const poly = PolygonEngine.create([{ x: 0, y: 0 }, { x: 10, y: 0 }])
    const result = validateVertices(poly)
    expect(result.valid).toBe(false)
  })

  it('minEdgeLength returns edges below threshold', () => {
    const poly = PolygonEngine.create([{ x: 0, y: 0 }, { x: 0.1, y: 0 }, { x: 10, y: 10 }])
    const short = minEdgeLength(poly, 0.5)
    expect(short.length).toBeGreaterThanOrEqual(1)
  })

  it('minArea returns true for tiny polygon', () => {
    const poly = PolygonEngine.create([{ x: 0, y: 0 }, { x: 0.01, y: 0 }, { x: 0, y: 0.01 }])
    expect(minArea(poly, 0.1)).toBe(true)
  })

  it('deduplicateVertices removes adjacent duplicates', () => {
    const poly = PolygonEngine.create([{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 5, y: 5 }, { x: 10, y: 10 }])
    const deduped = deduplicateVertices(poly)
    expect(deduped.rings[0].vertices).toHaveLength(3)
  })
})
