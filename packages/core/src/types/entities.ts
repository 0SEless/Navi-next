import type {
  LatLng,
  LocalCoord,
  PlanAlignment,
  WorldPolygon,
  LocalPolygon,
  LocalPolyline,
  WorldPolyline,
} from './coordinates'
import type {
  BuildingCategory,
  RoomCategory,
  EntranceType,
  StaircaseType,
  ElevatorType,
  RoadSurface,
  RoadType,
  RoadDisplayMode,
  RoadRoutingFeature,
  RoadSlope,
  RoadDirection,
  POICategory,
  DoorType,
} from './enums'
import type { RouteNetwork } from './routing'

// ── Core entity interfaces ──
// Per ADR-0007: outdoor entities use World coordinates, indoor use building-local.

export interface Building {
  id: string
  name: string
  code: string
  category: BuildingCategory
  description: string
  department?: string

  // Spatial (world coordinates)
  footprint: WorldPolygon
  baseElevation: number  // meters above sea level
  height: number         // meters

  // P1-T1 (D4/D18): building rotation relative to north (degrees clockwise).
  // Each floor's origin = building footprint centroid + floor.offset (see Floor).
  // Optional: absent = 0 (legacy documents load with defaults, no migration).
  rotation?: number

  // Structure
  floors: Floor[]
  verticalConnectors: VerticalConnector[]
  roofHeight?: number  // meters, optional roof/structure above top floor (default 2.0)

  // Feature entities (P0): one stable entity per physical staircase/elevator,
  // with per-level resolved geometry in `levels`. Empty until T0.3 migration
  // mints features from legacy per-floor arrays; nothing reads them yet.
  staircases?: Staircase[]
  elevators?: Elevator[]

  // W11: vertical transitions connecting route nodes across floors through
  // staircase/elevator features. Stored on Building (spans floors).
  verticalTransitions?: VerticalTransition[]

  // Visual
  color: string  // hex color for map rendering

  // Metadata
  aliases: string[]
  metadata: Record<string, unknown>
}

export interface Floor {
  id: string
  level: number           // 0 = ground, -1 = basement, 1 = second floor
  label: string           // full display name ("Ground Floor")
  shortLabel?: string     // compact label ("GF", "1F")
  elevation: number       // meters above building baseElevation (computed from floor heights)
  height: number          // meters, floor-to-ceiling height for this floor level (default 3.5)
  // P1-T1 (D4/D18): floor origin offset relative to building footprint centroid,
  // in building-local meters (x = east, y = north). Chain:
  // floor-local (meters) → + offset → building-local (meters) → world.
  // Optional: absent = {x:0,y:0} (legacy documents load with defaults, no migration).
  offset?: LocalCoord
  // P1-T1 (D18): floor rotation relative to building axes (degrees clockwise).
  // Math supported in V1; rotation editing UX deferred to V2 (R3.5).
  // Optional: absent = 0.
  rotation?: number
  // RC1: planImageId stores the floor plan image URL (data URL or asset ID).
  //   It is the single canonical source — consumed by thumbnail, canvas,
  //   status badge, save/load, and publish.
  // RC2: Replace with a floorPlan object:
  //   floorPlan: { imageUrl, alignment, opacity, visible, locked }
  planImageId?: string
  floorPlanState?: 'none' | 'active' | 'locked'

  // Floor plan image alignment relative to building footprint
  // All values in building-local coordinate space (W12B: uses shared PlanAlignment type)
  planAlignment?: PlanAlignment

  // Visibility (defaults: visible=true, locked=false)
  visible?: boolean
  locked?: boolean

