// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@supabase/ssr', () => ({ createServerClient: vi.fn(() => ({})) }))
vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}))
vi.mock('@/services/published-map-writer', () => ({
  writePublishedMap: vi.fn(async () => ({ status: 'written' })),
}))

import { writeFileSync } from 'fs'
import { writePublishedMap } from '@/services/published-map-writer'
import { POST } from '../route'

const ROUTING = {
  sourceRoadId: 'road-1',
  authoredOrientation: 'forward',
  authored: {
    feature: 'stairs', slope: 'steep', direction: 'forward',
    startElevationMeters: 1, endElevationMeters: 9,
    walkable: true, wheelchairAccessible: false,
  },
}

const SESSION_COOKIE = {
  name: 'navi-mock-session',
  value: Buffer.from(JSON.stringify({ id: 'mock-super-admin', role: 'super_admin' })).toString('base64'),
}

function fakeRequest(body: unknown) {
  return {
    json: async () => body,
    cookies: { getAll: () => [SESSION_COOKIE] },
  } as unknown as Parameters<typeof POST>[0]
}

function artifacts(options: { routing?: unknown } = { routing: ROUTING }) {
  return {
    navigationGraph: {
      version: '1.0.0', campusId: 'phase4-campus', createdAt: '', checksum: 'checksum',
      nodes: [
        { id: 'n1', label: 'A', type: 'waypoint', position: { lat: 14, lng: 121 }, floor: 0, buildingId: '__outdoor__', properties: {} },
        { id: 'n2', label: 'B', type: 'waypoint', position: { lat: 14.1, lng: 121.1 }, floor: 0, buildingId: '__outdoor__', properties: {} },
      ],
      edges: [{
        id: 'e1', from: 'n1', to: 'n2', type: 'walk', distance: 20, weight: 20,
        ...(Object.prototype.hasOwnProperty.call(options, 'routing') ? { routing: options.routing } : {}),
      }],
      metadata: { nodeCount: 2, edgeCount: 1, buildings: 0, floors: 1, boundingBox: { minLat: 14, maxLat: 14.1, minLng: 121, maxLng: 121.1 } },
    },
    searchIndex: { version: '1.0.0', entries: [] },
    buildingIndex: { version: '1.0.0', buildings: [] },
    poiData: { version: '1.0.0', points: [] },
    spatialIndex: { version: '1.0.0', cells: {}, cellSize: 10 },
    components: [],
    doors: [],
    metadata: {
      campusId: 'phase4-campus', compilerVersion: '1.0.0', revision: '1',
      sourceDocumentVersion: '1', compiledAt: '2026-09-11T00:00:00.000Z',
    },
  }
}

describe('POST /api/publish — Phase 4 Road routing metadata', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_MOCK_AUTH = 'true'
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key'
    vi.mocked(writePublishedMap).mockClear()
    vi.mocked(writeFileSync).mockClear()
  })

  it('accepts and stores the additive edge field without a live write', async () => {
    const response = await POST(fakeRequest({ campusId: 'phase4-campus', revision: 1, artifacts: artifacts() }))

    expect(response.status).toBe(200)
    const storedRow = vi.mocked(writePublishedMap).mock.calls[0][1]
    const storedGraph = storedRow.artifacts.graph as ReturnType<typeof artifacts>['navigationGraph']
    expect(storedGraph.edges[0]).toMatchObject({ distance: 20, weight: 20, routing: ROUTING })

    const graphWrite = vi.mocked(writeFileSync).mock.calls.find(call => String(call[0]).endsWith('navigation.graph.json'))
    expect(JSON.parse(String(graphWrite?.[1])).edges[0].routing).toEqual(ROUTING)
  })

  it('accepts a legacy graph with no edge routing', async () => {
    const response = await POST(fakeRequest({ campusId: 'phase4-campus', revision: 1, artifacts: artifacts({}) }))

    expect(response.status).toBe(200)
    const storedRow = vi.mocked(writePublishedMap).mock.calls[0][1]
    const storedGraph = storedRow.artifacts.graph as ReturnType<typeof artifacts>['navigationGraph']
    expect(storedGraph.edges[0]).not.toHaveProperty('routing')
  })

  it('rejects malformed present edge routing before any write', async () => {
    const response = await POST(fakeRequest({
      campusId: 'phase4-campus',
      revision: 1,
      artifacts: artifacts({
        routing: { ...ROUTING, authored: { feature: 'lava' } },
      }),
    }))

    const body = await response.json()
    expect(response.status).toBe(422)
    expect(body.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'ARTIFACT_INVALID_EDGE_ROUTING' }),
    ]))
    expect(writePublishedMap).not.toHaveBeenCalled()
    expect(writeFileSync).not.toHaveBeenCalled()
  })
})
