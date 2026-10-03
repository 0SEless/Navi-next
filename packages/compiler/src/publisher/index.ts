import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'
import type { CampusDocument, NavigationPackageManifest } from '@navi/core'
import { MANIFEST_SCHEMA_VERSION, MANIFEST_FORMAT_VERSION } from '@navi/core'
import type { CompileResult } from '../types'
import { generateArtifacts } from '../artifacts'

function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex')
}

export interface PublisherOptions {
  outDir: string
  compilerVersion?: string
}

export function publish(campus: CampusDocument, result: CompileResult, options: PublisherOptions): NavigationPackageManifest {
  const { outDir, compilerVersion = '0.1.0' } = options

  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })

  const extraction = result.extraction ?? { spaces: [], transitions: [], corridors: [], duration: 0 }
  const artifacts = generateArtifacts(campus, extraction)

  const files: Record<string, string> = {
    'navigation.graph.json': JSON.stringify(artifacts.navigationGraph, null, 2),
    'search.index.json': JSON.stringify(artifacts.searchIndex, null, 2),
    'poi.json': JSON.stringify(artifacts.poiData, null, 2),
    'building-index.json': JSON.stringify(artifacts.buildingIndex, null, 2),
  }

  for (const [filename, content] of Object.entries(files)) {
    writeFileSync(join(outDir, filename), content)
  }

  const manifest: NavigationPackageManifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    formatVersion: MANIFEST_FORMAT_VERSION,
    campusId: campus.metadata.campusId,
    campusName: campus.metadata.name,
    publishedAt: new Date().toISOString(),
    compilerVersion,
    revision: '1',
    artifacts: {
      graph: { path: 'navigation.graph.json', checksum: sha256(files['navigation.graph.json']), size: Buffer.byteLength(files['navigation.graph.json'], 'utf-8'), schemaVersion: MANIFEST_SCHEMA_VERSION, formatVersion: MANIFEST_FORMAT_VERSION },
      search: { path: 'search.index.json', checksum: sha256(files['search.index.json']), size: Buffer.byteLength(files['search.index.json'], 'utf-8'), schemaVersion: MANIFEST_SCHEMA_VERSION, formatVersion: MANIFEST_FORMAT_VERSION },
      buildings: { path: 'building-index.json', checksum: sha256(files['building-index.json']), size: Buffer.byteLength(files['building-index.json'], 'utf-8'), schemaVersion: MANIFEST_SCHEMA_VERSION, formatVersion: MANIFEST_FORMAT_VERSION },
      poi: { path: 'poi.json', checksum: sha256(files['poi.json']), size: Buffer.byteLength(files['poi.json'], 'utf-8'), schemaVersion: MANIFEST_SCHEMA_VERSION, formatVersion: MANIFEST_FORMAT_VERSION },
    },
    metadata: {
      nodeCount: result.graph.nodes.length,
      edgeCount: result.graph.edges.length,
      buildingCount: campus.buildings.length,
      floorCount: campus.buildings.reduce((s, b) => s + b.floors.length, 0),
      boundingBox: result.graph.metadata.boundingBox,
      routeable: result.graph.edges.length > 0,
    },
  }

  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2))

  return manifest
}
