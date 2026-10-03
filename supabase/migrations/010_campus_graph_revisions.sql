-- 010_campus_graph_revisions.sql - Phase 5: durable server-side revision history.
-- Every accepted save (sync_graph_snapshot) and every restore appends one immutable
-- row to campus_graph_revisions in the SAME transaction as the graph_snapshots
-- upsert and the projection rebuild (both go through write_graph_snapshot).
-- ATOMICITY: any failure raises and rolls the whole RPC back; a graph save can
-- never commit without its revision row, and no revision row survives without the
-- matching committed snapshot.
-- Preserved live 009 guarantees: per-campus pg_advisory_xact_lock, SELECT ... FOR
-- UPDATE, stale-revision GRAPH_SNAPSHOT_CONFLICT (40001), transport-field stripping,
-- metadata-placeholder adoption, post-lock clock_timestamp(), SET search_path='public',
-- authoritative updatedAt return, full projection rebuild.
-- RETENTION: prune_graph_revisions(campus, keep) deletes only source='autosave' rows
-- older than the newest `keep`; manual/restore/force/import rows are never deleted.
-- Recommended: keep 500 autosaves (~140 KB each for map-map-1-k6bv, ~70 MB per 500)
-- plus every protected source. Pruning never touches graph_snapshots or projections.

CREATE TABLE IF NOT EXISTS public.campus_graph_revisions (
  id BIGSERIAL PRIMARY KEY,
  campus_id TEXT NOT NULL,
  revision TIMESTAMPTZ NOT NULL,
  parent_revision TIMESTAMPTZ,
  graph_data JSONB NOT NULL,
  checksum TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT NOT NULL DEFAULT 'api',
  source TEXT NOT NULL DEFAULT 'autosave',
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB
);

CREATE INDEX IF NOT EXISTS campus_graph_revisions_campus_revision_idx
  ON public.campus_graph_revisions (campus_id, revision DESC);

-- RLS per 003 (public read; service-role RPCs bypass); privileges per 008.
ALTER TABLE public.campus_graph_revisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "campus_graph_revisions_select_public" ON public.campus_graph_revisions;
CREATE POLICY "campus_graph_revisions_select_public" ON public.campus_graph_revisions FOR SELECT USING (true);
REVOKE ALL ON public.campus_graph_revisions FROM anon, public, authenticated;
GRANT SELECT ON public.campus_graph_revisions TO anon, authenticated;
REVOKE ALL ON SEQUENCE public.campus_graph_revisions_id_seq FROM anon, public, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.campus_graph_revisions_id_seq TO service_role;
GRANT ALL ON public.campus_graph_revisions TO service_role;

-- Shared write path. Callers MUST hold the per-campus advisory lock and MUST have
-- passed the CAS check. Revision comes from clock_timestamp() while the lock is held
-- (never a client clock); the history row is inserted BEFORE the snapshot upsert, so
-- a history failure aborts the entire save.
CREATE OR REPLACE FUNCTION write_graph_snapshot(
  p_campus TEXT, p_payload JSONB, p_source TEXT DEFAULT 'autosave',
  p_parent TIMESTAMPTZ DEFAULT NULL, p_created_by TEXT DEFAULT 'api',
  p_metadata JSONB DEFAULT '{}'::JSONB
) RETURNS JSONB LANGUAGE plpgsql SET search_path = 'public' AS $$
DECLARE
  saved_revision TIMESTAMPTZ;
  revision_metadata JSONB;
  b JSONB;
  n JSONB;
  e JSONB;
