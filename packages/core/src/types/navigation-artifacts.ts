import type { LatLng, LocalCoord, LocalPolygon, LocalPolyline } from './coordinates'
import type { QrIndex } from './qr'
import type { RouteNetwork } from './routing'
import type { PointOfInterestAppearance, PointOfInterestVisibility, RoomAccess, EntranceAccess, RoadRouting, WorldPOIGeometry } from './entities'
import type { PlanAlignment } from './coordinates'

export interface BoundingBox {
  minLng: number
  maxLng: number
  minLat: number
  maxLat: number
}

export type NavNodeType = 'space' | 'corridor' | 'transition' | 'intersection' | 'poi' | 'waypoint' | 'outdoor' | 'entrance'

export interface NavNode {
  id: string
  label: string
  type: NavNodeType
  position: LatLng
  floor: number
  buildingId: string
  properties: Record<string, unknown>
}

export type NavEdgeType = 'walk' | 'stairs' | 'elevator' | 'transition'

/**
 * Passive authored Road semantics attached to each graph segment sampled from
 * that Road. Elevations in `authored` describe the whole source Road; they are
 * deliberately not per-segment interpolation.
 */
export interface RoadEdgeRouting {
  sourceRoadId: string
  /** The emitted edge from → to follows first-to-last authored polyline order. */
  authoredOrientation: 'forward'
  authored: RoadRouting
}

export interface NavEdge {
  id: string
  from: string
  to: string
  type: NavEdgeType
  distance: number
  weight: number
  /** Absent for legacy and non-Road edges. Passive until later routing phases. */
  routing?: RoadEdgeRouting
}

export interface NavigationGraph {
  version: string
  campusId: string
  createdAt: string
  checksum: string
  nodes: NavNode[]
  edges: NavEdge[]
  metadata: {
    nodeCount: number
    edgeCount: number
    buildings: number
    floors: number
    boundingBox: BoundingBox
  }
}

export interface SearchEntry {
  id: string
  label: string
  type: 'building' | 'room' | 'entrance' | 'poi'
  /** Present for graph-backed entries; omitted for authored, search-only POIs. */
  nodeId?: string
  position: LatLng
  tags: string[]
  buildingId?: string
  floor?: number
  /** Authored POI category, distinct from the broad search entry type. */
  category?: string
  floorId?: string
  source?: POIProvenance
  sourceId?: string
  /** Outdoor/campus scope marker. Absent = indoor/building/floor POI. */
  scope?: 'outdoor'
}

export interface SearchIndex {
  version: string
  entries: SearchEntry[]
}

export type POIProvenance = 'authored' | 'graph-derived'

/**
 * World-space geometry carried by the derived runtime POI projection.
 *
 * This is the same contract as the authored `WorldPOIGeometry` — outdoor
 * authored POIs pass through publish without a coordinate rewrite; indoor
 * authored POIs are transformed into it from floor-local geometry.
 */
export type RuntimePOIGeometry = WorldPOIGeometry

export interface POI {
  id: string
  label: string
  category: string
  position: LatLng
  buildingId?: string
  floor?: number
  /** Present for graph-derived POIs; absent for authored POIs. */
  nodeId?: string
  properties: Record<string, unknown>
  /** Provenance is additive and absent on older published records. */
  source?: POIProvenance
  sourceId?: string
  floorId?: string
  /** Full authored world geometry; graph-derived entries use a point geometry. */
  geometry?: RuntimePOIGeometry
  /** Explicit authored visual treatment, when present. */
  appearance?: PointOfInterestAppearance
  /** Outdoor/campus scope marker. Absent = indoor/building/floor POI. */
  scope?: 'outdoor'
  /** Additive visibility; absent = { showOnMap: true, searchable: true }. */
  visibility?: PointOfInterestVisibility
  /**
   * Resolved preferred approach target. Authored anchors are stored relative
   * to the geometry; the projection resolves them to a world position so the
   * runtime resolver can use it without re-deriving the geometry contract.
   * Absent = automatic approach (nearest eligible network point).
   */
  approach?: { mode: 'preferred'; position: LatLng }
}

export interface FloorEntry {
  level: number
  label: string
  elevation: number
  rooms: { id: string; name: string; number: string; nodeId: string }[]
}

/** Optional, visual-only floor-plan metadata carried by published indexes. */
export interface PublishedFloorPlanVisual {
  imageUrl: string
  alignment?: PlanAlignment
}

export interface BuildingEntry {
  id: string
  name: string
  code: string
  category: string
  position: LatLng
  floors: FloorEntry[]
  entrances: { id: string; label: string; position: LatLng }[]
  nodeId: string
  /** Building footprint polygon (closed ring). */
  footprint?: LatLng[]
  /** Hex color for map rendering. */
  color?: string
  /** Height in meters for extrusion rendering. */
  height?: number
  /** Base elevation in meters above sea level. */
  baseElevation?: number
  /** Custom metadata from the source document. */
  metadata?: Record<string, unknown>
  /** P1-T10 (R15.9): per-floor floor-plan image ids â€” typed contract field
   *  (previously attached via `as any` cast in the emitter). */
  floorPlanUrls?: Record<number, string>
  /** Additive visual metadata; never consumed by graph/topology generation. */
  floorPlanVisuals?: Record<number, PublishedFloorPlanVisual>
}

export interface BuildingIndex {
  version: string
  buildings: BuildingEntry[]
}

