/**
 * Safe idempotency-harness core (local-testable, no DEV dependency).
 * Guarantees: every real request is bounded by AbortController; no mutation
 * retries; single-request collision policy; cleanup is independent of the
 * test degrade guard; exact disposable fixture IDs only; no payload logging.
 *
 * Cleanup correctness contract (2026-09-17 fix):
 *  - DELETE 2xx means "delete request completed" ONLY — never row absence.
 *  - Any non-2xx DELETE (including 4xx) is a failure (bounded retry, then stop).
 *  - Absence MUST be verified with a valid row-based read (select of an existing
 *    ownership column, limit=1); non-2xx / unparseable verification FAILS CLOSED.
 *  - Never assume an `id` column exists (campus_graph_mutations has none).
 *  - deleteTransportSucceeded and absenceVerified are separate reported states.
 *  - With settleMs > 0, a post-settle re-verification detects mid-cleanup
 *    writers: report anomaly and STOP — never loop-delete against a writer.
 */

export const DEFAULT_TIMEOUT_MS = 15000
export const CLEANUP_TABLES = ['route_edges', 'route_nodes', 'buildings', 'campus_graph_mutations', 'campus_graph_revisions', 'graph_snapshots']

export class DegradeGuard {
  constructor(limit = 2) {
    this.limit = limit
    this.consecutive = 0
    this.tripped = false
  }
  /** Expected 4xx contract results (CAS conflict / collision) are NOT degradation. */
  record(classification) {
    if (classification === 'OK') {
      this.consecutive = 0
      return
    }
    if (classification === 'TIMEOUT' || classification === 'NETWORK' || classification === 'HTTP_5XX') {
      this.consecutive += 1
      if (this.consecutive >= this.limit) this.tripped = true
    }
  }
}

export function classifyHttp(status) {
  if (status >= 500) return 'HTTP_5XX'
  if (status >= 400) return 'HTTP_4XX'
  return 'OK'
}

/** One bounded request. Timer always cleared; signal reaches the real fetch. */
export async function boundedFetch(url, init = {}, opts = {}) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch } = opts
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const started = Date.now()
  try {
    let res
    try {
      res = await fetchImpl(url, { ...init, signal: controller.signal })
    } catch (error) {
      const timedOut = controller.signal.aborted
      return { status: 'ERR', ok: false, ms: Date.now() - started, classification: timedOut ? 'TIMEOUT' : 'NETWORK', error: String(error).slice(0, 120) }
    }
    const body = await res.text().catch(() => '')
    // Response headers are preserved where useful (e.g. Content-Range counts).
    const contentRange = typeof res.headers?.get === 'function' ? res.headers.get('content-range') : null
    return { status: res.status, ok: res.ok, ms: Date.now() - started, classification: classifyHttp(res.status), body: body.slice(0, 500), headers: { 'content-range': contentRange } }
  } finally {
    clearTimeout(timer)
  }
}

export function evaluateMutationResult(result) {
  let parsed = {}
  try { parsed = JSON.parse(result.body || '{}') } catch { parsed = {} }
  const msg = String(parsed?.error || parsed?.message || '')
  if (/MUTATION_ID_COLLISION/.test(msg)) return 'MUTATION_COLLISION'
  if (/GRAPH_SNAPSHOT_CONFLICT|server changed/i.test(msg)) return 'CAS_CONFLICT'
  if (result.classification === 'OK') return parsed?.idempotent_replay ? 'REPLAY' : 'SUCCESS'
  return result.classification
}

/** Collision verification: EXACTLY ONE mutation request, never retried, never parallel. */
export async function runCollisionProbe({ url, body, fetchImpl, timeoutMs, guard }) {
  const result = await boundedFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, { fetchImpl, timeoutMs })
  const kind = evaluateMutationResult(result)
  const contractResult = kind === 'CAS_CONFLICT' || kind === 'MUTATION_COLLISION' || kind === 'SUCCESS' || kind === 'REPLAY'
  if (contractResult) {
    guard?.record('OK')
    return { kind, status: result.status, ms: result.ms, stopped: false }
  }
  guard?.record(result.classification)
  return { kind, status: result.status, ms: result.ms, stopped: true, reason: result.classification }
}

const is2xx = (status) => typeof status === 'number' && status >= 200 && status < 300

/**
 * Structured row count WITHOUT large bodies: reads the Content-Range header
 * from a limit=1 request with Prefer: count=exact (e.g. "0-0/6" => 6; empty set => "0-0/0").
 * FAILS CLOSED: non-2xx or unparseable header => count null + failedClosed true.
 */
