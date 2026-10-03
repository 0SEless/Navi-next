-- Migration: Create published_maps table for compiled navigation artifacts
-- 
-- This table stores the compiled artifacts produced by the V2 compiler pipeline.
-- It is separate from graph_snapshots (which stores raw editor data).
-- The User App reads from this table to get the canonical published map.
--
-- Schema:
--   campus_id: unique identifier for the campus (one published map per campus)
--   revision: document version at time of publish
--   compiler_version: version of the compiler that produced the artifacts
--   artifacts: JSONB blob containing all NavigationArtifacts
--     - graph: NavigationGraph (nodes, edges, metadata)
--     - buildingIndex: BuildingIndex (buildings with footprints, floors, entrances)
--     - searchIndex: SearchIndex (searchable entries)
--     - poiIndex: POIIndex (points of interest)
--     - spatialIndex: SpatialIndex (grid cells for nearest-node queries)
--     - panoramaIndex: PanoramaIndex (panorama data, optional)
--     - metadata: ArtifactsMetadata (compiler version, revision, timestamp)
--   published_at: timestamp of publication
--   published_by: auth.uid() of the publishing user (nullable for anonymous/service)

CREATE TABLE IF NOT EXISTS published_maps (
  id BIGSERIAL PRIMARY KEY,
  campus_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  compiler_version TEXT NOT NULL DEFAULT '1.0.0',
  artifacts JSONB NOT NULL DEFAULT '{}',
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(campus_id)
);

-- Index for fast lookup by campus_id
CREATE INDEX IF NOT EXISTS idx_published_maps_campus_id ON published_maps(campus_id);

-- Enable RLS (Supabase best practice: every table in public schema must have RLS)
ALTER TABLE published_maps ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can read published maps (public navigation data)
CREATE POLICY "published_maps_read_all" ON published_maps
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Policy: Only authenticated users can insert/update published maps
CREATE POLICY "published_maps_write_authenticated" ON published_maps
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "published_maps_update_authenticated" ON published_maps
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Policy: Only authenticated users can delete published maps
CREATE POLICY "published_maps_delete_authenticated" ON published_maps
  FOR DELETE
  TO authenticated
  USING (true);

-- Grant access to anon and authenticated roles (required for Data API exposure)
GRANT SELECT ON published_maps TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON published_maps TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE published_maps_id_seq TO authenticated;
