import type {
  NavigationPackageManifest,
  FloorGeometryArtifact,
} from '@navi/core'
import type {
  NavigationGraph,
  SearchIndex,
  BuildingIndex,
  POIIndex,
  PanoramaIndex,
  QrIndex,
} from '@navi/core'

// ── LoadedPackage (ADR-012 §3) — runtime-ready types ──

export interface LoadedPackage {
  readonly manifest: NavigationPackageManifest
  readonly graph: NavigationGraph
  readonly searchIndex?: SearchIndex
  readonly buildingIndex?: BuildingIndex
  readonly poiIndex?: POIIndex
  readonly panoramaIndex?: PanoramaIndex
  readonly reports: readonly ArtifactReport[]
  /** P1-T11 (R11.2): non-fatal compatibility notes (e.g. formatVersion
   *  drift) — documented behavior, never blocks loading. */
  readonly warnings: readonly string[]
  /** P1-T13 (R10.2/D16): published QR index — opaque checkpoint resolution,
   *  local-first with API fallback. */
  readonly qrIndex?: QrIndex
  /** P1.5 (R6.1/D15): floor-geometry — indoor geometry in building-local
   *  meters + building anchor for world derivation. */
  readonly floorGeometry?: FloorGeometryArtifact
}

// ── LoadResult (ADR-012 §2) ──

export type LoadResult = LoadReport | LoadFailure

export interface LoadReport {
  readonly success: true
  readonly package: LoadedPackage
  readonly durationMs: number
}

export interface LoadFailure {
  readonly success: false
  readonly code: LoadErrorCode
  readonly message: string
  readonly durationMs: number
}

export type LoadErrorCode =
  | 'PACKAGE_NOT_FOUND'
  | 'MISSING_MANIFEST'
  | 'INVALID_MANIFEST'
  | 'CHECKSUM_MISMATCH'
  | 'INVALID_SCHEMA'
  | 'INVALID_REFERENCE'
  | 'IO_ERROR'
  // P1-T11 (R11.2): manifest major schemaVersion not supported by this runtime
  | 'UNSUPPORTED_SCHEMA_VERSION'

// ── Artifact Reports (per-artifact tracking) ──

export type ArtifactReport = LoadedArtifact | SkippedArtifact | FailedArtifact

export interface LoadedArtifact {
  readonly status: 'LOADED'
  readonly artifactType: string
  readonly data: unknown
}

export interface SkippedArtifact {
  readonly status: 'SKIPPED'
  readonly artifactType: string
  readonly reason: string
}

export interface FailedArtifact {
  readonly status: 'FAILED'
  readonly artifactType: string
  readonly code: string
  readonly message: string
}


