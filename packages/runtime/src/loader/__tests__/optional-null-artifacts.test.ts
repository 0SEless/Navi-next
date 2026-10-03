// T2 (Phase 3): runtime tolerance for the `null` optional-artifact contract.
//
// POST /api/publish writes demo-output packages where every optional
// artifact the client omitted is a literal 4-byte `null` document listed
// in manifest.json with a checksum over those exact bytes, while
// @navi/publisher packages simply omit absent optional artifacts. Both
// representations MUST converge: the package loads successfully, real
// artifacts hydrate, and absent/null optional artifacts bind to
// `undefined` — `null` is an absence marker, never package corruption.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { load } from '../loader'
import type { NavigationPackageManifest } from '@navi/core'

function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

const graphFile = {
  schemaVersion: '1.0.0',
  campusId: 'test-campus',
  checksum: 'g',
  nodes: [{ id: 'n1', label: 'N1', type: 'waypoint', lat: 14.5, lng: 121.0, floor: 0, buildingId: 'b1' }],
  edges: [],
}

const NULL_DOC = 'null'

type ArtifactEntry = {
  path: string
  checksum: string
  size: number
  schemaVersion: string
  formatVersion?: string
}

function graphBytes(): string {
  return JSON.stringify(graphFile)
}

function nullEntry(path: string): ArtifactEntry {
  return {
    path,
    checksum: sha256Hex(NULL_DOC),
    size: NULL_DOC.length,
    schemaVersion: '1.0.0',
    formatVersion: '0',
  }
}

function graphEntry(): ArtifactEntry {
  return {
    path: 'graph.json',
    checksum: sha256Hex(graphBytes()),
    size: graphBytes().length,
    schemaVersion: '1.0.0',
    formatVersion: '0',
  }
}

function makeManifest(
  campusDir: string,
  artifacts: Record<string, ArtifactEntry>,
): NavigationPackageManifest {
  return {
    schemaVersion: '1.0.0',
    formatVersion: '0',
    campusId: campusDir,
    campusName: 'Test',
    publishedAt: '2026-07-17T00:00:00Z',
    compilerVersion: '0.1.0',
    revision: '1',
    artifacts,
    metadata: {
      nodeCount: 1,
      edgeCount: 0,
      buildingCount: 1,
      floorCount: 1,
      boundingBox: { minLat: 14.5, maxLat: 14.5, minLng: 121.0, maxLng: 121.0 },
      routeable: true,
    },
  } as NavigationPackageManifest
}

describe('Optional-artifact `null` documents — runtime loader tolerance (T2)', () => {
  let root: string

  // Route-style package: manifest lists ALL artifacts; every optional one
  // is a literal `null` document (spatial is an unknown key by design).
  const nullStyleDir = 'route-null-style'
  const nullArtifacts: Record<string, ArtifactEntry> = {
    graph: graphEntry(),
    search: nullEntry('search.json'),
    poi: nullEntry('poi.json'),
    buildings: nullEntry('buildings.json'),
    panorama: nullEntry('panorama.json'),
    floorGeometry: nullEntry('floor-geometry.json'),
    qrIndex: nullEntry('qr-index.json'),
    spatial: nullEntry('spatial.json'),
  }

  // Publisher-style package: absent optional artifacts are omitted from
  // the manifest entirely.
  const absentStyleDir = 'publisher-absent-style'
  const absentArtifacts: Record<string, ArtifactEntry> = {
    graph: graphEntry(),
  }

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'navi-null-absent-'))

    mkdirSync(join(root, nullStyleDir), { recursive: true })
    writeFileSync(
      join(root, nullStyleDir, 'manifest.json'),
      JSON.stringify(makeManifest(nullStyleDir, nullArtifacts)),
    )
    writeFileSync(join(root, nullStyleDir, 'graph.json'), graphBytes())
    for (const [key, entry] of Object.entries(nullArtifacts)) {
      if (key === 'graph') continue
      writeFileSync(join(root, nullStyleDir, entry.path), NULL_DOC)
    }

    mkdirSync(join(root, absentStyleDir), { recursive: true })
    writeFileSync(
      join(root, absentStyleDir, 'manifest.json'),
      JSON.stringify(makeManifest(absentStyleDir, absentArtifacts)),
    )
    writeFileSync(join(root, absentStyleDir, 'graph.json'), graphBytes())
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('loads a package whose optional artifacts are literal `null` documents', async () => {
    const result = await load(join(root, nullStyleDir))

    // `null` is an absence marker — it must not fail the package load.
    expect(result.success).toBe(true)
    if (!result.success) return

    // Real artifacts hydrate.
    expect(result.package.graph.nodes).toHaveLength(1)

    // Null optional artifacts bind to `undefined` (feature unavailable).
    expect(result.package.searchIndex).toBeUndefined()
    expect(result.package.buildingIndex).toBeUndefined()
    expect(result.package.poiIndex).toBeUndefined()
    expect(result.package.panoramaIndex).toBeUndefined()
    expect(result.package.qrIndex).toBeUndefined()
    expect(result.package.floorGeometry).toBeUndefined()

    // Per-artifact reports keep an accurate signal: `null` content fails
    // schema hydration (it is not a JSON object), unknown keys are
    // skipped, and neither poisons the package.
    const byType = new Map(
      result.package.reports.map(r => [r.artifactType, r]),
    )
    expect(byType.get('graph')!.status).toBe('LOADED')
    for (const type of ['search', 'poi', 'buildings', 'panorama', 'floorGeometry', 'qrIndex']) {
      const report = byType.get(type)!
      expect(report.status, `${type} report status`).toBe('FAILED')
      expect((report as { code?: string }).code).toBe('INVALID_SCHEMA')
    }
    expect(byType.get('spatial')!.status).toBe('SKIPPED')
  })

  it('loads a publisher-style package with absent optional artifacts identically', async () => {
    const result = await load(join(root, absentStyleDir))

    expect(result.success).toBe(true)
    if (!result.success) return

    // Same outcome as the null-style package: bindings all undefined.
    expect(result.package.graph.nodes).toHaveLength(1)
    expect(result.package.searchIndex).toBeUndefined()
    expect(result.package.buildingIndex).toBeUndefined()
    expect(result.package.poiIndex).toBeUndefined()
    expect(result.package.panoramaIndex).toBeUndefined()
    expect(result.package.qrIndex).toBeUndefined()
    expect(result.package.floorGeometry).toBeUndefined()

    // Difference is only in reporting: absent artifacts are not in the
    // manifest, so they produce no reports at all.
    const artifactTypes = result.package.reports.map(r => r.artifactType)
    expect(artifactTypes).toEqual(['graph'])
  })
})
