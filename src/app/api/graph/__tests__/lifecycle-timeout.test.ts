// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { POST, getClient } from '../route'

vi.mock('@supabase/ssr', () => ({ createServerClient: vi.fn() }))

const mockCreate = createServerClient as unknown as ReturnType<typeof vi.fn>
let rpcMock: ReturnType<typeof vi.fn>
let capturedOptions: Record<string, unknown> | null

function makeRequest() {
  return new NextRequest('http://localhost/api/graph', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      cookie: 'sb-test-auth-token=test',
      'x-navi-save-chain-id': 'PRIVATE_ATTEMPT_CHAIN_ID',
      'x-navi-save-attempt': '3',
      'x-navi-session-generation': '17',
      'x-navi-campus-epoch': '4',
      'x-navi-graph-fingerprint': 'PRIVATE_GRAPH_FINGERPRINT',
      'x-navi-authored-fingerprint': 'PRIVATE_AUTHORED_FINGERPRINT',
    },
    body: JSON.stringify({
      campusId: 'test-campus-x',
      mutationId: 'M1',
      expectedServerUpdatedAt: 'PRIVATE_EXPECTED_REVISION',
      buildings: [{ id: 'PRIVATE_BUILDING_ID', name: 'PRIVATE_BUILDING_NAME' }],
      nodes: [{ id: 'PRIVATE_NODE_ID' }],
      edges: [],
      authoredDocument: {
        metadata: { name: 'PRIVATE_AUTHORED_DOCUMENT_NAME' },
        roads: [{ id: 'PRIVATE_ROAD_ID', geometry: [[1, 2], [3, 4]] }],
        token: 'PRIVATE_TOKEN_VALUE',
      },
    }),
  })
}

function lifecycleLine(logSpy: ReturnType<typeof vi.spyOn>): Record<string, unknown> {
  const raw = logSpy.mock.calls.map((c) => String(c[0])).find((l) => l.includes('[api/graph] lifecycle'))
  expect(raw, 'lifecycle log line must exist').toBeTruthy()
  return JSON.parse(String(raw).replace('[api/graph] lifecycle ', ''))
}

