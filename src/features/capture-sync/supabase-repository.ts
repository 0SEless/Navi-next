import type { SupabaseClient } from '@supabase/supabase-js'

import { serializeCaptureSession } from '../capture/format'
import type { CaptureSession } from '../capture/types'
import { CaptureCloudError } from './errors'
import { hashCaptureSession } from './hash'
import { getCaptureSummaryDetails } from './summary'
import type {
  CaptureCloudRepository,
  RemoteCaptureSession,
  RemoteCaptureSummary,
  UploadResult,
} from './types'

export const CAPTURE_SESSIONS_TABLE = 'capture_sessions' as const

interface CaptureSessionRow {
  session_id: string
  owner_id?: string
  campus_id: string | null
  title: string
  status: CaptureSession['status']
  schema_version: number
  payload: CaptureSession
  content_hash: string
  client_updated_at: string
  created_at: string
  updated_at: string
}

interface SupabaseErrorLike {
  code?: string
  message?: string
  name?: string
  status?: number
}

function clone<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value)) as T
}

function asErrorLike(error: unknown): SupabaseErrorLike {
  if (typeof error !== 'object' || error === null) return {}
  const value = error as Record<string, unknown>
  return {
    code: typeof value.code === 'string' ? value.code : undefined,
    message: typeof value.message === 'string' ? value.message : undefined,
    name: typeof value.name === 'string' ? value.name : undefined,
    status: typeof value.status === 'number' ? value.status : undefined,
  }
}

function mapSupabaseError(error: unknown, fallback: 'REMOTE_ERROR' | 'NETWORK_ERROR' = 'REMOTE_ERROR') {
  const details = asErrorLike(error)
  const message = details.message?.toLowerCase() ?? ''
  const status = details.status

  if (
    status === 401 ||
    status === 403 ||
    details.code === 'PGRST301' ||
    /jwt|token|not authenticated|unauthorized|forbidden/.test(message)
  ) {
    return new CaptureCloudError('AUTH_REQUIRED', undefined, { cause: error })
  }

  if (
    status === 413 ||
    /payload too large|request entity too large|content too large/.test(message)
  ) {
    return new CaptureCloudError('PAYLOAD_TOO_LARGE', undefined, { cause: error })
  }

  if (
    fallback === 'NETWORK_ERROR' ||
    details.name === 'TypeError' ||
    /failed to fetch|network|offline|timeout|timed out|abort/.test(message)
  ) {
    return new CaptureCloudError('NETWORK_ERROR', undefined, { cause: error })
  }

  if (details.code === '23505') {
    return new CaptureCloudError('REMOTE_CONFLICT', undefined, { cause: error })
  }

  if (status === 400 || status === 422 || details.code === '23514') {
    return new CaptureCloudError('INVALID_PAYLOAD', undefined, { cause: error })
  }

  return new CaptureCloudError('REMOTE_ERROR', undefined, { cause: error })
}

function validationError(error: unknown): CaptureCloudError {
  const message = error instanceof Error ? error.message : ''
  const code = /schemaVersion is unsupported|schema version/i.test(message)
    ? 'UNSUPPORTED_SCHEMA'
    : 'INVALID_PAYLOAD'
  return new CaptureCloudError(code, undefined, { cause: error })
}

function validateSession(session: CaptureSession): void {
  if (typeof session.campusId !== 'string' || session.campusId.trim().length === 0) {
    throw new CaptureCloudError('CAMPUS_REQUIRED')
  }

  try {
    serializeCaptureSession(session, session.updatedAt)
  } catch (error) {
    throw validationError(error)
  }

  if (session.status !== 'finished') {
    throw new CaptureCloudError('SESSION_NOT_FINISHED')
  }
}

function toInsertRow(session: CaptureSession, contentHash: string): Omit<CaptureSessionRow, 'owner_id' | 'created_at' | 'updated_at'> {
  return {
    session_id: session.id,
    campus_id: session.campusId ?? null,
    title: session.title,
    status: session.status,
    schema_version: session.schemaVersion,
    payload: clone(session),
    content_hash: contentHash,
    client_updated_at: session.updatedAt,
  }
}

function toUpdateRow(session: CaptureSession, contentHash: string) {
  return {
    campus_id: session.campusId ?? null,
    title: session.title,
    status: session.status,
    schema_version: session.schemaVersion,
    payload: clone(session),
    content_hash: contentHash,
    client_updated_at: session.updatedAt,
  }
}

function assertRow(value: unknown): CaptureSessionRow {
  if (typeof value !== 'object' || value === null) {
    throw new CaptureCloudError('REMOTE_ERROR', 'The sync service returned an invalid session row.')
  }

  const row = value as Record<string, unknown>
  if (
    typeof row.session_id !== 'string' ||
    (row.campus_id !== null && typeof row.campus_id !== 'string') ||
    typeof row.title !== 'string' ||
    typeof row.schema_version !== 'number' ||
    typeof row.content_hash !== 'string' ||
    typeof row.client_updated_at !== 'string' ||
    typeof row.created_at !== 'string' ||
    typeof row.updated_at !== 'string'
  ) {
    throw new CaptureCloudError('REMOTE_ERROR', 'The sync service returned an invalid session row.')
  }

  try {
    serializeCaptureSession(row.payload as CaptureSession, row.client_updated_at)
  } catch (error) {
    throw new CaptureCloudError('REMOTE_ERROR', 'The sync service returned an invalid Capture payload.', {
      cause: error,
    })
  }

  if (row.status !== 'recording' && row.status !== 'paused' && row.status !== 'finished') {
    throw new CaptureCloudError('REMOTE_ERROR', 'The sync service returned an invalid session status.')
  }

  return row as unknown as CaptureSessionRow
}

