-- 012_fix_conflict_sqlstates.sql — replace retryable SQLSTATE 40001 with a
-- non-retryable application error code for deterministic application conflicts.
--
-- Rationale (live DEV evidence, 2026-09-17):
--   MUTATION_ID_COLLISION and GRAPH_SNAPSHOT_CONFLICT are deterministic
--   application-level conflicts. Raising them as 40001 (serialization_failure)
--   wrongly advertises a retryable transaction failure; combined with
--   idle_in_transaction_session_timeout=0 it left aborted PostgREST transactions
--   retaining a granted advisory xact lock and degraded DEV to 503s. A late retry
--   also re-materialized a stale mutation during cleanup.
--
-- Change: USING ERRCODE = 'P0001' (generic PL/pgSQL raise_exception, non-retryable).
-- Preserved exactly: message prefixes (MUTATION_ID_COLLISION: / GRAPH_SNAPSHOT_CONFLICT:),
-- CAS comparison semantics, transport-field stripping, pg_advisory_xact_lock usage,
-- mutation-ledger semantics, checksum logic, revision history, projection rebuild,
-- atomicity and per-campus serialization. No timeout settings are added here.
--
-- This migration only recreates functions that previously raised 40001:
--   public.sync_graph_snapshot(JSONB)                (was 010)
--   public.restore_graph_revision(TEXT, TIMESTAMPTZ, TIMESTAMPTZ) (was 010)
--   public.sync_graph_snapshot_idempotent(JSONB)     (was 011)

CREATE OR REPLACE FUNCTION sync_graph_snapshot(payload JSONB)
RETURNS JSONB LANGUAGE plpgsql SET search_path = 'public' AS $$
DECLARE
  campus TEXT := payload->>'campusId';
  expected_revision TIMESTAMPTZ := NULLIF(payload->>'expectedServerUpdatedAt', '')::TIMESTAMPTZ;
  force_overwrite BOOLEAN := COALESCE((payload->>'forceServerOverwrite')::BOOLEAN, FALSE);
  current_revision TIMESTAMPTZ;
  current_data JSONB;
  revision_source TEXT := NULLIF(payload->>'revisionSource', '');
  created_by TEXT := NULLIF(payload->>'createdBy', '');
  authored_payload JSONB := payload - 'expectedServerUpdatedAt' - 'forceServerOverwrite' - 'revisionSource' - 'createdBy';
BEGIN
  IF campus IS NULL THEN campus := 'asu-ibajay'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('navi_graph_snapshot:' || campus));
  SELECT updated_at, data INTO current_revision, current_data
  FROM graph_snapshots WHERE campus_id = campus FOR UPDATE;
  IF NOT force_overwrite AND payload ? 'expectedServerUpdatedAt' THEN
    IF current_revision IS NOT NULL AND expected_revision IS NULL THEN
      IF current_data IS NULL
        OR (COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(current_data->'buildings') = 'array' THEN current_data->'buildings' END), 0) = 0
            AND COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(current_data->'nodes') = 'array' THEN current_data->'nodes' END), 0) = 0) THEN
        NULL;
      ELSE
        RAISE EXCEPTION 'GRAPH_SNAPSHOT_CONFLICT: server snapshot exists but the editor has no matching revision' USING ERRCODE = 'P0001';
      END IF;
    END IF;
    IF current_revision IS NULL AND expected_revision IS NOT NULL THEN
      RAISE EXCEPTION 'GRAPH_SNAPSHOT_CONFLICT: expected server snapshot no longer exists' USING ERRCODE = 'P0001';
    END IF;
    IF current_revision IS NOT NULL AND expected_revision IS NOT NULL AND current_revision <> expected_revision THEN
      RAISE EXCEPTION 'GRAPH_SNAPSHOT_CONFLICT: expected %, found %', expected_revision, current_revision USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN write_graph_snapshot(campus, authored_payload, COALESCE(revision_source, 'autosave'),
    current_revision, COALESCE(created_by, 'api'), '{}'::JSONB);
END;
$$;

CREATE OR REPLACE FUNCTION restore_graph_revision(
  p_campus_id TEXT, p_revision TIMESTAMPTZ, p_expected_current TIMESTAMPTZ
) RETURNS JSONB LANGUAGE plpgsql SET search_path = 'public' AS $$
DECLARE
  campus TEXT := NULLIF(p_campus_id, '');
  current_revision TIMESTAMPTZ;
  restored_data JSONB;
  result JSONB;
