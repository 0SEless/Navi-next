// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Mock Supabase so the route's RPC call never touches the network.
vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(),
}))

import { createServerClient } from '@supabase/ssr'
import { GET, POST } from '../route'

const mockClient = createServerClient as unknown as ReturnType<typeof vi.fn>

const MOCK_SESSION = Buffer.from(
  JSON.stringify({ id: 'mock-super-admin', role: 'super_admin' }),
).toString('base64')

function mockRpc(result: unknown) {
  const rpc = vi.fn().mockResolvedValue(result)
  mockClient.mockReturnValue({ rpc })
  return rpc
}

function makePost(options: { headers?: Record<string, string>; body?: unknown } = {}) {
  return new NextRequest('http://localhost:3000/api/graph', {
    method: 'POST',
    headers: {
      cookie: `navi-mock-session=${MOCK_SESSION}`,
      ...options.headers,
    },
    body: JSON.stringify(options.body ?? { id: 'map-1', campusId: 'map-1', version: '1.0.0' }),
  })
}

describe('POST /api/graph — RPC error handling (regression: empty error object)', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_MOCK_AUTH = 'true'
    mockClient.mockReset()
  })

  it('empty rpcError {} → 500 with fallback message, NOT an empty body', async () => {
    // postgrest-js surfaces {} when Supabase answers a 5xx with a non-JSON body.
    mockRpc({ data: null, error: {} })
    const res = await POST(makePost())
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('Supabase RPC failed')
  })

  it('wrapped fetch failure → 500 surfacing the network cause', async () => {
    mockRpc({
      data: null,
      error: {
        message: 'TypeError: fetch failed',
        details: 'TypeError: fetch failed\n\nCaused by: TypeError: fetch failed (ECONNREFUSED)',
        code: '',
        hint: '',
      },
    })
    const res = await POST(makePost())
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/fetch failed/i)
  })

  it('normal PostgrestError → 500 with its message', async () => {
    const privateError = 'SQL statement failed for PRIVATE_CAMPUS_ID and PRIVATE_MUTATION_ID; PRIVATE_TOKEN_VALUE'
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockRpc({
      data: null,
      error: { message: privateError, code: 'P0001', hint: 'PRIVATE_HINT', details: 'PRIVATE_DETAILS' },
    })
    try {
      const res = await POST(makePost())
      expect(res.status).toBe(500)
      const body = await res.json()
      expect(body.error).toBe(privateError)
      const serializedLogs = JSON.stringify(errorLog.mock.calls)
      for (const value of [privateError, 'PRIVATE_CAMPUS_ID', 'PRIVATE_MUTATION_ID', 'PRIVATE_TOKEN_VALUE', 'PRIVATE_HINT', 'PRIVATE_DETAILS']) {
        expect(serializedLogs).not.toContain(value)
      }
    } finally {
      errorLog.mockRestore()
    }
  })

  it('success → 200', async () => {
    mockRpc({ data: { success: true, campus_id: 'map-1' }, error: null })
    const res = await POST(makePost())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })

  it('forwards the authored document companion unchanged to the idempotent RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { success: true, campus_id: 'map-1' }, error: null })
    mockClient.mockReturnValue({ rpc })
    const authoredDocument = {
      schemaVersion: 1,
      version: 0,
      metadata: { campusId: 'map-1', name: 'Authored', description: '', lastModified: '', editorVersion: '' },
      buildings: [], roads: [], panoramas: [], qrCheckpoints: [],
    }
    const res = await POST(makePost({ body: { campusId: 'map-1', nodes: [], edges: [], buildings: [], components: [], authoredDocument } }))
    expect(res.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('sync_graph_snapshot_idempotent', expect.objectContaining({
      payload: expect.objectContaining({ authoredDocument }),
    }))
  })
})