export interface ArtifactsMetadata {
  /** Authoritative campus identity from the source CampusDocument. */
  campusId?: string
  /** Connectivity semantics contract version from the source document. */
  connectivitySemanticsVersion?: string
  /** Compiler version that produced these artifacts. */
  compilerVersion: string
  /** Revision identifier from the source document. */
  revision: string
  /** Explicit source CampusDocument.version for provenance checks. */
  sourceDocumentVersion?: string
  /** ISO 8601 timestamp of compilation. */
  compiledAt: string
}

export interface NavigationArtifacts {
  graph: NavigationGraph
  searchIndex: SearchIndex
  spatialIndex: SpatialIndex
  buildingIndex: BuildingIndex
  poiIndex: POIIndex
  panoramaIndex?: PanoramaIndex
  /** Indoor components (rooms, hallways, staircases, elevators, entrances).
   *  Produced from the same CampusDocument as the other Compiler V2 artifacts. */
  components?: unknown[]
  /** Authored door projections produced from the same CampusDocument. */
  doors?: unknown[]
  metadata?: ArtifactsMetadata
  extensions: Record<string, unknown>
  /** P1-T10 (R6.1/D15/Q2): dedicated floor-geometry artifact â€” per building,
   *  per floor geometry in building-local meters + the building world anchor. */
  floorGeometry?: FloorGeometryArtifact
  /** P1-T13 (R10.2/D16): published QR index â€” ID â†’ building/floor/position.
   *  The ONLY resolution source for opaque QR checkpoint codes. */
  qrIndex?: QrIndex
}

// â”€â”€ P1-T10 (R6.1/R6.3): floor-geometry.json artifact contract â”€â”€
// Versioned schema (schemaVersion major / formatVersion minor, group 11).
// All geometry is building-local meters (floor-local + floor.offset applied
// at emission); the building anchor (origin LatLng + rotation) makes the
// artifact self-contained for world derivation (R6.1).

export interface FloorGeometryArtifact {
  schemaVersion: number
  formatVersion: number
  campusId: string
  buildings: FloorGeometryBuilding[]
}

export interface FloorGeometryBuilding {
  id: string
  name: string
  /** Building world anchor: origin (footprint centroid) + rotation degrees
   *  clockwise â€” sufficient to derive world coordinates from local meters. */
  anchor: { origin: LatLng; rotation: number }
  floors: FloorGeometryFloor[]
}

export interface FloorGeometryFloor {
  level: number
  label: string
  elevation: number
  /** Floor-local → building-local translation (P1-T1 offset; applied at
   *  emission so all coordinates below are building-local meters). */
  offset: LocalCoord
  rooms: Array<{ id: string; name: string; number: string; polygon: LocalPolygon }>
  hallways: Array<{ id: string; name: string; polyline: LocalPolyline }>
  staircases: FloorGeometryFeature[]
  elevators: FloorGeometryFeature[]
  doors: Array<{ id: string; roomId: string; doorType: string; position: LocalCoord; width: number; angle?: number }>
  pois: Array<{ id: string; name: string; category: string; position: LocalCoord }>
  qrCheckpoints: Array<{ id: string; label: string; code: string; position: LocalCoord }>
  /** W15E: canonical wall-first structural geometry (P2). */
  walls?: Array<{ id: string; start: LocalCoord; end: LocalCoord; thickness: number; height: number }>
  /** W15E: canonical wall-attached openings (W7A). */
  openings?: Array<{ id: string; type: 'door' | 'window'; wallId: string; offset: number; width: number; height?: number; sillHeight?: number; orientation?: number }>
  /** W15E: derived room metadata from wall topology (W6 semantic attributes). */
  roomAttributes?: Array<{ roomId: string; name: string; type?: string; code?: string; description?: string; number?: string; category?: string; searchable: boolean }>
  /** W15E: authored route network (P1-T7). */
  routeNetwork?: RouteNetwork
  /** W15E: room-to-route-node access links (W9). */
  roomAccess?: RoomAccess[]
  /** W15E: entrance-to-route bridge relationships (W10). */
  entranceAccess?: EntranceAccess[]
}

export interface FloorGeometryFeature {
  id: string
  name: string
  position: LocalCoord
  rotation: number
  /** Resolved physical geometry (from feature-graphics resolution) when
   *  available â€” absent = position-only placement. */
  polygon?: LocalPolygon
}

export interface POIIndex {
  version: string
  points: POI[]
}

export interface SpatialIndex {
  version: string
  cells: Record<string, string[]>
  cellSize: number
}

// â”€â”€ Panorama Index (M6.5a) â”€â”€
// Optional runtime artifact exposing panorama data to capabilities.
// A faithful, read-only projection of document panoramas â€” no viewer concepts.

export interface HotspotContent {
  readonly title?: string
  readonly description?: string
  readonly imageUrl?: string
  readonly linkUrl?: string
  readonly linkLabel?: string
  readonly entityId?: string
}

export interface HotspotEntry {
  readonly id: string
  readonly type: 'navigation' | 'information' | 'link'
  readonly target: string
  readonly yaw: number
  readonly pitch: number
  readonly label: string
  readonly hotspotType?: 'navigation' | 'information'
  readonly content?: HotspotContent
}

export interface PanoramaEntry {
  readonly id: string
  readonly title: string
  readonly imageAssetId: string
  readonly buildingId?: string
  readonly floor?: number
  readonly position: LatLng
  readonly heading?: number
  readonly hotspots: readonly HotspotEntry[]
}

export interface PanoramaIndex {
  readonly version: string
  readonly panoramas: readonly PanoramaEntry[]
}

// P1-T13 (R10.2): QR index artifact â€” re-exported from ./qr (contract lives
// with the QR codec module; NavigationArtifacts references it above).