describe('api/graph request-lifecycle hardening', () => {
  beforeEach(() => {
    rpcMock = vi.fn()
    capturedOptions = null
    mockCreate.mockReset().mockImplementation(async (_url: string, _key: string, opts: Record<string, unknown>) => {
      capturedOptions = opts
      return { rpc: rpcMock }
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('A/B: plumbs the AbortSignal into the real network fetch of the Supabase client', async () => {
    const controller = new AbortController()
    await getClient('secret', controller.signal)
    const globalOpts = capturedOptions?.global as { fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<unknown> }
    expect(typeof globalOpts?.fetch).toBe('function')
    const fetchSpy = vi.fn(async () => new Response('{}'))
    vi.stubGlobal('fetch', fetchSpy)
    await globalOpts.fetch('http://example.invalid', {})
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect((fetchSpy.mock.calls[0][1] as RequestInit).signal).toBe(controller.signal)
  })

  it('C/E/G: timeout classifies as 504 TIMEOUT, is not retried, and clears its timer', async () => {
    vi.useFakeTimers()
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    rpcMock.mockRejectedValueOnce(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }))

    const res = await POST(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(504)
    expect(String(body.error)).toMatch(/timed out/i)
    expect(String(body.error)).toMatch(/NOT retried/)
    expect(rpcMock).toHaveBeenCalledTimes(1) // no automatic retry
    expect(vi.getTimerCount()).toBe(0) // timer cleared in finally
    expect(lifecycleLine(logSpy).outcome).toBe('TIMEOUT')
  })

  it('C/J/K: success classifies as SUCCESS, clears timer, and logs no payload or secrets', async () => {
    vi.useFakeTimers()
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    rpcMock.mockResolvedValueOnce({ data: { success: true, updatedAt: 'R1' }, error: null })

    const res = await POST(makeRequest())

    expect(res.status).toBe(200)
    expect(vi.getTimerCount()).toBe(0)
    const line = logSpy.mock.calls.map((c) => String(c[0])).find((l) => l.includes('lifecycle'))!
    const parsed = lifecycleLine(logSpy)
    expect(parsed.outcome).toBe('SUCCESS')
    expect(parsed).toEqual({
      event: 'save-attempt',
      attemptNumber: 3,
      durationMs: expect.any(Number),
      outcome: 'SUCCESS',
      status: 200,
    })
    expect(line).not.toMatch(/buildings|nodes|payload|service_role|secret/i)
    expect(line).not.toMatch(/requestId|mutationId|attemptChainId|campusId|fingerprint|graphCounts|expectedRevision|responseUpdatedAt|authoredDocument|road|geometry|token/i)
    for (const value of [
      'test-campus-x', 'M1', 'PRIVATE_ATTEMPT_CHAIN_ID', 'PRIVATE_GRAPH_FINGERPRINT',
      'PRIVATE_AUTHORED_FINGERPRINT', 'PRIVATE_EXPECTED_REVISION', 'PRIVATE_BUILDING_ID',
      'PRIVATE_BUILDING_NAME', 'PRIVATE_NODE_ID', 'PRIVATE_ROAD_ID',
      'PRIVATE_AUTHORED_DOCUMENT_NAME', 'PRIVATE_TOKEN_VALUE',
    ]) {
      expect(line).not.toContain(value)
    }
  })

  it('classifies idempotent replays distinctly', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    rpcMock.mockResolvedValueOnce({ data: { success: true, updatedAt: 'R1', idempotent_replay: true }, error: null })

    const res = await POST(makeRequest())

    expect(res.status).toBe(200)
    expect(lifecycleLine(logSpy).outcome).toBe('REPLAY')
  })

  it('H/I: CAS conflict and mutation collision stay distinct 409 outcomes', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'GRAPH_SNAPSHOT_CONFLICT: expected x found y' } })
    const conflict = await POST(makeRequest())
    expect(conflict.status).toBe(409)
    expect(lifecycleLine(logSpy).outcome).toBe('CAS_CONFLICT')

    logSpy.mockClear()
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'MUTATION_ID_COLLISION: mutation M1 already committed' } })
    const collision = await POST(makeRequest())
    expect(collision.status).toBe(409)
    expect(lifecycleLine(logSpy).outcome).toBe('MUTATION_COLLISION')
  })

  it('D: timer is cleared on failure paths too (upstream error)', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'Supabase RPC failed' } })

    const res = await POST(makeRequest())

    expect(res.status).toBe(500)
    expect(vi.getTimerCount()).toBe(0)
  })

  // ---- 409 mapping after SQLSTATE 40001 → P0001 (migration 012) ----

  it('1/3: MUTATION_ID_COLLISION maps 409 via message identity with P0001 — no SQLSTATE dependency, single attempt', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'MUTATION_ID_COLLISION: mutation M1 already committed for campus x with different content', code: 'P0001' } })

    const res = await POST(makeRequest())

    expect(res.status).toBe(409)
    expect(rpcMock).toHaveBeenCalledTimes(1) // 4: collision never auto-retried
  })

  it('2/3/5: GRAPH_SNAPSHOT_CONFLICT maps 409 via message identity with P0001 — CAS never auto-retried', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'GRAPH_SNAPSHOT_CONFLICT: expected x, found y', code: 'P0001' } })

    const res = await POST(makeRequest())

    expect(res.status).toBe(409)
    expect(rpcMock).toHaveBeenCalledTimes(1)
  })

  it('3: mapping does not require SQLSTATE 40001 — a code-less message-only error still maps 409', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'MUTATION_ID_COLLISION: message-only shape' } })

    const res = await POST(makeRequest())

    expect(res.status).toBe(409)
  })
})
