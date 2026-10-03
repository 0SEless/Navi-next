import { describe, it, expect } from 'vitest'
import { buildManifest } from '../manifest-builder'
import type { BuiltPackage } from '../types'

const samplePkg: BuiltPackage = {
  campusId: 'campus-1',
  campusName: 'Test Campus',
  publishedAt: '2026-07-17T12:00:00Z',
  compilerVersion: '1.2.3',
  revision: 'abc123',
  metadata: {
    nodeCount: 100,
    edgeCount: 250,
    buildingCount: 3,
    floorCount: 8,
    boundingBox: { minLat: 14.5, maxLat: 14.6, minLng: 121.0, maxLng: 121.1 },
    routeable: true,
  },
  graph: null as unknown as BuiltPackage['graph'],
  schemaVersions: { graph: '1.0.0', search: '1.0.0', spatial: '1.0.0', buildings: '1.0.0', poi: '1.0.0', panorama: '1.0.0', floorGeometry: '1.0.0', qrIndex: '1.0.0' },
}

describe('ManifestBuilder', () => {
  it('builds a manifest from BuiltPackage and artifact records', () => {
    const artifacts = [
      { name: 'graph', path: 'graph.json', checksum: 'aaa', size: 100, schemaVersion: '1.0.0', formatVersion: '0' },
      { name: 'search', path: 'search.json', checksum: 'bbb', size: 50, schemaVersion: '1.0.0', formatVersion: '0' },
    ]

    const manifest = buildManifest(samplePkg, artifacts)

    expect(manifest.campusId).toBe('campus-1')
    expect(manifest.campusName).toBe('Test Campus')
    expect(manifest.publishedAt).toBe('2026-07-17T12:00:00Z')
    expect(manifest.compilerVersion).toBe('1.2.3')
    expect(manifest.revision).toBe('abc123')
    expect(manifest.schemaVersion).toBe('1.0.0')
  })

  it('requires BOTH version fields and lists each artifact with its version (R11.1)', () => {
    const artifacts = [
      { name: 'graph', path: 'graph.json', checksum: 'aaa', size: 100, schemaVersion: '1.0.0', formatVersion: '3' },
      { name: 'floorGeometry', path: 'floor-geometry.json', checksum: 'ccc', size: 42, schemaVersion: '1.0.0', formatVersion: '0' },
    ]

    const manifest = buildManifest(samplePkg, artifacts)

    expect(manifest.schemaVersion).toBe('1.0.0')
    expect(manifest.formatVersion).toBe('0')
    expect(manifest.artifacts['graph']).toEqual({ path: 'graph.json', checksum: 'aaa', size: 100, schemaVersion: '1.0.0', formatVersion: '3' })
    expect(manifest.artifacts['floorGeometry']).toEqual({ path: 'floor-geometry.json', checksum: 'ccc', size: 42, schemaVersion: '1.0.0', formatVersion: '0' })
  })

  it('maps artifact records to the manifest artifacts record', () => {
    const artifacts = [
      { name: 'graph', path: 'graph.json', checksum: 'aaa', size: 100, schemaVersion: '1.0.0', formatVersion: '0' },
      { name: 'search', path: 'search.json', checksum: 'bbb', size: 50, schemaVersion: '1.0.0', formatVersion: '0' },
    ]

    const manifest = buildManifest(samplePkg, artifacts)

    expect(Object.keys(manifest.artifacts)).toEqual(['graph', 'search'])
    expect(manifest.artifacts['graph']).toEqual({ path: 'graph.json', checksum: 'aaa', size: 100, schemaVersion: '1.0.0', formatVersion: '0' })
    expect(manifest.artifacts['search']).toEqual({ path: 'search.json', checksum: 'bbb', size: 50, schemaVersion: '1.0.0', formatVersion: '0' })
  })

  it('copies metadata from BuiltPackage', () => {
    const manifest = buildManifest(samplePkg, [])

    expect(manifest.metadata).toEqual(samplePkg.metadata)
    expect(manifest.metadata).not.toBe(samplePkg.metadata)
  })

  it('handles empty artifact list', () => {
    const manifest = buildManifest(samplePkg, [])

    expect(manifest.artifacts).toEqual({})
  })

  it('is pure â€” does not mutate inputs', () => {
    const artifacts = [
      { name: 'graph', path: 'graph.json', checksum: 'aaa', size: 100, schemaVersion: '1.0.0', formatVersion: '0' },
    ]
    const pkg = { ...samplePkg }

    buildManifest(pkg, artifacts)

    expect(artifacts[0].name).toBe('graph')
    expect(pkg.campusId).toBe('campus-1')
  })
})
