// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@supabase/ssr', () => ({ createServerClient: vi.fn() }))
vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}))

import { createServerClient } from '@supabase/ssr'
import { writeFileSync } from 'fs'
import { POST } from '../route'

type PublishedRow = {
  campus_id: string
  revision: number
  compiler_version: string
  artifacts: Record<string, unknown>
  published_at: string
}

function makeArtifacts(revision: number, marker = 'new'): Record<string, unknown> {
  return {
    navigationGraph: {
      version: '1.0.0',
      campusId: 'phase7b-campus',
      createdAt: '2026-09-06T00:00:00.000Z',
      nodes: [],
      edges: [],
    },
    searchIndex: { version: '1.0.0', entries: [] },
    poiData: { version: '1.0.0', points: [] },
    buildingIndex: { version: '1.0.0', buildings: [] },
    spatialIndex: { version: '1.0.0', cells: {}, cellSize: 1 },
    components: [{ id: 'room-' + marker, type: 'room' }],
    doors: [{ id: 'door-' + marker, roomId: 'room-' + marker }],
    metadata: {
      campusId: 'phase7b-campus',
      connectivitySemanticsVersion: '6.0.0',
      compilerVersion: '1.0.0',
      revision: String(revision),
      sourceDocumentVersion: String(revision),
      compiledAt: '2026-09-06T00:00:00.000Z',
    },
  }
}

function makeRow(revision: number, marker = 'old'): PublishedRow {
  return {
    campus_id: 'phase7b-campus',
    revision,
    compiler_version: '1.0.0',
    artifacts: makeArtifacts(revision, marker),
    published_at: '2026-09-05T00:00:00.000Z',
  }
}

function makeFakeSupabase(initialRow: PublishedRow | null = null) {
  const state: {
    row: PublishedRow | null
    snapshotReads: number
  } = { row: initialRow, snapshotReads: 0 }

  function matches(conditions: Array<[string, string, unknown]>, row: PublishedRow | null): boolean {
    if (!row) return false
    return conditions.every(([operator, column, value]) => {
      const actual = row[column as keyof PublishedRow]
      if (operator === 'eq') return actual === value
      if (operator === 'lt') return Number(actual) < Number(value)
      return false
    })
  }

  type QueryResult = { data: unknown; error: unknown }
  type PublishedBuilder = {
    eq(column: string, value: unknown): PublishedBuilder
    lt(column: string, value: unknown): PublishedBuilder
    select(): Promise<QueryResult>
    maybeSingle(): Promise<QueryResult>
  }

  function publishedBuilder(operation: 'select' | 'update' | 'insert', payload?: PublishedRow): PublishedBuilder {
    const conditions: Array<[string, string, unknown]> = []
    const builder = {
      eq(column: string, value: unknown) {
        conditions.push(['eq', column, value])
        return builder
      },
      lt(column: string, value: unknown) {
        conditions.push(['lt', column, value])
        return builder
      },
      select() {
        if (operation === 'select') return Promise.resolve({ data: state.row, error: null })
        if (operation === 'update') {
          if (!matches(conditions, state.row)) return Promise.resolve({ data: [], error: null })
          state.row = { ...state.row!, ...(payload as PublishedRow) }
          return Promise.resolve({ data: [state.row], error: null })
        }
        if (state.row) return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key' } })
        state.row = payload ?? null
        return Promise.resolve({ data: state.row ? [state.row] : [], error: null })
      },
      maybeSingle() {
        return Promise.resolve({ data: operation === 'select' ? state.row : null, error: null })
      },
    } as PublishedBuilder
    return builder
  }

  const client = {
    from: vi.fn((table: string) => {
      if (table === 'graph_snapshots') {
        state.snapshotReads++
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        }
      }
      return {
        select: () => publishedBuilder('select'),
        update: (payload: PublishedRow) => publishedBuilder('update', payload),
        insert: (payload: PublishedRow) => publishedBuilder('insert', payload),
        upsert: async (payload: PublishedRow) => {
          state.row = payload
          return { data: state.row, error: null }
        },
      }
    }),
  }
  return { state, client }
}

function requestFor(artifacts: Record<string, unknown>, revision: number) {
  return new NextRequest('http://localhost/api/publish', {
    method: 'POST',
    headers: { cookie: `navi-mock-session=${MOCK_SESSION}` },
    body: JSON.stringify({ artifacts, campusId: 'phase7b-campus', revision }),
  })
}

