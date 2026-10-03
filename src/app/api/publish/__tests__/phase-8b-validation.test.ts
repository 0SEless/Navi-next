// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@supabase/ssr', () => ({ createServerClient: vi.fn() }))
vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}))

import { createServerClient } from '@supabase/ssr'
import { writeFileSync } from 'fs'
import { POST } from '../route'

type PublishArtifacts = Record<string, unknown> & {
  navigationGraph: Record<string, unknown>
}

type PublishedRow = {
  campus_id: string
  revision: number
  compiler_version: string
  artifacts: Record<string, unknown>
  published_at: string
}

function makeArtifacts(revision: number): PublishArtifacts {
  return {
    navigationGraph: {
      version: '1.0.0',
      campusId: 'phase8b-campus',
      createdAt: '2026-09-06T00:00:00.000Z',
      checksum: 'checksum',
      nodes: [
        {
          id: 'node-1',
          label: 'Node 1',
          type: 'space',
          position: { lat: 14, lng: 121 },
          floor: 0,
          buildingId: 'building-1',
          properties: {},
        },
        {
          id: 'node-2',
          label: 'Node 2',
          type: 'space',
          position: { lat: 14.0001, lng: 121.0001 },
          floor: 0,
          buildingId: 'building-1',
          properties: {},
        },
      ],
      edges: [{
        id: 'edge-1',
        from: 'node-1',
        to: 'node-2',
        type: 'walk',
        distance: 10,
        weight: 10,
      }],
      metadata: {
        nodeCount: 2,
        edgeCount: 1,
        buildings: 1,
        floors: 1,
        boundingBox: { minLng: 121, maxLng: 121.0001, minLat: 14, maxLat: 14.0001 },
      },
    },
    searchIndex: { version: '1.0.0', entries: [] },
    poiData: { version: '1.0.0', points: [] },
    buildingIndex: {
      version: '1.0.0',
      buildings: [{
        id: 'building-1',
        name: 'Building 1',
        code: 'B1',
        category: 'academic',
        position: { lat: 14, lng: 121 },
        floors: [{ level: 0, label: 'Ground', elevation: 0, rooms: [] }],
        entrances: [],
        nodeId: 'node-1',
      }],
    },
    spatialIndex: { version: '1.0.0', cells: {}, cellSize: 10 },
    components: [{
      id: 'room-1',
      type: 'room',
      buildingId: 'building-1',
      floor: 0,
      position: { lat: 14, lng: 121 },
    }],
    doors: [{
      id: 'door-1',
      roomId: 'room-1',
      buildingId: 'building-1',
      floor: 0,
      position: { lat: 14, lng: 121 },
    }],
    metadata: {
      campusId: 'phase8b-campus',
      connectivitySemanticsVersion: '6.0.0',
      compilerVersion: '1.0.0',
      revision: String(revision),
      sourceDocumentVersion: String(revision),
      compiledAt: '2026-09-06T00:00:00.000Z',
    },
  }
}

function makeRow(revision: number): PublishedRow {
  return {
    campus_id: 'phase8b-campus',
    revision,
    compiler_version: '1.0.0',
    artifacts: {
      graph: (makeArtifacts(revision).navigationGraph),
      buildingIndex: makeArtifacts(revision).buildingIndex,
      components: makeArtifacts(revision).components,
      doors: makeArtifacts(revision).doors,
      metadata: makeArtifacts(revision).metadata,
    },
    published_at: '2026-09-06T00:00:00.000Z',
  }
}

type QueryResult = { data: unknown; error: unknown }
type Condition = [operator: 'eq' | 'lt', column: string, value: unknown]
type Builder = {
  eq(column: string, value: unknown): Builder
  lt(column: string, value: unknown): Builder
  select(columns?: string): Promise<QueryResult>
  maybeSingle(): Promise<QueryResult>
}

function makeFakeSupabase(initialRow: PublishedRow | null) {
  const state: { row: PublishedRow | null; snapshotReads: number } = {
    row: initialRow,
    snapshotReads: 0,
  }

  function matches(conditions: Condition[], row: PublishedRow | null): boolean {
    if (!row) return false
    return conditions.every(([operator, column, value]) => {
      const actual = row[column as keyof PublishedRow]
      return operator === 'eq' ? actual === value : Number(actual) < Number(value)
    })
  }

  function builder(operation: 'select' | 'update' | 'insert', payload?: PublishedRow): Builder {
    const conditions: Condition[] = []
    const result: Builder = {
      eq(column, value) {
        conditions.push(['eq', column, value])
        return result
      },
      lt(column, value) {
        conditions.push(['lt', column, value])
        return result
      },
      async select() {
        if (operation === 'select') return { data: state.row, error: null }
        if (operation === 'update') {
          if (!matches(conditions, state.row)) return { data: [], error: null }
          state.row = { ...state.row!, ...payload }
          return { data: [state.row], error: null }
        }
        if (state.row) return { data: null, error: { code: '23505', message: 'duplicate key' } }
        state.row = payload ?? null
        return { data: state.row ? [state.row] : [], error: null }
      },
      async maybeSingle() {
        return {
          data: operation === 'select'
            ? state.row
              ? { revision: state.row.revision, artifacts: state.row.artifacts }
              : null
            : null,
          error: null,
        }
      },
    }
    return result
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
        select: () => builder('select'),
        update: (payload: PublishedRow) => builder('update', payload),
        insert: (payload: PublishedRow) => builder('insert', payload),
      }
    }),
  }

  return { state, client }
}

