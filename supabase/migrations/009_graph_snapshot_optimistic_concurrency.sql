-- Reject stale editor saves atomically. The client sends the exact
-- graph_snapshots.updated_at revision it last observed. Control fields are
-- removed before storing the authored graph JSON.
--
-- Hardening (2026-09-13 P0 stabilization audit):
--   F1: pg_advisory_xact_lock serializes first-write races where the row does
--       not exist yet (SELECT ... FOR UPDATE locks nothing for absent rows).
--   F2: saved_revision uses clock_timestamp() AFTER the lock so a waited
--       writer can never store a revision older than the committed one.
--   F4: SET search_path = 'public' restores the 004 hardening that 005/009
--       previously reset by omission.
--   F3: a metadata-only placeholder row (no buildings/nodes) may be adopted by
--       a first real save instead of permanently conflicting.
CREATE OR REPLACE FUNCTION sync_graph_snapshot(payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = 'public'
AS $$
DECLARE
  campus TEXT := payload->>'campusId';
  expected_revision TIMESTAMPTZ := NULLIF(payload->>'expectedServerUpdatedAt', '')::TIMESTAMPTZ;
  force_overwrite BOOLEAN := COALESCE((payload->>'forceServerOverwrite')::BOOLEAN, FALSE);
  current_revision TIMESTAMPTZ;
  current_data JSONB;
  saved_revision TIMESTAMPTZ;
  authored_payload JSONB := payload - 'expectedServerUpdatedAt' - 'forceServerOverwrite';
  b JSONB;
  n JSONB;
  e JSONB;
BEGIN
  IF campus IS NULL THEN campus := 'asu-ibajay'; END IF;

  -- F1: serialize writers per campus even before the row exists.
  PERFORM pg_advisory_xact_lock(hashtext('navi_graph_snapshot:' || campus));

  SELECT updated_at, data INTO current_revision, current_data
  FROM graph_snapshots
  WHERE campus_id = campus
  FOR UPDATE;

  -- F2: authoritative revision is generated after the lock is held.
  saved_revision := clock_timestamp();

  IF NOT force_overwrite AND payload ? 'expectedServerUpdatedAt' THEN
    IF current_revision IS NOT NULL AND expected_revision IS NULL THEN
      -- F3: allow a first real save to adopt a metadata-only placeholder row.
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

  INSERT INTO graph_snapshots (campus_id, data, version, updated_at)
  VALUES (campus, authored_payload, COALESCE(authored_payload->>'version', '1.0.0'), saved_revision)
  ON CONFLICT (campus_id)
  DO UPDATE SET data = EXCLUDED.data, version = EXCLUDED.version, updated_at = saved_revision;

  DELETE FROM buildings WHERE campus_id = campus;
  FOR b IN SELECT * FROM jsonb_array_elements(authored_payload->'buildings')
  LOOP
    INSERT INTO buildings (id, campus_id, name, code, description, floors, color, center, outline, floor_plan_url)
    VALUES (
      b->>'id', campus, COALESCE(b->>'name', ''), b->>'code', COALESCE(b->>'description', ''),
      COALESCE(jsonb_array_length(b->'floors'), 1), COALESCE(b->>'color', '#64748B'),
      CASE WHEN b->'center'->>'lat' IS NOT NULL
        THEN ST_SetSRID(ST_MakePoint((b->'center'->>'lng')::DOUBLE PRECISION, (b->'center'->>'lat')::DOUBLE PRECISION), 4326)::geography
        ELSE NULL END,
      CASE WHEN b->'outline' IS NOT NULL AND jsonb_array_length(b->'outline') >= 3
        THEN ST_GeogFromText('SRID=4326;POLYGON((' ||
          (SELECT string_agg((p->>'lng')::TEXT || ' ' || (p->>'lat')::TEXT, ',') FROM jsonb_array_elements(b->'outline') p)
          || ', ' || (b->'outline'->0->>'lng')::TEXT || ' ' || (b->'outline'->0->>'lat')::TEXT || '))')
        ELSE NULL END,
      b->>'floorPlanUrl'
    )
    ON CONFLICT (id) DO NOTHING;
  END LOOP;

  DELETE FROM route_nodes WHERE campus_id = campus;
  FOR n IN SELECT * FROM jsonb_array_elements(authored_payload->'nodes')
  LOOP
    INSERT INTO route_nodes (id, campus_id, building_id, name, node_type, floor, position, component_id, svg_offset_x, svg_offset_y, has_qr, has_panorama, panorama_url, metadata)
    VALUES (
      n->>'id', campus, NULLIF(n->>'buildingId', ''), COALESCE(n->>'name', ''), COALESCE(n->>'type', 'intersection'),
      COALESCE((n->>'floor')::INTEGER, 1),
      ST_SetSRID(ST_MakePoint((n->'position'->>'lng')::DOUBLE PRECISION, (n->'position'->>'lat')::DOUBLE PRECISION), 4326)::geography,
      n->>'componentId', (n->'svgOffset'->>'x')::DOUBLE PRECISION, (n->'svgOffset'->>'y')::DOUBLE PRECISION,
      COALESCE((n->>'hasQr')::BOOLEAN, FALSE), COALESCE((n->>'hasPanorama')::BOOLEAN, FALSE),
      n->>'panoramaUrl', COALESCE(n->'metadata', '{}'::JSONB)
    )
    ON CONFLICT (id) DO NOTHING;
  END LOOP;

  DELETE FROM route_edges WHERE campus_id = campus;
  FOR e IN SELECT * FROM jsonb_array_elements(authored_payload->'edges')
  LOOP
    INSERT INTO route_edges (id, campus_id, from_node_id, to_node_id, edge_type, distance)
    VALUES (e->>'id', campus, e->>'from', e->>'to', COALESCE(e->>'type', 'walkway'), COALESCE((e->>'distance')::DOUBLE PRECISION, 0))
    ON CONFLICT (id) DO NOTHING;
  END LOOP;

  RETURN jsonb_build_object('success', TRUE, 'campus_id', campus, 'updatedAt', saved_revision);
END;
$$;
