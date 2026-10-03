-- 011_graph_mutation_idempotency.sql — durable mutation idempotency (wrapper over 010).
--
-- Contract:
--   same campus + same mutationId + same authored payload -> replay original revision
--     (no new graph revision, no new history row, no projection change)
--   same campus + same mutationId + different payload   -> MUTATION_ID_COLLISION (40001)
--   missing mutationId                                  -> straight delegate (legacy behavior)
--
-- Retention: idempotency window = lifetime of campus_graph_mutations rows.
-- prune_graph_mutations removes entries older than p_older_than (default 30 days).
-- Revision pruning (010) never removes mutation rows, so replay stays deterministic
-- inside the retention window. Uniqueness is per (campus_id, mutation_id).
--
-- Does NOT modify migration 010; sync_graph_snapshot remains the authoritative writer.

CREATE TABLE IF NOT EXISTS public.campus_graph_mutations (
  campus_id text NOT NULL,
  mutation_id text NOT NULL,
  payload_checksum text NOT NULL,
  revision timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campus_id, mutation_id)
);

CREATE INDEX IF NOT EXISTS campus_graph_mutations_created_idx
  ON public.campus_graph_mutations (campus_id, created_at DESC);

ALTER TABLE public.campus_graph_mutations ENABLE ROW LEVEL SECURITY;

CREATE POLICY campus_graph_mutations_service_only ON public.campus_graph_mutations
  FOR ALL USING (false) WITH CHECK (false);

REVOKE ALL ON TABLE public.campus_graph_mutations FROM PUBLIC;
REVOKE ALL ON TABLE public.campus_graph_mutations FROM anon, authenticated;

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

  -- Serialize the mutation pre-check with the 010 writer's per-campus lock.
  -- Without this, a concurrent identical replay could pass the pre-check while
  -- the first transaction is still uncommitted, then block on the inner lock and
  -- fail CAS (conflict) instead of returning the original revision. Advisory
  -- xact locks are re-entrant within the same transaction, so the delegated
  -- sync_graph_snapshot re-acquires the same lock safely.
  PERFORM pg_advisory_xact_lock(hashtext('navi_graph_snapshot:' || campus));

  SELECT revision, payload_checksum INTO existing_revision, existing_checksum
  FROM campus_graph_mutations
  WHERE campus_id = campus AND mutation_id = mut;

  IF FOUND THEN
    IF existing_checksum = checksum THEN
      RETURN jsonb_build_object('success', TRUE, 'campus_id', campus, 'updatedAt', existing_revision, 'idempotent_replay', TRUE);
    END IF;
    RAISE EXCEPTION 'MUTATION_ID_COLLISION: mutation % already committed for campus % with different content', mut, campus USING ERRCODE = '40001';
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
    RAISE EXCEPTION 'MUTATION_ID_COLLISION: mutation % already committed for campus % with different content', mut, campus USING ERRCODE = '40001';
  END;

  RETURN result || jsonb_build_object('idempotent_replay', FALSE);
END;
$$;

CREATE OR REPLACE FUNCTION prune_graph_mutations(p_campus_id TEXT, p_older_than INTERVAL DEFAULT INTERVAL '30 days')
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = 'public'
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM campus_graph_mutations
  WHERE campus_id = p_campus_id AND created_at < now() - p_older_than;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION sync_graph_snapshot_idempotent(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION sync_graph_snapshot_idempotent(JSONB) FROM anon, authenticated;
REVOKE ALL ON FUNCTION prune_graph_mutations(TEXT, INTERVAL) FROM PUBLIC;
REVOKE ALL ON FUNCTION prune_graph_mutations(TEXT, INTERVAL) FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION sync_graph_snapshot_idempotent(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION prune_graph_mutations(TEXT, INTERVAL) TO service_role;