  // Spatial features (all in building-local coordinates)
  walls?: Wall[]              // P2: canonical authored structural geometry
  // W6: semantic room attributes — stable identity + metadata derived from wall topology.
  // Optional: absent = no semantic rooms (legacy documents stay additive-absent, D12).
  roomAttributes?: RoomAttributes[]
  rooms: Room[]
  hallways: Hallway[]
  staircases: LegacyStaircase[]
  elevators: LegacyElevator[]
  entrances: Entrance[]
  connectorStops: ConnectorStop[]
  parametricComponents: ParametricComponent[]
  // P1-T5 (R2.2): search/discovery landmarks — NOT rooms, never routing
  // destination leaves. Positions building-local meters only.
  // Optional: absent = no POIs (legacy documents stay additive-absent, D12).
  pois?: PointOfInterest[]
  // P1-T6 (R2.4/D7): extracted RoomDoor collection — the canonical home for
  // doors after extraction from Room nesting. Each door carries `roomId`
  // (owning room). Optional: absent = no extracted doors; legacy documents
  // may still carry nested room.roomDoors (valid input, never dual-written).
  doors?: RoomDoor[]
  // P1-T8: wall-attached windows — positioned via wallId + offset along the wall edge.
  windows?: Window[]
  // W7A: canonical wall-attached openings (doors + windows) — unified model.
  // Optional: absent = no openings (legacy documents stay additive-absent, D12).
  openings?: Opening[]
  // P1-T7 (R2.5/R8.1/D3): authored route network — first-class persisted
  // entity built from polyline-vertex editing. NOT derived from hallway
  // geometry (D3). Optional: absent = no authored network (legacy documents,
  // D12 additive-absent).
  routeNetwork?: RouteNetwork
  // W10: bridge relationships between outdoor navigation and indoor RouteNetwork
  // through building entrances. Optional: absent = no bridge (legacy documents,
  // D12 additive-absent).
  entranceAccess?: EntranceAccess[]

  // Asset references
  textureId?: string
  svgOverlayId?: string

  // Metadata
  metadata: Record<string, unknown>
}

export interface RoomDoor {
  id: string
  roomId?: string             // owning room; absent means explicitly unassigned/ambiguous
  ownership?:
    | { status: 'assigned' }
    | { status: 'unassigned' }
    | { status: 'ambiguous'; candidateRoomIds: string[] }
  // P1-T6 (D12): optional — a door may be unconnected (e.g. exterior doors
  // with connectedToType 'hallway' and no id). Absence is preserved verbatim
  // through migration/serialization; room-door-connectivity flags unlinked
  // doors as topology issues.
  connectedToId?: string      // room or hallway ID on the other side
  connectedToType?: 'room' | 'hallway'
  // P1-T6 (R2.4/D7): closed DoorType enum (see enums.ts). 'opening' is a
  // wall opening — always traversable; the rest are closed doors.
  doorType: DoorType
  position: LocalCoord        // wall position of the door
  width: number               // meters
  depth?: number
  rotation?: number           // radians
  geometry?: Extract<PointOfInterestGeometry, { type: 'rectangle' }>
  name?: string
  angle?: number              // degrees — door leaf angle (0 = E–W line)
  routeConnection?: {
    anchorNodeId: string
    targetRouteNodeId: string
    connectorEdgeId: string
  }
  metadata: Record<string, unknown>
}

/**
 * P1-T8: wall-attached window entity.
 * Lives on Floor.windows. Positioned via wallId (reference to an owning wall)
 * and offset (meters from wall start). The wall is identified by its parent
 * entity (room edge or hallway segment) and the edge index within that entity.
 */
export interface Window {
  id: string
  wallId: string              // composite wall reference (e.g. "room:roomId:edgeIdx" or "hallway:hallwayId:edgeIdx")
  offset: number              // meters from wall start
  width: number               // meters
  sillHeight: number          // meters from floor
  metadata: Record<string, unknown>
}

/**
 * W7A: Canonical wall-attached opening entity (door or window).
 * Unified model replacing ad-hoc wall references — lives at Floor.openings.
 * Positioned via wallId (reference to parent Wall.id) and offset (meters from wall start).
 * Actual (x,y) position is derived from wall geometry, never stored.
 */
export interface Opening {
  id: string
  type: 'door' | 'window'
  wallId: string        // reference to parent Wall.id
  offset: number        // distance in meters from wall.start
  width: number         // meters
  height?: number       // meters (optional initially)
  sillHeight?: number   // meters (optional initially)
  orientation?: number  // degrees — user-drawn door leaf angle (A→B direction)
  metadata?: Record<string, unknown>
}