const SESSION_COOKIE = {
  name: 'navi-mock-session',
  value: Buffer.from(JSON.stringify({ id: 'mock-super-admin', role: 'super_admin' })).toString('base64'),
}

function requestFor(body: unknown) {
  return {
    json: async () => body,
    cookies: { getAll: () => [SESSION_COOKIE] },
  } as unknown as Parameters<typeof POST>[0]
}

function bodyFor(artifacts: PublishArtifacts, revision: number) {
  return { artifacts, campusId: 'phase8b-campus', revision }
}

describe('POST /api/publish — Phase 8B structural validation', () => {
  const mockClient = createServerClient as unknown as ReturnType<typeof vi.fn>

  beforeEach(() => {
    process.env.NEXT_PUBLIC_MOCK_AUTH = 'true'
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key'
    mockClient.mockReset()
    vi.mocked(writeFileSync).mockClear()
  })

  it('rejects a non-finite node coordinate before mutation', async () => {
    const fake = makeFakeSupabase(makeRow(1))
    mockClient.mockReturnValue(fake.client)
    const artifacts = makeArtifacts(2)
    const nodes = artifacts.navigationGraph.nodes as Array<Record<string, unknown>>
    nodes[0] = {
      ...nodes[0],
      position: { lat: Number.NaN, lng: 121 },
    }

    const response = await POST(requestFor(bodyFor(artifacts, 2)))

    expect(response.status).toBe(422)
    expect(fake.state.row?.revision).toBe(1)
    expect(writeFileSync).not.toHaveBeenCalled()
  })

  it('rejects a dangling edge before mutation', async () => {
    const fake = makeFakeSupabase(makeRow(1))
    mockClient.mockReturnValue(fake.client)
    const artifacts = makeArtifacts(2)
    artifacts.navigationGraph.edges = [{
      id: 'edge-dangling',
      from: 'node-1',
      to: 'missing-node',
      type: 'walk',
      distance: 10,
      weight: 10,
    }]

    const response = await POST(requestFor(bodyFor(artifacts, 2)))

    expect(response.status).toBe(422)
    expect(fake.state.row?.revision).toBe(1)
    expect(writeFileSync).not.toHaveBeenCalled()
  })

  it('rejects graph campus identity mismatch before mutation', async () => {
    const fake = makeFakeSupabase(makeRow(1))
    mockClient.mockReturnValue(fake.client)
    const artifacts = makeArtifacts(2)
    artifacts.navigationGraph.campusId = 'other-campus'

    const response = await POST(requestFor(bodyFor(artifacts, 2)))

    expect(response.status).toBe(422)
    expect(fake.state.row?.revision).toBe(1)
    expect(writeFileSync).not.toHaveBeenCalled()
  })

  it('rejects request/source revision mismatch before mutation', async () => {
    const fake = makeFakeSupabase(null)
    mockClient.mockReturnValue(fake.client)

    const response = await POST(requestFor(bodyFor(makeArtifacts(2), 3)))

    expect(response.status).toBe(400)
    expect(fake.state.row).toBeNull()
    expect(writeFileSync).not.toHaveBeenCalled()
  })

  it('rejects an empty R+1 replacement and preserves the non-empty R', async () => {
    const fake = makeFakeSupabase(makeRow(1))
    mockClient.mockReturnValue(fake.client)
    const artifacts = makeArtifacts(2)
    artifacts.navigationGraph.nodes = []
    artifacts.navigationGraph.edges = []

    const response = await POST(requestFor(bodyFor(artifacts, 2)))

    expect(response.status).toBe(422)
    expect(fake.state.row?.revision).toBe(1)
    expect((fake.state.row?.artifacts.graph as Record<string, unknown>).nodes).toHaveLength(2)
    expect(writeFileSync).not.toHaveBeenCalled()
  })

  it('publishes a valid R+1 through the existing revision writer', async () => {
    const fake = makeFakeSupabase(makeRow(1))
    mockClient.mockReturnValue(fake.client)

    const response = await POST(requestFor(bodyFor(makeArtifacts(2), 2)))

    expect(response.status).toBe(200)
    expect(fake.state.row?.revision).toBe(2)
    expect(fake.state.snapshotReads).toBe(0)
    expect(writeFileSync).toHaveBeenCalled()
  })
})
