import { describe, it, expect } from 'vitest'
import { PolygonEngine } from '../PolygonEngine'
import type { EditablePolygon } from '@/types/polygon-types'

function makeSquare(
  x = 0, y = 0, size = 10,
  opts?: { closed?: boolean }
): EditablePolygon {
  return PolygonEngine.create([
    { x, y },
    { x: x + size, y },
    { x: x + size, y: y + size },
    { x, y: y + size },
  ], opts)
}

describe('PolygonEngine', () => {
  describe('create', () => {
    it('creates a polygon from points', () => {
      const poly = PolygonEngine.create([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ])
      expect(poly.rings).toHaveLength(1)
      expect(poly.rings[0].vertices).toHaveLength(3)
      expect(poly.rings[0].closed).toBe(false)
      expect(poly.id).toBeTruthy()
    })

    it('assigns unique IDs to each vertex', () => {
      const poly = PolygonEngine.create([
        { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 },
      ])
      const ids = poly.rings[0].vertices.map(v => v.id)
      expect(new Set(ids).size).toBe(3)
    })

    it('allows closed: true option', () => {
      const poly = PolygonEngine.create([
        { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 },
      ], { closed: true })
      expect(poly.rings[0].closed).toBe(true)
    })
  })

  describe('clone', () => {
    it('creates a deep copy with new ID', () => {
      const original = makeSquare()
      const cloned = PolygonEngine.clone(original)
      expect(cloned.id).not.toBe(original.id)
      expect(cloned.rings[0].vertices).toHaveLength(original.rings[0].vertices.length)
      expect(cloned.rings[0].vertices[0].x).toBe(original.rings[0].vertices[0].x)
    })

    it('produces an independent copy (mutation does not affect original)', () => {
      const original = makeSquare()
      const cloned = PolygonEngine.clone(original)
      cloned.rings[0].vertices[0] = { id: 'new', x: 999, y: 999 }
      expect(original.rings[0].vertices[0].x).toBe(0)
    })
  })

  describe('edges', () => {
    it('returns edges for an open polygon', () => {
      const poly = PolygonEngine.create([
        { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 },
      ])
      const edges = PolygonEngine.edges(poly)
      expect(edges).toHaveLength(2)
      expect(edges[0].startVertexId).toBe(poly.rings[0].vertices[0].id)
      expect(edges[0].endVertexId).toBe(poly.rings[0].vertices[1].id)
    })

    it('returns edges for a closed polygon (closing edge included)', () => {
      const poly = PolygonEngine.create([
        { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 },
      ], { closed: true })
      const edges = PolygonEngine.edges(poly)
      expect(edges).toHaveLength(3)
    })

    it('each edge has a unique ID', () => {
      const poly = makeSquare(0, 0, 10, { closed: true })
      const edges = PolygonEngine.edges(poly)
      expect(new Set(edges.map(e => e.id)).size).toBe(edges.length)
    })
  })

  describe('area', () => {
    it('returns 0 for an open polygon', () => {
      const poly = PolygonEngine.create([
        { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 },
      ])
      expect(PolygonEngine.area(poly)).toBe(0)
    })

    it('computes area of a unit square', () => {
      const poly = makeSquare(0, 0, 1, { closed: true })
      expect(PolygonEngine.area(poly)).toBe(1)
    })

    it('computes area of a 10x10 square', () => {
      const poly = makeSquare(0, 0, 10, { closed: true })
      expect(PolygonEngine.area(poly)).toBe(100)
    })

    it('computes area of a right triangle', () => {
      const poly = PolygonEngine.create([
        { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 },
      ], { closed: true })
      expect(PolygonEngine.area(poly)).toBe(50)
    })

    it('returns 0 for degenerate (collinear) polygon', () => {
      const poly = PolygonEngine.create([
        { x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 },
      ], { closed: true })
      expect(PolygonEngine.area(poly)).toBe(0)
    })
  })

  describe('perimeter', () => {
    it('returns 0 for a single point', () => {
      const poly = PolygonEngine.create([{ x: 0, y: 0 }])
      expect(PolygonEngine.perimeter(poly)).toBe(0)
    })

    it('computes perimeter of a unit square', () => {
      const poly = makeSquare(0, 0, 1, { closed: true })
      expect(PolygonEngine.perimeter(poly)).toBeCloseTo(4, 10)
    })

    it('computes perimeter of an open polygon (no closing edge)', () => {
      const poly = PolygonEngine.create([
        { x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 4 },
      ])
      expect(PolygonEngine.perimeter(poly)).toBe(7)
    })

    it('includes closing edge when polygon is closed', () => {
      const poly = PolygonEngine.create([
        { x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 4 },
      ], { closed: true })
      expect(PolygonEngine.perimeter(poly)).toBe(12)
    })
  })

  describe('boundingBox', () => {
    it('returns min/max coords', () => {
      const poly = makeSquare(5, 10, 20, { closed: true })
      const bb = PolygonEngine.boundingBox(poly)
      expect(bb).toEqual({ minX: 5, minY: 10, maxX: 25, maxY: 30 })
    })

    it('handles single vertex', () => {
      const poly = PolygonEngine.create([{ x: 7, y: 8 }])
      const bb = PolygonEngine.boundingBox(poly)
      expect(bb).toEqual({ minX: 7, minY: 8, maxX: 7, maxY: 8 })
    })
  })

  describe('centroid', () => {
    it('returns center of square', () => {
      const poly = makeSquare(0, 0, 10, { closed: true })
      const c = PolygonEngine.centroid(poly)
      expect(c.x).toBe(5)
      expect(c.y).toBe(5)
    })

    it('returns center of triangle', () => {
      const poly = PolygonEngine.create([
        { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 },
      ], { closed: true })
      const c = PolygonEngine.centroid(poly)
      expect(c.x).toBeCloseTo(10 / 3, 10)
      expect(c.y).toBeCloseTo(10 / 3, 10)
    })

    it('returns average of vertices for open polygon', () => {
      const poly = PolygonEngine.create([
        { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 },
      ])
      const c = PolygonEngine.centroid(poly)
      expect(c.x).toBeCloseTo(20 / 3, 10)
      expect(c.y).toBeCloseTo(10 / 3, 10)
    })
  })

  describe('winding', () => {
    it('returns CCW for a polygon traced in CCW order', () => {
      const poly = PolygonEngine.create([
        { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
      ], { closed: true })
      expect(PolygonEngine.winding(poly)).toBe('CCW')
    })

    it('returns CW for a polygon traced in CW order', () => {
      const poly = PolygonEngine.create([
        { x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 0 },
      ], { closed: true })
      expect(PolygonEngine.winding(poly)).toBe('CW')
    })

    it('returns CCW for open polygon (computed from vertices as-is)', () => {
      const poly = PolygonEngine.create([
        { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 },
      ])
      expect(PolygonEngine.winding(poly)).toBe('CCW')
    })
  })

  describe('immutability', () => {
    it('create does not mutate input points', () => {
      const points = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]
      const originalX = points[0].x
      PolygonEngine.create(points)
      expect(points[0].x).toBe(originalX)
    })

    it('clone does not share vertex references with original', () => {
      const original = makeSquare()
      const cloned = PolygonEngine.clone(original)
      cloned.rings[0].vertices[0] = { id: 'new', x: 999, y: 999 }
      expect(original.rings[0].vertices[0].x).toBe(0)
    })
  })

  describe('determinism', () => {
    it('same inputs produce same geometric output', () => {
      const a = makeSquare(0, 0, 10, { closed: true })
      const b = makeSquare(0, 0, 10, { closed: true })
      for (let i = 0; i < 4; i++) {
        expect(a.rings[0].vertices[i].x).toBe(b.rings[0].vertices[i].x)
        expect(a.rings[0].vertices[i].y).toBe(b.rings[0].vertices[i].y)
      }
      expect(PolygonEngine.area(a)).toBe(PolygonEngine.area(b))
    })
  })

  describe('normalize', () => {
    it('removes duplicate adjacent vertices', () => {
      const poly = PolygonEngine.create([
        { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 },
      ])
      const norm = PolygonEngine.normalize(poly)
      expect(norm.rings[0].vertices).toHaveLength(3)
    })

    it('does not remove non-adjacent duplicates', () => {
      const poly = PolygonEngine.create([
        { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
      ])
      const norm = PolygonEngine.normalize(poly)
      expect(norm.rings[0].vertices).toHaveLength(4)
    })

    it('does not mutate original polygon', () => {
      const poly = PolygonEngine.create([
        { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 },
      ])
      PolygonEngine.normalize(poly)
      expect(poly.rings[0].vertices).toHaveLength(4)
    })

    it('normalizes CW polygon to CCW', () => {
      const poly = PolygonEngine.create([
        { x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 0 },
      ], { closed: true })
      expect(PolygonEngine.winding(poly)).toBe('CW')
      const norm = PolygonEngine.normalize(poly)
      expect(PolygonEngine.winding(norm)).toBe('CCW')
    })

    it('preserves CCW winding', () => {
      const poly = makeSquare(0, 0, 10, { closed: true })
      expect(PolygonEngine.winding(poly)).toBe('CCW')
      const norm = PolygonEngine.normalize(poly)
      expect(PolygonEngine.winding(norm)).toBe('CCW')
    })

    it('opens a closed ring when dedup reduces below 3 vertices', () => {
      const poly = PolygonEngine.create([
        { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 0 },
      ], { closed: true })
      const norm = PolygonEngine.normalize(poly)
      expect(norm.rings[0].closed).toBe(false)
      expect(norm.rings[0].vertices).toHaveLength(2)
    })

    it('preserves open rings through normalization', () => {
      const poly = PolygonEngine.create([
        { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 },
      ])
      const norm = PolygonEngine.normalize(poly)
      expect(norm.rings[0].closed).toBe(false)
      expect(norm.rings[0].vertices).toHaveLength(3)
    })
  })

  describe('setVertex (index-based)', () => {
    it('sets vertex position by ring and vertex index', () => {
      const poly = PolygonEngine.create([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])
      const updated = PolygonEngine.setVertex(poly, 0, 0, { x: 5, y: 5 })
      expect(updated.rings[0].vertices[0].x).toBe(5)
      expect(updated.rings[0].vertices[0].y).toBe(5)
    })

    it('returns new polygon without mutating original', () => {
      const poly = PolygonEngine.create([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])
      PolygonEngine.setVertex(poly, 0, 1, { x: 99, y: 99 })
      expect(poly.rings[0].vertices[1].x).toBe(10)
    })

    it('preserves other vertices', () => {
      const poly = PolygonEngine.create([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }])
      const updated = PolygonEngine.setVertex(poly, 0, 0, { x: 5, y: 5 })
      expect(updated.rings[0].vertices[1].x).toBe(10)
      expect(updated.rings[0].vertices[2].x).toBe(10)
      expect(updated.rings[0].vertices[3].x).toBe(0)
    })

    it('preserves vertex IDs', () => {
      const poly = PolygonEngine.create([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])
      const vid = poly.rings[0].vertices[0].id
      const updated = PolygonEngine.setVertex(poly, 0, 0, { x: 5, y: 5 })
      expect(updated.rings[0].vertices[0].id).toBe(vid)
    })
  })

  describe('moveVertex (ID-based)', () => {
    it('moves a vertex by ID', () => {
      const poly = PolygonEngine.create([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])
      const vid = poly.rings[0].vertices[0].id
      const updated = PolygonEngine.moveVertex(poly, vid, { x: 5, y: 5 })
      const moved = updated.rings[0].vertices.find(v => v.id === vid)
      expect(moved).toBeDefined()
      expect(moved!.x).toBe(5)
      expect(moved!.y).toBe(5)
    })

    it('returns new polygon without mutating original', () => {
      const poly = PolygonEngine.create([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])
      const vid = poly.rings[0].vertices[0].id
      PolygonEngine.moveVertex(poly, vid, { x: 5, y: 5 })
      expect(poly.rings[0].vertices[0].x).toBe(0)
    })

    it('does nothing for non-existent vertex ID', () => {
      const poly = PolygonEngine.create([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])
      const updated = PolygonEngine.moveVertex(poly, 'nonexistent', { x: 5, y: 5 })
      expect(updated.rings[0].vertices).toHaveLength(3)
      expect(updated.rings[0].vertices[0].x).toBe(0)
    })
  })

  describe('insertVertex', () => {
    it('inserts a vertex between two adjacent vertices', () => {
      const poly = PolygonEngine.create([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])
      const sv = poly.rings[0].vertices[0]
      const ev = poly.rings[0].vertices[1]
      const updated = PolygonEngine.insertVertex(poly, sv.id, ev.id, { x: 5, y: 0 })
      expect(updated.rings[0].vertices).toHaveLength(4)
    })

    it('inserted vertex is placed between the two specified vertices', () => {
      const poly = PolygonEngine.create([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])
      const sv = poly.rings[0].vertices[0]
      const ev = poly.rings[0].vertices[1]
      const updated = PolygonEngine.insertVertex(poly, sv.id, ev.id, { x: 5, y: 0 })
      const startIdx = updated.rings[0].vertices.findIndex(v => v.id === sv.id)
      expect(updated.rings[0].vertices[startIdx + 1].x).toBe(5)
    })

    it('does nothing for non-adjacent vertex pair', () => {
      const poly = PolygonEngine.create([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])
      const sv = poly.rings[0].vertices[0]
      const ev = poly.rings[0].vertices[2]
      const updated = PolygonEngine.insertVertex(poly, sv.id, ev.id, { x: 5, y: 0 })
      expect(updated.rings[0].vertices).toHaveLength(3)
    })

    it('returns new polygon without mutating original', () => {
      const poly = PolygonEngine.create([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])
      const sv = poly.rings[0].vertices[0]
      const ev = poly.rings[0].vertices[1]
      PolygonEngine.insertVertex(poly, sv.id, ev.id, { x: 5, y: 0 })
      expect(poly.rings[0].vertices).toHaveLength(3)
    })
  })

  describe('deleteVertex', () => {
    it('deletes a vertex by ID (min 3 remain)', () => {
      const poly = PolygonEngine.create([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }])
      const vid = poly.rings[0].vertices[0].id
      const updated = PolygonEngine.deleteVertex(poly, vid)
      expect(updated.rings[0].vertices).toHaveLength(3)
    })

    it('refuses to delete vertex when only 3 remain', () => {
      const poly = PolygonEngine.create([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])
      const vid = poly.rings[0].vertices[0].id
      expect(() => PolygonEngine.deleteVertex(poly, vid)).toThrow('at least 3 vertices')
    })

    it('returns new polygon without mutating original', () => {
      const poly = PolygonEngine.create([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }])
      const vid = poly.rings[0].vertices[0].id
      PolygonEngine.deleteVertex(poly, vid)
      expect(poly.rings[0].vertices).toHaveLength(4)
    })

    it('does nothing for non-existent vertex ID', () => {
      const poly = PolygonEngine.create([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }])
      const updated = PolygonEngine.deleteVertex(poly, 'nonexistent')
      expect(updated.rings[0].vertices).toHaveLength(4)
    })
  })

  describe('closePolygon', () => {
    it('closes an open polygon', () => {
      const poly = PolygonEngine.create([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])
      const closed = PolygonEngine.closePolygon(poly)
      expect(closed.rings[0].closed).toBe(true)
    })

    it('is idempotent on already closed polygon', () => {
      const poly = PolygonEngine.create([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], { closed: true })
      const closed = PolygonEngine.closePolygon(poly)
      expect(closed.rings[0].closed).toBe(true)
    })

    it('returns new polygon without mutating original', () => {
      const poly = PolygonEngine.create([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])
      PolygonEngine.closePolygon(poly)
      expect(poly.rings[0].closed).toBe(false)
    })
  })
})
