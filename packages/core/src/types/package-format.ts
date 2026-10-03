import type {
  BoundingBox,
  POIProvenance,
  PublishedFloorPlanVisual,
  RoadEdgeRouting,
  RuntimePOIGeometry,
} from './navigation-artifacts'
import type { PointOfInterestAppearance, PointOfInterestVisibility } from './entities'

// ── Package Format (ADR-010) ──
// Shared between @navi/publisher (writer) and @navi/runtime (reader)

export interface NavNodeFile {
  id: string
  type: 'waypoint' | 'poi' | 'transition' | 'outdoor' | 'entrance'
  lat: number
  lng: number
  floor: number
  buildingId: string
  label?: string
  properties?: Record<string, unknown>
}

export interface NavEdgeFile {
  id: string
  from: string
  to: string
  type: 'walk' | 'stairs' | 'elevator' | 'escalator' | 'ramp' | 'transition'
  distance: number
  weight: number
  /** Additive Road metadata; absent in legacy package graphs. */
  routing?: RoadEdgeRouting
}

export interface NavigationGraphFile {
  schemaVersion: string
  campusId: string
  checksum: string
  nodes: NavNodeFile[]
  edges: NavEdgeFile[]
}

export interface SearchEntryFile {
  id: string
  label: string
  type: 'building' | 'room' | 'entrance' | 'poi'
  /** Present for graph-backed entries; omitted for authored search-only POIs. */
  nodeId?: string
  lat: number
  lng: number
  tags: string[]
  buildingId?: string
  floor?: number
  category?: string
  floorId?: string
  source?: POIProvenance
  sourceId?: string
  /** Outdoor/campus scope marker. Absent = indoor/building/floor entry. */
  scope?: 'outdoor'
}

export interface SearchIndexFile {
  schemaVersion: string
  entries: SearchEntryFile[]
}

export interface SpatialIndexFile {
  schemaVersion: string
  cellSize: number
  cells: Record<string, string[]>
}

export interface EntranceEntryFile {
  id: string
  label: string
  nodeId: string
}

export interface FloorEntryFile {
  level: number
  label: string
  elevation: number
  nodeIds: string[]
  rooms?: Array<{ id: string; name: string; number: string }>
}

export interface BuildingEntryFile {
  id: string
  name: string
  code: string
  category?: string
  position: { lat: number; lng: number }
  footprint?: Array<{ lat: number; lng: number }>
  height?: number
  baseElevation?: number
  color?: string
  floors: FloorEntryFile[]
  entrances: EntranceEntryFile[]
  floorPlanUrls?: Record<number, string>
  floorPlanVisuals?: Record<number, PublishedFloorPlanVisual>
  nodeId?: string
  metadata?: Record<string, unknown>
}

export interface BuildingIndexFile {
  schemaVersion: string
  buildings: BuildingEntryFile[]
}

export interface POIEntryFile {
  id: string
  label: string
  category: string
  lat: number
  lng: number
  nodeId?: string
  buildingId?: string
  floor?: number
  floorId?: string
  source?: POIProvenance
  sourceId?: string
  geometry?: RuntimePOIGeometry
  appearance?: PointOfInterestAppearance
  /** Outdoor/campus scope marker. Absent = indoor/building/floor POI. */
  scope?: 'outdoor'
  /** Additive visibility; absent = { showOnMap: true, searchable: true }. */
  visibility?: PointOfInterestVisibility
  /** Resolved preferred approach target; absent = automatic approach. */
  approach?: { mode: 'preferred'; lat: number; lng: number }
  properties: Record<string, unknown>
}

export interface POIIndexFile {
  schemaVersion: string
  points: POIEntryFile[]
}

export interface HotspotFile {
  id: string
  type: 'navigation' | 'information' | 'link'
  target: string
  yaw: number
  pitch: number
  label: string
  hotspotType?: 'navigation' | 'information'
  content?: {
    title?: string
    description?: string
    imageUrl?: string
    linkUrl?: string
    linkLabel?: string
    entityId?: string
  }
}

export interface PanoramaEntryFile {
  id: string
  title: string
  imageAssetId: string
  buildingId?: string
  floor?: number
  lat: number
  lng: number
  heading?: number
  hotspots: HotspotFile[]
}

export interface PanoramaIndexFile {
  schemaVersion: string
  panoramas: PanoramaEntryFile[]
}

// ── Package Manifest (ADR-010 §2) ──
// P1-T11 (R11.1): versioned contract — manifest carries BOTH schemaVersion
// (major) and formatVersion (minor); consumers accept the same major and
// tolerate minor evolutions (R11.2).

export const MANIFEST_SCHEMA_VERSION = '1.0.0'
export const MANIFEST_FORMAT_VERSION = '0'

export interface PackageArtifact {
  path: string
  checksum: string
  size: number
  schemaVersion: string
  formatVersion: string
}

export interface PackageMetadata {
  nodeCount: number
  edgeCount: number
  buildingCount: number
  floorCount: number
  boundingBox: BoundingBox
  routeable: boolean
}

export interface NavigationPackageManifest {
  schemaVersion: string
  /** P1-T11 (R11.1): minor evolution marker — required with schemaVersion. */
  formatVersion: string
  campusId: string
  campusName: string
  publishedAt: string
  compilerVersion: string
  revision: string
  artifacts: Record<string, PackageArtifact>
  metadata: PackageMetadata
}

// P1-T13 (R10.2/D16): qr-index.json file contract — published in the Campus
// Bundle; the ONLY resolution source for opaque QR checkpoint codes.
export interface QrIndexFile {
  schemaVersion: string
  formatVersion: number
  campusId: string
  checkpoints: Array<{
    id: string
    label: string
    buildingId: string
    floor: number
    position: { x: number; y: number }
    code: string
  }>
}

// P1.5 (R6.1/D15): floor-geometry.json file contract — shared between
// @navi/publisher (writer) and @navi/runtime (reader). All geometry is
// building-local meters; the building anchor makes the artifact self-contained
// for world derivation (R6.1).
export interface FloorGeometryFile {
  schemaVersion: string
  formatVersion: number
  campusId: string
  buildings: FloorGeometryBuildingFile[]
}

export interface FloorGeometryBuildingFile {
  id: string
  name: string
  anchor: { origin: { lat: number; lng: number }; rotation: number }
  floors: FloorGeometryFloorFile[]
}

export interface FloorGeometryFloorFile {
  level: number
  label: string
  elevation: number
  offset: { x: number; y: number }
  rooms: Array<{ id: string; name: string; number: string; polygon: { points: Array<{ x: number; y: number }> } }>
  hallways: Array<{ id: string; name: string; polyline: { points: Array<{ x: number; y: number }> } }>
  staircases: FloorGeometryFeatureFile[]
  elevators: FloorGeometryFeatureFile[]
  doors: Array<{ id: string; roomId: string; doorType: string; position: { x: number; y: number }; width: number; angle?: number }>
  pois: Array<{ id: string; name: string; category: string; position: { x: number; y: number }; showOnMap?: boolean }>
  qrCheckpoints: Array<{ id: string; label: string; code: string; position: { x: number; y: number } }>
  openings?: Array<{ id: string; type: 'door' | 'window'; wallId: string; offset: number; width: number; height?: number; sillHeight?: number; orientation?: number }>
}

export interface FloorGeometryFeatureFile {
  id: string
  name: string
  position: { x: number; y: number }
  rotation: number
  polygon?: { points: Array<{ x: number; y: number }> }
}