const MOCK_SESSION = Buffer.from(
  JSON.stringify({ id: 'mock-super-admin', role: 'super_admin' }),
).toString('base64')

describe('POST /api/publish — Phase 7B contract', () => {
  const mockClient = createServerClient as unknown as ReturnType<typeof vi.fn>

  beforeEach(() => {
    process.env.NEXT_PUBLIC_MOCK_AUTH = 'true'
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key'
    mockClient.mockReset()
    vi.mocked(writeFileSync).mockClear()
  })

  it('persists compiler provenance and same-document components and doors without reading graph snapshots', async () => {
    const fake = makeFakeSupabase()
    mockClient.mockReturnValue(fake.client)

    const response = await POST(requestFor(makeArtifacts(7), 7))

    expect(response.status).toBe(200)
    expect(fake.state.snapshotReads).toBe(0)
    expect(fake.state.row?.revision).toBe(7)
    expect(fake.state.row?.artifacts).toMatchObject({
      components: [{ id: 'room-new' }],
      doors: [{ id: 'door-new' }],
      metadata: {
        campusId: 'phase7b-campus',
        connectivitySemanticsVersion: '6.0.0',
        sourceDocumentVersion: '7',
        revision: '7',
      },
    })
  })

  it('rejects an older revision without changing the row or writing local artifacts', async () => {
    const fake = makeFakeSupabase(makeRow(8, 'current'))
    mockClient.mockReturnValue(fake.client)

    const response = await POST(requestFor(makeArtifacts(7), 7))

    expect(response.status).toBe(409)
    expect(fake.state.row?.revision).toBe(8)
    expect((fake.state.row?.artifacts.components as Array<{ id: string }>)[0].id).toBe('room-current')
    expect(writeFileSync).not.toHaveBeenCalled()
  })

  it('accepts a same-revision retry as an idempotent replacement', async () => {
    const fake = makeFakeSupabase(makeRow(7, 'current'))
    mockClient.mockReturnValue(fake.client)

    const response = await POST(requestFor(makeArtifacts(7), 7))

    expect(response.status).toBe(200)
    expect(fake.state.row?.revision).toBe(7)
    expect((fake.state.row?.artifacts.components as Array<{ id: string }>)[0].id).toBe('room-new')
  })

  it('accepts a newer revision', async () => {
    const fake = makeFakeSupabase(makeRow(7, 'current'))
    mockClient.mockReturnValue(fake.client)

    const response = await POST(requestFor(makeArtifacts(8), 8))

    expect(response.status).toBe(200)
    expect(fake.state.row?.revision).toBe(8)
    expect((fake.state.row?.artifacts.components as Array<{ id: string }>)[0].id).toBe('room-new')
  })

  it('rejects a request revision that conflicts with compiler source provenance', async () => {
    const fake = makeFakeSupabase()
    mockClient.mockReturnValue(fake.client)

    const response = await POST(requestFor(makeArtifacts(7), 8))

    expect(response.status).toBe(400)
    expect(fake.state.row).toBeNull()
    expect(writeFileSync).not.toHaveBeenCalled()
  })

  it('no session → 401 and no Supabase client or disk write', async () => {
    const response = await POST(new NextRequest('http://localhost/api/publish', {
      method: 'POST',
      body: JSON.stringify({ artifacts: makeArtifacts(7), campusId: 'phase7b-campus', revision: 7 }),
    }))

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Authentication required.' })
    expect(mockClient).not.toHaveBeenCalled()
    expect(writeFileSync).not.toHaveBeenCalled()
  })

  it('protected campus → 423 and no Supabase client or disk write (even with a session)', async () => {
    const response = await POST(new NextRequest('http://localhost/api/publish', {
      method: 'POST',
      headers: { cookie: `navi-mock-session=${MOCK_SESSION}` },
      body: JSON.stringify({ artifacts: makeArtifacts(7), campusId: 'map-map-1-k6bv', revision: 7 }),
    }))

    expect(response.status).toBe(423)
    expect(await response.json()).toEqual({ error: 'This campus is protected. Mutations are disabled.' })
    expect(mockClient).not.toHaveBeenCalled()
    expect(writeFileSync).not.toHaveBeenCalled()
  })
})
