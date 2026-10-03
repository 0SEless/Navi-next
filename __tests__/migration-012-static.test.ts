// @vitest-environment node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const M = (f: string) => readFileSync(path.resolve(process.cwd(), 'supabase', 'migrations', f), 'utf8')
const M012 = M('012_fix_conflict_sqlstates.sql')
const M012_CODE = M012.replace(/--[^\n]*/g, '') // assertions target executable SQL, not rationale comments
const M010 = M('010_campus_graph_revisions.sql')
const M011 = M('011_graph_mutation_idempotency.sql')

describe('migration 012 static contract — application conflict SQLSTATE', () => {
  it('22: replaces all conflict-path 40001 raises with P0001', () => {
    expect(M012).not.toMatch(/ERRCODE = '40001'/)
    const codes = M012.match(/USING ERRCODE = 'P0001'/g) ?? []
    expect(codes.length).toBeGreaterThanOrEqual(5) // 3 CAS (save) + 3 CAS (restore) + 2 collision
  })

  it('preserves exact recognizable message prefixes for API mapping', () => {
    expect(M012).toMatch(/GRAPH_SNAPSHOT_CONFLICT: server snapshot exists but the editor has no matching revision/)
    expect(M012).toMatch(/GRAPH_SNAPSHOT_CONFLICT: expected server snapshot no longer exists/)
    expect(M012).toMatch(/GRAPH_SNAPSHOT_CONFLICT: expected %, found %/)
    expect(M012).toMatch(/MUTATION_ID_COLLISION: mutation % already committed for campus % with different content/)
  })

  it('23: application conflict code is non-retryable (P0001, not 40001/serialization class)', () => {
    expect(M012_CODE).toMatch(/P0001/)
    expect(M012_CODE).not.toMatch(/40001|40002|40P01/)
  })

  it('24: advisory locking remains transaction-scoped pg_advisory_xact_lock only', () => {
    expect(M012).toMatch(/pg_advisory_xact_lock\(hashtext\('navi_graph_snapshot:' \|\| campus\)\)/)
    expect(M012).not.toMatch(/pg_advisory_lock\(/)
  })

  it('25: mutation ledger semantics unchanged (md5 checksum, per (campus,mutation), replay + collision paths)', () => {
    expect(M012).toMatch(/md5\(authored::text\)/)
    expect(M012).toMatch(/FROM campus_graph_mutations/)
    expect(M012).toMatch(/INSERT INTO campus_graph_mutations \(campus_id, mutation_id, payload_checksum, revision\)/)
    expect(M012).toMatch(/idempotent_replay', TRUE/)
    expect(M012).toMatch(/EXCEPTION WHEN unique_violation THEN/)
  })

  it('26: CAS comparison semantics unchanged (FOR UPDATE + expected/current comparison)', () => {
    expect(M012).toMatch(/FOR UPDATE/)
    expect(M012).toMatch(/current_revision <> expected_revision/)
    expect(M012).toMatch(/current_revision <> p_expected_current/)
  })

  it('27: revision-history write path untouched (delegates to write_graph_snapshot, no direct history writes)', () => {
    expect(M012).toMatch(/write_graph_snapshot\(campus, authored_payload/)
    expect(M012).not.toMatch(/INSERT INTO campus_graph_revisions/)
    expect(M012).not.toMatch(/CREATE OR REPLACE FUNCTION write_graph_snapshot/)
  })

  it('28: graph/projection transaction remains atomic (single write path, no partial writes added)', () => {
    expect(M012).not.toMatch(/COMMIT|BEGIN;/)
    expect(M012).toMatch(/RETURN write_graph_snapshot/)
    expect(M012).toMatch(/result := sync_graph_snapshot\(payload - 'mutationId'\)/)
  })

  it('no timeout configuration is introduced', () => {
    expect(M012_CODE).not.toMatch(/statement_timeout|lock_timeout|idle_in_transaction_session_timeout/i)
  })

  it('original migrations 010/011 untouched (012 supersedes function bodies)', () => {
    expect(M010).toMatch(/ERRCODE = '40001'/) // historical, superseded by 012
    expect(M011).toMatch(/ERRCODE = '40001'/) // historical, superseded by 012
    expect(M010).toMatch(/pg_advisory_xact_lock/)
    expect(M011).toMatch(/pg_advisory_xact_lock/)
  })

  it('recreates exactly the three conflict-raising functions and re-asserts service-role ACLs', () => {
    const replace = M012.match(/CREATE OR REPLACE FUNCTION (\w+)/g) ?? []
    expect(replace).toEqual([
      'CREATE OR REPLACE FUNCTION sync_graph_snapshot',
      'CREATE OR REPLACE FUNCTION restore_graph_revision',
      'CREATE OR REPLACE FUNCTION sync_graph_snapshot_idempotent',
    ])
    expect(M012).toMatch(/GRANT EXECUTE ON FUNCTION sync_graph_snapshot\(JSONB\) TO service_role/)
  })
})
