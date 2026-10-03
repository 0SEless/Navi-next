export interface PathVertex {
  id: string
  x: number
  y: number
}

export interface PathSegment {
  id: string
  startVertexId: string
  endVertexId: string
  type: 'straight' | 'arc'
  curvature?: number
}

/**
 * FROZEN API — RC-8 MILESTONE
 *
 * EditablePath is the public contract between the Linear Geometry Engine
 * and all consumers (HallwayRenderer, RoadRenderer, etc.).
 *
 * Breaking changes require a new major version and an ADR.
 *
 * @field id       - Stable identifier for this path entity
 * @field vertices - Ordered array of control points (at least 2)
 * @field segments - Ordered edges connecting vertices (vertices.length - 1)
 * @field closed   - Whether the path forms a loop
 * @field readOnly - Whether the path rejects user editing
 */
export interface EditablePath {
  id: string
  vertices: PathVertex[]
  segments: PathSegment[]
  closed: boolean
  readOnly: boolean
}
