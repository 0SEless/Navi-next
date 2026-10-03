/**
 * Production-environment safety gate for ad-hoc browser/e2e scripts (.mjs).
 *
 * Local dev and Playwright runs share `navi-next/.env.local`, which points at
 * the production Supabase project. Two layers of protection:
 *   1. Project lockout (primary): production is refused unless explicitly
 *      overridden with NAVI_ALLOW_PRODUCTION_TEST_WRITES=<project-ref>.
 *   2. Campus lockout (defense in depth): protected campus ids are refused.
 *
 * The TypeScript twin of this guard lives in `e2e/support/safety.ts` for
 * Playwright/vitest code.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

export const PRODUCTION_SUPABASE_PROJECT_REF = 'oltfaepqcktrumfhadzb'
export const PRODUCTION_OVERRIDE_VAR = 'NAVI_ALLOW_PRODUCTION_TEST_WRITES'
export const PROTECTED_CAMPUS_IDS = ['map-map-1-k6bv']

export function extractProjectRef(value) {
  if (!value) return null
  const trimmed = String(value).trim()
  if (!trimmed) return null
  const urlMatch = trimmed.match(/https?:\/\/([a-z0-9]+)\.supabase\.(co|in)/i)
  if (urlMatch) return urlMatch[1]
  if (!/[/.]/.test(trimmed)) return trimmed
  return null
}

export function detectSupabaseProjectRef(env = process.env) {
  return (
    extractProjectRef(env.SUPABASE_PROJECT_REF) ||
    extractProjectRef(env.SUPABASE_URL) ||
    extractProjectRef(env.NEXT_PUBLIC_SUPABASE_URL) ||
    null
  )
}

export function readEnvFile(filePath) {
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

export function detectEffectiveProjectRef(env = process.env, cwd = process.cwd()) {
  const direct = detectSupabaseProjectRef(env)
  if (direct) return direct
  for (const candidate of [
    path.join(cwd, '.env.development.local'),
    path.join(cwd, 'navi-next', '.env.development.local'),
    path.join(cwd, '.env.local'),
    path.join(cwd, 'navi-next', '.env.local'),
  ]) {
    const ref = detectSupabaseProjectRef(readEnvFile(candidate))
    if (ref) return ref
  }
  return null
}

/** Fail-closed project guard. Exits non-zero before any mutation on refusal. */
export function requireSafeTestEnvironment(env = process.env, cwd = process.cwd()) {
  const ref = detectEffectiveProjectRef(env, cwd)

  if (!ref) {
    console.error(
      'Refusing to run: the Supabase project could not be identified (checked environment and .env.local). ' +
        'Point the run at a non-production project explicitly.',
    )
    process.exit(1)
  }

  if (ref === PRODUCTION_SUPABASE_PROJECT_REF) {
    const override = String(env[PRODUCTION_OVERRIDE_VAR] ?? '').trim()
    if (override !== ref) {
      console.error(
        `Refusing to run against the production Supabase project (${ref}). ` +
          `Use a non-production project, or set ${PRODUCTION_OVERRIDE_VAR}=${ref} for a deliberately approved scoped verification.`,
      )
      process.exit(1)
    }
  }

  return ref
}

/** Resolve an explicit disposable campus id. Implicit selection is forbidden. */
export function requireE2eCampusId(env = process.env, cwd = process.cwd()) {
  requireSafeTestEnvironment(env, cwd)

  const campusId = String(env.E2E_CAMPUS_ID ?? '').trim()
  if (!campusId) {
    console.error(
      'E2E_CAMPUS_ID is required. Create a disposable campus and pass its id explicitly; ' +
        'automated runs must never select a campus implicitly.',
    )
    process.exit(1)
  }
  if (PROTECTED_CAMPUS_IDS.includes(campusId)) {
    console.error(`Refusing to run against protected production campus "${campusId}".`)
    process.exit(1)
  }
  return campusId
}
