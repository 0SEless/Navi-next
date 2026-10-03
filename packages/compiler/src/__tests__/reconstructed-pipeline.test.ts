import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { CampusCompiler } from '../pipeline/campus-compiler'
import type { CampusDocument, NavigationArtifacts } from '@navi/core'
import type { CompileResultV2 } from '../types'
import { Publisher } from '../../../publisher/src/publisher'
import { serialize } from '../../../publisher/src/serializer'
import { hash, hashFile } from '../../../publisher/src/checksum'
import { EnvironmentProbe } from '../../../publisher/src/environment'
import { RoundTripVerifier } from '../../../publisher/src/round-trip-verifier'
import { RenameCommitter } from '../../../publisher/src/committer'
import type { NavigationPackageManifest, NavigationGraphFile, FloorGeometryFile, QrIndexFile } from '@navi/core'

// ── Load fixture ──
function loadFixture(): CampusDocument {
  const raw = readFileSync(
    join(__dirname, 'fixtures', 'reconstructed-floor.json'),
    'utf-8',
  )
  return JSON.parse(raw) as CampusDocument
}

// ── Compile helper ──
function compileFixture(doc: CampusDocument): CompileResultV2 {
  const compiler = new CampusCompiler({
    nodeInterval: 10,
    mergeThreshold: 2,
    optimizationLevel: 'moderate',
    includeAccessibility: true,
  })
  return compiler.compileV2(doc)
}

// ── Publisher helper ──
function makePublisher() {
  return new Publisher(
    { serialize, deserialize: <T>(b: Uint8Array) => JSON.parse(new TextDecoder().decode(b)) as T },
    { hash, hashFile },
    new EnvironmentProbe(),
    new RoundTripVerifier(
      { hash, hashFile },
      { serialize, deserialize: <T>(b: Uint8Array) => JSON.parse(new TextDecoder().decode(b)) as T },
    ),
    new RenameCommitter(),
  )
}

