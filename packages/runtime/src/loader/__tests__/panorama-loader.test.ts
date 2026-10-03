import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { load } from '../loader'
import { toRuntimePanorama } from '../runtime-converter'
import type { PanoramaIndexFile } from '@navi/core'

function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

const panoramaFile: PanoramaIndexFile = {
  schemaVersion: '1.0.0',
  panoramas: [
    {
      id: 'pano-1',
      title: 'Lobby',
      imageAssetId: 'img-1',
      buildingId: 'b1',
      floor: 0,
      lat: 14.5,
      lng: 121.0,
      heading: 90,
      hotspots: [
        { id: 'h1', type: 'navigation', target: 'rm-1', yaw: 45, pitch: -10, label: 'Room 1' },
        { id: 'h2', type: 'link', target: 'https://x.com', yaw: 200, pitch: 0, label: 'Site' },
      ],
    },
  ],
}

const graphFile = {
  schemaVersion: '1.0.0',
  campusId: 'test-campus',
  checksum: 'g',
  nodes: [{ id: 'n1', label: 'N1', type: 'waypoint', lat: 14.5, lng: 121.0, floor: 0, buildingId: 'b1' }],
  edges: [],
}

describe('Panorama loader (M6.5a)', () => {
  let dir: string

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'navi-pano-'))
    mkdirSync(join(dir, 'test-campus'), { recursive: true })
    const base = join(dir, 'test-campus')

    const graphBytes = JSON.stringify(graphFile)
    const panoBytes = JSON.stringify(panoramaFile)

    const manifest = {
      schemaVersion: '1.0.0',
      campusId: 'test-campus',
      campusName: 'Test',
      publishedAt: '2026-07-17T00:00:00Z',
      compilerVersion: '0.1.0',
      revision: '1',
      artifacts: {
        graph: { path: 'graph.json', checksum: sha256Hex(graphBytes), size: graphBytes.length, schemaVersion: '1.0.0' },
        panorama: { path: 'panorama.json', checksum: sha256Hex(panoBytes), size: panoBytes.length, schemaVersion: '1.0.0' },
      },
      metadata: {
        nodeCount: 1, edgeCount: 0, buildingCount: 1, floorCount: 1,
        boundingBox: { minLat: 14.5, maxLat: 14.5, minLng: 121.0, maxLng: 121.0 },
        routeable: true,
      },
    }

    writeFileSync(join(base, 'manifest.json'), JSON.stringify(manifest))
    writeFileSync(join(base, 'graph.json'), graphBytes)
    writeFileSync(join(base, 'panorama.json'), panoBytes)
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('hydrates panoramaIndex from the package', async () => {
    const result = await load(join(dir, 'test-campus'))
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.package.panoramaIndex).toBeDefined()
    expect(result.package.panoramaIndex!.panoramas).toHaveLength(1)
    const p = result.package.panoramaIndex!.panoramas[0]
    expect(p.id).toBe('pano-1')
    expect(p.title).toBe('Lobby')
    expect(p.buildingId).toBe('b1')
    expect(p.floor).toBe(0)
    expect(p.position).toEqual({ lat: 14.5, lng: 121.0 })
    expect(p.hotspots).toHaveLength(2)
    expect(p.hotspots[0].type).toBe('navigation')
    expect(p.hotspots[1].type).toBe('link')
  })

  it('toRuntimePanorama maps files to runtime types', () => {
    const idx = toRuntimePanorama(panoramaFile)
    expect(idx.version).toBe('1.0.0')
    expect(idx.panoramas[0].title).toBe('Lobby')
    expect(idx.panoramas[0].hotspots[0].target).toBe('rm-1')
  })
})

describe('Panorama loader â€” graceful absence', () => {
  let dir: string

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'navi-pano2-'))
    mkdirSync(join(dir, 'test-campus'), { recursive: true })
    const base = join(dir, 'test-campus')
    const graphBytes = JSON.stringify(graphFile)
    const manifest = {
      schemaVersion: '1.0.0',
      campusId: 'test-campus',
      campusName: 'Test',
      publishedAt: '2026-07-17T00:00:00Z',
      compilerVersion: '0.1.0',
      revision: '1',
      artifacts: {
        graph: { path: 'graph.json', checksum: sha256Hex(graphBytes), size: graphBytes.length, schemaVersion: '1.0.0' },
      },
      metadata: {
        nodeCount: 1, edgeCount: 0, buildingCount: 1, floorCount: 1,
        boundingBox: { minLat: 14.5, maxLat: 14.5, minLng: 121.0, maxLng: 121.0 },
        routeable: true,
      },
    }
    writeFileSync(join(base, 'manifest.json'), JSON.stringify(manifest))
    writeFileSync(join(base, 'graph.json'), graphBytes)
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('loads package without panorama with panoramaIndex undefined', async () => {
    const result = await load(join(dir, 'test-campus'))
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.package.panoramaIndex).toBeUndefined()
  })
})
