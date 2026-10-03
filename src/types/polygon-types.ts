/**
 * FROZEN API — RC-POLYGON-ENGINE MILESTONE
 *
 * EditablePolygon is the public contract between the Polygon Engine
 * and all consumers (RoomRenderer, BuildingRenderer, etc.).
 *
 * Breaking changes require a new major version and an ADR.
 *
 * @field id       - Stable identifier for this polygon entity
 * @field rings    - Ordered array of rings; rings[0] is outer, rings[1..n] are holes
 * @field readOnly - Whether the polygon rejects user editing
 */
export interface Vertex {
  id: string
  x: number
  y: number
}

export interface PolygonEdge {
  id: string
  startVertexId: string
  endVertexId: string
}

export interface PolygonRing {
  id: string
  vertices: Vertex[]
  closed: boolean
}

export interface EditablePolygon {
  id: string
  rings: PolygonRing[]
  readOnly?: boolean
}
