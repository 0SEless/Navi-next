// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { PRODUCTION_SUPABASE_PROJECT_REF } from '../src/lib/env-safety'
import {
  CLEAN_CONFIRM_VAR,
  CLEAN_PRODUCTION_OVERRIDE_VAR,
  CLEAN_TABLES,
  assertCleanDatabaseAllowed,
} from '../scripts/clean-database'

const PROD = PRODUCTION_SUPABASE_PROJECT_REF

describe('clean-database destructive guard', () => {
  it('refuses an unidentified project (fail closed)', () => {
    expect(() => assertCleanDatabaseAllowed({})).toThrow(/could not be identified/)
  })

  it('refuses production without the explicit override', () => {
    expect(() => assertCleanDatabaseAllowed({ SUPABASE_PROJECT_REF: PROD })).toThrow(/production Supabase project/)
  })

  it('requires typed confirmation even for non-production projects', () => {
    expect(() => assertCleanDatabaseAllowed({ SUPABASE_PROJECT_REF: 'test-project' })).toThrow(
      /explicit confirmation/,
    )
  })

  it('accepts a non-production project with the exact confirmation token', () => {
    expect(
      assertCleanDatabaseAllowed({
        SUPABASE_PROJECT_REF: 'test-project',
        [CLEAN_CONFIRM_VAR]: 'WIPE:test-project',
      }),
    ).toBe('test-project')
  })

  it('requires both the production override and the confirmation token', () => {
    const base = { SUPABASE_PROJECT_REF: PROD, [CLEAN_PRODUCTION_OVERRIDE_VAR]: PROD }
    expect(() => assertCleanDatabaseAllowed(base)).toThrow(/explicit confirmation/)
    expect(assertCleanDatabaseAllowed({ ...base, [CLEAN_CONFIRM_VAR]: `WIPE:${PROD}` })).toBe(PROD)
  })

  it('dry-run skips confirmation but never bypasses the project guard', () => {
    expect(assertCleanDatabaseAllowed({ SUPABASE_PROJECT_REF: 'test-project' }, { dryRun: true })).toBe('test-project')
    expect(() => assertCleanDatabaseAllowed({ SUPABASE_PROJECT_REF: PROD }, { dryRun: true })).toThrow(
      /production Supabase project/,
    )
  })

  it('covers the complete fixture table set in FK-safe order', () => {
    expect(CLEAN_TABLES.map((table) => table.name)).toEqual([
      'route_edges',
      'route_nodes',
      'buildings',
      'published_maps',
      'graph_snapshots',
      'campus_maps',
    ])
  })
})
