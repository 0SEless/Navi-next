-- Migration: enable_rls_with_read_policies
-- Enables Row Level Security on all app tables and grants
-- SELECT access to the public/anonymous role.
-- Write operations already use the service_role key (bypasses RLS).

-- 1. Enable RLS on all app tables
ALTER TABLE public.buildings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.route_nodes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.route_edges      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.graph_snapshots  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campus_maps      ENABLE ROW LEVEL SECURITY;

-- 2. Buildings — anyone can read
DROP POLICY IF EXISTS "buildings_select_public" ON public.buildings;
CREATE POLICY "buildings_select_public"
  ON public.buildings
  FOR SELECT
  USING (true);

-- 3. Route nodes — anyone can read
DROP POLICY IF EXISTS "route_nodes_select_public" ON public.route_nodes;
CREATE POLICY "route_nodes_select_public"
  ON public.route_nodes
  FOR SELECT
  USING (true);

-- 4. Route edges — anyone can read
DROP POLICY IF EXISTS "route_edges_select_public" ON public.route_edges;
CREATE POLICY "route_edges_select_public"
  ON public.route_edges
  FOR SELECT
  USING (true);

-- 5. Graph snapshots — anyone can read
DROP POLICY IF EXISTS "graph_snapshots_select_public" ON public.graph_snapshots;
CREATE POLICY "graph_snapshots_select_public"
  ON public.graph_snapshots
  FOR SELECT
  USING (true);

-- 6. Campus maps — anyone can read
DROP POLICY IF EXISTS "campus_maps_select_public" ON public.campus_maps;
CREATE POLICY "campus_maps_select_public"
  ON public.campus_maps
  FOR SELECT
  USING (true);
