import type { PackageReader } from './package-reader'
import type { ChecksumVerifier } from './checksum-verifier'
import type { ArtifactHydrator, ArtifactValidator } from './artifact-hydrator'
import type { ReferenceValidator } from './reference-validator'
import type {
  LoadResult,
  LoadFailure,
  LoadedPackage,
  ArtifactReport,
} from './types'
import { graphValidator } from './validators/graph-validator'
import { searchValidator } from './validators/search-validator'
import { buildingValidator } from './validators/building-validator'
import { poiValidator } from './validators/poi-validator'
import { panoramaValidator } from './validators/panorama-validator'
import { qrValidator } from './validators/qr-validator'
import { floorGeometryValidator } from './validators/floor-geometry-validator'
import { toRuntimeGraph, toRuntimeSearch, toRuntimeBuildings, toRuntimePOI, toRuntimePanorama, toRuntimeQrIndex, toRuntimeFloorGeometry } from './runtime-converter'
import type { NavigationPackageManifest, PackageArtifact, NavigationGraphFile, SearchIndexFile, BuildingIndexFile, POIIndexFile, PanoramaIndexFile, QrIndexFile, FloorGeometryFile } from '@navi/core'

interface ArtifactData {
  fileType: 'graph' | 'search' | 'buildings' | 'poi' | 'panorama' | 'qrIndex' | 'floorGeometry'
  fileData: unknown
  report: ArtifactReport
}

interface ValidatorBinding {
  validator: ArtifactValidator<unknown>
  fileType: 'graph' | 'search' | 'buildings' | 'poi' | 'panorama' | 'qrIndex' | 'floorGeometry'
}

const ARTIFACT_REGISTRY: Record<string, ValidatorBinding> = {
  graph: { validator: graphValidator, fileType: 'graph' },
  search: { validator: searchValidator, fileType: 'search' },
  buildings: { validator: buildingValidator, fileType: 'buildings' },
  poi: { validator: poiValidator, fileType: 'poi' },
  panorama: { validator: panoramaValidator, fileType: 'panorama' },
  // P1-T13 (R10.2): published QR index — opaque checkpoint resolution.
  qrIndex: { validator: qrValidator, fileType: 'qrIndex' },
  // P1.5 (R6.1/D15): floor-geometry.json — indoor geometry for rendering.
  floorGeometry: { validator: floorGeometryValidator, fileType: 'floorGeometry' },
}

export class PackageLoader {
  constructor(
    private readonly reader: PackageReader,
    private readonly checksumVerifier: ChecksumVerifier,
    private readonly hydrator: ArtifactHydrator,
    private readonly referenceValidator: ReferenceValidator,
  ) {}

