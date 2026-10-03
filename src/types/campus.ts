export interface Campus {
  id: string;
  name: string;
  slug: string;
  description: string;
  address: string;
  status: 'active' | 'inactive';
  boundary_polygon: [number, number][] | null;
  created_at: string;
}

export interface CampusMapSettings {
  id: string;
  campus_id: string;
  provider: 'openstreetmap' | 'mapbox';
  default_latitude: number;
  default_longitude: number;
  default_zoom: number;
  map_style_url: string;
}

export interface CampusStats {
  total_campuses: number;
  total_buildings: number;
  total_route_nodes: number;
  total_route_edges: number;
  total_panoramas: number;
  total_qr_codes: number;
}
