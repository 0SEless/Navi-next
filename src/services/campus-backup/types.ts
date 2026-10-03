import type { GraphSnapshot } from '@/types/nav-types'
import type { CampusMap, LandmarkInstance, LandmarkType } from '@/types/campus-map'

/**
 * Lossless JSON backup contract for authored campus data.
 *
 * The envelope is a plain-data, versioned wrapper around the authoritative
 * persisted projections:
 *  - `graph`     — the `graph_snapshots.data` payload (`GraphSnapshot`)
 *  - `campusMap` — the `campus_maps.data` payload (campus metadata row plus
 *                  landmark types/instances when the row carries them)
 *
 * No database, storage or network access happens anywhere in this module.
 */
export const CAMPUS_BACKUP_FORMAT = 'navi-campus-backup/v1' as const

export const CAMPUS_BACKUP_SCHEMA_VERSION = 1

/** Shape of the `campus_maps.data` JSON row: campus metadata + landmark add-ons. */
export interface CampusMapData extends CampusMap {
  landmarkTypes?: LandmarkType[]
  landmarkInstances?: LandmarkInstance[]
}

export interface CampusBackupV1 {
  format: typeof CAMPUS_BACKUP_FORMAT
  schemaVersion: number
  /** ISO timestamp of the export. Informational — not used for conflict resolution. */
  exportedAt: string
  /** Authoritative campus identity. Must match `graph.campusId`. */
  campusId: string
  /** Last known server revision (`updatedAt`) the export was taken from, or null when unknown. */
  sourceRevision: string | null
  /** Authoritative authored graph payload (`graph_snapshots.data`). */
  graph: GraphSnapshot
  /** Optional campus metadata row (`campus_maps.data`). */
  campusMap?: CampusMapData
}

export type CampusBackupIssueCode =
  | 'not-an-object'
  | 'unknown-format'
  | 'unsupported-schema-version'
  | 'missing-field'
  | 'invalid-field'
  | 'invalid-coordinate'
  | 'campus-id-mismatch'
  | 'duplicate-id'
  | 'dangling-edge'
  | 'dangling-component-building'
  | 'dangling-door-room'
  | 'dangling-door-building'
  | 'dangling-door-floor'
  | 'dangling-route-edge'
  | 'dangling-trace-reference'
  | 'invalid-trace'
  | 'count-mismatch'
  | 'unknown-field'
  | 'empty-graph'

export interface CampusBackupIssue {
  severity: 'error' | 'warning'
  code: CampusBackupIssueCode
  /** JSON-path-like location, e.g. `graph.edges[2].to`. Empty for whole-payload issues. */
  path: string
  message: string
}

export interface CampusBackupValidationResult {
  valid: boolean
  errors: CampusBackupIssue[]
  warnings: CampusBackupIssue[]
  /** Normalized envelope when valid; null when the payload was rejected. */
  backup: CampusBackupV1 | null
}