  async load(): Promise<LoadResult> {
    const start = Date.now()

    let manifestContent: string
    try {
      manifestContent = await this.reader.readFile('manifest.json')
    } catch (e) {
      return {
        success: false,
        code: 'MISSING_MANIFEST',
        message: `Failed to read manifest: ${(e as Error).message}`,
        durationMs: Date.now() - start,
      }
    }

    let manifest: NavigationPackageManifest
    try {
      manifest = JSON.parse(manifestContent) as NavigationPackageManifest
    } catch {
      return {
        success: false,
        code: 'INVALID_MANIFEST',
        message: 'Manifest is not valid JSON',
        durationMs: Date.now() - start,
      }
    }

    // P1-T11 (R11.2): versioned compatibility rule — consumers accept the
    // same major schemaVersion; formatVersion covers minor evolutions.
    // Legacy manifests without version fields are tolerated (assumed
    // major 1 / format 0 — documented behavior).
    const manifestMajor = (manifest.schemaVersion ?? '1.0.0').split('.')[0] ?? '1'
    if (manifestMajor !== '1') {
      return {
        success: false,
        code: 'UNSUPPORTED_SCHEMA_VERSION',
        message: `Manifest schemaVersion "${manifest.schemaVersion}" is not supported by this runtime (supported major: 1). Re-publish the campus with a compatible compiler or update the runtime.`,
        durationMs: Date.now() - start,
      }
    }
    const warnings: string[] = []
    const manifestFormat = manifest.formatVersion ?? '0'
    if (manifestFormat !== '0') {
      warnings.push(`Manifest formatVersion "${manifestFormat}" differs from the supported "0" — loaded with documented tolerance (R11.2).`)
    }

    const artifacts: ArtifactData[] = []

    for (const [key, artifactMeta] of Object.entries(manifest.artifacts)) {
      const result = await this.processArtifact(key, artifactMeta)
      artifacts.push(result)
    }

    const reports = artifacts.map(a => a.report)

    const graphFile = artifacts.find(a => a.fileType === 'graph')?.fileData as NavigationGraphFile | undefined
    const searchFile = artifacts.find(a => a.fileType === 'search')?.fileData as SearchIndexFile | undefined
    const buildingsFile = artifacts.find(a => a.fileType === 'buildings')?.fileData as BuildingIndexFile | undefined
    const poiFile = artifacts.find(a => a.fileType === 'poi')?.fileData as POIIndexFile | undefined
    const panoramaFile = artifacts.find(a => a.fileType === 'panorama')?.fileData as PanoramaIndexFile | undefined
    const qrFile = artifacts.find(a => a.fileType === 'qrIndex')?.fileData as QrIndexFile | undefined
    const floorGeometryFile = artifacts.find(a => a.fileType === 'floorGeometry')?.fileData as FloorGeometryFile | undefined

    const refResult = this.referenceValidator.validate({
      graph: graphFile,
      search: searchFile,
      buildings: buildingsFile,
      poi: poiFile,
    })

    if (!refResult.success) {
      return {
        success: false,
        code: 'INVALID_REFERENCE',
        message: refResult.message,
        durationMs: Date.now() - start,
      }
    }

    const loadedPkg: LoadedPackage = {
      manifest,
      graph: toRuntimeGraph(graphFile!),
      searchIndex: searchFile ? toRuntimeSearch(searchFile) : undefined,
      buildingIndex: buildingsFile ? toRuntimeBuildings(buildingsFile) : undefined,
      poiIndex: poiFile ? toRuntimePOI(poiFile) : undefined,
      panoramaIndex: panoramaFile ? toRuntimePanorama(panoramaFile) : undefined,
      // P1-T13 (R10.2): QR index for opaque checkpoint resolution.
      qrIndex: qrFile ? toRuntimeQrIndex(qrFile) : undefined,
      // P1.5 (R6.1/D15): floor-geometry for indoor rendering.
      floorGeometry: floorGeometryFile ? toRuntimeFloorGeometry(floorGeometryFile) : undefined,
      reports,
      warnings,
    }

    return {
      success: true,
      package: loadedPkg,
      durationMs: Date.now() - start,
    }
  }

  private async processArtifact(
    key: string,
    meta: PackageArtifact,
  ): Promise<ArtifactData> {
    const binding = ARTIFACT_REGISTRY[key]
    if (!binding) {
      return {
        fileType: 'graph' as const,
        fileData: undefined,
        report: { status: 'SKIPPED', artifactType: key, reason: `Unknown artifact type: ${key}` },
      }
    }

    let content: string
    try {
      content = await this.reader.readFile(meta.path)
    } catch (e) {
      return {
        fileType: binding.fileType,
        fileData: undefined,
        report: { status: 'FAILED', artifactType: key, code: 'IO_ERROR', message: (e as Error).message },
      }
    }

    const rawBytes = Buffer.from(content, 'utf-8')
    if (!this.checksumVerifier.verify(rawBytes, meta.checksum)) {
      return {
        fileType: binding.fileType,
        fileData: undefined,
        report: { status: 'FAILED', artifactType: key, code: 'CHECKSUM_MISMATCH', message: `Checksum mismatch for ${key}` },
      }
    }

    const hydrateResult = await this.hydrator.hydrate(content, binding.validator)
    if (!hydrateResult.success) {
      return {
        fileType: binding.fileType,
        fileData: undefined,
        report: { status: 'FAILED', artifactType: key, code: hydrateResult.code, message: hydrateResult.message },
      }
    }

    return {
      fileType: binding.fileType,
      fileData: hydrateResult.artifact,
      report: { status: 'LOADED', artifactType: key, data: hydrateResult.artifact },
    }
  }
}
