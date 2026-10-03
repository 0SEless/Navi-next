import type { FloorGeometryArtifact, OutdoorPointOfInterest, PanoramaIndex, PlanAlignment, QrIndex, RoadDisplayMode, RoadEdgeRouting, RoadRouting, SeparatedCrossing } from '@navi/core'

export interface LatLng {
  lat: number;
  lng: number;
  elevation?: number;
}

export interface NavNode {
  id: string;
  label: string;
  name?: string;
  position: LatLng;
  floor: number;
  buildingId: string;
  campusId: string;
  type: 'room' | 'room_door' | 'walkway' | 'stair' | 'elevator' | 'entrance' | 'qr_marker' | 'corner' | 'staircase' | 'intersection' | 'building_entrance' | 'outdoor' | 'hallway' | 'connector_stop';
  componentId?: string;
  metadata?: Record<string, unknown>;
  svgOffset?: { x: number; y: number };
  hasQr?: boolean;
  hasPanorama?: boolean;
}

export interface NavEdge {
  id: string;
  from: string;
  to: string;
  distance: number;
  weight?: number;
  type: 'walkway' | 'stair' | 'elevator' | 'hallway' | 'outdoor' | 'corridor' | 'stairs' | 'transition' | 'walk' | 'wall' | 'door';
  campusId?: string;
  /** Canonical compiler provenance used by standard terrain-aware routing. */
  routing?: RoadEdgeRouting;
}

export interface BuildingEntrance {
  id: string;
  position: LatLng;
  floor: number;
  label?: string;
  connectorTraceId?: string;
}

export interface Building {
  id: string;
  name: string;
  campusId: string;
  floors: number[];
  footprint: LatLng[];
  baseElevation: number;
  height: number;
  rotation?: number;
  color?: string;
  center?: LatLng;
  code?: string;
  description?: string;
  outline?: LatLng[];
  floorPlanUrl?: string;
  floorPlanUrls?: Record<number, string>;
  floorPlanVisuals?: Record<number, { imageUrl: string; alignment?: PlanAlignment }>;
  entrances?: BuildingEntrance[];
  department?: string;
  category?: string;
  aliases?: string[];
  metadata?: Record<string, unknown>;
  staircases?: any[];
  elevators?: any[];
  floorData?: Record<string, unknown>[];
}


export interface FloorInfo {
  level: number;
  label: string;
  buildingId: string;
}

export interface MapComponent {
  id: string;
  type: ComponentType;
  label: string;
  name?: string;
  buildingId: string;
  campusId: string;
  floor: number;
  geometry: LatLng[];
  polygon?: LatLng[];
  metadata?: Record<string, unknown>;
  dimensions?: {
    width: number;
    height: number;
    rotation?: number;
  };
  connections?: string[];
}

export interface Area {
  id: string;
  name: string;
  points: LatLng[];
  color: string;
}

export interface GraphSnapshot {
  id: string;
  campusId: string;
  version: string;
  updatedAt: string;
  buildings: Building[];
  components: Component[];
  nodes: NavNode[];
  edges: NavEdge[];
  traces?: TracePath[];
  areas?: Area[];
  /** Outdoor/campus POIs (world geometry). Indoor POIs remain inside building floorData. */
  pois?: OutdoorPointOfInterest[];
  boundary?: { points: LatLng[] };
  doors?: DoorData[];
  separatedCrossings?: SeparatedCrossing[];
  /** Connectivity semantics contract version. Present for modern canonical documents. */
  connectivitySemanticsVersion?: string;
}

export interface PathResult {
  path: string[];
  cost: number;
  /** Generalized traversal cost used by canonical routing; separate from cost (meters). */
  generalizedCost?: number;
  steps: PathStep[];
}

export interface SearchEntry {
  id: string;
  label: string;
  type: 'building' | 'room' | 'entrance' | 'facility' | 'poi';
  nodeId?: string;
  position?: LatLng;
  tags?: string[];
  buildingId?: string;
  floor?: number;
  category?: string;
  floorId?: string;
  source?: 'authored' | 'graph-derived';
  sourceId?: string;
}

