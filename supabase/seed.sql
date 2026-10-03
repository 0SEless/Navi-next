-- NAVI Seed Data: ASU Ibajay Campus
-- Run after 001_initial_schema.sql
-- Usage: psql -f seed.sql or paste into Supabase SQL editor

-- Idempotent: uses ON CONFLICT DO NOTHING / DO UPDATE

-- SAFETY (2026-09-13 P0 stabilization): this seed updates campus rows, including
-- graph_snapshots.updated_at (the optimistic-concurrency revision). Never paste
-- it into a production database casually. Opt in for the current session:
--   SELECT set_config('navi.allow_seed', 'yes', false);
DO $$
BEGIN
  IF current_setting('navi.allow_seed', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing seed.sql: set navi.allow_seed=yes for this session after verifying the target database.';
  END IF;
END
$$;

-- 1. Graph snapshot placeholder
INSERT INTO graph_snapshots (campus_id, data, version)
VALUES (
  'asu-ibajay',
  '{"campusId":"asu-ibajay","buildings":[],"nodes":[],"edges":[]}',
  '1.0.0'
)
ON CONFLICT (campus_id) DO UPDATE SET updated_at = NOW();

-- 2. Buildings
INSERT INTO buildings (id, campus_id, name, code, description, floors, color, center, outline) VALUES
(
  'bldg-admin',
  'asu-ibajay',
  'Admin Building',
  'ADM',
  'Administrative offices and faculty rooms.',
  3,
  '#3B82F6',
  ST_SetSRID(ST_MakePoint(122.0925, 11.8195), 4326)::geography,
  ST_GeomFromText('POLYGON((122.0922 11.8193, 122.0928 11.8193, 122.0928 11.8197, 122.0922 11.8197, 122.0922 11.8193))', 4326)::geography
),
(
  'bldg-library',
  'asu-ibajay',
  'Library',
  'LIB',
  'University library and learning resource center.',
  2,
  '#10B981',
  ST_SetSRID(ST_MakePoint(122.0930, 11.8200), 4326)::geography,
  ST_GeomFromText('POLYGON((122.0927 11.8198, 122.0933 11.8198, 122.0933 11.8202, 122.0927 11.8202, 122.0927 11.8198))', 4326)::geography
),
(
  'bldg-academic',
  'asu-ibajay',
  'Academic Building',
  'ACD',
  'Main academic building with lecture halls and laboratories.',
  3,
  '#8B5CF6',
  ST_SetSRID(ST_MakePoint(122.0915, 11.8190), 4326)::geography,
  ST_GeomFromText('POLYGON((122.0912 11.8188, 122.0918 11.8188, 122.0918 11.8192, 122.0912 11.8192, 122.0912 11.8188))', 4326)::geography
),
(
  'bldg-dormitory',
  'asu-ibajay',
  'Dormitory',
  'DRM',
  'On-campus student dormitory.',
  3,
  '#F59E0B',
  ST_SetSRID(ST_MakePoint(122.0940, 11.8205), 4326)::geography,
  ST_GeomFromText('POLYGON((122.0937 11.8203, 122.0943 11.8203, 122.0943 11.8207, 122.0937 11.8207, 122.0937 11.8203))', 4326)::geography
),
(
  'bldg-canteen',
  'asu-ibajay',
  'Canteen',
  'CAN',
  'University cafeteria and food court.',
  1,
  '#EF4444',
  ST_SetSRID(ST_MakePoint(122.0920, 11.8202), 4326)::geography,
  ST_GeomFromText('POLYGON((122.0918 11.8201, 122.0922 11.8201, 122.0922 11.8203, 122.0918 11.8203, 122.0918 11.8201))', 4326)::geography
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  floors = EXCLUDED.floors,
  center = EXCLUDED.center,
  outline = EXCLUDED.outline;

-- 3. Route nodes (sample nodes per building/floor)

-- === Admin Building ===
INSERT INTO route_nodes (id, campus_id, building_id, name, node_type, floor, position, component_id, has_qr, has_panorama) VALUES
('n-adm-entrance', 'asu-ibajay', 'bldg-admin', 'Admin Building Entrance', 'entrance', 1, ST_SetSRID(ST_MakePoint(122.0925, 11.8195), 4326)::geography, 'comp-adm-entrance', TRUE, TRUE),
('n-adm-lobby', 'asu-ibajay', 'bldg-admin', 'Admin Lobby', 'hallway', 1, ST_SetSRID(ST_MakePoint(122.0924, 11.8195), 4326)::geography, 'comp-adm-lobby', FALSE, FALSE),
('n-adm-hall-1', 'asu-ibajay', 'bldg-admin', 'Admin Hallway Ground', 'hallway', 1, ST_SetSRID(ST_MakePoint(122.0925, 11.8194), 4326)::geography, 'comp-adm-hall-1', FALSE, FALSE),
('n-adm-room-101', 'asu-ibajay', 'bldg-admin', 'Room 101 - Registrar', 'room', 1, ST_SetSRID(ST_MakePoint(122.0926, 11.8194), 4326)::geography, 'comp-adm-101', FALSE, FALSE),
('n-adm-room-102', 'asu-ibajay', 'bldg-admin', 'Room 102 - Cashier', 'room', 1, ST_SetSRID(ST_MakePoint(122.0924, 11.8196), 4326)::geography, 'comp-adm-102', FALSE, FALSE),
('n-adm-stairs-1', 'asu-ibajay', 'bldg-admin', 'Admin Staircase 1', 'stair', 1, ST_SetSRID(ST_MakePoint(122.0925, 11.8196), 4326)::geography, 'comp-adm-stairs-1', FALSE, FALSE),
('n-adm-hall-2', 'asu-ibajay', 'bldg-admin', 'Admin Hallway 2F', 'hallway', 2, ST_SetSRID(ST_MakePoint(122.0925, 11.8194), 4326)::geography, NULL, FALSE, FALSE),
('n-adm-room-201', 'asu-ibajay', 'bldg-admin', 'Room 201 - VP Office', 'room', 2, ST_SetSRID(ST_MakePoint(122.0926, 11.8194), 4326)::geography, NULL, FALSE, FALSE),
('n-adm-room-202', 'asu-ibajay', 'bldg-admin', 'Room 202 - Conference', 'room', 2, ST_SetSRID(ST_MakePoint(122.0924, 11.8196), 4326)::geography, NULL, FALSE, FALSE),
('n-adm-stairs-2', 'asu-ibajay', 'bldg-admin', 'Admin Staircase 2F', 'stair', 2, ST_SetSRID(ST_MakePoint(122.0925, 11.8196), 4326)::geography, NULL, FALSE, FALSE),
('n-adm-hall-3', 'asu-ibajay', 'bldg-admin', 'Admin Hallway 3F', 'hallway', 3, ST_SetSRID(ST_MakePoint(122.0925, 11.8194), 4326)::geography, NULL, FALSE, FALSE),
('n-adm-room-301', 'asu-ibajay', 'bldg-admin', 'Room 301 - President', 'room', 3, ST_SetSRID(ST_MakePoint(122.0926, 11.8194), 4326)::geography, NULL, FALSE, FALSE),
('n-adm-room-302', 'asu-ibajay', 'bldg-admin', 'Room 302 - Board Room', 'room', 3, ST_SetSRID(ST_MakePoint(122.0924, 11.8196), 4326)::geography, NULL, FALSE, FALSE),
('n-adm-stairs-3', 'asu-ibajay', 'bldg-admin', 'Admin Staircase 3F', 'stair', 3, ST_SetSRID(ST_MakePoint(122.0925, 11.8196), 4326)::geography, NULL, FALSE, FALSE)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, node_type = EXCLUDED.node_type;

-- === Library ===
INSERT INTO route_nodes (id, campus_id, building_id, name, node_type, floor, position, component_id, has_qr, has_panorama) VALUES
('n-lib-entrance', 'asu-ibajay', 'bldg-library', 'Library Entrance', 'entrance', 1, ST_SetSRID(ST_MakePoint(122.0930, 11.8200), 4326)::geography, 'comp-lib-entrance', TRUE, TRUE),
('n-lib-lobby', 'asu-ibajay', 'bldg-library', 'Library Lobby', 'hallway', 1, ST_SetSRID(ST_MakePoint(122.0930, 11.8199), 4326)::geography, 'comp-lib-lobby', FALSE, FALSE),
('n-lib-reading', 'asu-ibajay', 'bldg-library', 'Reading Area', 'room', 1, ST_SetSRID(ST_MakePoint(122.0931, 11.8200), 4326)::geography, 'comp-lib-reading', FALSE, FALSE),
('n-lib-stacks', 'asu-ibajay', 'bldg-library', 'Book Stacks', 'room', 1, ST_SetSRID(ST_MakePoint(122.0929, 11.8201), 4326)::geography, 'comp-lib-stacks', FALSE, FALSE),
('n-lib-stairs-1', 'asu-ibajay', 'bldg-library', 'Library Stairs', 'stair', 1, ST_SetSRID(ST_MakePoint(122.0930, 11.8202), 4326)::geography, 'comp-lib-stairs', FALSE, FALSE),
('n-lib-mezzanine', 'asu-ibajay', 'bldg-library', 'Mezzanine Study Area', 'room', 2, ST_SetSRID(ST_MakePoint(122.0930, 11.8200), 4326)::geography, NULL, FALSE, FALSE),
('n-lib-computer', 'asu-ibajay', 'bldg-library', 'Computer Lab', 'room', 2, ST_SetSRID(ST_MakePoint(122.0931, 11.8199), 4326)::geography, NULL, FALSE, FALSE),
('n-lib-stairs-2', 'asu-ibajay', 'bldg-library', 'Library Stairs 2F', 'stair', 2, ST_SetSRID(ST_MakePoint(122.0930, 11.8202), 4326)::geography, NULL, FALSE, FALSE)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, node_type = EXCLUDED.node_type;

-- === Academic Building ===
INSERT INTO route_nodes (id, campus_id, building_id, name, node_type, floor, position, component_id, has_qr, has_panorama) VALUES
('n-acd-entrance', 'asu-ibajay', 'bldg-academic', 'Academic Building Entrance', 'entrance', 1, ST_SetSRID(ST_MakePoint(122.0915, 11.8190), 4326)::geography, 'comp-acd-entrance', TRUE, TRUE),
('n-acd-lobby', 'asu-ibajay', 'bldg-academic', 'Academic Lobby', 'hallway', 1, ST_SetSRID(ST_MakePoint(122.0915, 11.8189), 4326)::geography, 'comp-acd-lobby', FALSE, FALSE),
('n-acd-hall-1', 'asu-ibajay', 'bldg-academic', 'Academic Hallway Ground', 'hallway', 1, ST_SetSRID(ST_MakePoint(122.0916, 11.8190), 4326)::geography, 'comp-acd-hall-1', FALSE, FALSE),
('n-acd-room-101', 'asu-ibajay', 'bldg-academic', 'Room 101 - Lecture Hall A', 'room', 1, ST_SetSRID(ST_MakePoint(122.0916, 11.8191), 4326)::geography, 'comp-acd-101', FALSE, FALSE),
('n-acd-room-102', 'asu-ibajay', 'bldg-academic', 'Room 102 - Lecture Hall B', 'room', 1, ST_SetSRID(ST_MakePoint(122.0914, 11.8191), 4326)::geography, 'comp-acd-102', FALSE, FALSE),
('n-acd-room-103', 'asu-ibajay', 'bldg-academic', 'Room 103 - Physics Lab', 'room', 1, ST_SetSRID(ST_MakePoint(122.0915, 11.8189), 4326)::geography, 'comp-acd-103', FALSE, FALSE),
('n-acd-stairs-1', 'asu-ibajay', 'bldg-academic', 'Academic Staircase', 'stair', 1, ST_SetSRID(ST_MakePoint(122.0917, 11.8190), 4326)::geography, 'comp-acd-stairs', FALSE, FALSE),
('n-acd-hall-2', 'asu-ibajay', 'bldg-academic', 'Academic Hallway 2F', 'hallway', 2, ST_SetSRID(ST_MakePoint(122.0916, 11.8190), 4326)::geography, NULL, FALSE, FALSE),
('n-acd-room-201', 'asu-ibajay', 'bldg-academic', 'Room 201 - Comp Sci Lab', 'room', 2, ST_SetSRID(ST_MakePoint(122.0916, 11.8191), 4326)::geography, NULL, FALSE, FALSE),
('n-acd-room-202', 'asu-ibajay', 'bldg-academic', 'Room 202 - Chem Lab', 'room', 2, ST_SetSRID(ST_MakePoint(122.0914, 11.8191), 4326)::geography, NULL, FALSE, FALSE),
('n-acd-room-203', 'asu-ibajay', 'bldg-academic', 'Room 203 - Lecture Hall C', 'room', 2, ST_SetSRID(ST_MakePoint(122.0915, 11.8189), 4326)::geography, NULL, FALSE, FALSE),
('n-acd-stairs-2', 'asu-ibajay', 'bldg-academic', 'Academic Staircase 2F', 'stair', 2, ST_SetSRID(ST_MakePoint(122.0917, 11.8190), 4326)::geography, NULL, FALSE, FALSE),
('n-acd-hall-3', 'asu-ibajay', 'bldg-academic', 'Academic Hallway 3F', 'hallway', 3, ST_SetSRID(ST_MakePoint(122.0916, 11.8190), 4326)::geography, NULL, FALSE, FALSE),
('n-acd-room-301', 'asu-ibajay', 'bldg-academic', 'Room 301 - Dean Office', 'room', 3, ST_SetSRID(ST_MakePoint(122.0916, 11.8191), 4326)::geography, NULL, FALSE, FALSE),
('n-acd-room-302', 'asu-ibajay', 'bldg-academic', 'Room 302 - Faculty Room', 'room', 3, ST_SetSRID(ST_MakePoint(122.0914, 11.8191), 4326)::geography, NULL, FALSE, FALSE),
('n-acd-stairs-3', 'asu-ibajay', 'bldg-academic', 'Academic Staircase 3F', 'stair', 3, ST_SetSRID(ST_MakePoint(122.0917, 11.8190), 4326)::geography, NULL, FALSE, FALSE)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, node_type = EXCLUDED.node_type;

-- === Dormitory ===
INSERT INTO route_nodes (id, campus_id, building_id, name, node_type, floor, position, component_id, has_qr, has_panorama) VALUES
('n-drm-entrance', 'asu-ibajay', 'bldg-dormitory', 'Dormitory Entrance', 'entrance', 1, ST_SetSRID(ST_MakePoint(122.0940, 11.8205), 4326)::geography, 'comp-drm-entrance', TRUE, FALSE),
('n-drm-lobby', 'asu-ibajay', 'bldg-dormitory', 'Dormitory Lobby', 'hallway', 1, ST_SetSRID(ST_MakePoint(122.0940, 11.8204), 4326)::geography, 'comp-drm-lobby', FALSE, FALSE),
('n-drm-hall', 'asu-ibajay', 'bldg-dormitory', 'Dorm Hallway', 'hallway', 1, ST_SetSRID(ST_MakePoint(122.0941, 11.8205), 4326)::geography, 'comp-drm-hall', FALSE, FALSE),
('n-drm-room-1', 'asu-ibajay', 'bldg-dormitory', 'Dorm Room 1', 'room', 1, ST_SetSRID(ST_MakePoint(122.0941, 11.8206), 4326)::geography, NULL, FALSE, FALSE),
('n-drm-room-2', 'asu-ibajay', 'bldg-dormitory', 'Dorm Room 2', 'room', 1, ST_SetSRID(ST_MakePoint(122.0939, 11.8206), 4326)::geography, NULL, FALSE, FALSE),
('n-drm-stairs-1', 'asu-ibajay', 'bldg-dormitory', 'Dorm Stairs', 'stair', 1, ST_SetSRID(ST_MakePoint(122.0941, 11.8204), 4326)::geography, 'comp-drm-stairs', FALSE, FALSE),
('n-drm-room-3', 'asu-ibajay', 'bldg-dormitory', 'Dorm Room 3', 'room', 2, ST_SetSRID(ST_MakePoint(122.0941, 11.8206), 4326)::geography, NULL, FALSE, FALSE),
('n-drm-room-4', 'asu-ibajay', 'bldg-dormitory', 'Dorm Room 4', 'room', 2, ST_SetSRID(ST_MakePoint(122.0939, 11.8206), 4326)::geography, NULL, FALSE, FALSE),
('n-drm-stairs-2', 'asu-ibajay', 'bldg-dormitory', 'Dorm Stairs 2F', 'stair', 2, ST_SetSRID(ST_MakePoint(122.0941, 11.8204), 4326)::geography, NULL, FALSE, FALSE),
('n-drm-room-5', 'asu-ibajay', 'bldg-dormitory', 'Dorm Room 5', 'room', 3, ST_SetSRID(ST_MakePoint(122.0941, 11.8206), 4326)::geography, NULL, FALSE, FALSE),
('n-drm-room-6', 'asu-ibajay', 'bldg-dormitory', 'Dorm Room 6', 'room', 3, ST_SetSRID(ST_MakePoint(122.0939, 11.8206), 4326)::geography, NULL, FALSE, FALSE),
('n-drm-stairs-3', 'asu-ibajay', 'bldg-dormitory', 'Dorm Stairs 3F', 'stair', 3, ST_SetSRID(ST_MakePoint(122.0941, 11.8204), 4326)::geography, NULL, FALSE, FALSE)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, node_type = EXCLUDED.node_type;

-- === Canteen ===
INSERT INTO route_nodes (id, campus_id, building_id, name, node_type, floor, position, component_id, has_qr, has_panorama) VALUES
('n-can-entrance', 'asu-ibajay', 'bldg-canteen', 'Canteen Entrance', 'entrance', 1, ST_SetSRID(ST_MakePoint(122.0920, 11.8202), 4326)::geography, 'comp-can-entrance', TRUE, FALSE),
('n-can-counter', 'asu-ibajay', 'bldg-canteen', 'Food Counter', 'room', 1, ST_SetSRID(ST_MakePoint(122.0919, 11.8202), 4326)::geography, 'comp-can-counter', FALSE, FALSE),
('n-can-seating', 'asu-ibajay', 'bldg-canteen', 'Seating Area', 'room', 1, ST_SetSRID(ST_MakePoint(122.0921, 11.8202), 4326)::geography, 'comp-can-seating', FALSE, FALSE)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, node_type = EXCLUDED.node_type;

-- === Outdoor nodes (pathways between buildings) ===
INSERT INTO route_nodes (id, campus_id, building_id, name, node_type, floor, position, has_qr, has_panorama) VALUES
('n-out-plaza', 'asu-ibajay', NULL, 'Campus Plaza', 'intersection', 0, ST_SetSRID(ST_MakePoint(122.0920, 11.8198), 4326)::geography, FALSE, FALSE),
('n-out-path-adm-lib', 'asu-ibajay', NULL, 'Admin-Library Path', 'walkway', 0, ST_SetSRID(ST_MakePoint(122.0928, 11.8197), 4326)::geography, FALSE, FALSE),
('n-out-path-adm-acd', 'asu-ibajay', NULL, 'Admin-Academic Path', 'walkway', 0, ST_SetSRID(ST_MakePoint(122.0920, 11.8193), 4326)::geography, FALSE, FALSE),
('n-out-path-lib-canteen', 'asu-ibajay', NULL, 'Library-Canteen Path', 'walkway', 0, ST_SetSRID(ST_MakePoint(122.0925, 11.8201), 4326)::geography, FALSE, FALSE),
('n-out-main-gate', 'asu-ibajay', NULL, 'Main Gate', 'entrance', 0, ST_SetSRID(ST_MakePoint(122.0918, 11.8188), 4326)::geography, TRUE, FALSE),
('n-out-parking', 'asu-ibajay', NULL, 'Parking Area', 'intersection', 0, ST_SetSRID(ST_MakePoint(122.0910, 11.8195), 4326)::geography, FALSE, FALSE),
('n-out-drm-path', 'asu-ibajay', NULL, 'Dormitory Pathway', 'walkway', 0, ST_SetSRID(ST_MakePoint(122.0935, 11.8203), 4326)::geography, FALSE, FALSE),
('n-out-oval', 'asu-ibajay', NULL, 'Campus Oval', 'intersection', 0, ST_SetSRID(ST_MakePoint(122.0920, 11.8205), 4326)::geography, FALSE, FALSE)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, node_type = EXCLUDED.node_type;

-- 4. Route edges (connections between nodes)

-- Admin Building internal edges
INSERT INTO route_edges (id, campus_id, from_node_id, to_node_id, edge_type, distance)
SELECT 'e-adm-entrance-lobby', 'asu-ibajay', 'n-adm-entrance', 'n-adm-lobby', 'walkway', 5
WHERE EXISTS (SELECT 1 FROM route_nodes WHERE id = 'n-adm-entrance')
  AND EXISTS (SELECT 1 FROM route_nodes WHERE id = 'n-adm-lobby');

INSERT INTO route_edges (id, campus_id, from_node_id, to_node_id, edge_type, distance) VALUES
('e-adm-lobby-hall1', 'asu-ibajay', 'n-adm-lobby', 'n-adm-hall-1', 'walkway', 3),
('e-adm-hall1-101', 'asu-ibajay', 'n-adm-hall-1', 'n-adm-room-101', 'walkway', 2),
('e-adm-hall1-102', 'asu-ibajay', 'n-adm-hall-1', 'n-adm-room-102', 'walkway', 4),
('e-adm-hall1-stairs1', 'asu-ibajay', 'n-adm-hall-1', 'n-adm-stairs-1', 'walkway', 3),
('e-adm-stairs1-stairs2', 'asu-ibajay', 'n-adm-stairs-1', 'n-adm-stairs-2', 'stair', 4),
('e-adm-stairs2-stairs3', 'asu-ibajay', 'n-adm-stairs-2', 'n-adm-stairs-3', 'stair', 4),
('e-adm-stairs2-hall2', 'asu-ibajay', 'n-adm-stairs-2', 'n-adm-hall-2', 'walkway', 2),
('e-adm-hall2-201', 'asu-ibajay', 'n-adm-hall-2', 'n-adm-room-201', 'walkway', 2),
('e-adm-hall2-202', 'asu-ibajay', 'n-adm-hall-2', 'n-adm-room-202', 'walkway', 4),
('e-adm-stairs3-hall3', 'asu-ibajay', 'n-adm-stairs-3', 'n-adm-hall-3', 'walkway', 2),
('e-adm-hall3-301', 'asu-ibajay', 'n-adm-hall-3', 'n-adm-room-301', 'walkway', 2),
('e-adm-hall3-302', 'asu-ibajay', 'n-adm-hall-3', 'n-adm-room-302', 'walkway', 4)
ON CONFLICT (id) DO NOTHING;

-- Library internal edges
INSERT INTO route_edges (id, campus_id, from_node_id, to_node_id, edge_type, distance) VALUES
('e-lib-entrance-lobby', 'asu-ibajay', 'n-lib-entrance', 'n-lib-lobby', 'walkway', 4),
('e-lib-lobby-reading', 'asu-ibajay', 'n-lib-lobby', 'n-lib-reading', 'walkway', 5),
('e-lib-lobby-stacks', 'asu-ibajay', 'n-lib-lobby', 'n-lib-stacks', 'walkway', 6),
('e-lib-lobby-stairs', 'asu-ibajay', 'n-lib-lobby', 'n-lib-stairs-1', 'walkway', 3),
('e-lib-stairs1-stairs2', 'asu-ibajay', 'n-lib-stairs-1', 'n-lib-stairs-2', 'stair', 4),
('e-lib-stairs2-mezzanine', 'asu-ibajay', 'n-lib-stairs-2', 'n-lib-mezzanine', 'walkway', 3),
('e-lib-stairs2-computer', 'asu-ibajay', 'n-lib-stairs-2', 'n-lib-computer', 'walkway', 4)
ON CONFLICT (id) DO NOTHING;

-- Academic Building internal edges
INSERT INTO route_edges (id, campus_id, from_node_id, to_node_id, edge_type, distance) VALUES
('e-acd-entrance-lobby', 'asu-ibajay', 'n-acd-entrance', 'n-acd-lobby', 'walkway', 3),
('e-acd-lobby-hall1', 'asu-ibajay', 'n-acd-lobby', 'n-acd-hall-1', 'walkway', 3),
('e-acd-hall1-101', 'asu-ibajay', 'n-acd-hall-1', 'n-acd-room-101', 'walkway', 2),
('e-acd-hall1-102', 'asu-ibajay', 'n-acd-hall-1', 'n-acd-room-102', 'walkway', 3),
('e-acd-hall1-103', 'asu-ibajay', 'n-acd-hall-1', 'n-acd-room-103', 'walkway', 4),
('e-acd-hall1-stairs1', 'asu-ibajay', 'n-acd-hall-1', 'n-acd-stairs-1', 'walkway', 2),
('e-acd-stairs1-stairs2', 'asu-ibajay', 'n-acd-stairs-1', 'n-acd-stairs-2', 'stair', 4),
('e-acd-stairs2-stairs3', 'asu-ibajay', 'n-acd-stairs-2', 'n-acd-stairs-3', 'stair', 4),
('e-acd-stairs2-hall2', 'asu-ibajay', 'n-acd-stairs-2', 'n-acd-hall-2', 'walkway', 2),
('e-acd-hall2-201', 'asu-ibajay', 'n-acd-hall-2', 'n-acd-room-201', 'walkway', 2),
('e-acd-hall2-202', 'asu-ibajay', 'n-acd-hall-2', 'n-acd-room-202', 'walkway', 3),
('e-acd-hall2-203', 'asu-ibajay', 'n-acd-hall-2', 'n-acd-room-203', 'walkway', 4),
('e-acd-stairs3-hall3', 'asu-ibajay', 'n-acd-stairs-3', 'n-acd-hall-3', 'walkway', 2),
('e-acd-hall3-301', 'asu-ibajay', 'n-acd-hall-3', 'n-acd-room-301', 'walkway', 2),
('e-acd-hall3-302', 'asu-ibajay', 'n-acd-hall-3', 'n-acd-room-302', 'walkway', 4)
ON CONFLICT (id) DO NOTHING;

-- Dormitory internal edges
INSERT INTO route_edges (id, campus_id, from_node_id, to_node_id, edge_type, distance) VALUES
('e-drm-entrance-lobby', 'asu-ibajay', 'n-drm-entrance', 'n-drm-lobby', 'walkway', 3),
('e-drm-lobby-hall', 'asu-ibajay', 'n-drm-lobby', 'n-drm-hall', 'walkway', 4),
('e-drm-hall-room1', 'asu-ibajay', 'n-drm-hall', 'n-drm-room-1', 'walkway', 3),
('e-drm-hall-room2', 'asu-ibajay', 'n-drm-hall', 'n-drm-room-2', 'walkway', 4),
('e-drm-hall-stairs1', 'asu-ibajay', 'n-drm-hall', 'n-drm-stairs-1', 'walkway', 3),
('e-drm-stairs1-stairs2', 'asu-ibajay', 'n-drm-stairs-1', 'n-drm-stairs-2', 'stair', 4),
('e-drm-stairs2-stairs3', 'asu-ibajay', 'n-drm-stairs-2', 'n-drm-stairs-3', 'stair', 4),
('e-drm-stairs2-room3', 'asu-ibajay', 'n-drm-stairs-2', 'n-drm-room-3', 'walkway', 4),
('e-drm-stairs2-room4', 'asu-ibajay', 'n-drm-stairs-2', 'n-drm-room-4', 'walkway', 5),
('e-drm-stairs3-room5', 'asu-ibajay', 'n-drm-stairs-3', 'n-drm-room-5', 'walkway', 4),
('e-drm-stairs3-room6', 'asu-ibajay', 'n-drm-stairs-3', 'n-drm-room-6', 'walkway', 5)
ON CONFLICT (id) DO NOTHING;

-- Canteen internal edges
INSERT INTO route_edges (id, campus_id, from_node_id, to_node_id, edge_type, distance) VALUES
('e-can-entrance-counter', 'asu-ibajay', 'n-can-entrance', 'n-can-counter', 'walkway', 3),
('e-can-counter-seating', 'asu-ibajay', 'n-can-counter', 'n-can-seating', 'walkway', 5)
ON CONFLICT (id) DO NOTHING;

-- External pathway edges (between buildings)
INSERT INTO route_edges (id, campus_id, from_node_id, to_node_id, edge_type, distance) VALUES
('e-out-gate-acd', 'asu-ibajay', 'n-out-main-gate', 'n-acd-entrance', 'walkway', 15),
('e-out-parking-acd', 'asu-ibajay', 'n-out-parking', 'n-acd-entrance', 'walkway', 20),
('e-out-acd-plaza', 'asu-ibajay', 'n-acd-entrance', 'n-out-plaza', 'walkway', 25),
('e-out-plaza-adm', 'asu-ibajay', 'n-out-plaza', 'n-adm-entrance', 'walkway', 30),
('e-out-plaza-canteen', 'asu-ibajay', 'n-out-plaza', 'n-can-entrance', 'walkway', 15),
('e-out-plaza-lib', 'asu-ibajay', 'n-out-plaza', 'n-lib-entrance', 'walkway', 35),
('e-out-adm-path-lib', 'asu-ibajay', 'n-out-path-adm-lib', 'n-adm-entrance', 'walkway', 5),
('e-out-lib-path-adm', 'asu-ibajay', 'n-lib-entrance', 'n-out-path-adm-lib', 'walkway', 10),
('e-out-adm-path-acd', 'asu-ibajay', 'n-out-path-adm-acd', 'n-adm-entrance', 'walkway', 15),
('e-out-acd-path-adm', 'asu-ibajay', 'n-acd-entrance', 'n-out-path-adm-acd', 'walkway', 10),
('e-out-lib-path-canteen', 'asu-ibajay', 'n-lib-entrance', 'n-out-path-lib-canteen', 'walkway', 8),
('e-out-canteen-path-lib', 'asu-ibajay', 'n-can-entrance', 'n-out-path-lib-canteen', 'walkway', 8),
('e-out-oval-lib', 'asu-ibajay', 'n-lib-entrance', 'n-out-oval', 'walkway', 15),
('e-out-oval-canteen', 'asu-ibajay', 'n-can-entrance', 'n-out-oval', 'walkway', 10),
('e-out-plaza-drm', 'asu-ibajay', 'n-out-oval', 'n-out-drm-path', 'walkway', 20),
('e-out-drm-path-drm', 'asu-ibajay', 'n-out-drm-path', 'n-drm-entrance', 'walkway', 15),
('e-out-oval-drm', 'asu-ibajay', 'n-out-oval', 'n-drm-entrance', 'walkway', 30)
ON CONFLICT (id) DO NOTHING;

-- 5. Panorama placeholders (tied to nodes with has_panorama = TRUE)
-- These use placeholder URLs. Replace with actual Cloudinary URLs when available.
UPDATE route_nodes SET
  panorama_url = 'https://res.cloudinary.com/demo/image/upload/v1/navi/panoramas/asu-ibajay/admin-entrance.jpg'
WHERE id = 'n-adm-entrance' AND (panorama_url IS NULL OR panorama_url = '');

UPDATE route_nodes SET
  panorama_url = 'https://res.cloudinary.com/demo/image/upload/v1/navi/panoramas/asu-ibajay/library-entrance.jpg'
WHERE id = 'n-lib-entrance' AND (panorama_url IS NULL OR panorama_url = '');

UPDATE route_nodes SET
  panorama_url = 'https://res.cloudinary.com/demo/image/upload/v1/navi/panoramas/asu-ibajay/academic-entrance.jpg'
WHERE id = 'n-acd-entrance' AND (panorama_url IS NULL OR panorama_url = '');

-- 6. Elevator nodes for Admin Building (accessibility)
INSERT INTO route_nodes (id, campus_id, building_id, name, node_type, floor, position, component_id) VALUES
('n-adm-elev-1', 'asu-ibajay', 'bldg-admin', 'Admin Elevator G', 'elevator', 1, ST_SetSRID(ST_MakePoint(122.0926, 11.8195), 4326)::geography, NULL),
('n-adm-elev-2', 'asu-ibajay', 'bldg-admin', 'Admin Elevator 2F', 'elevator', 2, ST_SetSRID(ST_MakePoint(122.0926, 11.8195), 4326)::geography, NULL),
('n-adm-elev-3', 'asu-ibajay', 'bldg-admin', 'Admin Elevator 3F', 'elevator', 3, ST_SetSRID(ST_MakePoint(122.0926, 11.8195), 4326)::geography, NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO route_edges (id, campus_id, from_node_id, to_node_id, edge_type, distance) VALUES
('e-adm-elev1-elev2', 'asu-ibajay', 'n-adm-elev-1', 'n-adm-elev-2', 'elevator', 4),
('e-adm-elev2-elev3', 'asu-ibajay', 'n-adm-elev-2', 'n-adm-elev-3', 'elevator', 4),
('e-adm-hall1-elev1', 'asu-ibajay', 'n-adm-hall-1', 'n-adm-elev-1', 'walkway', 3),
('e-adm-hall2-elev2', 'asu-ibajay', 'n-adm-hall-2', 'n-adm-elev-2', 'walkway', 3),
('e-adm-hall3-elev3', 'asu-ibajay', 'n-adm-hall-3', 'n-adm-elev-3', 'walkway', 3)
ON CONFLICT (id) DO NOTHING;