BEGIN
  IF campus IS NULL THEN
    RAISE EXCEPTION 'GRAPH_REVISION_INVALID: campus id is required' USING ERRCODE = '22023';
  END IF;
  IF p_revision IS NULL THEN
    RAISE EXCEPTION 'GRAPH_REVISION_INVALID: revision timestamp is required' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('navi_graph_snapshot:' || campus));
  SELECT updated_at INTO current_revision FROM graph_snapshots WHERE campus_id = campus FOR UPDATE;
  IF current_revision IS NULL AND p_expected_current IS NOT NULL THEN
    RAISE EXCEPTION 'GRAPH_SNAPSHOT_CONFLICT: expected server snapshot no longer exists' USING ERRCODE = 'P0001';
  END IF;
  IF current_revision IS NOT NULL AND p_expected_current IS NULL THEN
    RAISE EXCEPTION 'GRAPH_SNAPSHOT_CONFLICT: server snapshot exists but the restore has no matching revision' USING ERRCODE = 'P0001';
  END IF;
  IF current_revision IS NOT NULL AND p_expected_current IS NOT NULL AND current_revision <> p_expected_current THEN
    RAISE EXCEPTION 'GRAPH_SNAPSHOT_CONFLICT: expected %, found %', p_expected_current, current_revision USING ERRCODE = 'P0001';
  END IF;
  SELECT graph_data INTO restored_data
  FROM campus_graph_revisions WHERE campus_id = campus AND revision = p_revision;
  IF restored_data IS NULL THEN
    RAISE EXCEPTION 'GRAPH_REVISION_NOT_FOUND: no revision % for campus %', p_revision, campus USING ERRCODE = 'P0002';
  END IF;
  result := write_graph_snapshot(campus, restored_data, 'restore', current_revision, 'api',
    jsonb_build_object('restoredFrom', p_revision));
  RETURN result || jsonb_build_object('restored_from', p_revision);
END;
$$;

CREATE OR REPLACE FUNCTION sync_graph_snapshot_idempotent(payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = 'public'
AS $$
DECLARE
  campus TEXT := payload->>'campusId';
  mut TEXT := NULLIF(payload->>'mutationId', '');
  authored JSONB := payload - 'expectedServerUpdatedAt' - 'forceServerOverwrite' - 'mutationId';
  checksum TEXT := md5(authored::text);
  existing_revision TIMESTAMPTZ;
  existing_checksum TEXT;
  result JSONB;
BEGIN
  IF campus IS NULL THEN campus := 'asu-ibajay'; END IF;

  IF mut IS NULL THEN
    RETURN sync_graph_snapshot(payload - 'mutationId');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('navi_graph_snapshot:' || campus));

  SELECT revision, payload_checksum INTO existing_revision, existing_checksum
  FROM campus_graph_mutations
  WHERE campus_id = campus AND mutation_id = mut;

  IF FOUND THEN
    IF existing_checksum = checksum THEN
      RETURN jsonb_build_object('success', TRUE, 'campus_id', campus, 'updatedAt', existing_revision, 'idempotent_replay', TRUE);
    END IF;
    RAISE EXCEPTION 'MUTATION_ID_COLLISION: mutation % already committed for campus % with different content', mut, campus USING ERRCODE = 'P0001';
  END IF;

  result := sync_graph_snapshot(payload - 'mutationId');

  BEGIN
    INSERT INTO campus_graph_mutations (campus_id, mutation_id, payload_checksum, revision)
    VALUES (campus, mut, checksum, (result->>'updatedAt')::timestamptz);
  EXCEPTION WHEN unique_violation THEN
    SELECT revision, payload_checksum INTO existing_revision, existing_checksum
    FROM campus_graph_mutations WHERE campus_id = campus AND mutation_id = mut;
    IF existing_checksum = checksum THEN
      RETURN jsonb_build_object('success', TRUE, 'campus_id', campus, 'updatedAt', existing_revision, 'idempotent_replay', TRUE);
    END IF;
    RAISE EXCEPTION 'MUTATION_ID_COLLISION: mutation % already committed for campus % with different content', mut, campus USING ERRCODE = 'P0001';
  END;

  RETURN result || jsonb_build_object('idempotent_replay', FALSE);
END;
$$;

-- ACLs are unchanged by CREATE OR REPLACE; re-assert for clarity/safety.
REVOKE ALL ON FUNCTION sync_graph_snapshot(JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION restore_graph_revision(TEXT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION sync_graph_snapshot_idempotent(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION sync_graph_snapshot(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION restore_graph_revision(TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION sync_graph_snapshot_idempotent(JSONB) TO service_role;
