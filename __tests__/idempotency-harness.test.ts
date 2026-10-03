// @vitest-environment node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CLEANUP_TABLES,
  DegradeGuard,
  boundedFetch,
  countRows,
  runCleanup,
  runCollisionProbe,
} from '../e2e/support/idempotency-harness.mjs'

const MODULE_SRC = readFileSync(path.resolve(process.cwd(), 'e2e', 'support', 'idempotency-harness.mjs'), 'utf8')

const okResp = (body = '{}', status = 200, headers?: Record<string, string>) => new Response(status === 204 ? null : body, { status, headers })
const failResp = (body = '{}', status = 503) => new Response(body, { status })

describe('idempotency harness hardening', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('A/B/E: signal reaches fetch, timeout aborts it, timer cleared, single attempt (no retry)', async () => {
    let seenSignal: AbortSignal | null = null
    const fetchImpl = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_res, rej) => {
      seenSignal = init.signal as AbortSignal
      ;(init.signal as AbortSignal).addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    }))
    const guard = new DegradeGuard()
    const pending = runCollisionProbe({ url: 'http://x/rpc', body: { mutationId: 'M1' }, fetchImpl, timeoutMs: 15000, guard })
    await vi.advanceTimersByTimeAsync(15000)
    const result = await pending
    expect(seenSignal).toBeInstanceOf(AbortSignal)
    expect(result.kind).toBe('TIMEOUT')
    expect(result.stopped).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    expect(guard.consecutive).toBe(1)
  })

  it('C/D: timer clears on success and on network failure', async () => {
    const ok = await boundedFetch('http://x', {}, { fetchImpl: vi.fn(async () => okResp('[]')) })
    expect(ok.classification).toBe('OK')
    expect(vi.getTimerCount()).toBe(0)
    const net = await boundedFetch('http://x', {}, { fetchImpl: vi.fn(async () => { throw new TypeError('fetch failed') }) })
    expect(net.classification).toBe('NETWORK')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('F/J: collision probe issues exactly one request; expected 409 does not trip the guard', async () => {
    const fetchImpl = vi.fn(async () => failResp('{"error":"MUTATION_ID_COLLISION: x"}', 409))
    const guard = new DegradeGuard()
    const result = await runCollisionProbe({ url: 'http://x', body: {}, fetchImpl, guard })
    expect(result.kind).toBe('MUTATION_COLLISION')
    expect(result.stopped).toBe(false)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(guard.tripped).toBe(false)
  })

  it('G: 5xx collision response stops subsequent mutation work', async () => {
    const fetchImpl = vi.fn(async () => failResp('{"message":"boom"}', 504))
    const guard = new DegradeGuard()
    const result = await runCollisionProbe({ url: 'http://x', body: {}, fetchImpl, guard })
    expect(result.stopped).toBe(true)
    expect(result.reason).toBe('HTTP_5XX')
  })

  it('I: two consecutive infrastructure failures trip the degrade guard; OK resets', async () => {
    const guard = new DegradeGuard()
    guard.record('NETWORK')
    expect(guard.tripped).toBe(false)
    guard.record('TIMEOUT')
    expect(guard.tripped).toBe(true)
    const other = new DegradeGuard()
    other.record('HTTP_5XX')
    other.record('OK')
    other.record('HTTP_5XX')
    expect(other.tripped).toBe(false)
  })

  it('K/L/M/N/O/P/Q/R: cleanup runs independently, bounded, FK-order, backoff, own aborts', async () => {
    const signals: AbortSignal[] = []
    const calls: string[] = []
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      signals.push(init.signal as AbortSignal)
      calls.push(url)
      if (url.includes('route_edges') && calls.filter((c) => c.includes('/route_edges') && !c.includes('select=')).length === 1) return failResp('', 503)
      return okResp('[]')
    })
    const sleep = vi.fn(async () => {})
    const guard = new DegradeGuard()
    guard.record('NETWORK'); guard.record('NETWORK')
    expect(guard.tripped).toBe(true) // main guard tripped BEFORE cleanup

    const report = await runCleanup({ ids: ['dev-fixture-1'], url: 'http://x', serviceKey: 'k', fetchImpl, sleep })

    expect(report.stopped).toBe(false)
    expect(fetchImpl).toHaveBeenCalled() // cleanup ran despite tripped main guard
    expect(signals.every((s) => s instanceof AbortSignal)).toBe(true)
    expect(sleep).toHaveBeenCalledWith(10000) // bounded backoff between attempts
    expect(report.deletes.route_edges.attempts).toBe(2)
    const deleteCalls = calls.filter((c) => !c.includes('select='))
    const order = deleteCalls.map((c) => c.split('/')[3].split('?')[0])
    expect([...new Set(order)]).toEqual(CLEANUP_TABLES)
    expect(report.deleteTransportSucceeded).toBe(true)
    expect(report.absenceVerified).toBe(true)
  })

  it('O: cleanup stops after its own consecutive-failure threshold without verification', async () => {
    const fetchImpl = vi.fn(async () => failResp('', 500))
    const sleep = vi.fn(async () => {})
    const report = await runCleanup({ ids: ['dev-fixture-1'], url: 'http://x', serviceKey: 'k', fetchImpl, sleep })
    expect(report.stopped).toBe(true)
    expect(Object.keys(report.verifiedCounts)).toHaveLength(0)
    expect(report.deleteTransportSucceeded).toBe(false)
  })

  it('T: cleanup requires exact disposable fixture IDs (no wildcards / protected campuses)', async () => {
    await expect(runCleanup({ ids: [], url: 'http://x', serviceKey: 'k', fetchImpl: vi.fn() })).rejects.toThrow(/exact disposable/i)
    await expect(runCleanup({ ids: ['map-map-1-k6bv'], url: 'http://x', serviceKey: 'k', fetchImpl: vi.fn() })).rejects.toThrow(/exact disposable/i)
  })

  it('P/Q/R/S: static source audit — no fanout, no child processes, no payload logging, no orphan handles', () => {
    expect(MODULE_SRC).not.toMatch(/Promise\.all|Promise\.race/)
    expect(MODULE_SRC).not.toMatch(/child_process|spawn|exec\(|shell\s*:/)
    expect(MODULE_SRC).not.toMatch(/console\.(log|info)\(/)
    expect(MODULE_SRC).toMatch(/clearTimeout\(timer\)/)
    expect(vi.getTimerCount()).toBe(0)
  })

  // ---- New false-zero / fail-closed regression coverage (2026-09-17 fix) ----

  it('6: 204 + remaining row !== cleanup PASS (deleteTransportSucceeded true, absenceVerified false)', async () => {
    const fetchImpl = vi.fn(async (url: string) => (
      url.includes('select=') ? okResp('[{"campus_id":"dev-fixture-1"}]') : okResp('', 204)
    ))
    const report = await runCleanup({ ids: ['dev-fixture-1'], url: 'http://x', serviceKey: 'k', fetchImpl, sleep: vi.fn(async () => {}) })
    expect(report.deleteTransportSucceeded).toBe(true)
    expect(report.absenceVerified).toBe(false)
    expect(report.verifiedCounts.buildings.rows).toBe(1)
  })

  it('7: 204 + zero rows = PASS', async () => {
    const fetchImpl = vi.fn(async (url: string) => (url.includes('select=') ? okResp('[]') : okResp('', 204)))
    const report = await runCleanup({ ids: ['dev-fixture-1'], url: 'http://x', serviceKey: 'k', fetchImpl, sleep: vi.fn(async () => {}) })
    expect(report.deleteTransportSucceeded).toBe(true)
    expect(report.absenceVerified).toBe(true)
    expect(report.anomaly).toBe(false)
  })

  it('8/9/10/11: verifier 400/401/403/500 FAIL CLOSED (never zero)', async () => {
    for (const status of [400, 401, 403, 500] as const) {
      const fetchImpl = vi.fn(async (url: string) => (url.includes('select=') ? failResp('{"message":"nope"}', status) : okResp('', 204)))
      const report = await runCleanup({ ids: ['dev-fixture-1'], url: 'http://x', serviceKey: 'k', fetchImpl, sleep: vi.fn(async () => {}) })
      expect(report.absenceVerified).toBe(false)
      expect(report.verificationTransportFailed).toBe(true)
    }
  })

  it('12: DELETE 4xx = FAIL (not cleanup success)', async () => {
    const fetchImpl = vi.fn(async () => failResp('{"code":"42703"}', 400))
    const sleep = vi.fn(async () => {})
    const report = await runCleanup({ ids: ['dev-fixture-1'], url: 'http://x', serviceKey: 'k', fetchImpl, sleep })
    expect(report.stopped).toBe(true)
    expect(report.deleteTransportSucceeded).toBe(false)
    expect(Object.values(report.deletes).every((d: unknown) => (d as { status: number }).status === 400)).toBe(true)
    expect(Object.keys(report.verifiedCounts)).toHaveLength(0)
  })

  it('13/14: mutation table verifies via campus_id — no id column, no limit=0 false-zero', async () => {
    const seen: string[] = []
    const fetchImpl = vi.fn(async (url: string) => {
      seen.push(url)
      return url.includes('select=') ? okResp('[]') : okResp('', 204)
    })
    const report = await runCleanup({ ids: ['dev-fixture-1'], url: 'http://x', serviceKey: 'k', fetchImpl, sleep: vi.fn(async () => {}) })
    const verifyUrls = seen.filter((u) => u.includes('select='))
    expect(verifyUrls.every((u) => u.includes('select=campus_id'))).toBe(true)
    expect(verifyUrls.some((u) => u.includes('select=id'))).toBe(false)
    expect(verifyUrls.some((u) => /limit=0(&|$)/.test(u))).toBe(false)
    expect(verifyUrls.some((u) => u.includes('/campus_graph_mutations?'))).toBe(true)
    expect(report.verifiedCounts.campus_graph_mutations.rows).toBe(0)
  })

  it('15: boundedFetch preserves Content-Range when present', async () => {
    const r = await boundedFetch('http://x', {}, { fetchImpl: vi.fn(async () => okResp('[]', 206, { 'content-range': '0-0/0' })) })
    expect(r.headers['content-range']).toBe('0-0/0')
  })

  it('16/17: every request filters by the exact campus id list; no wildcard/prefix filters', async () => {
    const seen: string[] = []
    const fetchImpl = vi.fn(async (url: string) => {
      seen.push(url)
      return url.includes('select=') ? okResp('[]') : okResp('', 204)
    })
    await runCleanup({ ids: ['dev-fixture-a', 'dev-fixture-b'], url: 'http://x', serviceKey: 'k', fetchImpl, sleep: vi.fn(async () => {}) })
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every((u) => u.includes('campus_id=in.(dev-fixture-a,dev-fixture-b)'))).toBe(true)
    expect(seen.some((u) => /campus_id=(like|ilike|eq\.dev-\u0025)/i.test(u))).toBe(false)
  })

  it('20/21: mid-cleanup appearance produces ANOMALY/STOP — no automatic re-delete loop', async () => {
    let verifyPass = 0
    const deletes: string[] = []
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('select=')) {
        const isSecondPass = verifyPass >= CLEANUP_TABLES.length
        verifyPass += 1
        if (isSecondPass && url.includes('/buildings?')) return okResp('[{"campus_id":"dev-fixture-1"}]')
        return okResp('[]')
      }
      deletes.push(url)
      return okResp('', 204)
    })
    const report = await runCleanup({ ids: ['dev-fixture-1'], url: 'http://x', serviceKey: 'k', fetchImpl, sleep: vi.fn(async () => {}), settleMs: 1 })
    expect(report.anomaly).toBe(true)
    expect(report.absenceVerified).toBe(false)
    expect(deletes).toHaveLength(CLEANUP_TABLES.length) // one delete pass only — no loop-delete
  })

  it('29: countRows surfaces exact counts from Content-Range (limit=1, count=exact) without large bodies', async () => {
    const calls: Array<{ url: string; prefer: string | undefined }> = []
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, prefer: (init.headers as Record<string, string>)?.['Prefer'] })
      return okResp('[]', 206, { 'content-range': '0-0/6' })
    })
    const r = await countRows({ url: 'http://x', table: 'campus_graph_mutations', campusId: 'dev-a', headers: { apikey: 'k' }, fetchImpl })
    expect(r.count).toBe(6)
    expect(r.failedClosed).toBe(false)
    expect(calls[0].url).toContain('select=campus_id&limit=1&campus_id=eq.dev-a')
    expect(calls[0].prefer).toBe('count=exact')
  })

  it('30: countRows fails closed on non-2xx / missing header; parses empty set as 0', async () => {
    const r401 = await countRows({ url: 'http://x', table: 't', campusId: 'dev-a', headers: {}, fetchImpl: vi.fn(async () => failResp('', 401)) })
    expect(r401.failedClosed).toBe(true)
    expect(r401.count).toBeNull()
    const rNo = await countRows({ url: 'http://x', table: 't', campusId: 'dev-a', headers: {}, fetchImpl: vi.fn(async () => okResp('[]', 200)) })
    expect(rNo.failedClosed).toBe(true)
    expect(rNo.count).toBeNull()
    const r0 = await countRows({ url: 'http://x', table: 't', campusId: 'dev-a', headers: {}, fetchImpl: vi.fn(async () => okResp('[]', 206, { 'content-range': '*/0' })) })
    expect(r0.count).toBe(0)
    expect(r0.failedClosed).toBe(false)
  })
})
