/**
 * Graph revision history client (fetch-only).
 *
 * Domain service for the durable server-side revision ledger created by
 * `supabase/migrations/010_campus_graph_revisions.sql`. This module never
 * imports a Supabase client and never touches localStorage: it is the single
 * transport boundary between the app and the revision API routes.
 *
 * Route contract (route handlers land in a later phase):
 *
 *   GET /api/graph-revisions?campus_id=<id>[&limit=<n>]
 *     -> 200 { success: true, campus_id, revisions: RevisionRow[] }
 *     -> 400 | 401 | 403 | 500 { error }
 *
 *   POST /api/graph-revisions/restore
 *     body { campusId, revision, expectedCurrent }
 *     -> 200 { success: true, campus_id, updatedAt, restored_from }
 *     -> 409 { error }  (GRAPH_SNAPSHOT_CONFLICT: stale expectedCurrent)
 *     -> 400 | 401 | 403 | 500 { error }
 *
 * Restore is forward-only on the server: the historical revision's graph_data
 * is replayed through the same write path as a normal save, producing a NEW
 * revision (source='restore', parent_revision = current). This client never
 * sends graph data; the server is the only source of historical payloads.
 */

export type GraphRevisionSource = 'autosave' | 'manual' | 'restore' | 'force' | 'import'

export interface GraphRevisionSummary {
  id: number
  campusId: string
  revision: string
  parentRevision: string | null
  checksum: string
  createdAt: string
  createdBy: string
  /** Known values: autosave | manual | restore | force | import. */
  source: GraphRevisionSource | (string & {})
  metadata: Record<string, unknown>
}

export type ListGraphRevisionsResult =
  | { status: 'ok'; campusId: string; revisions: GraphRevisionSummary[] }
  | { status: 'unauthorized'; message: string }
  | { status: 'error'; message: string }

export type RestoreGraphRevisionResult =
  | { status: 'restored'; campusId: string; updatedAt: string; restoredFrom: string }
  | { status: 'conflict'; message: string }
  | { status: 'unauthorized'; message: string }
  | { status: 'error'; message: string }

export interface RestoreGraphRevisionInput {
  campusId: string
  revision: string
  expectedCurrent: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return null
}

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body: unknown = await res.json()
    if (isRecord(body) && typeof body.error === 'string' && body.error.length > 0) return body.error
  } catch {
    // Non-JSON error body; keep the HTTP-status fallback.
  }
  return fallback
}

function parseRevisionSummary(value: unknown, campusId: string): GraphRevisionSummary | null {
  if (!isRecord(value)) return null
  const revision = readString(value, 'revision')
  const checksum = readString(value, 'checksum')
  const createdAt = readString(value, 'createdAt', 'created_at')
  const id = value.id
  if (revision === null || checksum === null || createdAt === null) return null
  if (typeof id !== 'number' || !Number.isFinite(id)) return null
  return {
    id,
    campusId: readString(value, 'campusId', 'campus_id') ?? campusId,
    revision,
    parentRevision: readString(value, 'parentRevision', 'parent_revision'),
    checksum,
    createdAt,
    createdBy: readString(value, 'createdBy', 'created_by') ?? 'api',
    source: readString(value, 'source') ?? 'autosave',
    metadata: isRecord(value.metadata) ? value.metadata : {},
  }
}

/**
 * List the revision ledger for a campus, newest first when the server orders
 * by `(campus_id, revision desc)`.
 */
export async function listGraphRevisions(
  campusId: string,
  options: { limit?: number } = {},
): Promise<ListGraphRevisionsResult> {
  const id = campusId.trim()
  if (id.length === 0) return { status: 'error', message: 'campusId is required' }

  const params = new URLSearchParams({ campus_id: id })
  if (typeof options.limit === 'number' && Number.isFinite(options.limit)) {
    params.set('limit', String(options.limit))
  }

  let res: Response
  try {
    res = await fetch(`/api/graph-revisions?${params.toString()}`, { credentials: 'include' })
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Unable to reach the revision history service',
    }
  }

  if (res.status === 401 || res.status === 403) {
    return { status: 'unauthorized', message: await readErrorMessage(res, `HTTP ${res.status}`) }
  }
  if (!res.ok) {
    return { status: 'error', message: await readErrorMessage(res, `HTTP ${res.status}`) }
  }

  let body: unknown
  try {
    body = await res.json()
  } catch {
    return { status: 'error', message: 'Malformed revision history response' }
  }
  if (!isRecord(body) || !Array.isArray(body.revisions)) {
    return { status: 'error', message: 'Malformed revision history response' }
  }

  const revisions: GraphRevisionSummary[] = []
  for (const entry of body.revisions) {
    const summary = parseRevisionSummary(entry, id)
    if (summary === null) return { status: 'error', message: 'Malformed revision history response' }
    revisions.push(summary)
  }

  return {
    status: 'ok',
    campusId: readString(body, 'campus_id', 'campusId') ?? id,
    revisions,
  }
}

/**
 * Restore a historical revision through the server CAS path. `expectedCurrent`
 * is the `updatedAt` this client last observed; a mismatch returns
 * `{ status: 'conflict' }` and no server state changes.
 */
export async function restoreGraphRevision(
  input: RestoreGraphRevisionInput,
): Promise<RestoreGraphRevisionResult> {
  const campusId = input.campusId.trim()
  const revision = input.revision.trim()
  if (campusId.length === 0) return { status: 'error', message: 'campusId is required' }
  if (revision.length === 0) return { status: 'error', message: 'revision is required' }

  let res: Response
  try {
    res = await fetch('/api/graph-revisions/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        campusId,
        revision,
        expectedCurrent: input.expectedCurrent,
      }),
    })
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Unable to reach the revision history service',
    }
  }

  if (res.status === 401 || res.status === 403) {
    return { status: 'unauthorized', message: await readErrorMessage(res, `HTTP ${res.status}`) }
  }
  if (res.status === 409) {
    return { status: 'conflict', message: await readErrorMessage(res, 'The server changed since the restore was prepared.') }
  }
  if (!res.ok) {
    return { status: 'error', message: await readErrorMessage(res, `HTTP ${res.status}`) }
  }

  let body: unknown
  try {
    body = await res.json()
  } catch {
    return { status: 'error', message: 'Malformed restore response' }
  }
  if (!isRecord(body)) {
    return { status: 'error', message: 'Malformed restore response' }
  }

  const updatedAt = readString(body, 'updatedAt', 'updated_at')
  const restoredFrom = readString(body, 'restored_from', 'restoredFrom')
  if (updatedAt === null || restoredFrom === null) {
    return { status: 'error', message: 'Malformed restore response' }
  }

  return {
    status: 'restored',
    campusId: readString(body, 'campus_id', 'campusId') ?? campusId,
    updatedAt,
    restoredFrom,
  }
}