describe('POST /api/graph — save attempt correlation', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_MOCK_AUTH = 'true'
    mockClient.mockReset()
  })

  it('passes correlation and revision data to the RPC while logging only safe attempt metadata', async () => {
    const rpc = mockRpc({
      data: { success: true, campus_id: 'map-1', updatedAt: 'R2', idempotent_replay: false },
      error: null,
    })
    const privateAuthoredName = 'PRIVATE_AUTHORED_DOCUMENT_CONTENT_MUST_NOT_BE_LOGGED'
    const authoredDocument = {
      schemaVersion: 1,
      version: 1,
      metadata: { campusId: 'map-1', name: privateAuthoredName, description: '', lastModified: '', editorVersion: '' },
      buildings: [], roads: [], panoramas: [], qrCheckpoints: [],
    }
    const lifecycleLog = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      const response = await POST(makePost({
        headers: {
          'x-navi-save-chain-id': 'save-chain-1',
          'x-navi-save-attempt': '2',
          'x-navi-session-generation': '17',
          'x-navi-campus-epoch': '4',
          'x-navi-graph-fingerprint': 'graph-hash',
          'x-navi-authored-fingerprint': 'authored-hash',
        },
        body: {
          campusId: 'map-1',
          mutationId: 'save-chain-1',
          expectedServerUpdatedAt: 'R1',
          buildings: [], nodes: [], edges: [], components: [], authoredDocument,
        },
      }))

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toMatchObject({ success: true, updatedAt: 'R2' })
      expect(rpc).toHaveBeenCalledWith('sync_graph_snapshot_idempotent', {
        payload: expect.objectContaining({
          campusId: 'map-1',
          mutationId: 'save-chain-1',
          expectedServerUpdatedAt: 'R1',
        }),
      })

      const line = lifecycleLog.mock.calls
        .map(([message]) => String(message))
        .find((message) => message.startsWith('[api/graph] lifecycle '))
      expect(line).toBeDefined()
      const record = JSON.parse(String(line).slice('[api/graph] lifecycle '.length)) as Record<string, unknown>
      expect(record).toEqual({
        event: 'save-attempt',
        attemptNumber: 2,
        durationMs: expect.any(Number),
        outcome: 'SUCCESS',
        status: 200,
      })
      expect(line).not.toMatch(/requestId|mutationId|attemptChainId|campusId|fingerprint|graphCounts|expectedRevision|responseUpdatedAt|authoredDocument|buildings|nodes|roads|geometry|payload|service_role|secret|token/i)
      expect(line).not.toContain(privateAuthoredName)
      for (const value of ['map-1', 'save-chain-1', 'graph-hash', 'authored-hash', 'R1', 'R2']) {
        expect(line).not.toContain(value)
      }
    } finally {
      lifecycleLog.mockRestore()
    }
  })
})

describe('GET /api/graph — snapshot-read log privacy', () => {
  it('preserves the query response without logging campus identifiers or error details', async () => {
    const campusId = 'PRIVATE_CAMPUS_IDENTIFIER'
    const privateError = 'snapshot read failed for PRIVATE_CAMPUS_IDENTIFIER; PRIVATE_TOKEN_VALUE'
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: privateError } }),
    }
    query.select.mockReturnValue(query)
    query.eq.mockReturnValue(query)
    mockClient.mockReturnValue({ from: vi.fn().mockReturnValue(query) })
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      const response = await GET(new NextRequest(`http://localhost:3000/api/graph?campus_id=${campusId}`))
      expect(response.status).toBe(500)
      await expect(response.json()).resolves.toEqual({ error: privateError })
      expect(query.eq).toHaveBeenCalledWith('campus_id', campusId)
      const serializedLogs = JSON.stringify(errorLog.mock.calls)
      expect(serializedLogs).not.toContain(campusId)
      expect(serializedLogs).not.toContain(privateError)
      expect(serializedLogs).not.toContain('PRIVATE_TOKEN_VALUE')
    } finally {
      errorLog.mockRestore()
    }
  })
})

describe('GET /api/graph — authored companion compatibility', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_MOCK_AUTH = 'true'
    mockClient.mockReset()
  })

  it('returns raw Graph fields and adds authoredDocument when the column is populated', async () => {
    const authoredDocument = { metadata: { campusId: 'map-1', name: 'Authored' }, buildings: [], roads: [], panoramas: [], qrCheckpoints: [] }
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        data: { campusId: 'map-1', buildings: [], nodes: [], edges: [], components: [] },
        authored_document: authoredDocument,
        updated_at: '2026-09-21T00:00:00.000Z',
      },
      error: null,
    })
    const eq = vi.fn().mockReturnValue({ maybeSingle })
    const select = vi.fn().mockReturnValue({ eq })
    mockClient.mockReturnValue({ from: vi.fn().mockReturnValue({ select }) })

    const res = await GET(new NextRequest('http://localhost:3000/api/graph?campus_id=map-1'))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual(expect.objectContaining({
      campusId: 'map-1',
      authoredDocumentFormatVersion: 1,
      authoredDocument,
    }))
  })
})

describe('POST /api/graph — mutation gate', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_MOCK_AUTH = 'true'
    mockClient.mockReset()
  })

  it('no session → 401 with the exact body and no Supabase client call', async () => {
    const res = await POST(makePost({ headers: { cookie: '' } }))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Authentication required.' })
    expect(mockClient).not.toHaveBeenCalled()
  })

  it('protected campus → 423 with the exact body and no Supabase client call', async () => {
    const res = await POST(makePost({
      body: { id: 'map-map-1-k6bv', campusId: 'map-map-1-k6bv', version: '1.0.0' },
    }))
    expect(res.status).toBe(423)
    expect(await res.json()).toEqual({ error: 'This campus is protected. Mutations are disabled.' })
    expect(mockClient).not.toHaveBeenCalled()
  })

  it('missing campus ID → 400 before creating a Supabase client', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { success: true, campus_id: 'asu-ibajay' }, error: null })
    mockClient.mockReturnValue({ rpc })

    const res = await POST(makePost({ body: { id: 'map-1', version: '1.0.0' } }))

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'campusId is required' })
    expect(mockClient).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })
})
