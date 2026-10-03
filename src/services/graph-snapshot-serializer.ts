/**
 * GraphSnapshotSerializer
 *
 * ── Ownership ─────────────────────────────────────────────────
 *
 * This is the SINGLE mapping layer between the application's
 * internal data model (GraphSnapshot) and the RPC payload format
 * that the database expects.
 *
 * The UI / wizard / editor NEVER know about RPC field names.
 * The RPC NEVER knows about internal field names.
 * This serializer is the translation boundary.
 *
 * ── Contract ──────────────────────────────────────────────────
 *
 * Input:   GraphSnapshot  (from graph.toJSON())
 * Output:  RpcPayload     (POST /api/graph → sync_graph_snapshot)
 *
 * Field mappings:
 *   Building.footprint  →  building.outline  (geometry for buildings table)
 *   Building.floors[]   →  unchanged         (RPC uses jsonb_array_length)
 *   snapshot.campusId   →  overridden by currentMapId when available
 *
 * ── Change me when the DB schema changes ─────────────────────
 */

import {
  AUTHORED_DOCUMENT_FORMAT_VERSION,
  toAuthoredDocumentSnapshot,
} from '@navi/core'
import type { CampusDocument } from '@navi/core'

export interface RpcBuilding {
  id: string
  name: string
  campusId: string
  floors: number[]
  footprint: { lat: number; lng: number }[]
  outline: { lat: number; lng: number }[]
  baseElevation: number
  height: number
  color?: string
  center?: { lat: number; lng: number }
  code?: string
  description?: string
  floorPlanUrl?: string
  [key: string]: unknown
}

export interface RpcPayload {
  id: string
  campusId: string
  version: string
  updatedAt: string
  buildings: RpcBuilding[]
  nodes: unknown[]
  edges: unknown[]
  components: unknown[]
  traces?: unknown[]
  areas?: unknown[]
  pois?: unknown[]
  doors?: unknown[]
  separatedCrossings?: unknown[]
  /** Versioned authored CampusDocument companion; Graph remains the projection. */
  authoredDocumentFormatVersion?: typeof AUTHORED_DOCUMENT_FORMAT_VERSION
  authoredDocument?: CampusDocument
}

export interface BuildingLike {
  id: string
  name: string
  campusId?: string
  floors?: number[]
  footprint?: { lat: number; lng: number }[]
  outline?: { lat: number; lng: number }[]
  baseElevation?: number
  height?: number
  color?: string
  center?: { lat: number; lng: number }
  code?: string
  description?: string
  floorPlanUrl?: string
  [key: string]: unknown
}

export interface GraphSnapshotLike {
  id?: string
  campusId?: string
  version?: string
  updatedAt?: string
  buildings?: BuildingLike[]
  nodes?: unknown[]
  edges?: unknown[]
  components?: unknown[]
  traces?: unknown[]
  areas?: unknown[]
  pois?: unknown[]
  doors?: unknown[]
  separatedCrossings?: unknown[]
}

/**
 * Serialize a GraphSnapshot into the RPC-compatible payload.
 *
 * Always produces both `footprint` and `outline` so the RPC
 * can extract geometry regardless of which field the DB looks for.
 */
export function serializeSnapshot(
  snapshot: GraphSnapshotLike,
  overrideCampusId?: string | null,
  authoredDocument?: CampusDocument | null,
): RpcPayload {
  const campusId = overrideCampusId || snapshot.campusId
  if (!campusId) {
    throw new Error('Cannot serialize snapshot: campusId is required')
  }

  const payload: RpcPayload = {
    id: snapshot.id || campusId,
    campusId,
    version: snapshot.version || '1.0.0',
    updatedAt: snapshot.updatedAt || new Date().toISOString(),
    buildings: (snapshot.buildings ?? []).map(serializeBuilding),
    nodes: snapshot.nodes ?? [],
    edges: snapshot.edges ?? [],
    components: snapshot.components ?? [],
    traces: snapshot.traces,
    areas: snapshot.areas,
    // Outdoor/campus POIs (world geometry) — additive-optional pass-through.
    pois: snapshot.pois,
    doors: snapshot.doors,
    // Persistence fix: explicit separation decisions must survive save/reload.
    separatedCrossings: snapshot.separatedCrossings,
  }

  if (authoredDocument) {
    payload.authoredDocumentFormatVersion = AUTHORED_DOCUMENT_FORMAT_VERSION
    payload.authoredDocument = toAuthoredDocumentSnapshot(authoredDocument)
  }
  return payload
}

/**
 * Serialize a single Building into RPC-compatible format.
 *
 * Rules:
 *   - `outline` is populated from `footprint` if missing
 *   - `floors` preserved as array (RPC uses jsonb_array_length)
 *   - All original fields pass through unchanged
 */
function serializeBuilding(
  b: BuildingLike,
): RpcBuilding {
  return {
    ...b,
    id: b.id,
    name: b.name ?? '',
    campusId: b.campusId ?? '',
    floors: b.floors ?? [],
    footprint: b.footprint ?? [],
    outline: b.outline ?? b.footprint ?? [],
    baseElevation: b.baseElevation ?? 0,
    height: b.height ?? 10,
    color: b.color,
    center: b.center,
    code: b.code,
    description: b.description,
    floorPlanUrl: b.floorPlanUrl,
  }
}