/**
 * P2: Canonical Wall entity — the authoritative indoor structural geometry.
 * Walls are the primary authored structure; rooms are derived from wall topology.
 *
 * Coordinates are BUILDING-LOCAL METERS (x=east, y=north).
 * MapLibre LatLng is NOT stored in Wall — it is derived at render time.
 * Floor-plan pixels are NOT stored in Wall — alignment is a separate concern.
 *
 * Walls are owned by Floor.walls[]. The Floor establishes floor ownership;
 * Wall does not redundantly store floorId.
 */
export interface Wall {
  id: string
  /** BUILDING-LOCAL METERS (x=east, y=north) */
  start: LocalCoord
  /** BUILDING-LOCAL METERS (x=east, y=north) */
  end: LocalCoord
  thickness: number    // meters (default 0.15)
  height: number       // meters (default 3.5)
  metadata?: Record<string, unknown>
}

/**
 * W9: Relationship between a semantic room, a door opening, and a route node.
 * Links a room's access point to the routing graph for indoor navigation.
 */
export interface RoomAccess {
  /** Optional reference to Opening.id — point-only access omits legacy door detail. */
  openingId?: string
  /** Reference to RouteNode.id */
  routeNodeId: string
  /** Whether this is the primary access point for routing */
  primary: boolean
}

/**
 * W6: Semantic room attributes — stable identity + metadata derived from wall topology.
 *
 * Attached to a derived face via faceId. Survives wall edits through face lineage.
 * Stored in Floor.roomAttributes[] — canonical authoritative source.
 */
export interface RoomAttributes {
  /** Stable face ID this room is tied to */
  faceId: string
  /** W15E: stable semantic room ID — canonical identity for search/index. */
  roomId?: string
  /** Human-readable room name */
  name: string
  /** Canonical room classification (e.g. classroom, laboratory, office, other) */
  type?: string
  /** Canonical room code used by the campus (optional) */
  code?: string
  /** Author-entered room description (optional) */
  description?: string
  /** Legacy room number; retained for backward-compatible reads */
  number?: string
  /** Legacy room category; retained for backward-compatible reads */
  category?: string
  /** Whether this room appears in search results */
  searchable: boolean
  /** W9: access points linking to door openings and route nodes */
  accessPoints?: RoomAccess[]
}

export interface Room {
  id: string
  name: string
  number: string
  category: RoomCategory

  // Geometry in building-local meters
  polygon: LocalPolygon
  entrancePosition?: LocalCoord  // door location on polygon boundary
  roomDoors: RoomDoor[]

  capacity?: number
  metadata: Record<string, unknown>
}

export interface Hallway {
  id: string
  name: string
  polyline: LocalPolyline  // building-local meters
  width: number            // meters
  color?: string
}

/**
 * P1-T5 (R2.2): a floor-local labeled point — search/discovery landmark.
 * Distinct from Room: a Registrar's Office is a Room; a vending machine is
 * a PointOfInterest. Never a routing destination leaf (route-network poi
 * nodes are P1-T7's concern).
 *
 * Named `PointOfInterest` because `POI` is already the RUNTIME artifact type
 * in navigation-artifacts.ts (world LatLng + nodeId); this is the authoring
 * entity (building-local).
 */
export type PointOfInterestGeometry =
  | {
      type: 'point'
      position: LocalCoord
    }
  | {
      type: 'circle'
      center: LocalCoord
      radius: number
    }
  | {
      type: 'rectangle'
      min: LocalCoord
      max: LocalCoord
      /** Rotation around the rectangle centroid, in radians. Absent means 0. */
      rotation?: number
    }
  | {
      type: 'polygon'
      /** Ordered, open ring in floor-local meters; closure is implicit. */
      points: LocalCoord[]
    }

export type PointOfInterestAppearanceMode = 'marker' | '2d' | '2.5d'

/** Optional visual treatment for a canonical POI (indoor floor-local or outdoor world). */
export interface PointOfInterestAppearance {
  mode: PointOfInterestAppearanceMode
  /** Extrusion height in meters; only used by the `2.5d` mode. */
  height?: number
  /**
   * Authored display color (hex). Applies to the marker, 2D fill/outline, and
   * 2.5D extrusion. Absent = renderer default; selection/hover highlighting is
   * always separate and never uses this value.
   */
  color?: string
}