export interface CampusBundle {
  /** Explicit human-readable display name from the active public contract. */
  campusName?: string;
  nodes: NavNode[];
  edges: NavEdge[];
  searchEntries: SearchEntry[];
  buildings: Building[];
  /** Indoor components (rooms, hallways, staircases, elevators, entrances).
   *  Sourced from the editor's GraphSnapshot via the published artifacts. */
  components?: Component[];
  /** Indoor doors — authored via Room.roomDoors, serialized for the rendering pipeline. */
  doors?: DoorData[];
  poi: unknown[];
  boundingBox: {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
  } | null;
  /** Floor geometry artifact — contains building anchors, floor polygons, rooms, doors, etc. */
  floorGeometry?: FloorGeometryArtifact;
  /** Panorama index — contains panorama data for 360 tours */
  panoramaIndex?: PanoramaIndex;
  /** Opaque QR checkpoint index from the published artifact bundle. */
  qrIndex?: QrIndex;
}

export interface PathStep {
  nodeId: string;
  /** Exact incoming edge selected by canonical routing. */
  edgeId?: string;
  instruction: string;
  distance: number;
}

export interface ValidationResult {
  category: string;
  status: 'pass' | 'fail' | 'warn' | 'error' | 'warning' | 'info';
  message: string;
  nodeId?: string;
  edgeId?: string;
  affectedIds?: string[];
}

// ---- Legacy types (used by existing committed code, to be migrated) ----

export type NodeType =
  | 'building_entrance'
  | 'intersection'
  | 'staircase'
  | 'elevator'
  | 'room'
  | 'outdoor'
  | 'corner'
  | 'waypoint';

export type EdgeType =
  | 'walk'
  | 'transition'
  | 'restricted'
  | 'walkway'
  | 'stairs'
  | 'corridor'
  | 'elevator'
  | 'ramp'
  | 'wall';

export type ComponentType =
  | 'room'
  | 'door'
  | 'stair'
  | 'elevator'
  | 'hallway'
  | 'entrance'
  | 'restroom'
  /** Editor-only projections of Floor.routeNetwork entities. */
  | 'route-node'
  | 'route-edge';

/** Runtime door data — authored via Floor.doors (P1-T6) in the editor,
 *  serialized to CampusBundle for the rendering pipeline. */
export interface DoorData {
  id: string;
  /** Absent while a spatial Door is not yet assigned to one unambiguous Room. */
  roomId?: string;
  buildingId: string;
  floor: number;
  /** Door center in world coordinates (LatLng). */
  position: LatLng;
  /** Door width in meters (default 1.0). */
  width: number;
  /** Door leaf angle in degrees (0 = E–W line). */
  angle?: number;
  /** ID of the room or hallway this door connects to (the "other side").
   *  Optional (P1-T6): unlinked/exterior doors may have no target. */
  connectedToId?: string;
  /** Whether the door is on the building exterior. */
  isExterior?: boolean;
}

export interface Component {
  id: string;
  type: ComponentType;
  name: string;
  buildingId: string;
  campusId?: string;
  floor: number;
  position: LatLng;
  polygon?: LatLng[];
  dimensions?: {
    width: number;
    height: number;
    rotation?: number;
  };
  connections?: string[];
  range?: { from: number; to: number };
  metadata?: Record<string, unknown>;
  featureId?: string; // stable physical-feature identity (stair/elevator); additive, runtime shape checks stay lenient
}

export interface TracePath {
  id: string;
  name?: string;
  buildingId?: string;
  campusId?: string;
  floor: number;
  points: LatLng[];
  type: 'arterial' | 'connector';
  /** Optional for legacy snapshots; missing is equivalent to `visible`. */
  displayMode?: RoadDisplayMode;
  color?: string;
  width?: number;
  connectorToBuildingId?: string;
  connectorToEntranceId?: string;
  /** Optional normalized authored Road routing metadata; absent for legacy traces. */
  routing?: RoadRouting;
  metadata?: Record<string, unknown>;
}

export interface FloorPlan {
  buildingId: string;
  floor: number;
  imageUrl: string;
  uploadedAt: string;
}

export interface DirEntry {
  id: string;
  label: string;
  type: 'building' | 'floor' | 'room' | 'entrance' | 'facility';
  nodeId?: string;
  children?: DirEntry[];
}