BEGIN
  saved_revision := clock_timestamp();
  revision_metadata := COALESCE(p_metadata, '{}'::JSONB) || jsonb_build_object(
    'version', COALESCE(p_payload->>'version', '1.0.0'),
    'buildingCount', COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(p_payload->'buildings') = 'array' THEN p_payload->'buildings' END), 0),
    'nodeCount', COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(p_payload->'nodes') = 'array' THEN p_payload->'nodes' END), 0),
    'edgeCount', COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(p_payload->'edges') = 'array' THEN p_payload->'edges' END), 0));
  INSERT INTO campus_graph_revisions (campus_id, revision, parent_revision, graph_data, checksum, created_by, source, metadata)
  VALUES (p_campus, saved_revision, p_parent, p_payload, md5(p_payload::TEXT),
    COALESCE(p_created_by, 'api'), COALESCE(p_source, 'autosave'), revision_metadata);
  INSERT INTO graph_snapshots (campus_id, data, version, updated_at)
  VALUES (p_campus, p_payload, COALESCE(p_payload->>'version', '1.0.0'), saved_revision)
  ON CONFLICT (campus_id)
  DO UPDATE SET data = EXCLUDED.data, version = EXCLUDED.version, updated_at = saved_revision;
  DELETE FROM buildings WHERE campus_id = p_campus;
  FOR b IN SELECT * FROM jsonb_array_elements(p_payload->'buildings')
  LOOP
    INSERT INTO buildings (id, campus_id, name, code, description, floors, color, center, outline, floor_plan_url)
    VALUES (
      b->>'id', p_campus, COALESCE(b->>'name', ''), b->>'code', COALESCE(b->>'description', ''),
      COALESCE(jsonb_array_length(b->'floors'), 1), COALESCE(b->>'color', '#64748B'),
      CASE WHEN b->'center'->>'lat' IS NOT NULL
        THEN ST_SetSRID(ST_MakePoint((b->'center'->>'lng')::DOUBLE PRECISION, (b->'center'->>'lat')::DOUBLE PRECISION), 4326)::geography
        ELSE NULL END,
      CASE WHEN b->'outline' IS NOT NULL AND jsonb_array_length(b->'outline') >= 3
        THEN ST_GeogFromText('SRID=4326;POLYGON((' ||
          (SELECT string_agg((p->>'lng')::TEXT || ' ' || (p->>'lat')::TEXT, ',') FROM jsonb_array_elements(b->'outline') p)
          || ', ' || (b->'outline'->0->>'lng')::TEXT || ' ' || (b->'outline'->0->>'lat')::TEXT || '))')
        ELSE NULL END,
      b->>'floorPlanUrl')
    ON CONFLICT (id) DO NOTHING;
  END LOOP;
  DELETE FROM route_nodes WHERE campus_id = p_campus;
  FOR n IN SELECT * FROM jsonb_array_elements(p_payload->'nodes')
  LOOP
    INSERT INTO route_nodes (id, campus_id, building_id, name, node_type, floor, position, component_id, svg_offset_x, svg_offset_y, has_qr, has_panorama, panorama_url, metadata)
    VALUES (
      n->>'id', p_campus, NULLIF(n->>'buildingId', ''), COALESCE(n->>'name', ''), COALESCE(n->>'type', 'intersection'),
      COALESCE((n->>'floor')::INTEGER, 1),
      ST_SetSRID(ST_MakePoint((n->'position'->>'lng')::DOUBLE PRECISION, (n->'position'->>'lat')::DOUBLE PRECISION), 4326)::geography,
      n->>'componentId', (n->'svgOffset'->>'x')::DOUBLE PRECISION, (n->'svgOffset'->>'y')::DOUBLE PRECISION,
      COALESCE((n->>'hasQr')::BOOLEAN, FALSE), COALESCE((n->>'hasPanorama')::BOOLEAN, FALSE),
      n->>'panoramaUrl', COALESCE(n->'metadata', '{}'::JSONB))
    ON CONFLICT (id) DO NOTHING;
  END LOOP;
  DELETE FROM route_edges WHERE campus_id = p_campus;
  FOR e IN SELECT * FROM jsonb_array_elements(p_payload->'edges')
  LOOP
    INSERT INTO route_edges (id, campus_id, from_node_id, to_node_id, edge_type, distance)
    VALUES (e->>'id', p_campus, e->>'from', e->>'to', COALESCE(e->>'type', 'walkway'), COALESCE((e->>'distance')::DOUBLE PRECISION, 0))
    ON CONFLICT (id) DO NOTHING;
  END LOOP;
  RETURN jsonb_build_object('success', TRUE, 'campus_id', p_campus, 'updatedAt', saved_revision);
END;
$$;

