// ── Entity category enums ──

export type BuildingCategory =
  | 'academic'
  | 'residential'
  | 'administrative'
  | 'facility'
  | 'library'
  | 'dining'
  | 'sports'
  | 'parking'
  | 'health'
  | 'other'

export type RoomCategory =
  | 'classroom'
  | 'office'
  | 'lab'
  | 'restroom'
  | 'stairwell'
  | 'elevator_lobby'
  | 'lobby'
  | 'storage'
  | 'meeting'
  | 'auditorium'
  | 'server'
  | 'utility'
  | 'other'

export type EntranceType = 'main' | 'side' | 'service' | 'emergency'

export type StaircaseType = 'open' | 'enclosed' | 'emergency'

export type ElevatorType = 'passenger' | 'freight' | 'service'

export type RoadSurface =
  | 'paved'
  | 'concrete'
  | 'brick'
  | 'gravel'
  | 'grass'
  | 'unpaved'

export type RoadType = 'arterial' | 'connector' | 'service' | 'pedestrian'

/** Controls whether an authored road is drawn in ordinary map presentation. */
export type RoadDisplayMode = 'visible' | 'navigation-only'

/** Outdoor semantics for a road-derived route segment. */
export type RoadRoutingFeature = 'normal' | 'stairs' | 'ramp' | 'bridge'

/** Administrator-authored qualitative slope classification. */
export type RoadSlope = 'level' | 'gentle' | 'moderate' | 'steep'

/**
 * Authored traversal direction. Forward follows the Road polyline from its
 * first point to its last point; reverse follows the opposite order.
 */
export type RoadDirection = 'both' | 'forward' | 'reverse'

// ── P1-T5 (R2.2): POI categories ──
// Controlled enum with `other` fallback. Validation item group-16 item 2:
// final list needs product confirmation before V1; additions are ADDITIVE
// ONLY — never reorder or rename existing entries.
export type POICategory =
  | 'restroom'
  | 'water_fountain'
  | 'vending_machine'
  | 'information'
  | 'food'
  | 'printer'
  | 'atm'
  | 'study_area'
  | 'waiting_area'
  | 'other'

export const POICATEGORIES: readonly POICategory[] = [
  'restroom',
  'water_fountain',
  'vending_machine',
  'information',
  'food',
  'printer',
  'atm',
  'study_area',
  'waiting_area',
  'other',
]

export function isPOICategory(value: unknown): value is POICategory {
  return typeof value === 'string' && (POICATEGORIES as readonly string[]).includes(value)
}

// ── P1-T6 (R2.4/R9.2/D7): RoomDoor type discriminator ──
// Closed enum per SPEC. 'opening' is a wall opening (always traversable);
// the other four are closed doors (conditionally traversable per access
// rules — single decision point lands with routing work). Additions are
// ADDITIVE ONLY — never reorder or rename existing entries.
export type DoorType = 'opening' | 'standard' | 'fire' | 'double' | 'sliding'

export const DOOR_TYPES: readonly DoorType[] = [
  'opening',
  'standard',
  'fire',
  'double',
  'sliding',
]

export function isDoorType(value: unknown): value is DoorType {
  return typeof value === 'string' && (DOOR_TYPES as readonly string[]).includes(value)
}

// ── P1-T7 (R2.5/R8.1/D10): route network vocabulary ──
// ONE vocabulary owned by the compiler; consumers use it through @navi/runtime
// with no ad-hoc normalization (D10). Node types:
//   waypoint   — authored polyline vertex (the default authoring primitive)
//   poi        — link to a Floor.pois landmark
//   transition — stair/elevator vertical connector landing
//   entrance   — building entrance node
//   outdoor    — outside the building footprint (campus walkway)
//   portal     — indoor↔outdoor bridge point
// Edge types: walk | stairs | elevator | portal.
// Additions are ADDITIVE ONLY — never reorder or rename existing entries.
export type RouteNodeType =
  | 'waypoint'
  | 'poi'
  | 'transition'
  | 'entrance'
  | 'outdoor'
  | 'portal'

export const ROUTE_NODE_TYPES: readonly RouteNodeType[] = [
  'waypoint',
  'poi',
  'transition',
  'entrance',
  'outdoor',
  'portal',
]

export function isRouteNodeType(value: unknown): value is RouteNodeType {
  return typeof value === 'string' && (ROUTE_NODE_TYPES as readonly string[]).includes(value)
}

export type RouteEdgeType = 'walk' | 'stairs' | 'elevator' | 'portal'

export const ROUTE_EDGE_TYPES: readonly RouteEdgeType[] = [
  'walk',
  'stairs',
  'elevator',
  'portal',
]

export function isRouteEdgeType(value: unknown): value is RouteEdgeType {
  return typeof value === 'string' && (ROUTE_EDGE_TYPES as readonly string[]).includes(value)
}
