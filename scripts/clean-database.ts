/**
 * clean-database.ts
 *
 * Deletes ALL map data from Supabase tables. DESTRUCTIVE.
 *
 * Safety contract (2026-09-13 P0 stabilization):
 *   - refuses an unidentified project (fail closed);
 *   - refuses production unless CLEAN_DATABASE_ALLOW_PRODUCTION=<project-ref> is set;
 *   - requires typed confirmation CLEAN_DATABASE_CONFIRM=WIPE:<project-ref> before deleting;
 *   - prints the target project ref and table list before mutating;
 *   - `--dry-run` prints counts only and performs no deletes;
 *   - aborts on the first table error unless `--keep-going` is given.
 *
 * Usage:
 *   npx tsx scripts/clean-database.ts --dry-run
 *   CLEAN_DATABASE_CONFIRM=WIPE:<ref> npx tsx scripts/clean-database.ts
 *   CLEAN_DATABASE_ALLOW_PRODUCTION=<prod-ref> CLEAN_DATABASE_CONFIRM=WIPE:<prod-ref> npx tsx scripts/clean-database.ts --keep-going
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { join } from 'path'
import { pathToFileURL } from 'url'

import {
  UnsafeEnvironmentError,
  requireSafeSupabaseEnvironment,
  type EnvLike,
} from '../src/lib/env-safety'

export const CLEAN_CONFIRM_VAR = 'CLEAN_DATABASE_CONFIRM'
export const CLEAN_PRODUCTION_OVERRIDE_VAR = 'CLEAN_DATABASE_ALLOW_PRODUCTION'

/** FK-safe deletion order: children before parents. */
export const CLEAN_TABLES: ReadonlyArray<{ name: string; idColumn: string }> = [
  { name: 'route_edges', idColumn: 'id' },
  { name: 'route_nodes', idColumn: 'id' },
  { name: 'buildings', idColumn: 'id' },
  { name: 'published_maps', idColumn: 'campus_id' },
  { name: 'graph_snapshots', idColumn: 'campus_id' },
  { name: 'campus_maps', idColumn: 'map_id' },
]

export function loadEnvFile(cwd: string = process.cwd()): EnvLike {
  try {
    const envPath = join(cwd, '.env.local')
    const envContent = readFileSync(envPath, 'utf-8')
    const envVars: EnvLike = {}
    for (const line of envContent.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIndex = trimmed.indexOf('=')
      if (eqIndex === -1) continue
      envVars[trimmed.substring(0, eqIndex).trim()] = trimmed.substring(eqIndex + 1).trim()
    }
    return envVars
  } catch {
    return {}
  }
}

/**
 * Resolve and authorize the target project for clean-database.
 * Throws (never warns-and-continues) when the run is not explicitly authorized.
 */
export function assertCleanDatabaseAllowed(
  env: EnvLike,
  options: { dryRun?: boolean } = {},
): string {
  const projectRef = requireSafeSupabaseEnvironment(env, {
    operation: 'clean-database',
    overrideVar: CLEAN_PRODUCTION_OVERRIDE_VAR,
  })

  if (options.dryRun) return projectRef

  const expectedConfirmation = `WIPE:${projectRef}`
  const provided = (env[CLEAN_CONFIRM_VAR] ?? '').trim()
  if (provided !== expectedConfirmation) {
    throw new UnsafeEnvironmentError(
      `clean-database refuses to delete without explicit confirmation. ` +
        `Set ${CLEAN_CONFIRM_VAR}=${expectedConfirmation} to wipe every row in: ` +
        `${CLEAN_TABLES.map((t) => t.name).join(', ')}. ` +
        `Use --dry-run to inspect counts only.`,
      'CONFIRMATION_REQUIRED',
    )
  }

  return projectRef
}

export interface CleanTableOptions {
  dryRun?: boolean
  keepGoing?: boolean
}

async function cleanTable(
  supabase: SupabaseClient,
  tableName: string,
  idColumn: string,
  options: CleanTableOptions,
): Promise<number> {
  const { count, error: countError } = await supabase
    .from(tableName)
    .select('*', { count: 'exact', head: true })

  if (countError) {
    if (options.keepGoing) {
      console.log(`  ${tableName}: skipping (${countError.message})`)
      return 0
    }
    throw new Error(`clean-database aborted at ${tableName}: ${countError.message}`)
  }

  const beforeCount = count ?? 0
  if (beforeCount === 0) {
    console.log(`  ${tableName}: already empty`)
    return 0
  }

  if (options.dryRun) {
    console.log(`  ${tableName}: would delete ${beforeCount} rows`)
    return 0
  }

  let deleted = 0
  for (let batch = 0; batch < 100; batch += 1) {
    const { data: rows, error: fetchError } = await supabase
      .from(tableName)
      .select(idColumn)
      .limit(1000)

    if (fetchError) {
      if (options.keepGoing) {
        console.error(`  ${tableName}: fetch failed (${fetchError.message})`)
        break
      }
      throw new Error(`clean-database aborted at ${tableName}: ${fetchError.message}`)
    }
    if (!rows || rows.length === 0) break

    const ids = rows.map((r: Record<string, unknown>) => r[idColumn])
    const { error: deleteError } = await supabase.from(tableName).delete().in(idColumn, ids)
    if (deleteError) {
      if (options.keepGoing) {
        console.error(`  ${tableName}: delete failed (${deleteError.message})`)
        break
      }
      throw new Error(`clean-database aborted at ${tableName}: ${deleteError.message}`)
    }
    deleted += ids.length
    if (rows.length < 1000) break
  }

  console.log(`  ${tableName}: deleted ${deleted} rows`)
  return deleted
}

export async function main(
  argv: string[] = process.argv.slice(2),
  envInput?: EnvLike,
): Promise<number> {
  const dryRun = argv.includes('--dry-run')
  const keepGoing = argv.includes('--keep-going')
  const env: EnvLike = { ...loadEnvFile(), ...process.env, ...(envInput ?? {}) }

  let projectRef: string
  try {
    projectRef = assertCleanDatabaseAllowed(env, { dryRun })
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 1
  }

  const url = (env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '')
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY
  if (!url || !serviceKey) {
    console.error('Missing Supabase environment variables (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)')
    return 1
  }

  console.log('=== NAVI Database Cleanup ===')
  console.log(`Target project: ${projectRef}`)
  console.log(dryRun ? 'Mode: DRY RUN (no deletes)' : 'Mode: DELETE')
  console.log('Tables:')
  for (const table of CLEAN_TABLES) console.log(`  - ${table.name}`)
  console.log('')

  const supabase = createClient(url, serviceKey)
  let totalDeleted = 0
  try {
    for (const table of CLEAN_TABLES) {
      totalDeleted += await cleanTable(supabase, table.name, table.idColumn, { dryRun, keepGoing })
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 1
  }

  console.log('')
  console.log('=== Complete ===')
  console.log(dryRun ? 'Dry run complete — no rows were deleted.' : `Total rows deleted: ${totalDeleted}`)
  return 0
}

const invokedDirectly =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  main().then((code) => {
    if (code !== 0) process.exit(code)
  })
}
