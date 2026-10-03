import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { isStableQrId } from '@/lib/qr-payload'

const PUBLIC_QR_READ_FAILED = 'PUBLIC_QR_READ_FAILED'

interface PublicQrCheckpoint {
  id: string
  label?: string
  buildingId?: string
  floor?: number
  position?: { x: number; y: number }
  code?: string
}

interface PublishedMapRow {
  campus_id?: unknown
  artifacts?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  return createServerClient(url, key, {
    cookies: { getAll: () => [], setAll: () => {} },
  })
}

function isSafePublicCode(value: unknown, checkpointId: string): value is string {
  if (typeof value !== 'string') return false
  return value === `navi.app/q/${checkpointId}`
    || value === `https://navi.app/q/${checkpointId}`
    || value === `https://www.navi.app/q/${checkpointId}`
}

function sanitizeCheckpoint(raw: unknown, checkpointId: string): PublicQrCheckpoint | null {
  if (!isRecord(raw) || raw.id !== checkpointId) return null

  const checkpoint: PublicQrCheckpoint = { id: checkpointId }
  if (typeof raw.label === 'string' && raw.label.trim().length > 0) {
    checkpoint.label = raw.label
  }
  if (typeof raw.buildingId === 'string' && raw.buildingId.trim().length > 0) {
    checkpoint.buildingId = raw.buildingId
  }
  if (typeof raw.floor === 'number' && Number.isFinite(raw.floor)) {
    checkpoint.floor = raw.floor
  }
  if (
    isRecord(raw.position)
    && typeof raw.position.x === 'number'
    && Number.isFinite(raw.position.x)
    && typeof raw.position.y === 'number'
    && Number.isFinite(raw.position.y)
  ) {
    checkpoint.position = { x: raw.position.x, y: raw.position.y }
  }
  if (isSafePublicCode(raw.code, checkpointId)) checkpoint.code = raw.code
  return checkpoint
}

function invalidCheckpointResponse() {
  return NextResponse.json(
    { status: 'invalid', reason: 'malformed-checkpoint' },
    { status: 400 },
  )
}

/**
 * Resolve an opaque QR checkpoint through published runtime artifacts.
 * Draft/snapshot data is intentionally never consulted by this endpoint.
 */
export async function GET(request: NextRequest) {
  const values = request.nextUrl.searchParams.getAll('checkpoint_id')
  if (values.length !== 1) return invalidCheckpointResponse()

  const checkpointId = values[0].trim()
  if (!isStableQrId(checkpointId)) return invalidCheckpointResponse()

  let data: unknown
  try {
    const supabase = getClient()
    const result = await supabase
      .from('published_maps')
      .select('campus_id, artifacts') as unknown as { data: unknown; error: unknown | null }
    if (result.error) {
      return NextResponse.json(
        { status: 'unavailable', code: PUBLIC_QR_READ_FAILED },
        { status: 503 },
      )
    }
    data = result.data
  } catch {
    return NextResponse.json(
      { status: 'unavailable', code: PUBLIC_QR_READ_FAILED },
      { status: 503 },
    )
  }

  const matches: Array<{ campusId: string; checkpoint: PublicQrCheckpoint }> = []
  const rows = Array.isArray(data) ? data : []
  for (const rawRow of rows) {
    if (!isRecord(rawRow)) continue
    const row = rawRow as PublishedMapRow
    if (typeof row.campus_id !== 'string' || row.campus_id.trim().length === 0) continue
    if (!isRecord(row.artifacts) || !isRecord(row.artifacts.qrIndex)) continue

    const index = row.artifacts.qrIndex
    if (index.campusId !== row.campus_id || !Array.isArray(index.checkpoints)) continue
    for (const rawCheckpoint of index.checkpoints) {
      const checkpoint = sanitizeCheckpoint(rawCheckpoint, checkpointId)
      if (checkpoint) matches.push({ campusId: row.campus_id, checkpoint })
    }
  }

  if (matches.length === 0) {
    return NextResponse.json({ status: 'unknown', checkpointId }, { status: 404 })
  }
  if (matches.length > 1) {
    return NextResponse.json({ status: 'ambiguous', checkpointId }, { status: 409 })
  }

  return NextResponse.json({
    status: 'resolved',
    campusId: matches[0].campusId,
    checkpoint: matches[0].checkpoint,
  })
}
