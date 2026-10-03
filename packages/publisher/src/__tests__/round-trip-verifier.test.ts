import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { serialize } from '../serializer'
import { hash } from '../checksum'
import { RoundTripVerifier } from '../round-trip-verifier'
import type { NavigationPackageManifest, NavigationGraphFile, BuildingIndexFile, POIIndexFile } from '../types'

describe('RoundTripVerifier', () => {
  let stagingDir: string
  let verifier: RoundTripVerifier

  const manifest: NavigationPackageManifest = {
    schemaVersion: '1.0.0',
  formatVersion: '0',
    campusId: 'campus-1',
    campusName: 'Test',
    publishedAt: '2026-07-17T12:00:00Z',
    compilerVersion: '1.0.0',
    revision: 'abc',
    artifacts: {
      graph: { path: 'graph.json', checksum: '', size: 0, schemaVersion: '1.0.0', formatVersion: '0' },
      buildings: { path: 'buildings.json', checksum: '', size: 0, schemaVersion: '1.0.0', formatVersion: '0' },
      poi: { path: 'poi.json', checksum: '', size: 0, schemaVersion: '1.0.0', formatVersion: '0' },
    },
    metadata: {
      nodeCount: 3, edgeCount: 2, buildingCount: 1, floorCount: 2,
      boundingBox: { minLat: 0, maxLat: 1, minLng: 0, maxLng: 1 },
      routeable: true,
    },
  }

  const graphFile: NavigationGraphFile = {
    schemaVersion: '1.0.0',
    campusId: 'campus-1',
    checksum: '',
    nodes: [
      { id: 'n1', type: 'waypoint', lat: 0, lng: 0, floor: 0, buildingId: 'b1' },
      { id: 'n2', type: 'waypoint', lat: 1, lng: 1, floor: 0, buildingId: 'b1' },
      { id: 'n3', type: 'entrance', lat: 0.5, lng: 0.5, floor: 0, buildingId: 'b1' },
    ],
    edges: [
      { id: 'e1', from: 'n1', to: 'n2', type: 'walk', distance: 100, weight: 100 },
      { id: 'e2', from: 'n2', to: 'n3', type: 'walk', distance: 50, weight: 50 },
    ],
  }

  const buildingFile: BuildingIndexFile = {
    schemaVersion: '1.0.0',
    buildings: [{
      id: 'b1', name: 'Building One', code: 'B1',
      position: { lat: 0, lng: 0 },
      floors: [{ level: 0, label: 'G', elevation: 0, nodeIds: ['n1', 'n2', 'n3'] }],
      entrances: [{ id: 'ent-1', label: 'Main', nodeId: 'n3' }],
    }],
  }

  const poiFile: POIIndexFile = {
    schemaVersion: '1.0.0',
    points: [{ id: 'poi-1', label: 'Cafe', category: 'food', lat: 0.5, lng: 0.5, nodeId: 'n2', floor: 0, properties: {} }],
  }

  beforeEach(async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'rtv-test-'))
    stagingDir = join(tmp, 'staging')
    await mkdir(stagingDir, { recursive: true })
    verifier = new RoundTripVerifier({ hash, hashFile: async () => '' }, { serialize, deserialize: <T>(b: Uint8Array) => JSON.parse(new TextDecoder().decode(b)) as T })
  })

  afterEach(() => {
    rmSync(stagingDir, { recursive: true, force: true })
  })

  async function writeWithChecksum(name: string, data: object): Promise<void> {
    const bytes = serialize(data)
    const checksum = hash(bytes)
    manifest.artifacts[name]!.checksum = checksum
    manifest.artifacts[name]!.size = bytes.byteLength
    writeFileSync(join(stagingDir, manifest.artifacts[name]!.path), bytes)
  }

  it('passes for a valid package', async () => {
    await writeWithChecksum('graph', graphFile)
    await writeWithChecksum('buildings', buildingFile)
    await writeWithChecksum('poi', poiFile)

    const result = await verifier.verify(manifest, stagingDir)
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('reports missing files', async () => {
    const result = await verifier.verify(manifest, stagingDir)
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => e.includes('Missing file'))).toBe(true)
  })

  it('reports checksum mismatch', async () => {
    const bytes = serialize(graphFile)
    writeFileSync(join(stagingDir, 'graph.json'), bytes)
    manifest.artifacts['graph']!.checksum = 'wrong-checksum'

    const result = await verifier.verify(manifest, stagingDir)
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => e.includes('Checksum mismatch'))).toBe(true)
  })

  it('reports invalid JSON', async () => {
    writeFileSync(join(stagingDir, 'graph.json'), new TextEncoder().encode('not-json'))
    manifest.artifacts['graph']!.checksum = hash(new TextEncoder().encode('not-json'))

    const result = await verifier.verify(manifest, stagingDir)
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => e.includes('Invalid JSON'))).toBe(true)
  })

  it('reports edges referencing unknown nodes', async () => {
    const badGraph = {
      ...graphFile,
      edges: [{ id: 'e1', from: 'n1', to: 'nonexistent', type: 'walk' as const, distance: 100, weight: 100 }],
    }
    await writeWithChecksum('graph', badGraph)
    await writeWithChecksum('buildings', buildingFile)
    await writeWithChecksum('poi', poiFile)

    const result = await verifier.verify(manifest, stagingDir)
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => e.includes('unknown node') && e.includes('nonexistent'))).toBe(true)
  })

  it('reports entrance references to unknown nodes', async () => {
    await writeWithChecksum('graph', graphFile)
    const badBuilding = {
      ...buildingFile,
      buildings: [{
        ...buildingFile.buildings[0]!,
        entrances: [{ id: 'bad-ent', label: 'Bad', nodeId: 'no-such-node' }],
      }],
    }
    await writeWithChecksum('buildings', badBuilding)
    await writeWithChecksum('poi', poiFile)

    const result = await verifier.verify(manifest, stagingDir)
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => e.includes('unknown node') && e.includes('no-such-node'))).toBe(true)
  })

  it('reports POI references to unknown nodes', async () => {
    await writeWithChecksum('graph', graphFile)
    await writeWithChecksum('buildings', buildingFile)

    const badPoi = {
      ...poiFile,
      points: [{ id: 'bad-poi', label: 'Nowhere', category: 'x', lat: 0, lng: 0, nodeId: 'ghost', floor: 0, properties: {} }],
    }
    await writeWithChecksum('poi', badPoi)

    const result = await verifier.verify(manifest, stagingDir)
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => e.includes('unknown node') && e.includes('ghost'))).toBe(true)
  })

  it('accepts authored POIs without a navigation node reference', async () => {
    await writeWithChecksum('graph', graphFile)
    await writeWithChecksum('buildings', buildingFile)

    const authoredPoi = {
      schemaVersion: '1.0.0',
      points: [{
        id: 'authored-poi',
        label: 'Authored POI',
        category: 'food',
        lat: 0.25,
        lng: 0.25,
        source: 'authored',
        sourceId: 'authored-poi',
        floorId: 'f1',
        geometry: { type: 'point', position: { lat: 0.25, lng: 0.25 } },
        properties: { owner: 'studio' },
      }],
    } as unknown as POIIndexFile
    await writeWithChecksum('poi', authoredPoi)

    const result = await verifier.verify(manifest, stagingDir)
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('accumulates multiple errors', async () => {
    const result = await verifier.verify(manifest, stagingDir)
    expect(result.ok).toBe(false)
    expect(result.errors.length).toBeGreaterThanOrEqual(3)
  })

  it('succeeds when manifest has no artifacts', async () => {
    const empty: NavigationPackageManifest = {
      schemaVersion: '1.0.0',
  formatVersion: '0',
      campusId: 'campus-1',
      campusName: 'Test',
      publishedAt: '',
      compilerVersion: '',
      revision: '',
      artifacts: {},
      metadata: { nodeCount: 0, edgeCount: 0, buildingCount: 0, floorCount: 0, boundingBox: { minLat: 0, maxLat: 0, minLng: 0, maxLng: 0 }, routeable: false },
    }
    const result = await verifier.verify(empty, stagingDir)
    expect(result.ok).toBe(true)
  })
})

