-- 014_authored_document_snapshots.sql — Phase 3A.1 durable authored state.
--
-- The existing data/graph_data columns remain raw Graph JSON for legacy
-- consumers, public publishing, and rollback compatibility. The nullable
-- authored_document companion is the canonical CampusDocument snapshot. Both
-- representations are written by one revision transaction through the shared
-- write path; old rows and old Graph-only payloads remain valid.

ALTER TABLE IF EXISTS public.graph_snapshots
  ADD COLUMN IF NOT EXISTS authored_document JSONB;

ALTER TABLE IF EXISTS public.campus_graph_revisions
  ADD COLUMN IF NOT EXISTS authored_document JSONB;

COMMENT ON COLUMN public.graph_snapshots.authored_document IS
  'Canonical authored CampusDocument snapshot; NULL means legacy Graph-only row.';
COMMENT ON COLUMN public.campus_graph_revisions.authored_document IS
  'Canonical authored CampusDocument paired atomically with graph_data; NULL means legacy revision.';

-- New seven-argument writer. The Graph payload stays separate from the
-- authored document so existing projection consumers see unchanged JSON.
CREATE OR REPLACE FUNCTION public.write_graph_snapshot(
  p_campus TEXT, p_payload JSONB, p_source TEXT DEFAULT 'autosave',
  p_parent TIMESTAMPTZ DEFAULT NULL, p_created_by TEXT DEFAULT 'api',
  p_metadata JSONB DEFAULT '{}'::JSONB,
  p_authored_document JSONB DEFAULT NULL
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
    'edgeCount', COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(p_payload->'edges') = 'array' THEN p_payload->'edges' END), 0),
    'authoredDocumentFormatVersion', CASE WHEN p_authored_document IS NULL THEN NULL ELSE 1 END);

  -- History and current snapshot are one transactionally bound pair.
  INSERT INTO public.campus_graph_revisions
    (campus_id, revision, parent_revision, graph_data, authored_document, checksum, created_by, source, metadata)
  VALUES
    (p_campus, saved_revision, p_parent, p_payload, p_authored_document,
     md5(jsonb_build_object('graph', p_payload, 'authoredDocument', p_authored_document)::TEXT),
     COALESCE(p_created_by, 'api'),
     COALESCE(p_source, 'autosave'), revision_metadata);

  INSERT INTO public.graph_snapshots
    (campus_id, data, authored_document, version, updated_at)
  VALUES
    (p_campus, p_payload, p_authored_document,
     COALESCE(p_payload->>'version', '1.0.0'), saved_revision)
  ON CONFLICT (campus_id)
  DO UPDATE SET
    data = EXCLUDED.data,
    authored_document = EXCLUDED.authored_document,
    version = EXCLUDED.version,
    updated_at = saved_revision;

  DELETE FROM public.buildings WHERE campus_id = p_campus;
  FOR b IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'buildings', '[]'::JSONB))
  LOOP
    INSERT INTO public.buildings (id, campus_id, name, code, description, floors, color, center, outline, floor_plan_url)
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

  DELETE FROM public.route_nodes WHERE campus_id = p_campus;
  FOR n IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'nodes', '[]'::JSONB))
  LOOP
    INSERT INTO public.route_nodes
      (id, campus_id, building_id, name, node_type, floor, position, component_id,
       svg_offset_x, svg_offset_y, has_qr, has_panorama, panorama_url, metadata)
    VALUES (
      n->>'id', p_campus, NULLIF(NULLIF(n->>'buildingId', ''), '__outdoor__'),
      COALESCE(n->>'name', ''), COALESCE(n->>'type', 'intersection'),
      COALESCE((n->>'floor')::INTEGER, 1),
      ST_SetSRID(ST_MakePoint((n->'position'->>'lng')::DOUBLE PRECISION, (n->'position'->>'lat')::DOUBLE PRECISION), 4326)::geography,
      n->>'componentId', (n->'svgOffset'->>'x')::DOUBLE PRECISION, (n->'svgOffset'->>'y')::DOUBLE PRECISION,
      COALESCE((n->>'hasQr')::BOOLEAN, FALSE), COALESCE((n->>'hasPanorama')::BOOLEAN, FALSE),
      n->>'panoramaUrl', COALESCE(n->'metadata', '{}'::JSONB))
    ON CONFLICT (id) DO NOTHING;
  END LOOP;

  DELETE FROM public.route_edges WHERE campus_id = p_campus;
  FOR e IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'edges', '[]'::JSONB))
  LOOP
    INSERT INTO public.route_edges (id, campus_id, from_node_id, to_node_id, edge_type, distance)
    VALUES (e->>'id', p_campus, e->>'from', e->>'to', COALESCE(e->>'type', 'walkway'), COALESCE((e->>'distance')::DOUBLE PRECISION, 0))
    ON CONFLICT (id) DO NOTHING;
  END LOOP;

  RETURN jsonb_build_object('success', TRUE, 'campus_id', p_campus, 'updatedAt', saved_revision);
