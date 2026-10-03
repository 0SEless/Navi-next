import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, existsSync, rmSync, readFileSync } from 'node:fs'
import { mkdir, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { NavigationArtifacts } from '@navi/core'
import { Publisher } from '../publisher'
import { serialize } from '../serializer'
import { hash, hashFile } from '../checksum'
import { EnvironmentProbe } from '../environment'
import { RoundTripVerifier } from '../round-trip-verifier'
import { RenameCommitter } from '../committer'
import type { IEnvironmentProbe, ICommitter } from '../interfaces'
import type { PublishFailure, PublisherReport, NavigationGraphFile, SearchIndexFile, BuildingIndexFile, NavigationPackageManifest } from '../types'

function makeArtifacts(overrides?: Partial<NavigationArtifacts>): NavigationArtifacts {
  return {
    graph: {
      version: '1.0.0',
      campusId: 'campus-1',
      createdAt: '2026-07-17T00:00:00Z',
      checksum: 'abc123',
      nodes: [
        { id: 'n1', label: 'Node 1', type: 'waypoint', position: { lat: 14.5, lng: 121.0 }, floor: 0, buildingId: 'b1', properties: {} },
        { id: 'n2', label: 'Node 2', type: 'poi', position: { lat: 14.6, lng: 121.1 }, floor: 1, buildingId: 'b1', properties: {} },
        { id: 'n3', label: 'Main Entrance', type: 'entrance', position: { lat: 14.5, lng: 121.0 }, floor: 0, buildingId: 'b1', properties: {} },
      ],
      edges: [
        { id: 'e1', from: 'n1', to: 'n2', type: 'walk', distance: 100, weight: 100 },
      ],
      metadata: {
        nodeCount: 3,
        edgeCount: 1,
        buildings: 1,
        floors: 2,
        boundingBox: { minLat: 14.5, maxLat: 14.6, minLng: 121.0, maxLng: 121.1 },
      },
    },
    searchIndex: {
      version: '1.0.0',
      entries: [
        { id: 's1', label: 'Building 1', type: 'building', nodeId: 'n1', position: { lat: 14.5, lng: 121.0 }, tags: ['b1'], buildingId: 'b1', floor: 0 },
      ],
    },
    spatialIndex: undefined as unknown as NavigationArtifacts['spatialIndex'],
    buildingIndex: {
      version: '1.0.0',
      buildings: [{
        id: 'b1', name: 'Building One', code: 'B1', category: 'academic',
        position: { lat: 14.5, lng: 121.0 }, nodeId: 'n1',
        floors: [{ level: 0, label: 'Ground', elevation: 0, rooms: [] }],
        entrances: [{ id: 'ent-1', label: 'Main Entrance', position: { lat: 14.5, lng: 121.0 } }],
      }],
    },
    poiIndex: undefined as unknown as NavigationArtifacts['poiIndex'],
    metadata: undefined as unknown as NavigationArtifacts['metadata'],
    extensions: {},
    ...overrides,
  }
}

function sortedKeys(o: Record<string, unknown>): string[] {
  return Object.keys(o).sort()
}

describe('Publisher', () => {
  let outputDir: string
  let publisher: Publisher

  const opts = {
    campusId: 'campus-1',
    campusName: 'Test Campus',
    outputDir: '', // set in beforeEach
    publishedAt: '2026-07-17T12:00:00Z',
  }

  beforeEach(() => {
    outputDir = mkdtempSync(join(tmpdir(), 'publisher-test-'))
    opts.outputDir = outputDir

    const verifier = new RoundTripVerifier(
      { hash, hashFile },
      { serialize, deserialize: <T>(b: Uint8Array) => JSON.parse(new TextDecoder().decode(b)) as T },
    )

    publisher = new Publisher(
      { serialize, deserialize: <T>(b: Uint8Array) => JSON.parse(new TextDecoder().decode(b)) as T },
      { hash, hashFile },
      new EnvironmentProbe(),
      verifier,
      new RenameCommitter(),
    )
  })

  afterEach(() => {
    if (existsSync(outputDir)) {
      rmSync(outputDir, { recursive: true, force: true })
    }
  })

  describe('publish', () => {
    it('returns a successful PublisherReport for valid artifacts', async () => {
      const result = await publisher.publish(makeArtifacts(), opts)

      expect(result.success).toBe(true)
      if (!result.success) return

      expect(result.path).toBe(join(outputDir, 'campus-1'))
      expect(result.artifactCount).toBeGreaterThanOrEqual(4) // graph + search + building + manifest
      expect(result.totalBytes).toBeGreaterThan(0)
      expect(result.durationMs).toBeGreaterThanOrEqual(0)
      expect(result.artifacts.length).toBeGreaterThanOrEqual(3)
    })

    it('writes files to the final directory', async () => {
      const result = await publisher.publish(makeArtifacts(), opts)
      expect(result.success).toBe(true)

      const finalDir = join(outputDir, 'campus-1')
      expect(existsSync(join(finalDir, 'graph.json'))).toBe(true)
      expect(existsSync(join(finalDir, 'search.json'))).toBe(true)
      expect(existsSync(join(finalDir, 'buildings.json'))).toBe(true)
      expect(existsSync(join(finalDir, 'manifest.json'))).toBe(true)
    })

    it('returns PublishFailure for non-existent output directory', async () => {
      const result = await publisher.publish(makeArtifacts(), { ...opts, outputDir: join(outputDir, 'does-not-exist') })
      expect(result.success).toBe(false)
    })

    it('cleans up staging directory on failure', async () => {
      const result = await publisher.publish(makeArtifacts(), { ...opts, outputDir: join(outputDir, 'does-not-exist') })
      expect(result.success).toBe(false)

      // No .staging- directories should remain
      const entries = (await import('node:fs/promises')).readdir
      const files = await entries(outputDir)
      expect(files.some(f => f.startsWith('.staging-'))).toBe(false)
    })

    it('cleans up staging directory on success', async () => {
      const result = await publisher.publish(makeArtifacts(), opts)
      expect(result.success).toBe(true)

      const files = await (await import('node:fs/promises')).readdir(outputDir)
      expect(files.some(f => f.startsWith('.staging-'))).toBe(false)
    })
  })

  describe('statelessness', () => {
    it('produces identical results for identical inputs', async () => {
      const arts = makeArtifacts()

      const a = await publisher.publish(arts, opts)
      expect(a.success).toBe(true)

      // Second publish to same campusId would fail because final dir exists
      // So use a different campusId
      const b = await publisher.publish(arts, { ...opts, campusId: 'campus-2' })
      expect(b.success).toBe(true)

      if (!a.success || !b.success) return

      // Same artifact count
      expect(a.artifactCount).toBe(b.artifactCount)
      expect(a.totalBytes).toBe(b.totalBytes)
    })
  })

  describe('failure injection', () => {
    it('handles env probe failure', async () => {
      const failing: IEnvironmentProbe = {
        probeDirectory: async () => ({ ok: false, error: 'injected failure' }),
      }
      const p = new Publisher(
        { serialize, deserialize: <T>(b: Uint8Array) => JSON.parse(new TextDecoder().decode(b)) as T },
        { hash, hashFile: async () => '' },
        failing,
        new RoundTripVerifier(
          { hash, hashFile },
          { serialize, deserialize: <T>(b: Uint8Array) => JSON.parse(new TextDecoder().decode(b)) as T },
        ),
        new RenameCommitter(),
      )

      const result = await p.publish(makeArtifacts(), opts) as PublishFailure
      expect(result.success).toBe(false)
      expect(result.code).toBe('PREFLIGHT_FAILED')
      expect(result.durationMs).toBeGreaterThanOrEqual(0)
    })

    it('handles commit failure', async () => {
      const badCommitter: ICommitter = {
        commit: async () => { throw new Error('commit failed') },
      }
      const p = new Publisher(
        { serialize, deserialize: <T>(b: Uint8Array) => JSON.parse(new TextDecoder().decode(b)) as T },
        { hash, hashFile: async () => '' },
        new EnvironmentProbe(),
        new RoundTripVerifier(
          { hash, hashFile },
          { serialize, deserialize: <T>(b: Uint8Array) => JSON.parse(new TextDecoder().decode(b)) as T },
        ),
        badCommitter,
      )

      await expect(p.publish(makeArtifacts(), opts)).rejects.toThrow('commit failed')
    })
  })

  describe('invariants', () => {
    it('identical artifacts produce identical per-file checksums for campus-independent files', async () => {
      const arts = makeArtifacts()

      const a = await publisher.publish(arts, opts) as PublisherReport
      const b = await publisher.publish(arts, { ...opts, campusId: 'campus-2' }) as PublisherReport

      const aMap = new Map(a.artifacts.map(a => [a.name, a.checksum]))
      const bMap = new Map(b.artifacts.map(a => [a.name, a.checksum]))

      // graph & manifest embed campusId so checksums differ;
      // building & search are campus-independent so must match
      for (const name of ['building', 'search']) {
        expect(aMap.get(name)).toBe(bMap.get(name))
      }
    })

    it('failed publish leaves no final directory at destination', async () => {
      await publisher.publish(makeArtifacts(), { ...opts, outputDir: join(outputDir, 'does-not-exist') })

      const finalDir = join(outputDir, 'does-not-exist', 'campus-1')
      expect(existsSync(finalDir)).toBe(false)
    })

    it('published package can be loaded and parsed from disk', async () => {
      const result = await publisher.publish(makeArtifacts(), opts) as PublisherReport

      const finalDir = result.path
      const manifest: NavigationPackageManifest = JSON.parse(readFileSync(join(finalDir, 'manifest.json'), 'utf-8'))
      const graph: NavigationGraphFile = JSON.parse(readFileSync(join(finalDir, 'graph.json'), 'utf-8'))
      const search: SearchIndexFile = JSON.parse(readFileSync(join(finalDir, 'search.json'), 'utf-8'))
      const building: BuildingIndexFile = JSON.parse(readFileSync(join(finalDir, 'buildings.json'), 'utf-8'))

      expect(manifest.campusId).toBe('campus-1')
      expect(sortedKeys(manifest.artifacts)).toEqual(['buildings', 'graph', 'search'])
      expect(manifest.artifacts.graph.checksum).toHaveLength(64)

      expect(graph.campusId).toBe('campus-1')
      expect(graph.nodes).toHaveLength(3)
      expect(graph.edges).toHaveLength(1)

      expect(search.entries).toHaveLength(1)
      expect(search.entries[0].nodeId).toBe('n1')

      expect(building.buildings).toHaveLength(1)
      expect(building.buildings[0].entrances[0].nodeId).toBe('n3')
      expect(building.buildings[0].floors[0].nodeIds).toEqual(['n1', 'n3'])
    })
  })
})

describe('Publisher — P1-T11 versioned manifest (R11.1)', () => {
  it('publishing a fixture produces a manifest whose versions match the emitted schemas', async () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'navi-pub-ver-'))
    try {
      const verifier = new RoundTripVerifier(
        { hash, hashFile },
        { serialize, deserialize: <T>(b: Uint8Array) => JSON.parse(new TextDecoder().decode(b)) as T },
      )
      const publisher = new Publisher(
        { serialize, deserialize: <T>(b: Uint8Array) => JSON.parse(new TextDecoder().decode(b)) as T },
        { hash, hashFile },
        new EnvironmentProbe(),
        verifier,
        new RenameCommitter(),
      )
      const opts = { campusId: 'campus-1', campusName: 'Test Campus', outputDir, publishedAt: '2026-07-17T00:00:00Z' }
      const result = await publisher.publish(makeArtifacts(), opts) as PublisherReport

      const manifest: NavigationPackageManifest = JSON.parse(readFileSync(join(result.path, 'manifest.json'), 'utf-8'))
      // Manifest requires BOTH version fields (R11.1)
      expect(manifest.schemaVersion).toBe('1.0.0')
      expect(manifest.formatVersion).toBe('0')
      // Each artifact is listed WITH its version
      for (const [, meta] of Object.entries(manifest.artifacts)) {
        expect(meta.schemaVersion).toBe('1.0.0')
        expect(meta.formatVersion).toBeDefined()
      }
    } finally {
      rmSync(outputDir, { recursive: true, force: true })
    }
  })
})