describe('Reconstructed pipeline: compiler → publisher', () => {
  let result: CompileResultV2
  let doc: CampusDocument

  beforeEach(() => {
    doc = loadFixture()
    result = compileFixture(doc)
  })

  // ─────────────────────────────────────────────
  // Part 1: Compiler output verification
  // ─────────────────────────────────────────────

  describe('compiler output', () => {
    it('compiles successfully', () => {
      expect(result.success).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('produces a NavigationGraph with nodes and edges', () => {
      expect(result.graph).not.toBeNull()
      expect(result.graph!.nodes.length).toBeGreaterThan(0)
      expect(result.graph!.edges.length).toBeGreaterThan(0)
    })

    it('preserves building IDs through compilation', () => {
      const buildingIds = new Set(result.graph!.nodes.map(n => n.buildingId))
      expect(buildingIds.has('bld-main')).toBe(true)
    })

    it('produces nodes for both floors', () => {
      const floors = new Set(result.graph!.nodes.map(n => `${n.buildingId}:${n.floor}`))
      expect(floors.has('bld-main:1')).toBe(true)
      expect(floors.has('bld-main:2')).toBe(true)
    })

    it('emits NavigationArtifacts with all required fields', () => {
      expect(result.artifacts).toBeDefined()
      const arts = result.artifacts!
      expect(arts.graph).toBeDefined()
      expect(arts.searchIndex).toBeDefined()
      expect(arts.spatialIndex).toBeDefined()
      expect(arts.buildingIndex).toBeDefined()
      expect(arts.poiIndex).toBeDefined()
      expect(arts.extensions).toBeDefined()
    })

    it('emits floorGeometry artifact', () => {
      const fg = result.artifacts!.floorGeometry
      expect(fg).toBeDefined()
      expect(fg!.schemaVersion).toBe(1)
      expect(fg!.campusId).toBe('test-campus')
      expect(fg!.buildings.length).toBe(1)
    })

    it('floorGeometry contains rooms on both floors', () => {
      const fg = result.artifacts!.floorGeometry!
      const bld = fg.buildings[0]
      expect(bld.floors.length).toBe(2)

      const f1 = bld.floors.find(f => f.level === 1)!
      const f2 = bld.floors.find(f => f.level === 2)!

      expect(f1.rooms.length).toBe(2) // room-101, room-102
      expect(f2.rooms.length).toBe(1) // room-201
    })

    it('floorGeometry contains doors', () => {
      const fg = result.artifacts!.floorGeometry!
      const f1 = fg.buildings[0].floors.find(f => f.level === 1)!
      expect(f1.doors.length).toBeGreaterThanOrEqual(1)
      const door = f1.doors.find(d => d.id === 'd-101')
      expect(door).toBeDefined()
      expect(door!.roomId).toBe('room-101')
      expect(door!.doorType).toBe('standard')
    })

    it('floorGeometry contains staircases', () => {
      const fg = result.artifacts!.floorGeometry!
      const f1 = fg.buildings[0].floors.find(f => f.level === 1)!
      const f2 = fg.buildings[0].floors.find(f => f.level === 2)!
      expect(f1.staircases.length).toBeGreaterThanOrEqual(1)
      expect(f2.staircases.length).toBeGreaterThanOrEqual(1)
      expect(f1.staircases[0]!.id).toBe('stair-1')
      expect(f2.staircases[0]!.id).toBe('stair-1')
    })

    it('floorGeometry preserves room IDs', () => {
      const fg = result.artifacts!.floorGeometry!
      const f1 = fg.buildings[0].floors.find(f => f.level === 1)!
      const ids = f1.rooms.map(r => r.id)
      expect(ids).toContain('room-101')
      expect(ids).toContain('room-102')
    })

    it('emits qrIndex artifact', () => {
      const qr = result.artifacts!.qrIndex
      expect(qr).toBeDefined()
      expect(qr!.schemaVersion).toBe(1)
      expect(qr!.campusId).toBe('test-campus')
    })

    it('buildingIndex includes the building with floors', () => {
      const bi = result.artifacts!.buildingIndex
      const bld = bi.buildings.find(b => b.id === 'bld-main')
      expect(bld).toBeDefined()
      expect(bld!.name).toBe('Main Building')
      expect(bld!.floors.length).toBe(2)
    })

    it('searchIndex includes room entries', () => {
      const si = result.artifacts!.searchIndex
      const roomEntries = si.entries.filter(e => e.type === 'room')
      expect(roomEntries.length).toBeGreaterThanOrEqual(2)
    })

    it('stats report is consistent with graph', () => {
      expect(result.stats.totalNodes).toBe(result.graph!.nodes.length)
      expect(result.stats.totalEdges).toBe(result.graph!.edges.length)
      expect(result.stats.buildingsProcessed).toBeGreaterThanOrEqual(1)
      expect(result.stats.floorsProcessed).toBeGreaterThanOrEqual(2)
    })
  })

  // ─────────────────────────────────────────────
  // Part 2: Publisher output verification
  // ─────────────────────────────────────────────

  describe('publisher output', () => {
    let outputDir: string
    let publisher: ReturnType<typeof makePublisher>

    beforeEach(() => {
      outputDir = mkdtempSync(join(tmpdir(), 'navi-pipeline-test-'))
      publisher = makePublisher()
    })

    afterEach(() => {
      if (existsSync(outputDir)) rmSync(outputDir, { recursive: true, force: true })
    })

    it('publishes successfully', async () => {
      const pubResult = await publisher.publish(result.artifacts!, {
        campusId: 'test-campus',
        campusName: 'Test Campus',
        outputDir,
        publishedAt: '2026-08-22T00:00:00Z',
      })
      expect(pubResult.success).toBe(true)
    })

    it('writes manifest.json in NavigationPackageManifest format', async () => {
      const pubResult = await publisher.publish(result.artifacts!, {
        campusId: 'test-campus',
        campusName: 'Test Campus',
        outputDir,
        publishedAt: '2026-08-22T00:00:00Z',
      })
      expect(pubResult.success).toBe(true)
      if (!pubResult.success) return

      const manifestPath = join(pubResult.path, 'manifest.json')
      expect(existsSync(manifestPath)).toBe(true)

      const manifest: NavigationPackageManifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
      expect(manifest.schemaVersion).toBe('1.0.0')
      expect(manifest.formatVersion).toBe('0')
      expect(manifest.campusId).toBe('test-campus')
      expect(manifest.campusName).toBe('Test Campus')
      expect(manifest.artifacts).toBeDefined()
      expect(typeof manifest.metadata).toBe('object')
      expect(manifest.metadata.nodeCount).toBeGreaterThan(0)
      expect(manifest.metadata.buildingCount).toBeGreaterThanOrEqual(1)
      expect(manifest.metadata.floorCount).toBeGreaterThanOrEqual(2)
    })

    it('writes all expected artifact files', async () => {
      const pubResult = await publisher.publish(result.artifacts!, {
        campusId: 'test-campus',
        campusName: 'Test Campus',
        outputDir,
        publishedAt: '2026-08-22T00:00:00Z',
      })
      expect(pubResult.success).toBe(true)
      if (!pubResult.success) return

      const finalDir = pubResult.path
      expect(existsSync(join(finalDir, 'graph.json'))).toBe(true)
      expect(existsSync(join(finalDir, 'search.json'))).toBe(true)
      expect(existsSync(join(finalDir, 'building.json'))).toBe(true)
      expect(existsSync(join(finalDir, 'manifest.json'))).toBe(true)
      expect(existsSync(join(finalDir, 'poi.json'))).toBe(true)
      expect(existsSync(join(finalDir, 'spatial.json'))).toBe(true)
      // floor-geometry.json and qr-index.json are optional — emitted when present
      if (result.artifacts!.floorGeometry) {
        expect(existsSync(join(finalDir, 'floor-geometry.json'))).toBe(true)
      }
      if (result.artifacts!.qrIndex) {
        expect(existsSync(join(finalDir, 'qr-index.json'))).toBe(true)
      }
    })

    it('floor-geometry.json contains expected data', async () => {
      const pubResult = await publisher.publish(result.artifacts!, {
        campusId: 'test-campus',
        campusName: 'Test Campus',
        outputDir,
        publishedAt: '2026-08-22T00:00:00Z',
      })
      expect(pubResult.success).toBe(true)
      if (!pubResult.success) return

      const fgPath = join(pubResult.path, 'floor-geometry.json')
      if (!existsSync(fgPath)) return // floor geometry not present

      const fg: FloorGeometryFile = JSON.parse(readFileSync(fgPath, 'utf-8'))
      expect(fg.schemaVersion).toBe('1.0.0')
      expect(fg.campusId).toBe('test-campus')
      expect(fg.buildings.length).toBe(1)

      const bld = fg.buildings[0]
      expect(bld.id).toBe('bld-main')
      expect(bld.name).toBe('Main Building')
      expect(bld.anchor).toBeDefined()
      expect(bld.anchor.origin.lat).toBeCloseTo(14.0, 3)
      expect(bld.floors.length).toBe(2)

      // Floor 1 has rooms and doors
      const f1 = bld.floors.find(f => f.level === 1)!
      expect(f1.rooms.length).toBe(2)
      expect(f1.doors.length).toBeGreaterThanOrEqual(1)
      expect(f1.staircases.length).toBeGreaterThanOrEqual(1)

      // Floor 2 has rooms and staircases
      const f2 = bld.floors.find(f => f.level === 2)!
      expect(f2.rooms.length).toBe(1)
      expect(f2.staircases.length).toBeGreaterThanOrEqual(1)
    })

    it('qr-index.json contains expected data', async () => {
      const pubResult = await publisher.publish(result.artifacts!, {
        campusId: 'test-campus',
        campusName: 'Test Campus',
        outputDir,
        publishedAt: '2026-08-22T00:00:00Z',
      })
      expect(pubResult.success).toBe(true)
      if (!pubResult.success) return

      const qrPath = join(pubResult.path, 'qr-index.json')
      if (!existsSync(qrPath)) return // no QR checkpoints in fixture

      const qr: QrIndexFile = JSON.parse(readFileSync(qrPath, 'utf-8'))
      expect(qr.schemaVersion).toBe('1.0.0')
      expect(qr.campusId).toBe('test-campus')
      expect(Array.isArray(qr.checkpoints)).toBe(true)
    })

    it('no fields disappear between compiler and publisher', async () => {
      const arts = result.artifacts!
      const pubResult = await publisher.publish(arts, {
        campusId: 'test-campus',
        campusName: 'Test Campus',
        outputDir,
        publishedAt: '2026-08-22T00:00:00Z',
      })
      expect(pubResult.success).toBe(true)
      if (!pubResult.success) return

      const finalDir = pubResult.path

      // graph.json preserves node/edge counts
      const graphFile: NavigationGraphFile = JSON.parse(readFileSync(join(finalDir, 'graph.json'), 'utf-8'))
      expect(graphFile.nodes.length).toBe(arts.graph.nodes.length)
      expect(graphFile.edges.length).toBe(arts.graph.edges.length)
      expect(graphFile.campusId).toBe('test-campus')

      // search.json preserves entry count
      const searchFile = JSON.parse(readFileSync(join(finalDir, 'search.json'), 'utf-8'))
      expect(searchFile.entries.length).toBe(arts.searchIndex.entries.length)

      // building.json preserves building count
      const buildingFile = JSON.parse(readFileSync(join(finalDir, 'building.json'), 'utf-8'))
      expect(buildingFile.buildings.length).toBe(arts.buildingIndex.buildings.length)
    })

    it('graph.json preserves node IDs through the pipeline', async () => {
      const arts = result.artifacts!
      const compilerNodeIds = new Set(arts.graph.nodes.map(n => n.id))

      const pubResult = await publisher.publish(arts, {
        campusId: 'test-campus',
        campusName: 'Test Campus',
        outputDir,
        publishedAt: '2026-08-22T00:00:00Z',
      })
      expect(pubResult.success).toBe(true)
      if (!pubResult.success) return

      const graphFile: NavigationGraphFile = JSON.parse(readFileSync(join(pubResult.path, 'graph.json'), 'utf-8'))
      const publishedNodeIds = new Set(graphFile.nodes.map(n => n.id))

      for (const id of compilerNodeIds) {
        expect(publishedNodeIds.has(id)).toBe(true)
      }
    })
  })
})