END;
$$;

-- Preserve direct callers using the old six-argument writer. It delegates to
-- the new atomic path with no authored companion and never changes Graph JSON.
CREATE OR REPLACE FUNCTION public.write_graph_snapshot(
  p_campus TEXT, p_payload JSONB, p_source TEXT DEFAULT 'autosave',
  p_parent TIMESTAMPTZ DEFAULT NULL, p_created_by TEXT DEFAULT 'api',
  p_metadata JSONB DEFAULT '{}'::JSONB
) RETURNS JSONB LANGUAGE plpgsql SET search_path = 'public' AS $$
BEGIN
  RETURN public.write_graph_snapshot(
    p_campus, p_payload, p_source, p_parent, p_created_by, p_metadata, NULL::JSONB);
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_graph_snapshot(payload JSONB)
RETURNS JSONB LANGUAGE plpgsql SET search_path = 'public' AS $$
DECLARE
  campus TEXT := payload->>'campusId';
  expected_revision TIMESTAMPTZ := NULLIF(payload->>'expectedServerUpdatedAt', '')::TIMESTAMPTZ;
  force_overwrite BOOLEAN := COALESCE((payload->>'forceServerOverwrite')::BOOLEAN, FALSE);
  current_revision TIMESTAMPTZ;
  current_data JSONB;
  revision_source TEXT := NULLIF(payload->>'revisionSource', '');
  created_by TEXT := NULLIF(payload->>'createdBy', '');
  authored_document JSONB := CASE
    WHEN payload ? 'authoredDocument' THEN NULLIF(payload->'authoredDocument', 'null'::JSONB)
    ELSE NULL END;
  authored_payload JSONB := payload - 'expectedServerUpdatedAt' - 'forceServerOverwrite'
    - 'revisionSource' - 'createdBy' - 'authoredDocument' - 'authoredDocumentFormatVersion';
BEGIN
  IF campus IS NULL THEN campus := 'asu-ibajay'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('navi_graph_snapshot:' || campus));
  SELECT updated_at, data INTO current_revision, current_data
  FROM public.graph_snapshots WHERE campus_id = campus FOR UPDATE;
  IF NOT force_overwrite AND payload ? 'expectedServerUpdatedAt' THEN
    IF current_revision IS NOT NULL AND expected_revision IS NULL THEN
      IF current_data IS NULL OR
        (COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(current_data->'buildings') = 'array' THEN current_data->'buildings' END), 0) = 0
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
  RETURN public.write_graph_snapshot(campus, authored_payload, COALESCE(revision_source, 'autosave'),
    current_revision, COALESCE(created_by, 'api'), '{}'::JSONB, authored_document);
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_graph_revision(
  p_campus_id TEXT, p_revision TIMESTAMPTZ, p_expected_current TIMESTAMPTZ
) RETURNS JSONB LANGUAGE plpgsql SET search_path = 'public' AS $$
DECLARE
  campus TEXT := NULLIF(p_campus_id, '');
  current_revision TIMESTAMPTZ;
  restored_data JSONB;
  restored_authored_document JSONB;
  result JSONB;
