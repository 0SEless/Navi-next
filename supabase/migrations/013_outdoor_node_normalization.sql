-- 013_outdoor_node_normalization.sql — normalize legacy outdoor route-node sentinel
-- at the canonical relational boundary (domain JSON -> route_nodes.building_id).
--
-- Contract (Phase 2D):
--   buildingId = '__outdoor__'  -> NULL  (outdoor node, belongs to no building)
--   buildingId = ''             -> NULL  (existing NULLIF semantics, unchanged)
--   buildingId = NULL/missing   -> NULL  (unchanged)
--   buildingId = valid id       -> preserved exactly
--   buildingId = arbitrary invalid id -> preserved as-is (FK continues to reject;
--                                      genuine referential bugs must NOT be hidden)
--
-- Scope: recreates ONLY public.write_graph_snapshot (the projection writer).
-- No schema change, no migration of existing rows, no routing-algorithm change.
-- All other guarantees are preserved verbatim: revision-history insert, snapshot
-- upsert, projection rebuild (buildings/nodes/edges), authoritative return.

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
      n->>'id', p_campus,
      -- Phase 2D: canonical relational boundary — legacy outdoor sentinel maps to
      -- NULL (no building). Empty string keeps existing NULL semantics. Any other
      -- value (valid or invalid) is preserved so FK checks still surface real bugs.
      NULLIF(NULLIF(n->>'buildingId', ''), '__outdoor__'),
      COALESCE(n->>'name', ''), COALESCE(n->>'type', 'intersection'),
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
