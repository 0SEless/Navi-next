-- Migration: fix_function_search_paths
-- Sets an explicit search_path on all custom RPCs to prevent
-- role-mutable search path attacks.
-- PostGIS is installed in public schema, so search_path = 'public'.

CREATE OR REPLACE FUNCTION get_nearest_node(
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  max_dist DOUBLE PRECISION DEFAULT 50,
  campus TEXT DEFAULT 'asu-ibajay'
) RETURNS TABLE (
  id TEXT,
  name TEXT,
  node_type TEXT,
  floor INTEGER,
  building_id TEXT,
  has_qr BOOLEAN,
  has_panorama BOOLEAN,
  distance DOUBLE PRECISION
) LANGUAGE SQL STABLE
SET search_path = 'public'
AS $$
  SELECT id, name, node_type, floor, building_id,
         has_qr, has_panorama,
         ST_Distance(position, ST_MakePoint(lng, lat)::geography) AS distance
  FROM route_nodes
  WHERE campus_id = campus
    AND ST_DWithin(position, ST_MakePoint(lng, lat)::geography, max_dist)
  ORDER BY distance
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION nodes_within_bounds(
  south DOUBLE PRECISION,
  west DOUBLE PRECISION,
  north DOUBLE PRECISION,
  east DOUBLE PRECISION,
  campus TEXT DEFAULT 'asu-ibajay'
) RETURNS TABLE (
  id TEXT,
  name TEXT,
  node_type TEXT,
  floor INTEGER,
  building_id TEXT,
  lng DOUBLE PRECISION,
  lat DOUBLE PRECISION,
  has_qr BOOLEAN,
  has_panorama BOOLEAN
) LANGUAGE SQL STABLE
SET search_path = 'public'
AS $$
  SELECT id, name, node_type, floor, building_id,
         ST_X(position::geometry) AS lng,
         ST_Y(position::geometry) AS lat,
         has_qr, has_panorama
  FROM route_nodes
  WHERE campus_id = campus
    AND position && ST_MakeEnvelope(west, south, east, north, 4326)::geography
  ORDER BY name;
$$;

CREATE OR REPLACE FUNCTION sync_campus_map(payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = 'public'
AS $$
DECLARE
  mid TEXT := payload->>'id';
  ts TIMESTAMPTZ := NOW();
BEGIN
  IF mid IS NULL THEN
    RETURN jsonb_build_object('error', 'missing map id');
  END IF;

  INSERT INTO campus_maps (map_id, data, updated_at)
  VALUES (mid, payload, ts)
  ON CONFLICT (map_id)
  DO UPDATE SET data = EXCLUDED.data, updated_at = ts;

  RETURN jsonb_build_object('success', TRUE, 'map_id', mid);
END;
$$;

CREATE OR REPLACE FUNCTION delete_campus_map(map_id_param TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = 'public'
AS $$
BEGIN
  DELETE FROM campus_maps WHERE map_id = map_id_param;
  RETURN jsonb_build_object('success', TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION sync_graph_snapshot(payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = 'public'
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
      COALESCE((b->>'floors')::INTEGER, 1), COALESCE(b->>'color', '#64748B'),
      CASE WHEN b->'center'->>'lat' IS NOT NULL
        THEN ST_SetSRID(ST_MakePoint((b->'center'->>'lng')::DOUBLE PRECISION, (b->'center'->>'lat')::DOUBLE PRECISION), 4326)::geography
        ELSE NULL END,
      CASE WHEN b->'outline' IS NOT NULL AND jsonb_array_length(b->'outline') >= 3
        THEN ST_GeogFromText('SRID=4326;POLYGON((' ||
          (SELECT string_agg((p->>'lng')::TEXT || ' ' || (p->>'lat')::TEXT, ',') FROM jsonb_array_elements(b->'outline') p)
          || ', ' || (b->'outline'->0->>'lng')::TEXT || ' ' || (b->'outline'->0->>'lat')::TEXT || '))')
        ELSE NULL END,
      b->>'floorPlanUrl'
    );
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
    );
  END LOOP;

  DELETE FROM route_edges WHERE campus_id = campus;
  FOR e IN SELECT * FROM jsonb_array_elements(payload->'edges')
  LOOP
    INSERT INTO route_edges (id, campus_id, from_node_id, to_node_id, edge_type, distance)
    VALUES (e->>'id', campus, e->>'from', e->>'to', COALESCE(e->>'type', 'walkway'), COALESCE((e->>'distance')::DOUBLE PRECISION, 0));
  END LOOP;

  RETURN jsonb_build_object('success', TRUE, 'campus_id', campus);
END;
$$;