/**
 * Map/search visibility for a canonical POI. Both flags default to `true`
 * when the record is absent (legacy + migrated documents keep behaving as
 * before). `showOnMap = false` hides the POI from public maps; when it is
 * still `searchable`, a user search may temporarily reveal it without
 * persisting anything.
 */
export interface PointOfInterestVisibility {
  showOnMap: boolean
  searchable: boolean
}

/**
 * Geometry-relative preferred approach anchor. Stored relative to the POI
 * geometry so it stays attached through move/resize/rotate/vertex edits:
 *   - circle:    angle in radians on the circumference
 *   - rectangle: edge index (0..3 = corner i -> corner i+1) + interpolation t
 *   - polygon:   edge index + interpolation t
 * Point POIs use their own position and never carry an anchor.
 */
export type PoiApproachAnchor =
  | { kind: 'circle-angle'; angle: number }
  | { kind: 'rectangle-edge'; edge: 0 | 1 | 2 | 3; t: number }
  | { kind: 'polygon-edge'; edge: number; t: number }

/** Navigation approach preference; `automatic` is the default. */
export interface PointOfInterestNavigation {
  approachMode: 'automatic' | 'preferred'
  anchor?: PoiApproachAnchor
}

interface PointOfInterestIdentity {
  id: string
  name: string               // free-form display name
  category: POICategory      // controlled enum, `other` fallback
  metadata?: Record<string, unknown>
  /** Additive visual state; absent records resolve from their geometry kind. */
  appearance?: PointOfInterestAppearance
  /** Additive map/search visibility; absent = { showOnMap: true, searchable: true }. */
  visibility?: PointOfInterestVisibility
  /** Additive approach preference; absent = { approachMode: 'automatic' }. */
  navigation?: PointOfInterestNavigation
}

/**
 * Canonical Studio POI record.
 *
 * Position-only records are the Phase 2/3A compatibility form. Explicit
 * geometry records use the discriminated geometry field as their sole spatial
 * source; the `never` exclusions prevent dual-writing two competing sources.
 */
export type PointOfInterest =
  | (PointOfInterestIdentity & {
      position: LocalCoord
      geometry?: never
    })
  | (PointOfInterestIdentity & {
      geometry: PointOfInterestGeometry
      position?: never
    })

/**
 * World-space POI geometry for outdoor/campus POIs.
 *
 * Shares the indoor discriminant and appearance contract; the only difference
 * from `PointOfInterestGeometry` is the coordinate space (world LatLng instead
 * of building/floor-local meters). Reused verbatim as the derived runtime
 * `RuntimePOIGeometry` so authored outdoor records pass through publish without
 * a coordinate rewrite.
 */
export type WorldPOIGeometry =
  | { type: 'point'; position: LatLng }
  | { type: 'circle'; center: LatLng; radius: number }
  | { type: 'rectangle'; points: LatLng[] }
  | { type: 'polygon'; points: LatLng[] }

/**
 * Canonical Studio POI record for the campus/outdoor scope.
 *
 * Outdoor POIs are authored directly on the campus map and use world
 * coordinates only — they carry no buildingId/floorId and never write to
 * `Floor.pois`. Identity and appearance are the same contract as indoor POIs.
 */
export interface OutdoorPointOfInterest extends PointOfInterestIdentity {
  scope: 'outdoor'
  geometry: WorldPOIGeometry
}

export function isOutdoorPointOfInterest(value: unknown): value is OutdoorPointOfInterest {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as { scope?: unknown; geometry?: unknown }
  return candidate.scope === 'outdoor' && typeof candidate.geometry === 'object' && candidate.geometry !== null
}

/**
 * @deprecated legacy per-floor record — read-only for migration; see Staircase feature entity
 */
export interface LegacyStaircase {
  id: string
  name: string
  position: LocalCoord     // building-local meters
  fromLevel: number
  toLevel: number
  type: StaircaseType
}

/**
 * @deprecated legacy per-floor record — read-only for migration; see Elevator feature entity
 */
export interface LegacyElevator {
  id: string
  name: string
  position: LocalCoord     // building-local meters
  fromLevel: number
  toLevel: number
}

/**
 * A physical staircase: one stable entity per stairwell, with resolved
 * per-floor geometry in `levels`.
 *
 * Invariant: `fromLevel <= toLevel` (physical extent).
 * Invariant: `levels` keys ⊆ [fromLevel..toLevel] (access floors only).
 */
