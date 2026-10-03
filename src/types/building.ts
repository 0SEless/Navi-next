export interface Building {
  id: string;
  campus_id: string;
  name: string;
  description: string;
  latitude: number;
  longitude: number;
  image: string | null;
  created_at: string;
}

export interface Floor {
  id: string;
  campus_id: string;
  building_id: string;
  name: string;
  level_number: number;
  floor_plan_image: string | null;
}

export interface Room {
  id: string;
  campus_id: string;
  building_id: string;
  floor_id: string;
  name: string;
  room_type: string;
  route_node_id: string | null;
}