BEGIN
  IF campus IS NULL THEN
    RAISE EXCEPTION 'GRAPH_REVISION_INVALID: campus id is required' USING ERRCODE = '22023';
  END IF;
  IF p_revision IS NULL THEN
    RAISE EXCEPTION 'GRAPH_REVISION_INVALID: revision timestamp is required' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('navi_graph_snapshot:' || campus));
  SELECT updated_at INTO current_revision FROM public.graph_snapshots WHERE campus_id = campus FOR UPDATE;
  IF current_revision IS NULL AND p_expected_current IS NOT NULL THEN
    RAISE EXCEPTION 'GRAPH_SNAPSHOT_CONFLICT: expected server snapshot no longer exists' USING ERRCODE = 'P0001';
  END IF;
  IF current_revision IS NOT NULL AND p_expected_current IS NULL THEN
    RAISE EXCEPTION 'GRAPH_SNAPSHOT_CONFLICT: server snapshot exists but the restore has no matching revision' USING ERRCODE = 'P0001';
  END IF;
  IF current_revision IS NOT NULL AND p_expected_current IS NOT NULL AND current_revision <> p_expected_current THEN
    RAISE EXCEPTION 'GRAPH_SNAPSHOT_CONFLICT: expected %, found %', p_expected_current, current_revision USING ERRCODE = 'P0001';
  END IF;
  SELECT graph_data, authored_document INTO restored_data, restored_authored_document
  FROM public.campus_graph_revisions WHERE campus_id = campus AND revision = p_revision;
  IF restored_data IS NULL THEN
    RAISE EXCEPTION 'GRAPH_REVISION_NOT_FOUND: no revision % for campus %', p_revision, campus USING ERRCODE = 'P0002';
  END IF;
  result := public.write_graph_snapshot(campus, restored_data, 'restore', current_revision, 'api',
    jsonb_build_object('restoredFrom', p_revision), restored_authored_document);
  RETURN result || jsonb_build_object('restored_from', p_revision);
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_graph_snapshot_idempotent(payload JSONB)
RETURNS JSONB LANGUAGE plpgsql SET search_path = 'public' AS $$
DECLARE
  campus TEXT := payload->>'campusId';
  mut TEXT := NULLIF(payload->>'mutationId', '');
  authored JSONB := payload - 'expectedServerUpdatedAt' - 'forceServerOverwrite' - 'mutationId';
  checksum TEXT := md5(authored::TEXT);
  existing_revision TIMESTAMPTZ;
  existing_checksum TEXT;
  result JSONB;
BEGIN
  IF campus IS NULL THEN campus := 'asu-ibajay'; END IF;
  IF mut IS NULL THEN RETURN public.sync_graph_snapshot(payload - 'mutationId'); END IF;
  PERFORM pg_advisory_xact_lock(hashtext('navi_graph_snapshot:' || campus));
  SELECT revision, payload_checksum INTO existing_revision, existing_checksum
  FROM public.campus_graph_mutations WHERE campus_id = campus AND mutation_id = mut;
  IF FOUND THEN
    IF existing_checksum = checksum THEN
      RETURN jsonb_build_object('success', TRUE, 'campus_id', campus, 'updatedAt', existing_revision, 'idempotent_replay', TRUE);
    END IF;
    RAISE EXCEPTION 'MUTATION_ID_COLLISION: mutation % already committed for campus % with different content', mut, campus USING ERRCODE = 'P0001';
  END IF;
  result := public.sync_graph_snapshot(payload - 'mutationId');
  BEGIN
    INSERT INTO public.campus_graph_mutations (campus_id, mutation_id, payload_checksum, revision)
    VALUES (campus, mut, checksum, (result->>'updatedAt')::timestamptz);
  EXCEPTION WHEN unique_violation THEN
    SELECT revision, payload_checksum INTO existing_revision, existing_checksum
    FROM public.campus_graph_mutations WHERE campus_id = campus AND mutation_id = mut;
    IF existing_checksum = checksum THEN
      RETURN jsonb_build_object('success', TRUE, 'campus_id', campus, 'updatedAt', existing_revision, 'idempotent_replay', TRUE);
    END IF;
    RAISE EXCEPTION 'MUTATION_ID_COLLISION: mutation % already committed for campus % with different content', mut, campus USING ERRCODE = 'P0001';
  END;
  RETURN result || jsonb_build_object('idempotent_replay', FALSE);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.write_graph_snapshot(TEXT, JSONB, TEXT, TIMESTAMPTZ, TEXT, JSONB),
  public.write_graph_snapshot(TEXT, JSONB, TEXT, TIMESTAMPTZ, TEXT, JSONB, JSONB),
  public.sync_graph_snapshot(JSONB), public.restore_graph_revision(TEXT, TIMESTAMPTZ, TIMESTAMPTZ),
  public.sync_graph_snapshot_idempotent(JSONB)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.write_graph_snapshot(TEXT, JSONB, TEXT, TIMESTAMPTZ, TEXT, JSONB),
  public.write_graph_snapshot(TEXT, JSONB, TEXT, TIMESTAMPTZ, TEXT, JSONB, JSONB),
  public.sync_graph_snapshot(JSONB), public.restore_graph_revision(TEXT, TIMESTAMPTZ, TIMESTAMPTZ),
  public.sync_graph_snapshot_idempotent(JSONB)
TO service_role;