// ── Regression: published packages key the building index `buildings`
// (ARTIFACT_NAMES in publisher.ts); a legacy `building` lookup is dead code.
describe('RoundTripVerifier — published `buildings` key contract', () => {
  let stagingDir: string
  let verifier: RoundTripVerifier

  const graph: NavigationGraphFile = {
    schemaVersion: '1.0.0',
    campusId: 'campus-1',
    checksum: '',
    nodes: [
      { id: 'n1', type: 'waypoint', lat: 0, lng: 0, floor: 0, buildingId: 'b1' },
      { id: 'n3', type: 'entrance', lat: 0.5, lng: 0.5, floor: 0, buildingId: 'b1' },
    ],
    edges: [{ id: 'e1', from: 'n1', to: 'n3', type: 'walk', distance: 50, weight: 50 }],
  }

  const brokenBuilding: BuildingIndexFile = {
    schemaVersion: '1.0.0',
    buildings: [{
      id: 'b1', name: 'Building One', code: 'B1',
      position: { lat: 0, lng: 0 },
      floors: [{ level: 0, label: 'G', elevation: 0, nodeIds: ['n1', 'n3'] }],
      entrances: [{ id: 'bad-ent', label: 'Bad', nodeId: 'no-such-node' }],
    }],
  }

  function makeManifest(
    artifacts: NavigationPackageManifest['artifacts'],
  ): NavigationPackageManifest {
    return {
      schemaVersion: '1.0.0',
      formatVersion: '0',
      campusId: 'campus-1',
      campusName: 'Test',
      publishedAt: '2026-07-17T12:00:00Z',
      compilerVersion: '1.0.0',
      revision: '1',
      artifacts,
      metadata: {
        nodeCount: 2, edgeCount: 1, buildingCount: 1, floorCount: 1,
        boundingBox: { minLat: 0, maxLat: 1, minLng: 0, maxLng: 1 },
        routeable: true,
      },
    }
  }

  async function stage(
    manifest: NavigationPackageManifest,
    entries: Array<[string, object]>,
  ): Promise<void> {
    for (const [name, data] of entries) {
      const bytes = serialize(data)
      writeFileSync(join(stagingDir, manifest.artifacts[name]!.path), bytes)
      manifest.artifacts[name]!.checksum = hash(bytes)
      manifest.artifacts[name]!.size = bytes.byteLength
    }
  }

  function artifact(path: string): NavigationPackageManifest['artifacts'][string] {
    return { path, checksum: '', size: 0, schemaVersion: '1.0.0', formatVersion: '0' }
  }

  beforeEach(async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'rtv-key-'))
    stagingDir = join(tmp, 'staging')
    await mkdir(stagingDir, { recursive: true })
    verifier = new RoundTripVerifier(
      { hash, hashFile: async () => '' },
      { serialize, deserialize: <T>(b: Uint8Array) => JSON.parse(new TextDecoder().decode(b)) as T },
    )
  })

  afterEach(() => {
    rmSync(stagingDir, { recursive: true, force: true })
  })

  it('runs entrance-integrity against the published `buildings` key', async () => {
    const manifest = makeManifest({
      graph: artifact('graph.json'),
      buildings: artifact('buildings.json'),
    })
    // No legacy `building` key exists anywhere in a published package.
    expect(manifest.artifacts['buildings']).toBeDefined()
    expect(manifest.artifacts['building']).toBeUndefined()

    await stage(manifest, [
      ['graph', graph],
      ['buildings', brokenBuilding],
    ])

    const result = await verifier.verify(manifest, stagingDir)

    // The entrance check must actually run (old `building` lookup never did).
    expect(result.ok).toBe(false)
    expect(
      result.errors.some(
        e =>
          e.includes('Building b1 entrance bad-ent') &&
          e.includes('no-such-node'),
      ),
    ).toBe(true)
  })

  it('does not fall back to the legacy `building` key (no alias)', async () => {
    const manifest = makeManifest({
      graph: artifact('graph.json'),
      building: artifact('building.json'),
    })

    await stage(manifest, [
      ['graph', graph],
      ['building', brokenBuilding],
    ])

    const result = await verifier.verify(manifest, stagingDir)

    // A stray `building` key is an unrecognized artifact: checksum-only.
    // Entrance-integrity must NOT consult it (that would be an alias).
    expect(
      result.errors.some(e => e.includes('Building b1 entrance')),
    ).toBe(false)
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })
})
