import { readFileSync } from 'node:fs'
import path from 'node:path'

import {
  PRODUCTION_OVERRIDE_VAR,
  PRODUCTION_SUPABASE_PROJECT_REF,
  UnsafeEnvironmentError,
  detectSupabaseProjectRef,
  isProductionSupabaseProject,
  type EnvLike,
} from '../../src/lib/env-safety'

export { PRODUCTION_OVERRIDE_VAR, PRODUCTION_SUPABASE_PROJECT_REF, UnsafeEnvironmentError }

/**
 * Campuses that must never be used by automated tests or destructive tooling.
 * Production lockout is the primary guard (see assertSafeTestEnvironment);
 * this list is defense in depth.
 */
export const PROTECTED_CAMPUS_IDS: readonly string[] = ['map-map-1-k6bv']

/** Minimal KEY=value parser for .env files (no interpolation, comments skipped). */
export function readEnvFile(filePath: string): EnvLike {
  try {
    const out: EnvLike = {}
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

/**
 * Resolve the project the app/scripts would actually talk to. Environment
 * variables win; then the repo's `.env.local` (the production-wired file).
 */
export function detectEffectiveProjectRef(env: EnvLike = process.env, cwd: string = process.cwd()): string | null {
  const direct = detectSupabaseProjectRef(env)
  if (direct) return direct
  const candidates = [
    path.join(cwd, '.env.development.local'),
    path.join(cwd, 'navi-next', '.env.development.local'),
    path.join(cwd, '.env.local'),
    path.join(cwd, 'navi-next', '.env.local'),
  ]
  for (const candidate of candidates) {
    const ref = detectSupabaseProjectRef(readEnvFile(candidate))
    if (ref) return ref
  }
  return null
}

/**
 * Fail-closed project guard for every automated browser/e2e run.
 * Production is refused unless explicitly overridden with
 * `NAVI_ALLOW_PRODUCTION_TEST_WRITES=<project-ref>`.
 */
export function assertSafeTestEnvironment(env: EnvLike = process.env, cwd: string = process.cwd()): string {
  const ref = detectEffectiveProjectRef(env, cwd)

  if (!ref) {
    throw new UnsafeEnvironmentError(
      'Automated tests refuse to run: the Supabase project could not be identified ' +
        '(checked environment variables and .env.local). Point tests at a non-production project explicitly.',
      'UNKNOWN_PROJECT',
    )
  }

  if (isProductionSupabaseProject(ref)) {
    const override = (env[PRODUCTION_OVERRIDE_VAR] ?? '').trim()
    if (override !== ref) {
      throw new UnsafeEnvironmentError(
        `Automated tests refuse to run against the production Supabase project (${ref}). ` +
          `Use a non-production project, or set ${PRODUCTION_OVERRIDE_VAR}=${ref} for a deliberately approved scoped verification.`,
        'PRODUCTION_PROJECT',
      )
    }
  }

  return ref
}

export function assertNotProtectedCampusId(campusId: string): void {
  if (PROTECTED_CAMPUS_IDS.includes(campusId)) {
    throw new Error(
      `Refusing to run an automated test against protected production campus "${campusId}". ` +
        'Create a disposable campus and pass its id via E2E_CAMPUS_ID.',
    )
  }
}

/**
 * Resolve the campus id an automated run may write to.
 * Requires an explicit `E2E_CAMPUS_ID`, a safe (non-production unless
 * explicitly overridden) project, and rejects protected campuses.
 */
export function requireDisposableTestCampusId(env: EnvLike = process.env, cwd: string = process.cwd()): string {
  assertSafeTestEnvironment(env, cwd)

  const campusId = (env.E2E_CAMPUS_ID ?? '').trim()
  if (!campusId) {
    throw new Error(
      'E2E_CAMPUS_ID is required. Automated runs must never select a campus implicitly (for example maps[0]). ' +
        'Create a disposable campus and pass its id via E2E_CAMPUS_ID.',
    )
  }

  assertNotProtectedCampusId(campusId)
  return campusId
}
