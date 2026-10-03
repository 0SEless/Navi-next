import type { BuiltPackage, NavigationPackageManifest, PackageArtifact } from './types'
import { MANIFEST_SCHEMA_VERSION, MANIFEST_FORMAT_VERSION } from '@navi/core'

export interface ArtifactRecord {
  name: string
  path: string
  checksum: string
  size: number
  schemaVersion: string
  /** P1-T11 (R11.1): per-artifact minor evolution marker. */
  formatVersion: string
}

export function buildManifest(pkg: BuiltPackage, artifacts: ArtifactRecord[]): NavigationPackageManifest {
  const artifactMap: Record<string, PackageArtifact> = {}

  for (const a of artifacts) {
    artifactMap[a.name] = {
      path: a.path,
      checksum: a.checksum,
      size: a.size,
      schemaVersion: a.schemaVersion,
      formatVersion: a.formatVersion,
    }
  }

  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    formatVersion: MANIFEST_FORMAT_VERSION,
    campusId: pkg.campusId,
    campusName: pkg.campusName,
    publishedAt: pkg.publishedAt,
    compilerVersion: pkg.compilerVersion,
    revision: pkg.revision,
    artifacts: artifactMap,
    metadata: { ...pkg.metadata },
  }
}
