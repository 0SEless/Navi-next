import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { CampusCompiler } from '@navi/compiler'
import { build } from '@navi/publisher'
import { load, RoutingEngine } from '@navi/runtime'
import type { CampusDocument } from '@navi/core'

// P1-T11 (R11.3): CI compatibility smoke â€” compile fixture â†’ generate bundle
// â†’ validate schema â†’ load through @navi/runtime â†’ smoke tests (graph loads,
// route computes). QR index smoke lands with P1-T13 (QR artifact).

function smokeCampus(): CampusDocument {
  return {
    schemaVersion: 1,
    version: 1,
    metadata: { campusId: 'smoke-univ', name: 'smoke-univ', description: 'Smoke campus', lastModified: '', editorVersion: '1.0' },
    buildings: [
      {
        id: 'bld-a',
        name: 'Building A',
        code: 'BLA',
        category: 'academic',
        description: '',
        footprint: { points: [{ lat: 14.0, lng: 121.0 }, { lat: 14.001, lng: 121.0 }, { lat: 14.001, lng: 121.001 }, { lat: 14.0, lng: 121.001 }] },
        baseElevation: 10,
        height: 20,
        floors: [
          {
            id: 'bld-a-f1',
            level: 1,
            label: 'First Floor',
            elevation: 0, height: 4,
            rooms: [
              { id: 'a101', name: 'Room 101', number: '101', category: 'classroom', polygon: { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] }, roomDoors: [], metadata: {} },
            ],
            hallways: [{ id: 'hw-a1', name: 'Main Hallway', polyline: { points: [{ x: 0, y: 5 }, { x: 25, y: 5 }] }, width: 3 }],
            staircases: [],
            elevators: [],
            entrances: [{ id: 'a-ent-1', label: 'Main Entrance', position: { x: 0, y: 5 } as never, level: 1, type: 'main', hasQR: false, hasPanorama: false }],
            connectorStops: [{ id: 'stop-a-stair-1', connectorId: 'conn-stair-a', label: 'Stair Landing', position: { x: 25, y: 5 }, rotation: 0, accessible: true, anchors: [], metadata: {} }],
            parametricComponents: [],
            metadata: {},
          },
          {
            id: 'bld-a-f2',
            level: 2,
            label: 'Second Floor',
            elevation: 4, height: 4,
            rooms: [
              { id: 'a201', name: 'Room 201', number: '201', category: 'office', polygon: { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] }, roomDoors: [], metadata: {} },
            ],
            hallways: [{ id: 'hw-a2', name: 'Upper Hallway', polyline: { points: [{ x: 0, y: 5 }, { x: 25, y: 5 }] }, width: 3 }],
            staircases: [],
            elevators: [],
            entrances: [],
            connectorStops: [{ id: 'stop-a-stair-2', connectorId: 'conn-stair-a', label: 'Stair Landing', position: { x: 25, y: 5 }, rotation: 0, accessible: true, anchors: [], metadata: {} }],
            parametricComponents: [],
            metadata: {},
          },
        ],
        verticalConnectors: [{ id: 'conn-stair-a', type: 'staircase', name: 'Stairwell A', stopIds: ['stop-a-stair-1', 'stop-a-stair-2'], accessible: true, metadata: {} }],
        aliases: [],
        color: '#ff0000',
        metadata: {},
      },
    ],
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
  }
}

function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

describe('P1-T11: artifact compatibility smoke (R11.3)', () => {
  it('compiles â†’ bundles â†’ loads via @navi/runtime â†’ graph loads and a route computes end-to-end', async () => {
    // 1. Compile fixture
    const compiler = new CampusCompiler({ nodeInterval: 10, mergeThreshold: 0.5 } as never)
    const result = compiler.compileV2(smokeCampus())
    expect(result.success).toBe(true)
    expect(result.artifacts).toBeDefined()

    // 2. Generate bundle
    const pkg = build(result.artifacts!, {
      campusId: 'smoke-univ',
      campusName: 'smoke-univ',
      outputDir: '',
      publishedAt: '2026-07-17T00:00:00Z',
      schemaVersions: { graph: '1.0.0', search: '1.0.0', spatial: '1.0.0', building: '1.0.0', poi: '1.0.0', panorama: '1.0.0', floorGeometry: '1.0.0' },
    })
    expect(pkg.graph.nodes.length).toBeGreaterThan(0)

    // 3. Write bundle to disk (files + manifest)
    const dir = mkdtempSync(join(tmpdir(), 'navi-smoke-'))
    try {
      mkdirSync(join(dir, 'smoke-univ'), { recursive: true })
      const base = join(dir, 'smoke-univ')
      const files: Array<[string, unknown]> = [
        ['graph.json', pkg.graph],
        ['search.json', pkg.search],
        ['spatial.json', pkg.spatial],
        ['building.json', pkg.building],
        ['poi.json', pkg.poi],
        ['panorama.json', pkg.panorama],
        ['floor-geometry.json', pkg.floorGeometry],
      ]
      const artifactMeta: Record<string, { path: string; checksum: string; size: number; schemaVersion: string; formatVersion: string }> = {}
      for (const [name, data] of files) {
        if (data === undefined) continue
        const bytes = Buffer.from(JSON.stringify(data), 'utf-8')
        writeFileSync(join(base, name), bytes)
        const artifactName = name.replace('.json', '') === 'floor-geometry' ? 'floorGeometry' : name.replace('.json', '')
        artifactMeta[artifactName] = { path: name, checksum: sha256Hex(bytes), size: bytes.length, schemaVersion: '1.0.0', formatVersion: '0' }
      }
      writeFileSync(join(base, 'manifest.json'), JSON.stringify({
        schemaVersion: '1.0.0',
        formatVersion: '0',
        campusId: pkg.campusId,
        campusName: pkg.campusName,
        publishedAt: pkg.publishedAt,
        compilerVersion: pkg.compilerVersion,
        revision: pkg.revision,
        artifacts: artifactMeta,
        metadata: pkg.metadata,
      }))

      // 4. Load through @navi/runtime
      const loaded = await load(join(dir, 'smoke-univ'))
      expect(loaded.success).toBe(true)
      if (!loaded.success) return

      // Smoke: graph loads
      expect(loaded.package.graph.nodes.length).toBeGreaterThan(0)
      expect(loaded.package.graph.edges.length).toBeGreaterThan(0)

      // Smoke: route computes end-to-end between two reachable nodes
      const engine = new RoutingEngine(loaded.package.graph)
      const candidates = loaded.package.graph.nodes
      let routed = false
      for (let i = 0; i < candidates.length && !routed; i++) {
        for (let j = i + 1; j < candidates.length; j++) {
          const route = engine.findRoute(candidates[i].id, candidates[j].id)
          if (route) {
            expect(route.path.length).toBeGreaterThan(0)
            routed = true
            break
          }
        }
      }
      expect(routed).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})