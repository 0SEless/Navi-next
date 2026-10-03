/**
 * Disposable test-campus lifecycle helper (.mjs).
 *
 * A test fixture that writes a campus graph must clean up the COMPLETE fixture:
 * route_edges -> route_nodes -> buildings -> published_maps -> graph_snapshots
 * -> campus_maps. Deleting only `campus_maps` leaves orphan graph snapshots
 * (the documented production junk generator).
 *
 * Guard: refuses to construct against an unidentified or production project
 * unless the explicit override is set (NAVI_ALLOW_PRODUCTION_TEST_WRITES).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { requireSafeTestEnvironment } from './campus-guard.mjs'

/** FK-safe deletion order: children before parents. */
export const FIXTURE_TABLES = [
  { table: 'route_edges', column: 'campus_id' },
  { table: 'route_nodes', column: 'campus_id' },
  { table: 'buildings', column: 'campus_id' },
  { table: 'published_maps', column: 'campus_id' },
  { table: 'graph_snapshots', column: 'campus_id' },
  { table: 'campus_maps', column: 'map_id' },
]

export function generateTestCampusId(suite = 'e2e') {
  const stamp = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 8)
  return `e2e-${suite}-${stamp}-${rand}`
}

function loadEnvFile(filePath) {
  try {
    const out = {}
    for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
      if (!line || line.startsWith('#')) continue
      const idx = line.indexOf('=')
      if (idx < 0) continue
      out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
    }
    return out
  } catch {
    return {}
  }
}

export function resolveSupabaseAdmin(env = process.env, cwd = process.cwd()) {
  const localFileEnv = {
    ...loadEnvFile(path.join(cwd, '.env.local')),
    ...loadEnvFile(path.join(cwd, 'navi-next', '.env.local')),
  }
  const devFileEnv = {
    ...loadEnvFile(path.join(cwd, '.env.development.local')),
    ...loadEnvFile(path.join(cwd, 'navi-next', '.env.development.local')),
  }
  // DEV wins over production when both exist (fail-safe local/test selection).
  const fileEnv = { ...localFileEnv, ...devFileEnv }
  const url = (env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || fileEnv.SUPABASE_URL || fileEnv.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '')
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || fileEnv.SUPABASE_SERVICE_ROLE_KEY || fileEnv.SUPABASE_SECRET_KEY
  if (!url || !key) {
    throw new Error('test-campus fixture helper: missing Supabase URL or service key (env or .env.local)')
  }
  return { url, key }
}

/**
 * Build a janitor bound to the resolved project. `guard` is injectable for
 * unit tests; production scripts always use the real fail-closed guard.
 */
export function createTestCampusJanitor({
  env = process.env,
  cwd = process.cwd(),
  fetchImpl = fetch,
  guard = requireSafeTestEnvironment,
} = {}) {
  guard(env, cwd) // fail closed BEFORE resolving credentials or issuing requests
  const { url, key } = resolveSupabaseAdmin(env, cwd)
  const authHeaders = { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' }

  async function tableRequest(table, column, campusId, init) {
    const query = `${column}=eq.${encodeURIComponent(campusId)}`
    return fetchImpl(`${url}/rest/v1/${table}?${query}`, {
      ...init,
      headers: { ...authHeaders, ...(init?.headers ?? {}) },
    })
  }

  return {
    /** Delete every fixture row for the campus; throws if any table fails. */
    async deleteCampus(campusId) {
      const results = []
      for (const { table, column } of FIXTURE_TABLES) {
        const res = await tableRequest(table, column, campusId, {
          method: 'DELETE',
          headers: { Prefer: 'return=representation' },
        })
        const body = await res.json().catch(() => null)
        if (!res.ok) {
          throw new Error(
            `test-campus cleanup failed for ${table}: HTTP ${res.status} ${JSON.stringify(body).slice(0, 200)}`,
          )
        }
        results.push({ table, deleted: Array.isArray(body) ? body.length : 0 })
      }
      return results
    },

    /** Read-only proof that no fixture rows remain. */
    async assertCampusAbsent(campusId) {
      const report = []
      for (const { table, column } of FIXTURE_TABLES) {
        const res = await tableRequest(table, column, campusId, { method: 'GET' })
        if (!res.ok) {
          throw new Error(`test-campus absence check failed for ${table}: HTTP ${res.status}`)
        }
        const rows = await res.json().catch(() => [])
        report.push({ table, rows: Array.isArray(rows) ? rows.length : 0 })
      }
      return report
    },
  }
}

/**
 * Run a fixture callback with deterministic cleanup.
 * Returns the callback result; throws if cleanup leaves any row behind.
 */
export async function withDisposableTestCampus(suite, run, options = {}) {
  const janitor = createTestCampusJanitor(options)
  const campusId = options.campusId ?? generateTestCampusId(suite)
  let result
  let primaryError
  try {
    result = await run(campusId, janitor)
  } catch (error) {
    primaryError = error
  } finally {
    try {
      await janitor.deleteCampus(campusId)
      const absence = await janitor.assertCampusAbsent(campusId)
      const leftovers = absence.filter((entry) => entry.rows > 0)
      if (leftovers.length > 0) {
        throw new Error(
          `test-campus cleanup incomplete for ${campusId}: ${leftovers.map((e) => `${e.table}=${e.rows}`).join(', ')}`,
        )
      }
    } catch (cleanupError) {
      if (primaryError) {
        // Surface both: the run failed AND cleanup failed.
        throw new AggregateError([primaryError, cleanupError], `fixture run and cleanup both failed for ${campusId}`)
      }
      throw cleanupError
    }
  }
  if (primaryError) throw primaryError
  return result
}
