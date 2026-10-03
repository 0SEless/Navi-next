// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(),
}))

import { createServerClient } from '@supabase/ssr'
import { POST as saveGraph, GET as readGraph } from '../graph/route'
import { GET as readPublicCampus } from '../public-campus/route'

const CAMPUS_ID = 'runtime-fixture-campus'
const mockCreateServerClient = createServerClient as unknown as ReturnType<typeof vi.fn>

const MOCK_SESSION = Buffer.from(
  JSON.stringify({ id: 'mock-super-admin', role: 'super_admin' }),
).toString('base64')

const AUTHORED_ROUTING = {
  sourceRoadId: 'authored-stair-road',
  authoredOrientation: 'forward' as const,
  authored: {
    feature: 'stairs' as const,
    slope: 'steep' as const,
    direction: 'forward' as const,
    startElevationMeters: 0,
    endElevationMeters: 5,
    walkable: true,
    wheelchairAccessible: false,
  },
}

const SNAPSHOT = {
  id: CAMPUS_ID,
  campusId: CAMPUS_ID,
  version: '1.0.0',
  updatedAt: '2026-09-13T10:20:00.000Z',
  buildings: [{
    id: 'building-authored',
    name: 'New Authored Hall',
    campusId: CAMPUS_ID,
    floors: [0],
    footprint: [
      { lat: 11.8, lng: 122.1 },
      { lat: 11.8, lng: 122.1001 },
      { lat: 11.8001, lng: 122.1001 },
      { lat: 11.8001, lng: 122.1 },
    ],
    baseElevation: 0,
    height: 4,
  }],
  components: [{
    id: 'stair-component',
    type: 'stair',
    name: 'North stairs',
    buildingId: 'building-authored',
    campusId: CAMPUS_ID,
    floor: 0,
    position: { lat: 11.8, lng: 122.1 },
    metadata: { authored: true },
  }],
  nodes: [
    {
      id: 'stair-node',
      label: 'North stairs',
      type: 'stair',
      position: { lat: 11.8, lng: 122.1 },
      floor: 0,
      buildingId: 'building-authored',
      campusId: CAMPUS_ID,
      componentId: 'stair-component',
      metadata: { authored: true },
    },
    {
      id: 'outdoor-node',
      label: 'Outside',
      type: 'outdoor',
      position: { lat: 11.8002, lng: 122.1002 },
      floor: 0,
      buildingId: '',
      campusId: CAMPUS_ID,
    },
  ],
  edges: [{
    id: 'slope-edge',
    from: 'outdoor-node',
    to: 'stair-node',
    type: 'stairs',
    distance: 10,
    weight: 10,
    campusId: CAMPUS_ID,
    routing: AUTHORED_ROUTING,
  }],
  traces: [{
    id: 'authored-stair-road',
    name: 'New stair route',
    type: 'connector',
    floor: 0,
    points: [
      { lat: 11.8002, lng: 122.1002 },
      { lat: 11.8, lng: 122.1 },
    ],
    campusId: CAMPUS_ID,
    routing: AUTHORED_ROUTING.authored,
    metadata: { source: 'floor-editor' },
  }],
  pois: [{
    id: 'authored-poi',
    name: 'New authored POI',
    position: { lat: 11.8, lng: 122.1 },
    campusId: CAMPUS_ID,
  }],
  doors: [],
}

describe('save → graph API → public-campus runtime consistency', () => {
  let storedSnapshot: Record<string, unknown> | null = null

  beforeEach(() => {
    process.env.NEXT_PUBLIC_MOCK_AUTH = 'true'
    storedSnapshot = null
    const client = {
      rpc: vi.fn(async (_name: string, args: { payload: Record<string, unknown> }) => {
        storedSnapshot = args.payload
        return { data: { success: true, campus_id: CAMPUS_ID }, error: null }
      }),
      from: vi.fn((table: string) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => table === 'published_maps'
              ? { data: null, error: null }
              : { data: storedSnapshot ? { data: storedSnapshot, updated_at: SNAPSHOT.updatedAt } : null, error: null },
          }),
        }),
      })),
    }
    mockCreateServerClient.mockReturnValue(client)
  })

  it('keeps an authored building, stair route, slope metadata, and POI visible through the runtime path', async () => {
    const saveResponse = await saveGraph(new NextRequest('http://localhost/api/graph', {
      method: 'POST',
      headers: { cookie: `navi-mock-session=${MOCK_SESSION}` },
      body: JSON.stringify(SNAPSHOT),
    }))

    expect(saveResponse.status).toBe(200)
    expect(storedSnapshot).toMatchObject({
      campusId: CAMPUS_ID,
      buildings: [expect.objectContaining({ id: 'building-authored', name: 'New Authored Hall' })],
      edges: [expect.objectContaining({ id: 'slope-edge', routing: AUTHORED_ROUTING })],
      traces: [expect.objectContaining({ id: 'authored-stair-road', routing: AUTHORED_ROUTING.authored })],
      pois: [expect.objectContaining({ id: 'authored-poi' })],
    })

    const graphResponse = await readGraph(new NextRequest(`http://localhost/api/graph?campus_id=${CAMPUS_ID}`))
    expect(graphResponse.status).toBe(200)
    const graphBody = await graphResponse.json()
    expect(graphBody).toMatchObject({
      buildings: [expect.objectContaining({ id: 'building-authored' })],
      edges: [expect.objectContaining({ id: 'slope-edge', routing: AUTHORED_ROUTING })],
    })

    const publicResponse = await readPublicCampus(new NextRequest(`http://localhost/api/public-campus?campus_id=${CAMPUS_ID}`))
    expect(publicResponse.status).toBe(200)
    const publicBody = await publicResponse.json()
    expect(publicBody.source).toBe('graph_snapshots')
    expect(publicBody.buildings).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'building-authored', name: 'New Authored Hall' }),
    ]))
    expect(publicBody.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'stair-node', type: 'stair' }),
    ]))
    expect(publicBody.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'slope-edge', type: 'stairs', routing: AUTHORED_ROUTING }),
    ]))
    expect(publicBody.traces).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'authored-stair-road', routing: AUTHORED_ROUTING.authored }),
    ]))
    expect(publicBody.pois).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'authored-poi', name: 'New authored POI' }),
    ]))
  })
})