export interface Staircase {
  id: string
  buildingId: string
  name: string
  type: StaircaseType
  accessible: boolean
  fromLevel: number
  toLevel: number          // PHYSICAL EXTENT (authored). Invariant: fromLevel <= toLevel
  levels: Record<number, StairLevelGeometry>  // ACCESS FLOORS only. Invariant: keys ⊆ [fromLevel..toLevel]
}

export interface StairLevelGeometry {
  position: LocalCoord          // per-level position (editable)
  rotation: number              // per-level orientation (editable)
  polygon?: LocalPolygon        // RESOLVED physical geometry (never "authoritative")
  landing?: {
    position: LocalCoord
    rotation?: number
    polygon?: LocalPolygon
  }
  drawing?: {                   // parametric mode; absent = freeform
    definitionId: 'stair'
    properties: { stepCount: number; stepWidth: number; stepDepth: number; direction: string; preset: string }
  }
}

/**
 * A physical elevator: one stable entity per elevator car/bank, with resolved
 * per-floor geometry in `levels`.
 *
 * Invariant: `fromLevel <= toLevel` (physical extent).
 * Invariant: `levels` keys ⊆ [fromLevel..toLevel] (access floors only).
 */
export interface Elevator {
  id: string
  buildingId: string
  name: string
  type: ElevatorType
  accessible: boolean
  fromLevel: number
  toLevel: number          // PHYSICAL EXTENT (authored). Invariant: fromLevel <= toLevel
  levels: Record<number, ElevatorLevelGeometry>  // ACCESS FLOORS only. Invariant: keys ⊆ [fromLevel..toLevel]
}

export interface ElevatorLevelGeometry {
  position: LocalCoord          // per-level position (editable)
  rotation: number              // per-level orientation (editable)
  polygon?: LocalPolygon        // RESOLVED physical geometry (never "authoritative")
  landing?: {
    position: LocalCoord
    rotation?: number
    polygon?: LocalPolygon
  }
  drawing?: {                   // parametric mode; absent = freeform
    definitionId: 'elevator'
    properties: { width: number; depth: number; doorSide: string }
  }
}

export interface LocalCoord2D {
  x: number
  y: number
}

export interface ParametricComponentEntity {
  id: string
  definitionId: string
  position: LocalCoord2D
  rotation: number
  properties: Record<string, unknown>
}

export interface PanoramaAnchor {
  id: string
  label: string
  position: LocalCoord       // building-local meters
  heading: number            // degrees, initial camera heading
  imageAssetId: string
  hotspots: PanoramaHotspot[]  // same structure as top-level Panorama hotspots
}

export interface QRCodeAnchor {
  id: string
  label: string
  position: LocalCoord     // building-local meters
  code: string
  metadata: Record<string, unknown>
}

export type Anchor = PanoramaAnchor | QRCodeAnchor

export interface ConnectorStop {
  id: string
  connectorId: string     // parent VerticalConnector
  label?: string          // "Landing", "Elevator Lobby"
  position: LocalCoord    // building-local meters
  rotation?: number       // facing direction in degrees (instruction generation)
  landingPolygon?: LocalPolygon
  connectedHallwayId?: string
  anchors: Anchor[]       // navigational points of interest; replaces inline panorama/qr
  accessible: boolean
  metadata: Record<string, unknown>
}

export interface VerticalConnector {
  id: string
  type: 'staircase' | 'elevator'
  name: string               // "Stairwell A", "Main Elevator Bank"
  stopIds: string[]           // ConnectorStop IDs that belong to this connector
  accessible: boolean
  metadata: Record<string, unknown>
}

export interface Entrance {
  id: string
  label: string
  position: LocalCoord     // building-local meters (D9); world LatLng derived via CoordinateTransformer only
  level: number
  type: EntranceType
  hasQR: boolean
  hasPanorama: boolean
  connectorRoadId?: string // road ID this entrance connects to
}

