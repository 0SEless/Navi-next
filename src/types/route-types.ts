/**
 * Canonical enriched route contract (ADR 020).
 *
 * Production `aStar` produces a lean `PathResult`. `buildNavRoute` enriches it
 * into this shape, adopting the runtime-style `Route` model for continuous
 * navigation. `@navi/runtime` remains the reference/model source only.
 */

import type { LatLng } from './nav-types'

// ---------------------------------------------------------------------------
// Step / instruction types
// ---------------------------------------------------------------------------

/** Step type: derived from node type + incoming edge type. */
export type NavStepType = 'walk' | 'stairs' | 'elevator' | 'door' | 'entrance'

/** Instruction type (simplified — no turn detection in initial implementation). */
export type NavInstructionType =
  | 'walk'
  | 'stairs'
  | 'elevator'
  | 'turn_left'
  | 'turn_right'
  | 'arrive'

// ---------------------------------------------------------------------------
// Step / instruction / arrival
// ---------------------------------------------------------------------------

/** Enriched route step with floor, position, and type context. */
export interface NavRouteStep {
  nodeId: string
  /** Exact incoming canonical edge when available. */
  edgeId?: string
  label: string
  position: LatLng
  floor: number
  buildingId: string
  type: NavStepType
}

/** Typed instruction for turn-by-turn guidance. */
export interface NavInstruction {
  type: NavInstructionType
  text: string
  distance: number
  fromNode: string
  toNode: string
}

/** Arrival summary — fires when positional distance < threshold OR currentNode = destination. */
export interface NavArrival {
  nodeId: string
  label: string
  position: LatLng
  remainingDistance: number
}

/** Stable destination identity for preview routes, including authored POIs. */
export interface NavRouteDestination {
  entityType: 'poi'
  entityId: string
  resolvedApproach?: {
    kind: 'node' | 'edge'
    networkId: string
    position: LatLng
    distanceMeters: number
    floor: number
    buildingId: string
  }
}

// ---------------------------------------------------------------------------
// Segments
// ---------------------------------------------------------------------------

/** Segment type for navigation context (mirrors NavigationSegment). */
export type NavSegmentType = 'outdoor' | 'entrance' | 'indoor' | 'floor-transition'

/** A contiguous span of route steps within one segment. */
export interface NavRouteSegment {
  type: NavSegmentType
  startIndex: number
  endIndex: number // inclusive
  floor: number
  buildingId?: string
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

/** Enriched route — the canonical contract for continuous navigation. */
export interface NavRoute {
  /** Legacy-compatible ordered node ids (same as PathResult.path). */
  path: string[]
  /** Enriched steps — one per node (replaces PathStep[]). */
  steps: NavRouteStep[]
  /** Typed instructions. */
  instructions: NavInstruction[]
  /** Total distance in meters. */
  totalDistance: number
  /** Generalized traversal cost used for selection; never presented as meters. */
  generalizedCost?: number
  /** Total duration in seconds (0 until speed data is available). */
  totalDuration: number
  /** Human-readable start label. */
  fromLabel: string
  /** Human-readable destination label. */
  toLabel: string
  /** Arrival summary — used by the navigation session to detect arrival. */
  arrival: NavArrival
  /** Ordered distinct floors the route passes through (numeric descending). */
  nodeFloors: number[]
  /** Stable destination identity; never a request-local routing target ID. */
  destination?: NavRouteDestination
}

// ---------------------------------------------------------------------------
// Progress result
// ---------------------------------------------------------------------------

/** Result of projecting a GPS position onto the route polyline. */
export interface RouteProgress {
  /** Index of the nearest step (or the segment before the projection point). */
  index: number
  /** Remaining distance in meters from the snapped position to the destination. */
  remainingDistance: number
  /** Current navigation segment at this progress point. */
  currentSegment: NavSegmentType
  /** GPS position snapped to the nearest point on the route polyline. */
  snappedPosition: LatLng
}
