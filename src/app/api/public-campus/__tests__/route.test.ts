// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@supabase/ssr', () => ({ createServerClient: vi.fn() }))

import { createServerClient } from '@supabase/ssr'
import { GET } from '../route'
import * as PublicCampusRoute from '../route'

function mockPublished(artifacts: Record<string, unknown>) {
  const client = {
    from: vi.fn((table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => table === 'published_maps'
            ? { data: { artifacts }, error: null }
            : { data: null, error: null },
        }),
      }),
    })),
  }
  ;(createServerClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(client)
  return client
}

function mockSnapshot(snapshot: Record<string, unknown>) {
  const client = {
    from: vi.fn((table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => table === 'published_maps'
            ? { data: null, error: null }
            : { data: { data: snapshot }, error: null },
        }),
      }),
    })),
  }
  ;(createServerClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(client)
  return client
}

function request() {
  return new NextRequest('http://localhost/api/public-campus?campus_id=phase7b-campus')
}

describe('GET /api/public-campus — Phase 7B contract', () => {
  it('carries an explicit published campus display name without changing campus identity', async () => {
    mockPublished({
      graph: { nodes: [], edges: [] },
      buildingIndex: { buildings: [] },
      metadata: {
        campusId: 'phase7b-campus',
        campusName: 'North Campus',
      },
    })

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.campusId).toBe('phase7b-campus')
    expect(body.campusName).toBe('North Campus')
  })

  it('returns published components and doors with the requested campus identity', async () => {
    mockPublished({
      graph: { nodes: [], edges: [] },
      buildingIndex: { buildings: [] },
      components: [{ id: 'room-public', type: 'room' }],
      doors: [{ id: 'door-public', roomId: 'room-public' }],
      metadata: { campusId: 'phase7b-campus', revision: '7', compiledAt: '2026-09-06T00:00:00.000Z' },
    })

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.campusId).toBe('phase7b-campus')
    expect(body.components).toEqual([{ id: 'room-public', type: 'room' }])
    expect(body.doors).toEqual([{ id: 'door-public', roomId: 'room-public' }])
  })

  it('keeps old published artifacts readable with additive empty geometry defaults', async () => {
    mockPublished({
      graph: { nodes: [], edges: [] },
      buildingIndex: { buildings: [] },
    })

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.campusId).toBe('phase7b-campus')
    expect(body.components).toEqual([])
    expect(body.doors).toEqual([])
  })

  it('prefers authored road artifacts and preserves the legacy graph trace fallback', async () => {
    const authoredRoads = [{
      id: 'road-published',
      name: 'Library Walk',
      type: 'pedestrian',
      polyline: { points: [{ lat: 14, lng: 121 }, { lat: 14.001, lng: 121.002 }] },
      displayMode: 'visible',
    }]
    const legacyTraces = [{
      id: 'trace-legacy',
      name: 'Legacy Walk',
      type: 'connector',
      points: [{ lat: 14, lng: 121 }, { lat: 14.001, lng: 121.002 }],
    }]
    mockPublished({
      graph: { nodes: [], edges: [], traces: legacyTraces },
      traces: authoredRoads,
      buildingIndex: { buildings: [] },
      metadata: { campusId: 'phase7b-campus' },
    })

    const preferredResponse = await GET(request())
    const preferredBody = await preferredResponse.json()
    expect(preferredBody.traces).toEqual(authoredRoads)

    mockPublished({
      graph: { nodes: [], edges: [], traces: legacyTraces },
      buildingIndex: { buildings: [] },
    })
    const legacyResponse = await GET(request())
    const legacyBody = await legacyResponse.json()
    expect(legacyBody.traces).toEqual(legacyTraces)
  })

  it('reports fallback lookup and response stages without campus payload values', async () => {
    mockSnapshot({
      campusName: 'diagnostic-private-label',
      buildings: [{ id: 'diagnostic-building', name: 'diagnostic-private-label' }],
      nodes: [],
      edges: [],
    })

    const response = await GET(request())
    const serverTiming = response.headers.get('Server-Timing') ?? ''
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.campusName).toBe('diagnostic-private-label')
    expect(serverTiming).toMatch(/published;dur=\d+(\.\d+)?/)
    expect(serverTiming).toMatch(/snapshot;dur=\d+(\.\d+)?/)
    expect(serverTiming).toMatch(/transform;dur=\d+(\.\d+)?/)
    expect(serverTiming).toMatch(/serialize;dur=\d+(\.\d+)?/)
    expect(serverTiming).toMatch(/handler;dur=\d+(\.\d+)?/)
    expect(serverTiming).not.toContain('diagnostic-private-label')
    expect(serverTiming).not.toContain('diagnostic-building')
  })

  it('places the public campus route with the Tokyo Supabase project', () => {
    const routeConfig = PublicCampusRoute as unknown as { preferredRegion?: string }
    expect(routeConfig.preferredRegion).toBe('hnd1')
  })
})
