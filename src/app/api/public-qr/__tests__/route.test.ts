// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@supabase/ssr', () => ({ createServerClient: vi.fn() }))

import { createServerClient } from '@supabase/ssr'
import { GET } from '../route'

const checkpoint = (id: string, campusId: string) => ({
  id,
  label: `${campusId} checkpoint`,
  buildingId: 'building-1',
  floor: 3,
  position: { x: 4, y: 8 },
  code: `navi.app/q/${id}`,
})

function configureSupabase(
  behavior: { data: unknown; error: unknown | null } | { throws: Error },
) {
  const client = {
    from: vi.fn(() => ({
      select: vi.fn(async () => {
        if ('throws' in behavior) throw behavior.throws
        return behavior
      }),
    })),
  }
  ;(createServerClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(client)
  return client
}

function request(query = 'CS-3F-EAST-01') {
  return new NextRequest(`http://localhost/api/public-qr?checkpoint_id=${encodeURIComponent(query)}`)
}

function publishedRow(id: string, campusId: string) {
  return {
    campus_id: campusId,
    artifacts: {
      qrIndex: {
        schemaVersion: 1,
        formatVersion: 1,
        campusId,
        checkpoints: [checkpoint(id, campusId)],
      },
    },
  }
}

describe('GET /api/public-qr', () => {
  it('resolves an exact checkpoint from published maps only', async () => {
    const client = configureSupabase({
      data: [publishedRow('CS-3F-EAST-01', 'campus-b')],
      error: null,
    })

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      status: 'resolved',
      campusId: 'campus-b',
      checkpoint: checkpoint('CS-3F-EAST-01', 'campus-b'),
    })
    expect(client.from).toHaveBeenCalledWith('published_maps')
  })

  it('returns unknown for stale, unpublished, or malformed published indexes', async () => {
    configureSupabase({
      data: [
        { campus_id: 'campus-a', artifacts: { graph: {} } },
        { campus_id: 'campus-b', artifacts: { qrIndex: { campusId: 'campus-b', checkpoints: [] } } },
      ],
      error: null,
    })

    const response = await GET(request('missing'))
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body).toEqual({ status: 'unknown', checkpointId: 'missing' })
  })

  it('fails closed for empty, duplicate, oversized, and malformed query values', async () => {
    const empty = await GET(request(''))
    expect(empty.status).toBe(400)
    expect(await empty.json()).toEqual({ status: 'invalid', reason: 'malformed-checkpoint' })

    const oversized = await GET(request('x'.repeat(129)))
    expect(oversized.status).toBe(400)
    expect(await oversized.json()).toEqual({ status: 'invalid', reason: 'malformed-checkpoint' })

    const duplicate = new NextRequest(
      'http://localhost/api/public-qr?checkpoint_id=one&checkpoint_id=two',
    )
    const duplicateResponse = await GET(duplicate)
    expect(duplicateResponse.status).toBe(400)
    expect(await duplicateResponse.json()).toEqual({ status: 'invalid', reason: 'malformed-checkpoint' })
  })

  it('does not guess when a stable checkpoint id is ambiguous across published campuses', async () => {
    configureSupabase({
      data: [
        publishedRow('duplicate', 'campus-a'),
        publishedRow('duplicate', 'campus-b'),
      ],
      error: null,
    })

    const response = await GET(request('duplicate'))
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body).toEqual({ status: 'ambiguous', checkpointId: 'duplicate' })
  })

  it('returns a generic read error without exposing database details', async () => {
    configureSupabase({ throws: new Error('secret database detail') })

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body).toEqual({ status: 'unavailable', code: 'PUBLIC_QR_READ_FAILED' })
    expect(JSON.stringify(body)).not.toContain('secret database detail')
  })
})
