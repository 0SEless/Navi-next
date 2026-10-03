import type { GraphSnapshot } from '@/types/nav-types'
import { CAMPUS_BACKUP_FORMAT, CAMPUS_BACKUP_SCHEMA_VERSION } from './types'
import type { CampusBackupV1, CampusMapData } from './types'

export interface CreateCampusBackupInput {
  campusId: string
  /** Last known server revision, or null when unknown (offline/manual export). */
  revision?: string | null
  graph: GraphSnapshot
  campusMap?: CampusMapData
  /** Injectable ISO timestamp so callers/tests can produce identical envelopes. */
  exportedAt?: string
}

/**
 * Build a `navi-campus-backup/v1` envelope from the authoritative projections.
 *
 * Pure and deterministic: all inputs are deep-copied and no stable id, geometry
 * or metadata is rewritten. Passing the same inputs (and `exportedAt`) twice
 * yields semantically identical envelopes.
 */
export function createCampusBackup(input: CreateCampusBackupInput): CampusBackupV1 {
  const campusId = typeof input.campusId === 'string' ? input.campusId.trim() : ''
  if (campusId.length === 0) {
    throw new Error('createCampusBackup requires a non-empty campusId')
  }

  const envelope: CampusBackupV1 = {
    format: CAMPUS_BACKUP_FORMAT,
    schemaVersion: CAMPUS_BACKUP_SCHEMA_VERSION,
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    campusId,
    sourceRevision: input.revision ?? null,
    graph: structuredClone(input.graph),
  }

  if (input.campusMap !== undefined) {
    envelope.campusMap = structuredClone(input.campusMap)
  }

  return envelope
}
