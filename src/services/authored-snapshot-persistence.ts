import {
  AUTHORED_DOCUMENT_FORMAT_VERSION,
  deserializeAuthoredDocument,
  toAuthoredDocumentSnapshot,
} from '@navi/core'
import type { CampusDocument } from '@navi/core'

/** Additive companion format carried beside the legacy top-level Graph JSON. */
export interface AuthoredGraphPayload extends Record<string, unknown> {
  authoredDocumentFormatVersion?: typeof AUTHORED_DOCUMENT_FORMAT_VERSION
  authoredDocument?: CampusDocument
}

export interface ParsedAuthoredGraphPayload {
  graphPayload: Record<string, unknown>
  authoredDocument: CampusDocument | null
  authoredDocumentFormatVersion: number | null
  legacyGraphOnly: boolean
}

/**
 * Attach a detached authored snapshot without nesting the Graph. Keeping the
 * existing Graph fields at the top level preserves raw localStorage readers,
 * public fallback consumers, and old clients that ignore unknown keys.
 */
export function withAuthoredDocument(
  graphPayload: Record<string, unknown>,
  document: CampusDocument | null | undefined,
): AuthoredGraphPayload {
  const payload: AuthoredGraphPayload = { ...graphPayload }
  if (!document) return payload
  payload.authoredDocumentFormatVersion = AUTHORED_DOCUMENT_FORMAT_VERSION
  payload.authoredDocument = toAuthoredDocumentSnapshot(document)
  return payload
}

/** Serialize a Graph JSON object into the additive local/server draft shape. */
export function serializeAuthoredGraphPayload(
  graphPayload: Record<string, unknown>,
  document?: CampusDocument | null,
): AuthoredGraphPayload {
  return withAuthoredDocument(graphPayload, document)
}

/**
 * Read an additive payload. An absent authored field is explicitly classified
 * as legacy Graph-only; it never becomes an authored mutation or an automatic
 * rewrite. A present malformed field fails loudly so callers cannot silently
 * lose a new-format document.
 */
export function parseAuthoredGraphPayload(value: unknown): ParsedAuthoredGraphPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid persisted Graph payload: expected an object')
  }

  const input = value as Record<string, unknown>
  const rawAuthored = input.authoredDocument
  const versionValue = input.authoredDocumentFormatVersion
  if (versionValue !== undefined && versionValue !== AUTHORED_DOCUMENT_FORMAT_VERSION) {
    throw new Error(`Unsupported authored document format version: ${String(versionValue)}`)
  }
  const authoredDocument = rawAuthored === undefined || rawAuthored === null
    ? null
    : deserializeAuthoredDocument(rawAuthored)
  const authoredDocumentFormatVersion = typeof versionValue === 'number' ? versionValue : null

  return {
    graphPayload: { ...input },
    authoredDocument,
    authoredDocumentFormatVersion,
    legacyGraphOnly: authoredDocument === null,
  }
}

/** Extract only the authored document, preserving the legacy-null distinction. */
export function readAuthoredDocument(value: unknown): CampusDocument | null {
  return parseAuthoredGraphPayload(value).authoredDocument
}
