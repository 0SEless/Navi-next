-- NAVI Database Schema v1
-- Run this in Supabase SQL editor after enabling PostGIS extension.
-- Enable PostGIS: Database → Extensions → enable "postgis"

CREATE EXTENSION IF NOT EXISTS postgis;

-- 1. graph_snapshots — JSONB cache for admin save/load
CREATE TABLE IF NOT EXISTS graph_snapshots (
  id BIGSERIAL PRIMARY KEY,
  campus_id TEXT NOT NULL DEFAULT 'asu-ibajay',
  data JSONB NOT NULL DEFAULT '{}',
  version TEXT NOT NULL DEFAULT '1.0.0',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(campus_id)
);

-- 2. buildings — normalized with PostGIS geometry
CREATE TABLE IF NOT EXISTS buildings (
  id TEXT PRIMARY KEY,
  campus_id TEXT NOT NULL DEFAULT 'asu-ibajay',
  name TEXT NOT NULL,
  code TEXT,
  description TEXT NOT NULL DEFAULT '',
  floors INTEGER NOT NULL DEFAULT 1,
  color TEXT DEFAULT '#64748B',
  center GEOGRAPHY(POINT),
  outline GEOGRAPHY(POLYGON),
  floor_plan_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. route_nodes — normalized with PostGIS geography
CREATE TABLE IF NOT EXISTS route_nodes (
  id TEXT PRIMARY KEY,
  campus_id TEXT NOT NULL DEFAULT 'asu-ibajay',
  building_id TEXT REFERENCES buildings(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  node_type TEXT NOT NULL DEFAULT 'intersection',
  floor INTEGER NOT NULL DEFAULT 1,
  position GEOGRAPHY(POINT) NOT NULL,
  component_id TEXT,
  svg_offset_x DOUBLE PRECISION,
  svg_offset_y DOUBLE PRECISION,
  has_qr BOOLEAN NOT NULL DEFAULT FALSE,
  has_panorama BOOLEAN NOT NULL DEFAULT FALSE,
  panorama_url TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. route_edges — normalized FK to nodes
CREATE TABLE IF NOT EXISTS route_edges (
  id TEXT PRIMARY KEY,
  campus_id TEXT NOT NULL DEFAULT 'asu-ibajay',
  from_node_id TEXT NOT NULL REFERENCES route_nodes(id) ON DELETE CASCADE,
  to_node_id TEXT NOT NULL REFERENCES route_nodes(id) ON DELETE CASCADE,
  edge_type TEXT NOT NULL DEFAULT 'walkway',
  distance DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Geo indexes for spatial queries
CREATE INDEX IF NOT EXISTS idx_route_nodes_position ON route_nodes USING GIST (position);
CREATE INDEX IF NOT EXISTS idx_buildings_center ON buildings USING GIST (center);
CREATE INDEX IF NOT EXISTS idx_buildings_outline ON buildings USING GIST (outline);

-- Query indexes
CREATE INDEX IF NOT EXISTS idx_route_nodes_campus ON route_nodes(campus_id);
CREATE INDEX IF NOT EXISTS idx_route_nodes_building ON route_nodes(building_id);
CREATE INDEX IF NOT EXISTS idx_route_edges_campus ON route_edges(campus_id);
CREATE INDEX IF NOT EXISTS idx_route_edges_from ON route_edges(from_node_id);
CREATE INDEX IF NOT EXISTS idx_route_edges_to ON route_edges(to_node_id);
CREATE INDEX IF NOT EXISTS idx_buildings_campus ON buildings(campus_id);

-- RPC: get_nearest_node — spatial nearest-neighbor query
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
) LANGUAGE SQL STABLE AS $$
  SELECT id, name, node_type, floor, building_id,
         has_qr, has_panorama,
         ST_Distance(position, ST_MakePoint(lng, lat)::geography) AS distance
  FROM route_nodes
  WHERE campus_id = campus
    AND ST_DWithin(position, ST_MakePoint(lng, lat)::geography, max_dist)
  ORDER BY distance
  LIMIT 1;
$$;

-- RPC: nodes_within_bounds — bounding box query for map viewport
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
) LANGUAGE SQL STABLE AS $$
  SELECT id, name, node_type, floor, building_id,
         ST_X(position::geometry) AS lng,
         ST_Y(position::geometry) AS lat,
         has_qr, has_panorama
  FROM route_nodes
  WHERE campus_id = campus
    AND position && ST_MakeEnvelope(west, south, east, north, 4326)::geography
  ORDER BY name;
$$;

-- RPC: sync_graph_snapshot — full snapshot sync in one transaction
CREATE OR REPLACE FUNCTION sync_graph_snapshot(payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  campus TEXT := payload->>'campusId';
  b JSONB;
  n JSONB;
  e JSONB;
BEGIN
  IF campus IS NULL THEN
    campus := 'asu-ibajay';
  END IF;

  -- 1. Upsert the JSONB graph snapshot
  INSERT INTO graph_snapshots (campus_id, data, version, updated_at)
  VALUES (
    campus,
    payload,
    COALESCE(payload->>'version', '1.0.0'),
    NOW()
  )
  ON CONFLICT (campus_id)
  DO UPDATE SET
    data = EXCLUDED.data,
    version = EXCLUDED.version,
    updated_at = NOW();

  -- 2. Replace buildings for this campus
  DELETE FROM buildings WHERE campus_id = campus;
  FOR b IN SELECT * FROM jsonb_array_elements(payload->'buildings')
  LOOP
    INSERT INTO buildings (
      id, campus_id, name, code, description, floors, color,
      center, outline, floor_plan_url
    ) VALUES (
      b->>'id',
      campus,
      COALESCE(b->>'name', ''),
      b->>'code',
      COALESCE(b->>'description', ''),
      COALESCE((b->>'floors')::INTEGER, 1),
      COALESCE(b->>'color', '#64748B'),
      CASE
        WHEN b->'center'->>'lat' IS NOT NULL
        THEN ST_SetSRID(ST_MakePoint(
          (b->'center'->>'lng')::DOUBLE PRECISION,
          (b->'center'->>'lat')::DOUBLE PRECISION
        ), 4326)::geography
        ELSE NULL
      END,
      CASE
        WHEN b->'outline' IS NOT NULL AND jsonb_array_length(b->'outline') >= 3
        THEN ST_GeogFromText('SRID=4326;POLYGON((' ||
          (SELECT string_agg(
            (p->>'lng')::TEXT || ' ' || (p->>'lat')::TEXT, ','
          ) FROM jsonb_array_elements(b->'outline') p) ||
          ', ' || (b->'outline'->0->>'lng')::TEXT || ' ' || (b->'outline'->0->>'lat')::TEXT ||
        '))')
        ELSE NULL
      END,
      b->>'floorPlanUrl'
    );
  END LOOP;

  -- 3. Replace route nodes for this campus
  DELETE FROM route_nodes WHERE campus_id = campus;
  FOR n IN SELECT * FROM jsonb_array_elements(payload->'nodes')
  LOOP
    INSERT INTO route_nodes (
      id, campus_id, building_id, name, node_type, floor, position,
      component_id, svg_offset_x, svg_offset_y,
      has_qr, has_panorama, panorama_url, metadata
    ) VALUES (
      n->>'id',
      campus,
      n->>'buildingId',
      COALESCE(n->>'name', ''),
      COALESCE(n->>'type', 'intersection'),
      COALESCE((n->>'floor')::INTEGER, 1),
      ST_SetSRID(ST_MakePoint(
        (n->'position'->>'lng')::DOUBLE PRECISION,
        (n->'position'->>'lat')::DOUBLE PRECISION
      ), 4326)::geography,
      n->>'componentId',
      (n->'svgOffset'->>'x')::DOUBLE PRECISION,
      (n->'svgOffset'->>'y')::DOUBLE PRECISION,
      COALESCE((n->>'hasQr')::BOOLEAN, FALSE),
      COALESCE((n->>'hasPanorama')::BOOLEAN, FALSE),
      n->>'panoramaUrl',
      COALESCE(n->'metadata', '{}'::JSONB)
    );
  END LOOP;

  -- 4. Replace route edges for this campus
  DELETE FROM route_edges WHERE campus_id = campus;
  FOR e IN SELECT * FROM jsonb_array_elements(payload->'edges')
  LOOP
    INSERT INTO route_edges (id, campus_id, from_node_id, to_node_id, edge_type, distance)
    VALUES (
      e->>'id',
      campus,
      e->>'from',
      e->>'to',
      COALESCE(e->>'type', 'walkway'),
      COALESCE((e->>'distance')::DOUBLE PRECISION, 0)
    );
  END LOOP;

  RETURN jsonb_build_object('success', TRUE, 'campus_id', campus);
END;
$$;
