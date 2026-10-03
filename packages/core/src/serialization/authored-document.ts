import type { CampusDocument } from '../types/document'
import { deserializeDocument, serializeDocument } from './serializer'

/** Version of the companion authored-document persistence representation. */
export const AUTHORED_DOCUMENT_FORMAT_VERSION = 1 as const

/**
 * Make a detached authored snapshot suitable for persistence or hydration.
 *
 * The existing document serializer is deliberately used as the first step so
 * feature migrations and the legacy staircase/elevator compatibility view stay
 * identical to the rest of the core persistence code. The change journal is
 * runtime-only and is never carried into the snapshot.
 */
export function toAuthoredDocumentSnapshot(document: CampusDocument): CampusDocument {
  const snapshot = JSON.parse(serializeDocument(document)) as CampusDocument
  delete snapshot._changeJournal
  return snapshot
}

/**
 * Return the authored fields used for canonical persistence identity.
 *
 * `version`, editor timestamps, and the change journal describe an editing
 * session or transport event rather than authored content. Everything else is
 * retained, including fields that the derived Graph cannot represent.
 */
export function canonicalizeAuthoredDocument(document: CampusDocument): unknown {
  const snapshot = toAuthoredDocumentSnapshot(document) as unknown as Record<string, unknown>
  // Schema/version counters describe the representation or editing session,
  // not authored campus content. The transport carries its own
  // AUTHORED_DOCUMENT_FORMAT_VERSION for migrations.
  delete snapshot.schemaVersion
  delete snapshot.version
  delete snapshot._changeJournal

  const metadata = snapshot.metadata
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    const cleanMetadata = metadata as Record<string, unknown>
    delete cleanMetadata.lastModified
    delete cleanMetadata.editorVersion
  }

  return stableCanonicalValue(snapshot)
}

/** Stable JSON representation: object keys are sorted, array order is authored. */
export function serializeAuthoredDocument(document: CampusDocument): string {
  return JSON.stringify(canonicalizeAuthoredDocument(document))
}

/**
 * Validate and hydrate an authored snapshot. Canonical snapshots intentionally
 * omit session metadata; defaults are restored so callers receive a normal
 * CampusDocument shape without inventing authored fields.
 */
export function deserializeAuthoredDocument(value: unknown): CampusDocument {
  const parsed = typeof value === 'string' ? JSON.parse(value) : cloneJson(value)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid authored document snapshot: expected an object')
  }

  const document = parsed as Record<string, unknown>
  if (typeof document.version !== 'number') document.version = 0
  if (typeof document.schemaVersion !== 'number') document.schemaVersion = 1
  if (!document.metadata || typeof document.metadata !== 'object' || Array.isArray(document.metadata)) {
    throw new Error('Invalid authored document snapshot: missing metadata')
  }
  const metadata = document.metadata as Record<string, unknown>
  if (typeof metadata.lastModified !== 'string') metadata.lastModified = ''
  if (typeof metadata.editorVersion !== 'string') metadata.editorVersion = ''

  return deserializeDocument(JSON.stringify(document))
}

/** Deterministic authored-content fingerprint (FNV-1a, lower-case hex). */
export function authoredFingerprint(document: CampusDocument): string {
  const input = serializeAuthoredDocument(document)
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

function cloneJson(value: unknown): unknown {
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value))
}

function stableCanonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableCanonicalValue)
  if (!value || typeof value !== 'object') return value

  const record = value as Record<string, unknown>
  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(record).sort()) {
    sorted[key] = stableCanonicalValue(record[key])
  }
  return sorted
}
