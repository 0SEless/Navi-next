import type { EditablePolygon } from '@/types/polygon-types'
import { PolygonEngine } from './PolygonEngine'

export interface ConstraintResult {
  valid: boolean
  message?: string
}

export function validateVertices(polygon: EditablePolygon): ConstraintResult {
  const verts = polygon.rings[0]?.vertices
  if (!verts || verts.length < 3) {
    return { valid: false, message: 'Polygon must have at least 3 vertices' }
  }
  for (const v of verts) {
    if (!Number.isFinite(v.x) || !Number.isFinite(v.y)) {
      return { valid: false, message: 'Vertex coordinates must be finite numbers' }
    }
  }
  return { valid: true }
}

export function minEdgeLength(polygon: EditablePolygon, threshold: number): string[] {
  const edges = PolygonEngine.edges(polygon)
  const verts = polygon.rings[0]?.vertices ?? []
  const short: string[] = []
  for (const e of edges) {
    const sv = verts.find(v => v.id === e.startVertexId)
    const ev = verts.find(v => v.id === e.endVertexId)
    if (!sv || !ev) continue
    const d = Math.sqrt((ev.x - sv.x) ** 2 + (ev.y - sv.y) ** 2)
    if (d < threshold) short.push(e.id)
  }
  return short
}

export function minArea(polygon: EditablePolygon, threshold: number): boolean {
  return PolygonEngine.area(polygon) < threshold
}

export function deduplicateVertices(polygon: EditablePolygon): EditablePolygon {
  return {
    ...polygon,
    rings: polygon.rings.map(ring => ({
      ...ring,
      vertices: ring.vertices.filter((v, i) => {
        if (i === 0) return true
        const prev = ring.vertices[i - 1]
        return v.x !== prev.x || v.y !== prev.y
      }),
    })),
  }
}
