import type { NavigationArtifacts } from '@navi/core'
import { MANIFEST_FORMAT_VERSION } from '@navi/core'
import { build } from './package-builder'
import { buildManifest } from './manifest-builder'
import { PackageWriter } from './package-writer'
import type { Serializer, ChecksumService, IEnvironmentProbe, ICommitter } from './interfaces'
import type { RoundTripVerifier } from './round-trip-verifier'
import type {
  PublishOptions,
  PublishResult,
  PublisherReport,
  PublishFailure,
  ArtifactResult,
  BuiltPackage,
  NavigationPackageManifest,
} from './types'
import { join } from 'node:path'

const ARTIFACT_NAMES = ['graph', 'search', 'spatial', 'buildings', 'poi', 'panorama', 'floorGeometry', 'qrIndex'] as const
type ArtifactName = (typeof ARTIFACT_NAMES)[number]

function artifactPath(name: string): string {
  // P1-T10 (R6.1)/P1-T13 (R10.2): spec filenames for the dedicated artifacts.
  if (name === 'floorGeometry') return 'floor-geometry.json'
  if (name === 'qrIndex') return 'qr-index.json'
  return `${name}.json`
}

export class Publisher {
  constructor(
    private readonly serializer: Serializer,
    private readonly checksum: ChecksumService,
    private readonly envProbe: IEnvironmentProbe,
    private readonly verifier: RoundTripVerifier,
    private readonly committer: ICommitter,
  ) {}

  async publish(artifacts: NavigationArtifacts, options: PublishOptions): Promise<PublishResult> {
    const start = Date.now()
    const writer = new PackageWriter(options.outputDir)

    try {
      const probe = await this.envProbe.probeDirectory(options.outputDir)
      if (!probe.ok) {
        return failure('PREFLIGHT_FAILED', probe.error!, start)
      }

      await writer.createStagingDir()

      const pkg = build(artifacts, options)
      const results = await this.writeArtifacts(writer, pkg)
      if (!results.success) {
        return failure('SERIALIZATION_FAILED', 'Failed to write artifacts', start)
      }

      const manifest = buildManifest(pkg, results.artifacts)
      const manifestBytes = this.serializer.serialize(manifest)
      await writer.writeFile('manifest.json', manifestBytes)

      const verification = await this.verifier.verify(manifest, writer.stagingDir!)
      if (!verification.ok) {
        return failure('CHECKSUM_MISMATCH', `Verification failed: ${verification.errors[0]}`, start)
      }

      const finalDir = join(options.outputDir, options.campusId)
      const commitPath = await this.committer.commit(writer.stagingDir!, finalDir)

      const totalBytes = results.artifacts.reduce((sum, a) => sum + a.size, 0) + manifestBytes.byteLength

      return {
        success: true,
        path: commitPath,
        artifactCount: results.artifacts.length + 1,
        totalBytes,
        durationMs: Date.now() - start,
        artifacts: results.artifacts,
      } satisfies PublisherReport
    } finally {
      await writer.destroy()
    }
  }

  private async writeArtifacts(
    writer: PackageWriter,
    pkg: BuiltPackage,
  ): Promise<{ success: boolean; artifacts: ArtifactResult[] }> {
    const results: ArtifactResult[] = []

    for (const name of ARTIFACT_NAMES) {
      const data = (pkg as unknown as Record<string, unknown>)[name]
      if (!data) continue

      const bytes = this.serializer.serialize(data)
      const checksum = this.checksum.hash(bytes)
      const path = artifactPath(name)
      const schemaVersion = pkg.schemaVersions[name as keyof typeof pkg.schemaVersions] ?? '1.0.0'

      try {
        await writer.writeFile(path, bytes)
      } catch {
        return { success: false, artifacts: results }
      }

      // P1-T11 (R11.1): every artifact record carries its format version.
      results.push({ name, path, checksum, size: bytes.byteLength, schemaVersion, formatVersion: MANIFEST_FORMAT_VERSION })
    }

    return { success: true, artifacts: results }
  }
}

function failure(code: PublishFailure['code'], message: string, start: number): PublishFailure {
  return { success: false, code, message, durationMs: Date.now() - start }
}