/** Optional outdoor traversal metadata. Absence preserves legacy behavior. */
export interface RoadRouting {
  feature?: RoadRoutingFeature
  slope?: RoadSlope
  direction?: RoadDirection
  /** Administrator-authored elevation in meters; not a survey measurement. */
  startElevationMeters?: number
  /** Administrator-authored elevation in meters; not a survey measurement. */
  endElevationMeters?: number
  walkable?: boolean
  /** Undefined means unknown/legacy, not accessible or inaccessible. */
  wheelchairAccessible?: boolean
}

export interface Road {
  id: string
  name: string
  polyline: WorldPolyline  // world coordinates (lat/lng)
  width: number            // meters
  surface: RoadSurface
  type: RoadType
  /** Optional for legacy documents; missing is equivalent to `visible`. */
  displayMode?: RoadDisplayMode
  connectorEntranceId?: string
  /** Optional for legacy documents; interpret through getEffectiveRoadRouting. */
  routing?: RoadRouting
  metadata: Record<string, unknown>
}

/**
 * W10: Bridge relationship between outdoor navigation and indoor RouteNetwork
 * through a building entrance. Links an outdoor road/path node to an indoor
 * route node via the building's entrance.
 */
export interface EntranceAccess {
  /** Reference to Entrance.id */
  entranceId: string
  /** Reference to an external outdoor node, or the stable access-junction ID. */
  outdoorNodeId: string
  /** Reference to indoor RouteNode.id (from Floor.routeNetwork) */
  indoorRouteNodeId: string
  /** Authored road/trace ID when the author selected a route segment or trace node. */
  outdoorRouteId?: string
  /** Exact world position selected on the authored outdoor route. */
  outdoorPosition?: LatLng
}

export interface HotspotContent {
  title?: string
  description?: string
  imageUrl?: string
  linkUrl?: string
  linkLabel?: string
  entityId?: string  // Reference to existing NAVI entity (building, room, POI)
}

export interface PanoramaHotspot {
  // Hotspot type discriminator:
  // - 'navigation': links to another panorama (targetPanoramaId in target.targetId)
  // - 'information': displays content card (content field)
  // Backward compatible: absent = 'navigation' for legacy documents
  hotspotType?: 'navigation' | 'information'
  target: {
    type: 'panorama' | 'room' | 'entrance' | 'qr' | 'url'
    targetId: string
  }
  position: {
    pitch: number  // degrees, -90 to 90
    yaw: number    // degrees, 0-360
  }
  label: string
  // Information hotspot content (only when hotspotType = 'information')
  content?: HotspotContent
}

export interface Panorama {
  id: string
  label: string
  // D9 coordinate semantics:
  // - When buildingId is present: position is LocalCoord (building-local meters)
  // - When buildingId is absent: position is LatLng (world coordinates)
  // - Legacy documents may store LatLng directly (detected via `lat` property)
  position: LocalCoord | LatLng
  heading: number           // degrees, 0-360, initial camera heading
  imageAssetId: string      // asset ID of the panorama image
  buildingId?: string       // undefined = outdoor/campus-wide panorama
  floor?: number
  hotspots: PanoramaHotspot[]
}

export interface QRCheckpoint {
  id: string
  label: string
  position: LocalCoord     // building-local meters (D9); world LatLng derived via CoordinateTransformer only
  floor: number
  buildingId: string
  code: string              // encoded data or URL (opaque stable code; encoding scheme is P1-T13)
  metadata: Record<string, unknown>
}

export interface Area {
  id: string
  name: string              // display label ("Parking Lot A", "Event Plaza")
  points: LatLng[]          // polygon vertices (world coordinates)
  color: string             // hex color for map rendering
}

/**
 * W11: Vertical transition connecting route nodes across floors through a
 * physical staircase or elevator feature. Stored on Building (spans floors).
 *
 * Invariant: each connection's floorId must exist in building.floors.
 * Invariant: each connection's routeNodeId must exist in that floor's routeNetwork.
 * Invariant: no duplicate floorId entries in connections.
 * Invariant: featureId must reference an existing Staircase or Elevator on the building.
 * Invariant: type must match the referenced feature's type.
 */
export interface VerticalTransition {
  id: string
  featureId: string      // reference to Staircase.id or Elevator.id
  type: 'staircase' | 'elevator'
  connections: Array<{
    floorId: string
    routeNodeId: string
  }>
}
