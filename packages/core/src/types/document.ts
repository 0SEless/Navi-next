import type { Building, Road, Panorama, QRCheckpoint, Area, OutdoorPointOfInterest } from './entities'

export interface DocumentMetadata {
  /** Authoritative campus identity — immutable once created. Used as the canonical
   *  campusId through publish, persistence, and runtime resolution. Must never be
   *  confused with `name`, which is the human-readable display label. */
  campusId: string
  /** Human-readable display name. May change freely (e.g., "ASU Ibajay" → "Main Campus").
   *  NOT used as a campus identifier. */
  name: string
  description: string
  lastModified: string  // ISO timestamp
  editorVersion: string // NAVI Studio version that last saved
}

export interface EntityChange {
  readonly entityId: string
  readonly entityType: string
  // 'restored' = undo of a delete (entity reintroduced verbatim).
  readonly operation: 'created' | 'updated' | 'deleted' | 'restored'
}

/**
 * Explicit road junction — a stable shared connection point where two or more
 * roads meet. Persisted on CampusDocument so junction identity survives the
 * full graph rebuild cycle in GraphAdapter.sync().
 *
 * JUNCTION ID STABILITY:
 * - IDs are assigned once when the junction is first detected.
 * - IDs are reused across save/reload/rebuild cycles.
 * - Moving a road does not change the junction ID.
 * - Removing the last road from a junction removes the junction record.
 */
export interface RoadJunction {
  /** Stable unique identifier. Assigned once, never regenerated. */
  id: string
  /** Geographic position of the junction (world coordinates). */
  position: { lat: number; lng: number }
  /** IDs of roads that participate in this junction (minimum 2). */
  roadIds: string[]
  /** Provenance: was this junction explicitly authored or auto-detected? */
  source?: 'authored' | 'legacy-inferred'
}

/**
 * A geometric crossing that the administrator has explicitly marked as
 * "Keep Separate" — roads cross visually but must NOT be connected for routing.
 *
 * Persisted on CampusDocument so syncTraceIntersections does not recreate
 * the rejected junction.
 */
export interface SeparatedCrossing {
  /** Stable unique identifier. */
  id: string
  /** IDs of the two roads that cross (order-independent). */
  roadIds: [string, string]
  /** Geographic position of the geometric intersection. */
  position: { lat: number; lng: number }
}

export interface CampusDocument {
  schemaVersion: number  // currently 1
  version: number        // monotonic version counter, incremented on every change
  metadata: DocumentMetadata
  buildings: Building[]
  roads: Road[]
  panoramas: Panorama[]
  qrCheckpoints: QRCheckpoint[]
  areas?: Area[]
  /**
   * Outdoor/campus POIs authored directly on the campus map (world LatLng
   * geometry, no building/floor context). Indoor POIs remain on
   * `Floor.pois[]` — outdoor and indoor share identity/geometry/appearance
   * contracts and the same runtime POI index. Absent = no outdoor POIs
   * (additive-optional, legacy documents stay byte-stable).
   */
  pois?: OutdoorPointOfInterest[]
  /** Explicit road junctions — stable shared connection points. Survives save/reload. */
  roadJunctions?: RoadJunction[]
  /** Separated crossings — geometric intersections marked "Keep Separate". Survives save/reload. */
  separatedCrossings?: SeparatedCrossing[]
  /**
   * Connectivity semantics contract version. Present when the document has been
   * authored under explicit connectivity semantics (Phase 3+). Absent (undefined)
   * for legacy documents that predate the contract.
   *
   * The compiler and GraphAdapter use this to select canonical vs legacy behavior:
   *   - Present: use canonical ConnectivitySemantics, no geometric inference
   *   - Absent: use legacy geometric inference for backward compatibility
   *
   * Set on first save after connectivity semantics are introduced. Never decremented.
   */
  connectivitySemanticsVersion?: string
  /** Campus outer boundary polygon. Optional — set via boundary tool. */
  boundary?: { points: Array<{ lat: number; lng: number }> }
  /** Runtime-only change journal. Not serialized. Populated during editing sessions. */
  _changeJournal?: EntityChange[]
}

/** Record a change and bump the document version. */
export function recordChange(document: CampusDocument, change: EntityChange): void {
  if (!document._changeJournal) {
    document._changeJournal = []
  }
  document._changeJournal.push(change)
  document.version++
}

/**
 * Return all changes recorded since the given version.
 * Non-destructive — multiple callers can query independently.
 */
export function getChangesSince(document: CampusDocument, version: number): readonly EntityChange[] {
  if (!document._changeJournal || version >= document.version) return []
  const startIndex = Math.max(0, version)
  return document._changeJournal.slice(startIndex)
}