function toSummary(row: CaptureSessionRow): RemoteCaptureSummary {
  return {
    sessionId: row.session_id,
    campusId: row.campus_id,
    title: row.title,
    status: row.status,
    schemaVersion: row.schema_version,
    contentHash: row.content_hash,
    clientUpdatedAt: row.client_updated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...getCaptureSummaryDetails(row.payload),
  }
}

function toRemoteSession(row: CaptureSessionRow): RemoteCaptureSession {
  return {
    ...toSummary(row),
    session: clone(row.payload),
  }
}

export function createSupabaseCaptureRepository(client: SupabaseClient): CaptureCloudRepository {
  async function requireAuthenticatedUser(): Promise<void> {
    try {
      const { data, error } = await client.auth.getUser()
      if (error) {
        throw mapSupabaseError(error, 'NETWORK_ERROR')
      }
      if (!data.user?.id) {
        throw new CaptureCloudError('AUTH_REQUIRED')
      }
    } catch (error) {
      if (error instanceof CaptureCloudError) throw error
      throw mapSupabaseError(error, 'NETWORK_ERROR')
    }
  }

  async function getRow(sessionId: string): Promise<CaptureSessionRow | null> {
    const { data, error } = await client
      .from(CAPTURE_SESSIONS_TABLE)
      .select('*')
      .eq('session_id', sessionId)
      .maybeSingle()

    if (error) {
      throw mapSupabaseError(error)
    }
    return data ? assertRow(data) : null
  }

  async function insertRow(session: CaptureSession, contentHash: string): Promise<CaptureSessionRow> {
    const { data, error } = await client
      .from(CAPTURE_SESSIONS_TABLE)
      .insert(toInsertRow(session, contentHash))
      .select('*')
      .single()

    if (error) {
      throw mapSupabaseError(error)
    }
    if (!data) {
      throw new CaptureCloudError('REMOTE_ERROR', 'The sync service did not return the inserted session.')
    }
    return assertRow(data)
  }

  async function updateRow(
    session: CaptureSession,
    contentHash: string,
    expectedRemoteHash: string,
  ): Promise<CaptureSessionRow | null> {
    const { data, error } = await client
      .from(CAPTURE_SESSIONS_TABLE)
      .update(toUpdateRow(session, contentHash))
      .eq('session_id', session.id)
      .eq('content_hash', expectedRemoteHash)
      .select('*')
      .maybeSingle()

    if (error) {
      throw mapSupabaseError(error)
    }
    return data ? assertRow(data) : null
  }

  async function getSession(sessionId: string): Promise<RemoteCaptureSession | null> {
    await requireAuthenticatedUser()
    const row = await getRow(sessionId)
    return row ? toRemoteSession(row) : null
  }

  async function listSessions(options?: { campusId?: string | null }): Promise<RemoteCaptureSummary[]> {
    await requireAuthenticatedUser()
    let query = client.from(CAPTURE_SESSIONS_TABLE).select('*')
    if (options && options.campusId !== undefined) {
      query = query.eq('campus_id', options.campusId)
    }
    const { data, error } = await query.order('updated_at', { ascending: false })
    if (error) {
      throw mapSupabaseError(error)
    }
    return (data ?? []).map((row) => toSummary(assertRow(row)))
  }

  async function uploadSession(
    session: CaptureSession,
    expectedRemoteHash?: string | null,
  ): Promise<UploadResult> {
    validateSession(session)
    await requireAuthenticatedUser()
    const contentHash = await hashCaptureSession(session)
    const current = await getRow(session.id)

    if (!current) {
      try {
        return { kind: 'uploaded', remote: toSummary(await insertRow(session, contentHash)) }
      } catch (error) {
        if (error instanceof CaptureCloudError && error.code === 'REMOTE_CONFLICT') {
          const raced = await getRow(session.id)
          if (!raced) throw error
          if (raced.content_hash === contentHash) {
            return { kind: 'unchanged', remote: toSummary(raced) }
          }
          return { kind: 'conflict', remote: toSummary(raced) }
        }
        throw error
      }
    }

    if (current.content_hash === contentHash) {
      return { kind: 'unchanged', remote: toSummary(current) }
    }

    const expectedHash = expectedRemoteHash ?? null
    if (current.content_hash !== expectedHash) {
      return { kind: 'conflict', remote: toSummary(current) }
    }

    const updated = await updateRow(session, contentHash, current.content_hash)
    if (updated) {
      return { kind: 'uploaded', remote: toSummary(updated) }
    }

    const afterConditionalUpdate = await getRow(session.id)
    if (!afterConditionalUpdate) {
      throw new CaptureCloudError('REMOTE_ERROR', 'The Capture session disappeared during sync.')
    }
    if (afterConditionalUpdate.content_hash === contentHash) {
      return { kind: 'unchanged', remote: toSummary(afterConditionalUpdate) }
    }
    return { kind: 'conflict', remote: toSummary(afterConditionalUpdate) }
  }

  return {
    getSession,
    listSessions,
    uploadSession,
  }
}
