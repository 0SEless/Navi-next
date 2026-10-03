-- Migration: fix_floors_type_in_sync_rpc
-- Fix B4: the RPC cast (b->>'floors')::INTEGER fails because floors is a
-- number[] (e.g. [0]) in the GraphSnapshot payload, not a scalar.
-- Changed to jsonb_array_length(b->'floors') which correctly counts array
-- elements to populate the INTEGER floors column.
-- Also added ON CONFLICT (id) DO NOTHING as a safety net against duplicate
-- building IDs in the payload (defense-in-depth).

CREATE OR REPLACE FUNCTION sync_graph_snapshot(payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  campus TEXT := payload->>'campusId';
  b JSONB;
  n JSONB;
  e JSONB;
BEGIN
  IF campus IS NULL THEN campus := 'asu-ibajay'; END IF;

  INSERT INTO graph_snapshots (campus_id, data, version, updated_at)
  VALUES (campus, payload, COALESCE(payload->>'version', '1.0.0'), NOW())
  ON CONFLICT (campus_id)
  DO UPDATE SET data = EXCLUDED.data, version = EXCLUDED.version, updated_at = NOW();

  DELETE FROM buildings WHERE campus_id = campus;
  FOR b IN SELECT * FROM jsonb_array_elements(payload->'buildings')
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
  FOR n IN SELECT * FROM jsonb_array_elements(payload->'nodes')
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
  FOR e IN SELECT * FROM jsonb_array_elements(payload->'edges')
  LOOP
    INSERT INTO route_edges (id, campus_id, from_node_id, to_node_id, edge_type, distance)
    VALUES (e->>'id', campus, e->>'from', e->>'to', COALESCE(e->>'type', 'walkway'), COALESCE((e->>'distance')::DOUBLE PRECISION, 0))
    ON CONFLICT (id) DO NOTHING;
  END LOOP;

  RETURN jsonb_build_object('success', TRUE, 'campus_id', campus);
END;
$$;
