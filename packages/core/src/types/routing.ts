import type { LocalCoord } from './coordinates'
import type { RouteEdgeType, RouteNodeType } from './enums'

// ── Route preferences (pre-existing, consumed by the routing engine) ──

export type RouteMode = 'standard' | 'accessible'

export interface RoutePreferences {
  mode?: RouteMode
}

// ── P1-T7 (R2.5/R8.1/D3/D10): route network as a first-class persisted entity ──
// Authored per floor via polyline-vertex editing (each vertex becomes an
// explicit node). NOT derived from hallway geometry — moving a hallway wall
// never affects the network and vice versa (D3). Stored additively on
// `Floor.routeNetwork` (D12): absent = no authored network (legacy documents).

export interface RouteNode {
  id: string
  // Single vocabulary (D10). Validated against the closed enum on deserialize.
  type: RouteNodeType
  // Building-local meters (same coordinate contract as rooms/doors/pois).
  position: LocalCoord
  // Owning floor level — denormalized for cross-floor tooling; the handler
  // layer derives it from the containing Floor (payloads cannot override).
  floor: number
}

export interface RouteEdge {
  id: string
  /** Source node id — must exist in the SAME network. */
  from: string
  /** Target node id — must exist in the SAME network. */
  to: string
  type: RouteEdgeType
  /** Traversal weight in meters. Kept in sync with node positions by the
   *  topology operations (P1-T8: move node updates incident edges O(degree)). */
  distance: number
}

export interface RouteNetwork {
  nodes: RouteNode[]
  edges: RouteEdge[]
}
