// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '../route'

describe('POST /api/compile — Phase 4 Road routing metadata', () => {
  it('returns compiled road metadata without changing walk-edge cost', async () => {
    const authored = {
      feature: 'stairs' as const,
      slope: 'steep' as const,
      direction: 'forward' as const,
      startElevationMeters: 1,
      endElevationMeters: 9,
      walkable: true,
      wheelchairAccessible: false,
    }
    const request = new NextRequest('http://localhost/api/compile', {
      method: 'POST',
      headers: { cookie: 'sb-test-auth-token=test' },
      body: JSON.stringify({
        document: {
          schemaVersion: 1,
          version: 1,
          metadata: { campusId: 'phase4-campus', name: 'Phase 4', description: '', lastModified: '', editorVersion: '1.0' },
          buildings: [{
            id: 'building-1', name: 'Building 1', code: 'B1', category: 'academic', description: '',
            footprint: { points: [
              { lat: 13.9999, lng: 120.9999 }, { lat: 14.0001, lng: 120.9999 },
              { lat: 14.0001, lng: 121.0001 }, { lat: 13.9999, lng: 121.0001 },
            ] },
            baseElevation: 0, height: 10, verticalConnectors: [], aliases: [], color: '#000000', metadata: {},
            floors: [{
              id: 'floor-1', level: 0, label: 'Ground', elevation: 0,
              rooms: [], hallways: [], staircases: [], elevators: [], connectorStops: [], metadata: {},
              entrances: [{
                id: 'entrance-1', label: 'Main', position: { lat: 14, lng: 121 }, level: 0,
                type: 'main', hasQR: false, hasPanorama: false, connectorRoadId: 'road-1',
              }],
            }],
          }],
          roads: [{
            id: 'road-1', name: 'Outdoor stairs',
            polyline: { points: [{ lat: 14, lng: 121 }, { lat: 14.0002, lng: 121.0002 }] },
            width: 3, surface: 'paved', type: 'connector', metadata: {}, routing: authored,
          }],
          panoramas: [],
          qrCheckpoints: [],
        },
      }),
    })

    const response = await POST(request)
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body).toMatchObject({ status: 'success', artifacts: expect.any(Object) })
    const edges = body.artifacts.navigationGraph.edges
    expect(edges.length).toBeGreaterThan(0)
    expect(edges[0]).toMatchObject({
      type: 'walk',
      routing: { sourceRoadId: 'road-1', authoredOrientation: 'forward', authored },
    })
    expect(edges.every((edge: { distance: number; weight: number }) => edge.distance === edge.weight)).toBe(true)
  })
})
