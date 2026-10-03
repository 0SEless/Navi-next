import type { EditablePolygon, Vertex, PolygonEdge } from '@/types/polygon-types'
import { genId } from '@navi/editor'

function pointId(): string {
  return genId('v')
}

function ringId(): string {
  return genId('r')
}

function edgeId(): string {
  return genId('e')
}

function computeSignedArea(vertices: Vertex[]): number {
  if (vertices.length < 3) return 0
  let sum = 0
  for (let i = 0; i < vertices.length; i++) {
    const j = (i + 1) % vertices.length
    sum += vertices[i].x * vertices[j].y
    sum -= vertices[j].x * vertices[i].y
  }
  return sum / 2
}

export const PolygonEngine = {
  create(
    points: { x: number; y: number }[],
    opts?: { closed?: boolean }
  ): EditablePolygon {
    const vertices = points.map(p => ({ id: pointId(), x: p.x, y: p.y }))
    return {
      id: genId('poly'),
      rings: [{ id: ringId(), vertices, closed: opts?.closed ?? false }],
    }
  },

  clone(polygon: EditablePolygon): EditablePolygon {
    return {
      id: genId('poly'),
      rings: polygon.rings.map(ring => ({
        id: ringId(),
        closed: ring.closed,
        vertices: ring.vertices.map(v => ({ id: pointId(), x: v.x, y: v.y })),
      })),
    }
  },

  edges(polygon: EditablePolygon): PolygonEdge[] {
    return polygon.rings.flatMap(ring => {
      const edges: PolygonEdge[] = []
      for (let i = 0; i < ring.vertices.length - 1; i++) {
        edges.push({
          id: edgeId(),
          startVertexId: ring.vertices[i].id,
          endVertexId: ring.vertices[i + 1].id,
        })
      }
      if (ring.closed && ring.vertices.length > 2) {
        edges.push({
          id: edgeId(),
          startVertexId: ring.vertices[ring.vertices.length - 1].id,
          endVertexId: ring.vertices[0].id,
        })
      }
      return edges
    })
  },

  area(polygon: EditablePolygon): number {
    const verts = polygon.rings[0]?.vertices
    if (!verts || verts.length < 3) return 0
    if (!polygon.rings[0].closed) return 0
    return Math.abs(computeSignedArea(verts))
  },

  perimeter(polygon: EditablePolygon): number {
    const edges = this.edges(polygon)
    const verts = polygon.rings[0]?.vertices ?? []
    let total = 0
    for (const e of edges) {
      const sv = verts.find(v => v.id === e.startVertexId)
      const ev = verts.find(v => v.id === e.endVertexId)
      if (!sv || !ev) continue
      total += Math.sqrt((ev.x - sv.x) ** 2 + (ev.y - sv.y) ** 2)
    }
    return total
  },

  boundingBox(polygon: EditablePolygon): { minX: number; minY: number; maxX: number; maxY: number } {
    const verts = polygon.rings[0]?.vertices ?? []
    if (verts.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const v of verts) {
      if (v.x < minX) minX = v.x
      if (v.x > maxX) maxX = v.x
      if (v.y < minY) minY = v.y
      if (v.y > maxY) maxY = v.y
    }
    return { minX, minY, maxX, maxY }
  },

  centroid(polygon: EditablePolygon): { x: number; y: number } {
    const verts = polygon.rings[0]?.vertices ?? []
    if (verts.length === 0) return { x: 0, y: 0 }
    if (verts.length === 1) return { x: verts[0].x, y: verts[0].y }
    if (!polygon.rings[0].closed || verts.length < 3) {
      const cx = verts.reduce((s, v) => s + v.x, 0) / verts.length
      const cy = verts.reduce((s, v) => s + v.y, 0) / verts.length
      return { x: cx, y: cy }
    }
    const signedArea = computeSignedArea(verts)
    if (signedArea === 0) {
      const cx = verts.reduce((s, v) => s + v.x, 0) / verts.length
      const cy = verts.reduce((s, v) => s + v.y, 0) / verts.length
      return { x: cx, y: cy }
    }
    let cx = 0, cy = 0
    for (let i = 0; i < verts.length; i++) {
      const j = (i + 1) % verts.length
      const cross = verts[i].x * verts[j].y - verts[j].x * verts[i].y
      cx += (verts[i].x + verts[j].x) * cross
      cy += (verts[i].y + verts[j].y) * cross
    }
    const f = 1 / (6 * signedArea)
    return { x: cx * f, y: cy * f }
  },

  winding(polygon: EditablePolygon): 'CW' | 'CCW' {
    const verts = polygon.rings[0]?.vertices ?? []
    if (verts.length < 3) return 'CCW'
    return computeSignedArea(verts) < 0 ? 'CW' : 'CCW'
  },

  setVertex(polygon: EditablePolygon, ringIndex: number, vertexIndex: number, position: { x: number; y: number }): EditablePolygon {
    return {
      ...polygon,
      rings: polygon.rings.map((ring, ri) =>
        ri !== ringIndex ? ring : {
          ...ring,
          vertices: ring.vertices.map((v, vi) =>
            vi !== vertexIndex ? v : { ...v, ...position }
          ),
        }
      ),
    }
  },

  moveVertex(polygon: EditablePolygon, vertexId: string, position: { x: number; y: number }): EditablePolygon {
    for (let ri = 0; ri < polygon.rings.length; ri++) {
      for (let vi = 0; vi < polygon.rings[ri].vertices.length; vi++) {
        if (polygon.rings[ri].vertices[vi].id === vertexId) {
          return this.setVertex(polygon, ri, vi, position)
        }
      }
    }
    return polygon
  },

  insertVertex(polygon: EditablePolygon, startVertexId: string, endVertexId: string, position: { x: number; y: number }): EditablePolygon {
    const newVertex: Vertex = { id: pointId(), ...position }
    return {
      ...polygon,
      rings: polygon.rings.map(ring => {
        const startIdx = ring.vertices.findIndex(v => v.id === startVertexId)
        if (startIdx === -1) return ring
        const endIdx = ring.vertices.findIndex(v => v.id === endVertexId)
        if (endIdx === -1) return ring
        if (Math.abs(startIdx - endIdx) !== 1 && !(ring.closed && ((startIdx === 0 && endIdx === ring.vertices.length - 1) || (startIdx === ring.vertices.length - 1 && endIdx === 0)))) {
          return ring
        }
        const insertAfter = Math.min(startIdx, endIdx)
        const verts = [...ring.vertices]
        verts.splice(insertAfter + 1, 0, newVertex)
        return { ...ring, vertices: verts }
      }),
    }
  },

  deleteVertex(polygon: EditablePolygon, vertexId: string): EditablePolygon {
    const newRings = polygon.rings.map(ring => {
      if (ring.vertices.length <= 3) throw new Error('Polygon must have at least 3 vertices')
      return { ...ring, vertices: ring.vertices.filter(v => v.id !== vertexId) }
    })
    return { ...polygon, rings: newRings }
  },

  closePolygon(polygon: EditablePolygon): EditablePolygon {
    return {
      ...polygon,
      rings: polygon.rings.map(ring => ({ ...ring, closed: true })),
    }
  },

  normalize(polygon: EditablePolygon): EditablePolygon {
    return {
      ...polygon,
      rings: polygon.rings.map(ring => {
        const deduped = ring.vertices.filter((v, i, arr) => {
          if (i === 0) return true
          const prev = arr[i - 1]
          return v.x !== prev.x || v.y !== prev.y
        })
        if (ring.closed && deduped.length < 3) {
          return { ...ring, closed: false, vertices: deduped }
        }
        if (!ring.closed || this.winding({ ...polygon, rings: [{ ...ring, vertices: deduped }] }) === 'CCW') {
          return { ...ring, vertices: deduped }
        }
        return { ...ring, vertices: [...deduped].reverse() }
      }),
    }
  },
}
