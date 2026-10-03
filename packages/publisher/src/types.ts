// â”€â”€ Package Format Types (re-exported from @navi/core per ADR-012) â”€â”€

export type {
  NavNodeFile,
  NavEdgeFile,
  NavigationGraphFile,
  SearchEntryFile,
  SearchIndexFile,
  SpatialIndexFile,
  EntranceEntryFile,
  FloorEntryFile,
  BuildingEntryFile,
  BuildingIndexFile,
  POIEntryFile,
  POIIndexFile,
  PackageArtifact,
  PackageMetadata,
  NavigationPackageManifest,
} from '@navi/core'

// 360 Tour (R6.1): panorama artifact file contracts, re-exported so ./index
// and package-builder can source them from './types'.
export type {
  PanoramaIndexFile,
  PanoramaEntryFile,
  HotspotFile,
} from '@navi/core'

import type {
  PackageMetadata,
  NavigationGraphFile,
  SearchIndexFile,
  SpatialIndexFile,
  BuildingIndexFile,
  POIIndexFile,
  PanoramaIndexFile,
  FloorGeometryFile,
  FloorGeometryFeatureFile,
} from '@navi/core'

// â”€â”€ BuiltPackage (PackageBuilder output) â”€â”€

export interface BuiltPackage {
  campusId: string
  campusName: string
  publishedAt: string
  compilerVersion: string
  revision: string
  metadata: PackageMetadata
  graph: NavigationGraphFile
  search?: SearchIndexFile
  spatial?: SpatialIndexFile
  buildings?: BuildingIndexFile
  poi?: POIIndexFile
  panorama?: PanoramaIndexFile
  /** P1-T10 (R6.1/D15): floor-geometry.json file. */
  floorGeometry?: FloorGeometryFile
  /** P1-T13 (R10.2/D16): qr-index.json file. */
  qrIndex?: QrIndexFile
  schemaVersions: {
    graph: string
    search: string
    spatial: string
    buildings: string
    poi: string
    panorama: string
    floorGeometry: string
    qrIndex: string
  }
}

// P1-T10 (R6.1/D15): floor-geometry.json file contract — shared with @navi/runtime via @navi/core.
export type { FloorGeometryFile, FloorGeometryFeatureFile } from '@navi/core'

// P1-T13 (R10.2/D16): the qr-index.json file contract lives in @navi/core
// package-format (shared with the runtime loader).
import type { QrIndexFile } from '@navi/core'
export type { QrIndexFile } from '@navi/core'

// ── Publisher Result Types (ADR-011 ┬º4) ──

export interface PublishOptions {
  campusId: string
  campusName: string
  outputDir: string
  publishedAt?: string
  schemaVersions?: Partial<{
    graph: string
    search: string
    spatial: string
    building: string
    poi: string
    panorama: string
    floorGeometry: string
    qrIndex: string
  }>
}

export interface ArtifactResult {
  name: string
  path: string
  checksum: string
  size: number
  schemaVersion: string
  /** P1-T11 (R11.1): minor evolution marker carried into the manifest. */
  formatVersion: string
}

export interface PublisherReport {
  success: true
  path: string
  artifactCount: number
  totalBytes: number
  durationMs: number
  artifacts: ArtifactResult[]
}

export interface PublishFailure {
  success: false
  code: PublishErrorCode
  message: string
  artifact?: string
  durationMs: number
}

export type PublishResult = PublisherReport | PublishFailure

export type PublishErrorCode =
  | 'PREFLIGHT_FAILED'
  | 'SERIALIZATION_FAILED'
  | 'CHECKSUM_MISMATCH'
  | 'IO_ERROR'
  | 'COMMIT_FAILED'
