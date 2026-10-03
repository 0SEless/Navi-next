import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { NavigationPackageManifest, NavigationGraphFile, BuildingIndexFile, POIIndexFile } from './types'
import type { Serializer, ChecksumService } from './interfaces'

export interface VerificationResult {
  ok: boolean
  errors: string[]
}

export class RoundTripVerifier {
  constructor(
    private readonly checksum: ChecksumService,
    private readonly serializer: Serializer,
  ) {}

  async verify(manifest: NavigationPackageManifest, stagingDir: string): Promise<VerificationResult> {
    const errors: string[] = []
    const parsed: Record<string, unknown> = {}

    for (const [name, artifact] of Object.entries(manifest.artifacts)) {
      let bytes: Uint8Array
      try {
        const buffer = await readFile(join(stagingDir, artifact.path))
        bytes = new Uint8Array(buffer)
      } catch {
        errors.push(`Missing file: ${artifact.path}`)
        continue
      }

      const actualChecksum = this.checksum.hash(bytes)
      if (actualChecksum !== artifact.checksum) {
        errors.push(`Checksum mismatch for ${artifact.path}: expected ${artifact.checksum}, got ${actualChecksum}`)
        continue
      }

      try {
        parsed[name] = this.serializer.deserialize(bytes)
      } catch {
        errors.push(`Invalid JSON in ${artifact.path}`)
      }
    }

    const graph = parsed['graph'] as NavigationGraphFile | undefined
    if (graph) {
      const nodeIds = new Set(graph.nodes.map(n => n.id))

      for (const edge of graph.edges) {
        if (!nodeIds.has(edge.from)) {
          errors.push(`Edge ${edge.id} references unknown node: ${edge.from}`)
        }
        if (!nodeIds.has(edge.to)) {
          errors.push(`Edge ${edge.id} references unknown node: ${edge.to}`)
        }
      }
    }

    // Published packages key this artifact `buildings` (see ARTIFACT_NAMES in
    // publisher.ts). The verifier parses `manifest.artifacts` entries, so the
    // lookup must use the published key — `building` was always undefined and
    // this entrance-integrity block never executed against real packages.
    const building = parsed['buildings'] as BuildingIndexFile | undefined
    if (building && graph) {
      const nodeIds = new Set(graph.nodes.map(n => n.id))
      for (const b of building.buildings) {
        for (const ent of b.entrances) {
          if (!nodeIds.has(ent.nodeId)) {
            errors.push(`Building ${b.id} entrance ${ent.id} references unknown node: ${ent.nodeId}`)
          }
        }
      }
    }

    const poi = parsed['poi'] as POIIndexFile | undefined
    if (poi && graph) {
      const nodeIds = new Set(graph.nodes.map(n => n.id))
      for (const p of poi.points) {
        if (!p.nodeId && p.source === 'authored') continue
        if (!nodeIds.has(p.nodeId ?? '')) {
          errors.push(`POI ${p.id} references unknown node: ${p.nodeId ?? ''}`)
        }
      }
    }

    return { ok: errors.length === 0, errors }
  }
}