export async function countRows({ url, table, campusId, headers = {}, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const r = await boundedFetch(
    `${url}/${table}?select=campus_id&limit=1&campus_id=eq.${encodeURIComponent(campusId)}`,
    { headers: { ...headers, Prefer: 'count=exact' } },
    { fetchImpl, timeoutMs },
  )
  const raw = r.headers?.['content-range'] ?? null
  let count = null
  if (typeof raw === 'string') {
    const m = raw.match(/^(?:\*|\d+-\d+|\d+-\*)\/(\d+|\*)$/)
    if (m && m[1] !== '*') count = Number(m[1])
  }
  const statusOk = is2xx(r.status)
  const failedClosed = !statusOk || count === null
  return { status: r.status, count: failedClosed ? null : count, raw, classification: r.classification, failedClosed }
}

/**
 * Independent cleanup: own bounded requests, own failure counter, FK-safe order,
 * bounded attempts with backoff, exact disposable IDs only, then AUTHORITATIVE
 * row-based verification. Never consults the main test DegradeGuard.
 */
export async function runCleanup({
  ids,
  url,
  serviceKey,
  tables = CLEANUP_TABLES,
  fetchImpl = fetch,
  verifyFetchImpl,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  maxAttempts = 3,
  backoffMs = 10000,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  stopAfterConsecutive = 2,
  settleMs = 0,
}) {
  if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => typeof id !== 'string' || !id.startsWith('dev-'))) {
    throw new Error('cleanup requires exact disposable fixture campus IDs (no wildcards)')
  }
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' }
  const verifyFetch = verifyFetchImpl ?? fetchImpl
  const inFilter = `campus_id=in.(${ids.join(',')})`
  const report = { deletes: {}, stopped: false, deleteTransportSucceeded: false, absenceVerified: false, anomaly: false, verifiedCounts: {} }

  let consecutive = 0
  for (const table of tables) {
    let done = false
    for (let attempt = 1; attempt <= maxAttempts && !done; attempt += 1) {
      const result = await boundedFetch(`${url}/${table}?${inFilter}`, { method: 'DELETE', headers }, { fetchImpl, timeoutMs })
      if (is2xx(result.status)) {
        report.deletes[table] = { status: result.status, attempts: attempt }
        done = true
        consecutive = 0
      } else {
        // Any non-2xx (including 4xx) is a failure — transport success is NOT cleanup success.
        report.deletes[table] = { status: result.status, attempts: attempt, classification: result.classification }
        consecutive += 1
        if (consecutive >= stopAfterConsecutive) {
          report.stopped = true
          break
        }
        if (attempt < maxAttempts) await sleep(backoffMs)
      }
    }
    if (report.stopped) break
  }
  // Transport success = every table's DELETE ultimately completed 2xx within bounds.
  report.deleteTransportSucceeded = !report.stopped && tables.every((t) => is2xx(report.deletes[t]?.status))
  if (report.stopped) return report

  const verifyOnce = async () => {
    const counts = {}
    let allZero = true
    let all2xx = true
    for (const table of tables) {
      // Row-based verification on the ownership key: valid for every cleanup table
      // (campus_graph_mutations has no `id` column — never use `select=id`).
      const result = await boundedFetch(`${url}/${table}?select=campus_id&limit=1&${inFilter}`, { headers }, { fetchImpl: verifyFetch, timeoutMs })
      let rows = null
      try {
        const parsed = JSON.parse(result.body || '[]')
        rows = Array.isArray(parsed) ? parsed.length : null
      } catch { rows = null }
      const statusOk = is2xx(result.status)
      if (!statusOk || rows === null) all2xx = false
      if (!statusOk || rows === null || rows > 0) allZero = false
      counts[table] = { status: result.status, rows, classification: result.classification }
    }
    return { counts, allZero, all2xx }
  }

  const pass1 = await verifyOnce()
  report.verifiedCounts = pass1.counts
  if (!pass1.all2xx) {
    // FAIL CLOSED: a verification transport/parse failure is never "zero rows".
    report.verificationTransportFailed = true
    report.absenceVerified = false
    return report
  }
  report.absenceVerified = pass1.allZero

  if (settleMs > 0 && pass1.allZero) {
    await sleep(settleMs)
    const pass2 = await verifyOnce()
    report.verifiedCountsAfterSettle = pass2.counts
    const reappeared = Object.values(pass2.counts).some((c) => !is2xx(c.status) || c.rows === null || c.rows > 0)
    if (reappeared) {
      // Mid-cleanup writer detected: STOP and report. Never re-delete in a loop.
      report.anomaly = true
      report.absenceVerified = false
    }
  }
  return report
}
