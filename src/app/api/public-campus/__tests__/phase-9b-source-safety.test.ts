// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@supabase/ssr', () => ({ createServerClient: vi.fn() }))

import { createServerClient } from '@supabase/ssr'
import { GET } from '../route'

type QueryResult = {
  data: unknown
  error: { message: string } | null
}

type QueryBehavior = QueryResult | { throws: Error }

function request() {
  return new NextRequest('http://localhost/api/public-campus?campus_id=phase9b-campus')
}

function configureSupabase(
  published: QueryBehavior,
  snapshot: QueryBehavior,
) {
  const queriedTables: string[] = []
  const client = {
    from: vi.fn((table: string) => {
      queriedTables.push(table)
      const behavior = table === 'published_maps' ? published : snapshot
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              if ('throws' in behavior) throw behavior.throws
              return behavior
            },
          }),
        }),
      }
    }),
  }
  ;(createServerClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(client)
  return queriedTables
}

function publishedArtifacts(overrides: Record<string, unknown> = {}) {
  return {
    graph: {
      campusId: 'phase9b-campus',
      nodes: [{ id: 'node-1', position: { lat: 14, lng: 121 } }],
      edges: [],
      metadata: {
        boundingBox: { minLat: 14, maxLat: 14, minLng: 121, maxLng: 121 },
      },
    },
    buildingIndex: { buildings: [{ id: 'building-1', name: 'Building 1' }] },
    searchIndex: { entries: [] },
    poiIndex: { points: [] },
    ...overrides,
  }
}

function snapshotData() {
  return {
    buildings: [{ id: 'snapshot-building', name: 'Snapshot Building' }],
    nodes: [{ id: 'snapshot-node' }],
    edges: [],
    boundary: null,
  }
}

describe('GET /api/public-campus — Phase 9B source safety', () => {
  it('returns a valid published row and never queries graph_snapshots', async () => {
    const queriedTables = configureSupabase(
      { data: { artifacts: publishedArtifacts() }, error: null },
      { data: { data: snapshotData() }, error: null },
    )

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.source).toBe('published_maps')
    expect(body.buildings).toEqual([{ id: 'building-1', name: 'Building 1' }])
    expect(queriedTables).toEqual(['published_maps'])
  })

  it('queries graph_snapshots only when published_maps is definitively not found', async () => {
    const queriedTables = configureSupabase(
      { data: null, error: null },
      { data: { data: snapshotData() }, error: null },
    )

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.source).toBe('graph_snapshots')
    expect(body.buildings).toEqual([{ id: 'snapshot-building', name: 'Snapshot Building' }])
    expect(queriedTables).toEqual(['published_maps', 'graph_snapshots'])
  })

  it('returns a stable read error and does not query snapshots after a published lookup error', async () => {
    const queriedTables = configureSupabase(
      { data: null, error: { message: 'secret database detail' } },
      { data: { data: snapshotData() }, error: null },
    )

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.error).toBe('PUBLIC_CAMPUS_READ_FAILED')
    expect(JSON.stringify(body)).not.toContain('secret database detail')
    expect(queriedTables).toEqual(['published_maps'])
  })

  it('returns a stable invalid-artifact error and does not query snapshots', async () => {
    const queriedTables = configureSupabase(
      {
        data: {
          artifacts: publishedArtifacts({
            graph: {
              campusId: 'phase9b-campus',
              nodes: [{ id: 'node-1', position: { lat: 14, lng: 121 } }],
              edges: [{
                id: 'edge-1',
                from: 'ghost-node',
                to: 'node-1',
                weight: 1,
                distance: 1,
              }],
            },
          }),
        },
        error: null,
      },
      { data: { data: snapshotData() }, error: null },
    )

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.error).toBe('PUBLIC_CAMPUS_ARTIFACT_INVALID')
    expect(queriedTables).toEqual(['published_maps'])
  })

  it('keeps legacy published artifacts readable without additive Phase 7/8 metadata', async () => {
    const queriedTables = configureSupabase(
      {
        data: {
          artifacts: {
            graph: { nodes: [], edges: [] },
            buildingIndex: { buildings: [] },
          },
        },
        error: null,
      },
      { data: { data: snapshotData() }, error: null },
    )

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.source).toBe('published_maps')
    expect(body.components).toEqual([])
    expect(body.doors).toEqual([])
    expect(queriedTables).toEqual(['published_maps'])
  })

  it('treats an unexpected published read exception as an error, not as no row', async () => {
    const queriedTables = configureSupabase(
      { throws: new Error('secret transport detail') },
      { data: { data: snapshotData() }, error: null },
    )

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.error).toBe('PUBLIC_CAMPUS_READ_FAILED')
    expect(JSON.stringify(body)).not.toContain('secret transport detail')
    expect(queriedTables).toEqual(['published_maps'])
  })
})
