/**
 * PublishedCampus — the canonical runtime model.
 *
 * This is the Runtime Domain's type. It represents the complete, self-contained
 * runtime representation of a campus. Every runtime consumer (User App, Route
 * Testing, Mobile, Offline, SDK) consumes only this type.
 *
 * The compiler produces `NavigationArtifacts` (its internal type). The publish
 * boundary transforms those into `PublishedCampus` (the exported runtime contract).
 * These may be structurally identical today, but they are different concepts at
 * different layers.
 *
 * Design principles:
 * - Runtime Completeness: contains everything any runtime consumer may need
 * - Canonical data + published indexes (not just canonical)
 * - Transport agnostic (JSON is one serialization, not the definition)
 *
 * @see ADR-001-domain-boundaries.md
 * @see ADR-002-published-runtime-contract.md
 */

import type { LatLng } from './coordinates'
import type {
  BoundingBox,
  NavNode,
  NavEdge,
  SearchIndex,
  SpatialIndex,
  POI,
  PanoramaEntry,
  BuildingEntry,
} from './navigation-artifacts'

// ── Metadata ──

export interface PublishedCampusMetadata {
  /** Unique campus identifier. */
  campusId: string
  /** ISO 8601 timestamp of publication. */
  publishedAt: string
  /** Compiler version that produced this package. */
  compilerVersion: string
}

// ── Buildings ──

/**
 * A published building. Extends the compiler's BuildingEntry with
 * runtime-specific fields that presentation consumers need.
 *
 * The compiler's `BuildingEntry` is the base. This type adds fields
 * that are useful to runtime consumers but not produced by the compiler.
 *
 * TODO Phase 2: PublishedBuilding becomes runtime-owned and no longer
 * extends BuildingEntry. The Runtime Domain should not depend on
 * Compiler Domain types. For now, inheritance is a migration strategy
 * to avoid touching the compiler.
 */
export interface PublishedBuilding extends BuildingEntry {
  /** Building description for detail views. */
  description?: string
  /** Alternative names for search matching. */
  aliases?: string[]
}

// ── Navigation ──

/**
 * The navigation graph. Nodes and edges for pathfinding and rendering.
 */
export interface PublishedNavigation {
  nodes: NavNode[]
  edges: NavEdge[]
}

// ── Published Campus ──

/**
 * The complete runtime representation of a campus.
 *
 * This is the single source of truth for all runtime consumers.
 * It contains:
 * - Canonical data: buildings, navigation, POIs, panoramas
 * - Published indexes: search, spatial (compiler-produced optimizations)
 * - Metadata: campus identity, publication timestamp
 *
 * Runtime consumers must never reconstruct, infer, or retrieve
 * authoring data to function correctly.
 */
export interface PublishedCampus {
  /** Campus identity and publication metadata. */
  metadata: PublishedCampusMetadata

  /** Campus boundary bounding box. */
  boundary: BoundingBox | null

  /** All buildings with floors, rooms, entrances, and geometry. */
  buildings: PublishedBuilding[]

  /** Navigation graph (nodes and edges). */
  navigation: PublishedNavigation

  /** Points of interest. */
  pois: POI[]

  /** 360° panoramas with hotspots. */
  panoramas: PanoramaEntry[]

  /** Published indexes (compiler-produced runtime optimizations). */
  indexes: {
    /** Tokenized search index for fast text search. */
    search: SearchIndex
    /** Grid-cell spatial index for proximity queries. */
    spatial: SpatialIndex
  }
}
