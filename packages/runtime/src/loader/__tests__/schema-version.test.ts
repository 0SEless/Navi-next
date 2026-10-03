import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { load } from '../loader'
import type { LoadErrorCode } from '../types'

// P1-T11 (R11.2): versioned manifest compatibility rule â€” consumers accept
// the same major schemaVersion; formatVersion covers minor evolutions.

function sha256Hex(data: string): string {
  return createHash('sha256').update(data).digest('hex')
}

const graphFile = {
  schemaVersion: '1.0.0',
  campusId: 'test-campus',
  checksum: 'g',
  nodes: [{ id: 'n1', label: 'N1', type: 'waypoint', lat: 14.5, lng: 121.0, floor: 0, buildingId: 'b1' }],
  edges: [],
}

interface ManifestLike {
  schemaVersion?: string
  formatVersion?: string
  campusId: string
  campusName: string
  publishedAt: string
  compilerVersion: string
  revision: string
  artifacts: Record<string, { path: string; checksum: string; size: number; schemaVersion: string; formatVersion?: string }>
  metadata: Record<string, unknown>
}

function buildBundle(manifest: ManifestLike): string {
  const dir = mkdtempSync(join(tmpdir(), 'navi-schema-'))
  mkdirSync(join(dir, 'test-campus'), { recursive: true })
  const base = join(dir, 'test-campus')
  const graphBytes = JSON.stringify(graphFile)
  writeFileSync(join(base, 'manifest.json'), JSON.stringify(manifest))
  writeFileSync(join(base, 'graph.json'), graphBytes)
  return join(dir, 'test-campus')
}

function baseManifest(): ManifestLike {
  const graphBytes = JSON.stringify(graphFile)
  return {
    schemaVersion: '1.0.0',
    formatVersion: '0',
    campusId: 'test-campus',
    campusName: 'Test',
    publishedAt: '2026-07-17T00:00:00Z',
    compilerVersion: '0.1.0',
    revision: '1',
    artifacts: {
      graph: { path: 'graph.json', checksum: sha256Hex(graphBytes), size: graphBytes.length, schemaVersion: '1.0.0', formatVersion: '0' },
    },
    metadata: {
      nodeCount: 1, edgeCount: 0, buildingCount: 1, floorCount: 1,
      boundingBox: { minLat: 14.5, maxLat: 14.5, minLng: 121.0, maxLng: 121.0 },
      routeable: true,
    },
  }
}

const cleanup: string[] = []

describe('P1-T11: manifest version compatibility (R11.2)', () => {
  afterAll(() => {
    for (const dir of cleanup) rmSync(dir, { recursive: true, force: true })
  })

  it('rejects an unsupported major schemaVersion with a clear, actionable error', async () => {
    const manifest = baseManifest()
    manifest.schemaVersion = '2.0.0'
    const dir = buildBundle(manifest)
    cleanup.push(dir)

    const result = await load(dir)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.code).toBe('UNSUPPORTED_SCHEMA_VERSION')
      expect(result.message).toMatch(/schemaVersion/i)
      expect(result.message).toMatch(/supported major/i) // actionable: names the supported major
    }
  })

  it('loads a same-major manifest with differing formatVersion and reports a warning (documented behavior)', async () => {
    const manifest = baseManifest()
    manifest.formatVersion = '9'
    const dir = buildBundle(manifest)
    cleanup.push(dir)

    const result = await load(dir)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.package.warnings.length).toBeGreaterThan(0)
      expect(result.package.warnings.some(w => /formatVersion/i.test(w))).toBe(true)
      expect(result.package.graph.nodes.length).toBe(1)
    }
  })

  it('loads a legacy manifest without version fields (documented tolerance)', async () => {
    const manifest = baseManifest()
    delete manifest.schemaVersion
    delete manifest.formatVersion
    const dir = buildBundle(manifest)
    cleanup.push(dir)

    const result = await load(dir)
    expect(result.success).toBe(true)
    if (result.success) {
      // Legacy assumed major 1 â€” no warnings for missing fields
      expect(result.package.warnings).toEqual([])
      expect(result.package.graph.nodes).toHaveLength(1)
    }
  })
})

describe('P1-T11: loader error code surface', () => {
  it('exposes UNSUPPORTED_SCHEMA_VERSION in the LoadErrorCode union', () => {
    const code: LoadErrorCode = 'UNSUPPORTED_SCHEMA_VERSION'
    expect(code).toBe('UNSUPPORTED_SCHEMA_VERSION')
  })
})