/**
 * Environment-safety guard for the NAVI Supabase project.
 *
 * Local development, Playwright, and ad-hoc scripts share `navi-next/.env.local`,
 * which has historically pointed at the production Supabase project. Every
 * automated test and destructive utility must therefore prove that it is not
 * about to mutate production, and must fail closed when the target cannot be
 * identified.
 *
 * This module is intentionally dependency-free (no node:fs) so it can be used
 * from server routes, scripts, and test tooling alike. Filesystem-based env
 * detection lives in `e2e/support/safety.ts`.
 */

export const PRODUCTION_SUPABASE_PROJECT_REF = 'oltfaepqcktrumfhadzb'
export const PRODUCTION_OVERRIDE_VAR = 'NAVI_ALLOW_PRODUCTION_TEST_WRITES'

export interface EnvLike {
  [key: string]: string | undefined
}

export type UnsafeEnvironmentCode = 'UNKNOWN_PROJECT' | 'PRODUCTION_PROJECT' | 'CONFIRMATION_REQUIRED'

export class UnsafeEnvironmentError extends Error {
  readonly code: UnsafeEnvironmentCode

  constructor(message: string, code: UnsafeEnvironmentCode) {
    super(message)
    this.name = 'UnsafeEnvironmentError'
    this.code = code
  }
}

/**
 * Extract a Supabase project ref from either a raw ref or a project URL.
 * Returns null when the value does not look like a project identifier.
 */
export function extractProjectRef(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const urlMatch = trimmed.match(/https?:\/\/([a-z0-9]+)\.supabase\.(co|in)/i)
  if (urlMatch) return urlMatch[1]
  // Raw refs are short lowercase alphanumeric tokens without path characters.
  if (!/[/.]/.test(trimmed)) return trimmed
  return null
}

export function isProductionSupabaseProject(ref: string | null | undefined): boolean {
  return Boolean(ref) && ref === PRODUCTION_SUPABASE_PROJECT_REF
}

/** Detect the project ref from explicit environment variables only. */
export function detectSupabaseProjectRef(env: EnvLike = process.env): string | null {
  return (
    extractProjectRef(env.SUPABASE_PROJECT_REF) ??
    extractProjectRef(env.SUPABASE_URL) ??
    extractProjectRef(env.NEXT_PUBLIC_SUPABASE_URL) ??
    null
  )
}

export interface RequireSafeEnvironmentOptions {
  /** Human label for the guarded operation, used in error messages. */
  operation?: string
  /** Env var that must equal the detected project ref to allow production. */
  overrideVar?: string
}

/**
 * Fail-closed project guard.
 *
 * - Unknown project -> refuse.
 * - Production project -> refuse unless the caller explicitly sets the
 *   override variable to the production project ref. There is no
 *   warning-and-continue path.
 */
export function requireSafeSupabaseEnvironment(
  env: EnvLike = process.env,
  options: RequireSafeEnvironmentOptions = {},
): string {
  const operation = options.operation ?? 'This operation'
  const overrideVar = options.overrideVar ?? PRODUCTION_OVERRIDE_VAR
  const ref = detectSupabaseProjectRef(env)

  if (!ref) {
    throw new UnsafeEnvironmentError(
      `${operation} refuses to run: the Supabase project could not be identified. ` +
        'Set SUPABASE_PROJECT_REF or NEXT_PUBLIC_SUPABASE_URL explicitly so the guard can verify the target.',
      'UNKNOWN_PROJECT',
    )
  }

  if (isProductionSupabaseProject(ref)) {
    const override = (env[overrideVar] ?? '').trim()
    if (override !== ref) {
      throw new UnsafeEnvironmentError(
        `${operation} refuses to run against the production Supabase project (${ref}). ` +
          `Automated tests and destructive tooling must use a non-production project. ` +
          `For a deliberately approved scoped verification, set ${overrideVar}=${ref}.`,
        'PRODUCTION_PROJECT',
      )
    }
  }

  return ref
}
