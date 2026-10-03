// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(),
}))

import { createServerClient } from '@supabase/ssr'
import { POST } from '../route'

const mockCreateServerClient = createServerClient as unknown as ReturnType<typeof vi.fn>

type SnapshotPayload = {
  campus_id: string
  data: { campusId: string; name: string; description: string; address: string }
  version: string
}

const UNIQUE_VIOLATION = {
  code: '23505',
  message: 'duplicate key value violates unique constraint "graph_snapshots_campus_id_key"',
}

const MOCK_SESSION = Buffer.from(
  JSON.stringify({ id: 'mock-super-admin', role: 'super_admin' }),
).toString('base64')

let insert: ReturnType<typeof vi.fn>
let upsert: ReturnType<typeof vi.fn>

function mockSupabaseClient() {
  const client = { from: vi.fn(() => ({ insert, upsert })) }
  mockCreateServerClient.mockReturnValue(client)
  return client
}

function makePost(body: unknown = {}) {
  return new NextRequest('http://localhost:3000/api/campuses', {
    method: 'POST',
    headers: { cookie: `navi-mock-session=${MOCK_SESSION}` },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

describe('POST /api/campuses — create-only campus snapshots', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_MOCK_AUTH = 'true'
    mockCreateServerClient.mockReset()
    insert = vi.fn()
    upsert = vi.fn()
    mockSupabaseClient()
  })

  it('missing campus_id → 400 and no database write', async () => {
    const res = await POST(makePost({ name: 'No id' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'campus_id is required' })
    expect(insert).not.toHaveBeenCalled()
  })

  it('new campus → 200 and inserts the exact payload with name defaulting to campus_id', async () => {
    insert.mockResolvedValue({ error: null })

    const res = await POST(makePost({ campus_id: 'campus-1' }))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, campus_id: 'campus-1' })
    expect(insert).toHaveBeenCalledTimes(1)
    expect(insert).toHaveBeenCalledWith({
      campus_id: 'campus-1',
      data: { campusId: 'campus-1', name: 'campus-1', description: '', address: '' },
      version: '1.0.0',
    })
  })

  it('existing campus (23505) → 409 CAMPUS_ALREADY_EXISTS with no success flag', async () => {
    insert.mockResolvedValue({ error: UNIQUE_VIOLATION })

    const res = await POST(makePost({ campus_id: 'campus-1', name: 'Renamed' }))

    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body).toEqual({ error: 'Campus already exists', code: 'CAMPUS_ALREADY_EXISTS' })
    expect(body).not.toHaveProperty('success')
  })

  it('regression guard: never calls upsert (create-only, existing graph data cannot be overwritten)', async () => {
    insert.mockResolvedValue({ error: null })

    const res = await POST(makePost({ campus_id: 'campus-1' }))

    expect(res.status).toBe(200)
    expect(insert).toHaveBeenCalledTimes(1)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('non-23505 insert error → 500 with the error message', async () => {
    insert.mockResolvedValue({
      error: { code: '42501', message: 'permission denied for table graph_snapshots' },
    })

    const res = await POST(makePost({ campus_id: 'campus-1' }))

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'permission denied for table graph_snapshots' })
  })

  it('empty insert error object → 500 with fallback message', async () => {
    insert.mockResolvedValue({ error: {} })

    const res = await POST(makePost({ campus_id: 'campus-1' }))

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Failed to create campus' })
  })

  it('malformed JSON body → 400 and no database write', async () => {
    const res = await POST(makePost('{ not json'))

    expect(res.status).toBe(400)
    expect(insert).not.toHaveBeenCalled()
  })

  it('two POSTs for the same campus: first 200, second 409, first payload unchanged', async () => {
    const store = new Map<string, SnapshotPayload>()
    insert.mockImplementation(async (payload: SnapshotPayload) => {
      if (store.has(payload.campus_id)) {
        return { error: UNIQUE_VIOLATION }
      }
      store.set(payload.campus_id, payload)
      return { error: null }
    })

    const first = await POST(makePost({ campus_id: 'campus-1', name: 'Original' }))
    expect(first.status).toBe(200)

    const second = await POST(makePost({ campus_id: 'campus-1', name: 'Overwritten' }))
    expect(second.status).toBe(409)

    expect(store.size).toBe(1)
    expect(store.get('campus-1')).toEqual({
      campus_id: 'campus-1',
      data: { campusId: 'campus-1', name: 'Original', description: '', address: '' },
      version: '1.0.0',
    })
    expect(upsert).not.toHaveBeenCalled()
  })
})
