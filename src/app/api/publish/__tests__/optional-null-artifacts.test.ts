// @vitest-environment node
//
// T2 (Phase 3): the `?? null` optional-artifact contract of POST /api/publish.
//
// Contract (deliberate, Phase 1): artifacts the client did not send are
// persisted EXPLICITLY as `null` in the published_maps blob, written to
// demo-output as literal 4-byte `null` JSON documents, and still listed in
// manifest.json with checksums computed over those exact bytes (ERROR.md
// 2026-07-08). Optional artifacts that ARE present are never nulled.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
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

const MOCK_SESSION = Buffer.from(
  JSON.stringify({ id: 'mock-super-admin', role: 'super_admin' }),
).toString('base64')

const CAMPUS_ID = 'phase7b-campus'

function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

type PublishedRow = {
  campus_id: string
  revision: number
  compiler_version: string
  artifacts: Record<string, unknown>
  published_at: string
}

function makeFakeSupabase() {
  const state: { row: PublishedRow | null } = { row: null }

  function matches(
    conditions: Array<[string, string, unknown]>,
    row: PublishedRow | null,
  ): boolean {
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

  function builder(operation: 'select' | 'update' | 'insert', payload?: PublishedRow): PublishedBuilder {
    const conditions: Array<[string, string, unknown]> = []
    const b = {
      eq(column: string, value: unknown) {
        conditions.push(['eq', column, value])
        return b
      },
      lt(column: string, value: unknown) {
        conditions.push(['lt', column, value])
        return b
      },
      select() {
        if (operation === 'select') return Promise.resolve({ data: state.row, error: null })
        if (operation === 'update') {
          if (!matches(conditions, state.row)) return Promise.resolve({ data: [], error: null })
          state.row = { ...state.row!, ...(payload as PublishedRow) }
          return Promise.resolve({ data: [state.row], error: null })
        }
        if (state.row) {
          return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key' } })
        }
        state.row = payload ?? null
        return Promise.resolve({ data: state.row ? [state.row] : [], error: null })
      },
      maybeSingle() {
        return Promise.resolve({ data: operation === 'select' ? state.row : null, error: null })
      },
    } as PublishedBuilder
    return b
  }

  const client = {
    from: vi.fn(() => ({
      select: () => builder('select'),
      update: (payload: PublishedRow) => builder('update', payload),
      insert: (payload: PublishedRow) => builder('insert', payload),
      upsert: async (payload: PublishedRow) => {
        state.row = payload
        return { data: state.row, error: null }
      },
    })),
  }
  return { state, client }
}

/** Artifacts with ONLY the required navigationGraph + metadata — every
 *  optional artifact (search/poi/building/spatial/panorama/floor/qr) omitted. */
function makeMinimalArtifacts(revision: number): Record<string, unknown> {
  return {
    navigationGraph: {
      version: '1.0.0',
      campusId: CAMPUS_ID,
      createdAt: '2026-09-06T00:00:00.000Z',
      nodes: [],
      edges: [],
    },
    metadata: {
      campusId: CAMPUS_ID,
      connectivitySemanticsVersion: '6.0.0',
      compilerVersion: '1.0.0',
      revision: String(revision),
      sourceDocumentVersion: String(revision),
      compiledAt: '2026-09-06T00:00:00.000Z',
    },
  }
}

function requestFor(artifacts: Record<string, unknown>, revision: number) {
  return new NextRequest('http://localhost/api/publish', {
    method: 'POST',
    headers: { cookie: `navi-mock-session=${MOCK_SESSION}` },
    body: JSON.stringify({ artifacts, campusId: CAMPUS_ID, revision }),
  })
}

/** Extract (path, content) pairs written to demo-output. */
function writtenDemoFiles(): Map<string, string> {
  const files = new Map<string, string>()
  for (const call of vi.mocked(writeFileSync).mock.calls) {
    const [path, content] = call as [string, string]
    files.set(path, content)
  }
  return files
}

describe('POST /api/publish — explicit `null` optional-artifact contract (T2)', () => {
  const mockClient = createServerClient as unknown as ReturnType<typeof vi.fn>

  beforeEach(() => {
    process.env.NEXT_PUBLIC_MOCK_AUTH = 'true'
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key'
    mockClient.mockReset()
    vi.mocked(writeFileSync).mockClear()
  })

  it('persists absent optional artifacts as explicit nulls with checksummed `null` files', async () => {
    const fake = makeFakeSupabase()
    mockClient.mockReturnValue(fake.client)

    const response = await POST(requestFor(makeMinimalArtifacts(7), 7))
    expect(response.status).toBe(200)

    // ── 1. published_maps blob: explicit nulls for the four nullable slots,
    //      default empty objects for search/building/poi (route defaults). ──
    const blob = (fake.state.row as { artifacts: Record<string, unknown> }).artifacts
    expect(blob.spatialIndex).toBeNull()
    expect(blob.panoramaIndex).toBeNull()
    expect(blob.floorGeometry).toBeNull()
    expect(blob.qrIndex).toBeNull()
    expect(blob.searchIndex).toEqual({ version: '1.0.0', entries: [] })
    expect(blob.buildingIndex).toEqual({ version: '1.0.0', buildings: [] })
    expect(blob.poiIndex).toEqual({ version: '1.0.0', points: [] })

    // ── 2. demo-output files: JSON.stringify(null, null, 2) is exactly
    //      the 4-byte string 'null' for all seven optional artifacts. ──
    const files = writtenDemoFiles()
    const dir = process.cwd()
    const nullFiles = [
      'search.index.json',
      'poi.json',
      'building-index.json',
      'spatial-index.json',
      'panorama-index.json',
      'floor-geometry.json',
      'qr-index.json',
    ]
    for (const name of nullFiles) {
      expect(
        files.get(join(dir, 'demo-output', name)),
        `demo-output/${name} must be the literal 4-byte 'null' document`,
      ).toBe('null')
    }
    // The required graph file is a real object document, never 'null'.
    const graphContent = files.get(join(dir, 'demo-output', 'navigation.graph.json'))
    expect(graphContent).toBeDefined()
    expect(JSON.parse(graphContent!).nodes).toEqual([])

    // ── 3. manifest: every entry listed; null files checksummed over the
    //      exact 'null' bytes written to disk (ERROR.md 2026-07-08). ──
    const body = (await response.json()) as {
      manifest: { artifacts: Record<string, { path: string; checksum: string; size: number }> }
    }
    const manifestArtifacts = body.manifest.artifacts
    expect(Object.keys(manifestArtifacts).sort()).toEqual([
      'buildings',
      'floorGeometry',
      'graph',
      'panorama',
      'poi',
      'qrIndex',
      'search',
      'spatial',
    ])
    for (const name of ['search', 'poi', 'buildings', 'spatial', 'panorama', 'floorGeometry', 'qrIndex']) {
      expect(manifestArtifacts[name]!.checksum, `${name} checksum`).toBe(sha256Hex('null'))
      expect(manifestArtifacts[name]!.size, `${name} size`).toBe(4)
    }
    expect(manifestArtifacts.graph!.checksum).toBe(sha256Hex(graphContent!))
    expect(manifestArtifacts.graph!.size).toBe(Buffer.byteLength(graphContent!, 'utf-8'))
  })

  it('writes real documents for optional artifacts that are present (null only when absent)', async () => {
    const fake = makeFakeSupabase()
    mockClient.mockReturnValue(fake.client)

    const spatialIndex = { version: '1.0.0', cells: { '0,0': ['n1'] }, cellSize: 10 }
    const panoramaIndex = {
      version: '1.0.0',
      panoramas: [
        {
          id: 'pano-lobby',
          title: 'Lobby',
          imageAssetId: 'img-1',
          buildingId: 'b1',
          floor: 0,
          lat: 14.5,
          lng: 121.0,
          heading: 0,
          hotspots: [],
        },
      ],
    }
    const artifacts = makeMinimalArtifacts(7)
    artifacts.spatialIndex = spatialIndex
    artifacts.panoramaIndex = panoramaIndex

    const response = await POST(requestFor(artifacts, 7))
    expect(response.status).toBe(200)

    // Blob keeps the real objects — no nulling of present artifacts.
    const blob = (fake.state.row as { artifacts: Record<string, unknown> }).artifacts
    expect(blob.spatialIndex).toEqual(spatialIndex)
    expect(blob.panoramaIndex).toEqual(panoramaIndex)

    // Files are the serialized objects, not 'null'.
    const files = writtenDemoFiles()
    const dir = process.cwd()
    const spatialContent = files.get(join(dir, 'demo-output', 'spatial-index.json'))!
    const panoContent = files.get(join(dir, 'demo-output', 'panorama-index.json'))!
    expect(spatialContent).not.toBe('null')
    expect(panoContent).not.toBe('null')
    expect(JSON.parse(spatialContent)).toEqual(spatialIndex)
    expect(JSON.parse(panoContent)).toEqual(panoramaIndex)

    // Still-null slots (floor/qr) remain 'null' with matching checksums.
    expect(files.get(join(dir, 'demo-output', 'floor-geometry.json'))).toBe('null')
    expect(files.get(join(dir, 'demo-output', 'qr-index.json'))).toBe('null')
    const body = (await response.json()) as {
      manifest: { artifacts: Record<string, { checksum: string }> }
    }
    expect(body.manifest.artifacts.spatial!.checksum).toBe(sha256Hex(spatialContent))
    expect(body.manifest.artifacts.panorama!.checksum).toBe(sha256Hex(panoContent))
    expect(body.manifest.artifacts.floorGeometry!.checksum).toBe(sha256Hex('null'))
    expect(body.manifest.artifacts.qrIndex!.checksum).toBe(sha256Hex('null'))
  })
})