-- Save path: identical CAS contract to live 009, plus revision capture. The Phase 5
-- control fields revisionSource/createdBy are stripped with the other transport
-- fields and default to 'autosave' / 'api'.
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
        RAISE EXCEPTION 'GRAPH_SNAPSHOT_CONFLICT: server snapshot exists but the editor has no matching revision' USING ERRCODE = '40001';
      END IF;
    END IF;
    IF current_revision IS NULL AND expected_revision IS NOT NULL THEN
      RAISE EXCEPTION 'GRAPH_SNAPSHOT_CONFLICT: expected server snapshot no longer exists' USING ERRCODE = '40001';
    END IF;
    IF current_revision IS NOT NULL AND expected_revision IS NOT NULL AND current_revision <> expected_revision THEN
      RAISE EXCEPTION 'GRAPH_SNAPSHOT_CONFLICT: expected %, found %', expected_revision, current_revision USING ERRCODE = '40001';
    END IF;
  END IF;
  RETURN write_graph_snapshot(campus, authored_payload, COALESCE(revision_source, 'autosave'),
    current_revision, COALESCE(created_by, 'api'), '{}'::JSONB);
END;
$$;

-- Restore path: forward-only, CAS-gated against graph_snapshots.updated_at, replaying
-- the historical graph_data through the SAME write path. Creates a NEW revision
-- (source='restore', parent_revision = current); history rows are never updated or
-- deleted. Returns updatedAt plus restored_from.
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
    RAISE EXCEPTION 'GRAPH_SNAPSHOT_CONFLICT: expected server snapshot no longer exists' USING ERRCODE = '40001';
  END IF;
  IF current_revision IS NOT NULL AND p_expected_current IS NULL THEN
    RAISE EXCEPTION 'GRAPH_SNAPSHOT_CONFLICT: server snapshot exists but the restore has no matching revision' USING ERRCODE = '40001';
  END IF;
  IF current_revision IS NOT NULL AND p_expected_current IS NOT NULL AND current_revision <> p_expected_current THEN
    RAISE EXCEPTION 'GRAPH_SNAPSHOT_CONFLICT: expected %, found %', p_expected_current, current_revision USING ERRCODE = '40001';
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

-- Retention: deletes only source='autosave' rows beyond the newest p_keep; never
-- touches manual/restore/force/import. Holds the same advisory lock as save/restore.
CREATE OR REPLACE FUNCTION prune_graph_revisions(p_campus_id TEXT, p_keep INTEGER)
RETURNS INTEGER LANGUAGE plpgsql SET search_path = 'public' AS $$
DECLARE
  campus TEXT := NULLIF(p_campus_id, '');
  deleted_count INTEGER := 0;
BEGIN
  IF campus IS NULL THEN
    RAISE EXCEPTION 'PRUNE_INVALID_REQUEST: campus id is required' USING ERRCODE = '22023';
  END IF;
  IF p_keep IS NULL OR p_keep < 1 THEN
    RAISE EXCEPTION 'PRUNE_INVALID_REQUEST: p_keep must be at least 1' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('navi_graph_snapshot:' || campus));
  WITH keep AS (
    SELECT revision FROM campus_graph_revisions
    WHERE campus_id = campus AND source = 'autosave'
    ORDER BY revision DESC LIMIT p_keep
  )
  DELETE FROM campus_graph_revisions r
  WHERE r.campus_id = campus AND r.source = 'autosave'
    AND NOT EXISTS (SELECT 1 FROM keep k WHERE k.revision = r.revision);
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- Only the service role (used by /api routes) may run the new functions; the default
-- PUBLIC EXECUTE would otherwise expose raw write/restore/prune over PostgREST.
REVOKE EXECUTE ON FUNCTION
  public.write_graph_snapshot(TEXT, JSONB, TEXT, TIMESTAMPTZ, TEXT, JSONB),
  public.restore_graph_revision(TEXT, TIMESTAMPTZ, TIMESTAMPTZ),
  public.prune_graph_revisions(TEXT, INTEGER)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.write_graph_snapshot(TEXT, JSONB, TEXT, TIMESTAMPTZ, TEXT, JSONB),
  public.restore_graph_revision(TEXT, TIMESTAMPTZ, TIMESTAMPTZ),
  public.prune_graph_revisions(TEXT, INTEGER)
TO service_role;
