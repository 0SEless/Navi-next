export interface PublishedMapRow {
  campus_id: string
  revision: number
  compiler_version: string
  artifacts: Record<string, unknown>
  published_at: string
}

interface PublishedMapQuery {
  update(row: PublishedMapRow): PublishedMapQuery
  insert(row: PublishedMapRow): PublishedMapQuery
  eq(column: string, value: unknown): PublishedMapQuery
  lt(column: string, value: unknown): PublishedMapQuery
  select(columns?: string): Promise<{ data?: unknown; error?: unknown }>
  maybeSingle(): Promise<{ data?: unknown; error?: unknown }>
}

export interface PublishedMapClient {
  from(table: string): unknown
}

export type PublishedMapWriteResult =
  | { status: 'published' }
  | { status: 'rejected'; currentRevision: number }
  | { status: 'error'; message: string }

function errorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message
  }
  return fallback
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && 'code' in error
    && (error as { code?: unknown }).code === '23505',
  )
}

async function conditionalUpdate(
  client: PublishedMapClient,
  row: PublishedMapRow,
  operator: 'lt' | 'eq',
): Promise<{ status: 'updated' | 'missing' | 'error'; message?: string }> {
  const query = (client.from('published_maps') as PublishedMapQuery)
    .update(row)
    .eq('campus_id', row.campus_id)

  const filtered = operator === 'lt'
    ? query.lt('revision', row.revision)
    : query.eq('revision', row.revision)
  const result = await filtered.select('campus_id,revision')

  if (result?.error) {
    return { status: 'error', message: errorMessage(result.error, 'Conditional published_maps update failed') }
  }
  return {
    status: Array.isArray(result?.data) && result.data.length > 0 ? 'updated' : 'missing',
  }
}

async function readCurrentRevision(
  client: PublishedMapClient,
  campusId: string,
): Promise<{ revision: number | null; error?: string }> {
  const result = await (client.from('published_maps') as PublishedMapQuery)
    .select('revision')
    .eq('campus_id', campusId)
    .maybeSingle()

  if (result?.error) {
    return { revision: null, error: errorMessage(result.error, 'Unable to read current published revision') }
  }
  const revision = result?.data?.revision
  return {
    revision: typeof revision === 'number' && Number.isInteger(revision) ? revision : null,
  }
}

/**
 * Monotonic published-map write without a schema migration.
 *
 * The first two updates are the concurrency gate: they only match a row whose
 * revision is older than, or equal to, the incoming revision. Insert handles
 * the first publish. A unique conflict means another writer won the insert
 * race, so the same conditional updates are retried before classifying the
 * winner as newer.
 */
export async function writePublishedMap(
  client: PublishedMapClient,
  row: PublishedMapRow,
): Promise<PublishedMapWriteResult> {
  const newer = await conditionalUpdate(client, row, 'lt')
  if (newer.status === 'updated') return { status: 'published' }
  if (newer.status === 'error') return { status: 'error', message: newer.message! }

  const equal = await conditionalUpdate(client, row, 'eq')
  if (equal.status === 'updated') return { status: 'published' }
  if (equal.status === 'error') return { status: 'error', message: equal.message! }

  const inserted = await (client.from('published_maps') as PublishedMapQuery)
    .insert(row)
    .select('campus_id,revision')
  if (!inserted?.error) return { status: 'published' }
  if (!isUniqueViolation(inserted.error)) {
    return { status: 'error', message: errorMessage(inserted.error, 'Published map insert failed') }
  }

  const retryNewer = await conditionalUpdate(client, row, 'lt')
  if (retryNewer.status === 'updated') return { status: 'published' }
  if (retryNewer.status === 'error') return { status: 'error', message: retryNewer.message! }

  const retryEqual = await conditionalUpdate(client, row, 'eq')
  if (retryEqual.status === 'updated') return { status: 'published' }
  if (retryEqual.status === 'error') return { status: 'error', message: retryEqual.message! }

  const current = await readCurrentRevision(client, row.campus_id)
  if (current.error) return { status: 'error', message: current.error }
  if (current.revision !== null && current.revision > row.revision) {
    return { status: 'rejected', currentRevision: current.revision }
  }

  return {
    status: 'error',
    message: 'Published map changed during revision-protected write; retry required',
  }
}
