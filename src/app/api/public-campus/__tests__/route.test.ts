// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@supabase/ssr', () => ({ createServerClient: vi.fn() }))

import { createServerClient } from '@supabase/ssr'
import { GET } from '../route'

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
})
