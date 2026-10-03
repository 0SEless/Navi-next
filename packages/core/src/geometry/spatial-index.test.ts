import { describe, it, expect, beforeEach } from 'vitest'
import { GridSpatialIndex } from './spatial-index'
import type { BBox } from './polygon'

describe('GridSpatialIndex', () => {
  let index: GridSpatialIndex

  beforeEach(() => {
    index = new GridSpatialIndex(50)
  })

  it('inserts and queries by point', () => {
    index.insert({ id: 'room-1', bbox: { minX: 10, maxX: 20, minY: 10, maxY: 20 } })
    const results = index.queryPoint(15, 15)
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('room-1')
  })

  it('returns empty for point outside all entities', () => {
    index.insert({ id: 'room-1', bbox: { minX: 10, maxX: 20, minY: 10, maxY: 20 } })
    expect(index.queryPoint(100, 100)).toHaveLength(0)
  })

  it('queries by bounding box', () => {
    index.insert({ id: 'a', bbox: { minX: 0, maxX: 10, minY: 0, maxY: 10 } })
    index.insert({ id: 'b', bbox: { minX: 20, maxX: 30, minY: 20, maxY: 30 } })
    const results = index.queryBBox({ minX: 5, maxX: 25, minY: 5, maxY: 25 })
    expect(results).toHaveLength(2)
  })

  it('removes entities', () => {
    index.insert({ id: 'a', bbox: { minX: 0, maxX: 10, minY: 0, maxY: 10 } })
    index.remove('a')
    expect(index.size).toBe(0)
    expect(index.queryPoint(5, 5)).toHaveLength(0)
  })

  it('updates entity position', () => {
    index.insert({ id: 'a', bbox: { minX: 0, maxX: 10, minY: 0, maxY: 10 } })
    index.update({ id: 'a', bbox: { minX: 100, maxX: 110, minY: 100, maxY: 110 } })
    expect(index.queryPoint(5, 5)).toHaveLength(0)
    expect(index.queryPoint(105, 105)).toHaveLength(1)
  })

  it('finds nearest entities', () => {
    index.insert({ id: 'near', bbox: { minX: 5, maxX: 10, minY: 5, maxY: 10 } })
    index.insert({ id: 'far', bbox: { minX: 100, maxX: 110, minY: 100, maxY: 110 } })
    const nearest = index.queryNearest(0, 0, 1)
    expect(nearest).toHaveLength(1)
    expect(nearest[0].id).toBe('near')
  })

  it('clears all entities', () => {
    index.insert({ id: 'a', bbox: { minX: 0, maxX: 10, minY: 0, maxY: 10 } })
    index.clear()
    expect(index.size).toBe(0)
  })
})
