// T3 (Phase 3): 360° panorama hotspot round trip.
//
// Authored input hotspots → buildPanoramaFile (via build()) → serialized
// panorama.json inside a real published package → runtime load() — every
// hotspot field must be preserved at each leg, and navigation vs
// information hotspots must stay distinguishable:
//   - base fields: id, type, target, yaw, pitch, label
//   - authored extensions: hotspotType and content (when supplied)
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { NavigationArtifacts } from '@navi/core'
import {
  Publisher,
  serialize,
  hash,
  hashFile,
  EnvironmentProbe,
  RoundTripVerifier,
  RenameCommitter,
  build,
  type PublishOptions,
  type HotspotFile,
} from '@navi/publisher'
import { load } from '@navi/runtime'

const CAMPUS_ID = 'pano-roundtrip-campus'

const NAV_HOTSPOT = {
  id: 'hs-nav',
  type: 'navigation' as const,
  target: 'pano-courtyard',
  yaw: 45.5,
  pitch: -10.25,
  label: 'To Courtyard',
  hotspotType: 'navigation' as const,
}

const INFO_HOTSPOT = {
  id: 'hs-info',
  type: 'information' as const,
  target: 'b1',
  yaw: 180,
  pitch: 5,
  label: 'About',
  hotspotType: 'information' as const,
  content: {
    title: 'About this building',
    description: 'Fixture hotspot',
    linkUrl: 'https://example.edu/about',
  },
}

function makeArtifacts(): NavigationArtifacts {
  return {
    graph: {
      version: '1.0.0',
      campusId: CAMPUS_ID,
      createdAt: '2026-09-25T00:00:00Z',
      checksum: 'abc123',
      nodes: [
        { id: 'n1', label: 'Node 1', type: 'waypoint', position: { lat: 14.5, lng: 121.0 }, floor: 0, buildingId: 'b1', properties: {} },
        { id: 'n2', label: 'Node 2', type: 'poi', position: { lat: 14.6, lng: 121.1 }, floor: 1, buildingId: 'b1', properties: {} },
      ],
      edges: [
        { id: 'e1', from: 'n1', to: 'n2', type: 'walk', distance: 100, weight: 100 },
      ],
      metadata: {
        nodeCount: 2,
        edgeCount: 1,
        buildings: 1,
        floors: 2,
        boundingBox: { minLat: 14.5, maxLat: 14.6, minLng: 121.0, maxLng: 121.1 },
      },
    },
    panoramaIndex: {
      version: '1.0.0',
      panoramas: [
        {
          id: 'pano-lobby',
          title: 'Lobby',
          imageAssetId: 'img-lobby',
          buildingId: 'b1',
          floor: 0,
          position: { lat: 14.5, lng: 121.0 },
          heading: 90,
          hotspots: [NAV_HOTSPOT, INFO_HOTSPOT],
        },
      ],
    },
    metadata: {
      compilerVersion: '1.0.0',
      revision: 'rev-1',
      compiledAt: '2026-09-25T00:00:00Z',
    },
    extensions: {},
  } as unknown as NavigationArtifacts
}

/** Field-by-field contract for one hotspot at any leg of the round trip. */
function expectHotspotContract(hotspot: HotspotFile): void {
  expect(hotspot.yaw).toBeTypeOf('number')
  expect(hotspot.pitch).toBeTypeOf('number')
}

describe('Panorama hotspot round trip: input → build → package file → load (T3)', () => {
  let outputDir: string
  let finalDir: string
  let opts: PublishOptions

  beforeAll(async () => {
    outputDir = mkdtempSync(join(tmpdir(), 'pano-rt-'))
    opts = {
      campusId: CAMPUS_ID,
      campusName: 'Panorama Roundtrip',
      outputDir,
      publishedAt: '2026-09-25T12:00:00Z',
    }

    const publisher = new Publisher(
      { serialize, deserialize: <T>(b: Uint8Array) => JSON.parse(new TextDecoder().decode(b)) as T },
      { hash, hashFile },
      new EnvironmentProbe(),
      new RoundTripVerifier(
        { hash, hashFile },
        { serialize, deserialize: <T>(b: Uint8Array) => JSON.parse(new TextDecoder().decode(b)) as T },
      ),
      new RenameCommitter(),
    )

    const result = await publisher.publish(makeArtifacts(), opts)
    expect(result.success).toBe(true)
    finalDir = join(outputDir, CAMPUS_ID)
    expect(existsSync(join(finalDir, 'panorama.json'))).toBe(true)
  }, 30_000)

  afterAll(() => {
    if (outputDir && existsSync(outputDir)) {
      rmSync(outputDir, { recursive: true, force: true })
    }
  })

  it('leg 1 — build() maps authored hotspots with every field intact', () => {
    const pkg = build(makeArtifacts(), opts)
    expect(pkg.panorama).toBeDefined()
    expect(pkg.schemaVersions.panorama).toBe('1.0.0')

    const hotspots = pkg.panorama!.panoramas[0]!.hotspots
    expect(hotspots).toHaveLength(2)

    const [nav, info] = hotspots as [HotspotFile, HotspotFile]

    // Navigation hotspot: base fields + hotspotType, no content.
    expect(nav.id).toBe('hs-nav')
    expect(nav.type).toBe('navigation')
    expect(nav.target).toBe('pano-courtyard')
    expect(nav.yaw).toBe(45.5)
    expect(nav.pitch).toBe(-10.25)
    expect(nav.label).toBe('To Courtyard')
    expect(nav.hotspotType).toBe('navigation')
    expect(nav.content).toBeUndefined()

    // Information hotspot: base fields + hotspotType + content.
    expect(info.id).toBe('hs-info')
    expect(info.type).toBe('information')
    expect(info.target).toBe('b1')
    expect(info.yaw).toBe(180)
    expect(info.pitch).toBe(5)
    expect(info.label).toBe('About')
    expect(info.hotspotType).toBe('information')
    expect(info.content).toEqual(INFO_HOTSPOT.content)

    // Nav vs info are distinguishable by type AND hotspotType.
    expect(nav.type).not.toBe(info.type)
    expectHotspotContract(nav)
    expectHotspotContract(info)
  })

  it('leg 2 — the serialized panorama.json in the published package preserves every field', () => {
    const file = JSON.parse(
      readFileSync(join(finalDir, 'panorama.json'), 'utf-8'),
    ) as { panoramas: Array<{ id: string; hotspots: HotspotFile[] }> }

    expect(file.panoramas).toHaveLength(1)
    expect(file.panoramas[0]!.id).toBe('pano-lobby')
    const hotspots = file.panoramas[0]!.hotspots
    expect(hotspots).toHaveLength(2)

    expect(hotspots[0]).toEqual({
      id: 'hs-nav',
      type: 'navigation',
      target: 'pano-courtyard',
      yaw: 45.5,
      pitch: -10.25,
      label: 'To Courtyard',
      hotspotType: 'navigation',
    })
    expect(hotspots[1]).toEqual({
      id: 'hs-info',
      type: 'information',
      target: 'b1',
      yaw: 180,
      pitch: 5,
      label: 'About',
      hotspotType: 'information',
      content: INFO_HOTSPOT.content,
    })

    // The manifest lists the panorama artifact under its published key.
    const manifest = JSON.parse(
      readFileSync(join(finalDir, 'manifest.json'), 'utf-8'),
    ) as { artifacts: Record<string, { path: string; checksum: string }> }
    expect(manifest.artifacts.panorama).toBeDefined()
    expect(manifest.artifacts.panorama!.path).toBe('panorama.json')
    expect(manifest.artifacts.panorama!.checksum).toBe(hash(readFileSync(join(finalDir, 'panorama.json'))))
  })

  it('leg 3 — runtime load() hydrates the package with hotspots unchanged', async () => {
    const result = await load(finalDir)
    expect(result.success).toBe(true)
    if (!result.success) return

    const panoramas = result.package.panoramaIndex?.panoramas
    expect(panoramas).toHaveLength(1)

    const pano = panoramas![0]!
    expect(pano.id).toBe('pano-lobby')
    expect(pano.title).toBe('Lobby')
    expect(pano.imageAssetId).toBe('img-lobby')
    expect(pano.buildingId).toBe('b1')
    expect(pano.floor).toBe(0)
    expect(pano.position).toEqual({ lat: 14.5, lng: 121.0 })
    expect(pano.heading).toBe(90)

    expect(pano.hotspots).toHaveLength(2)
    const [nav, info] = pano.hotspots

    // Navigation hotspot survives load() intact.
    expect(nav).toMatchObject({
      id: 'hs-nav',
      type: 'navigation',
      target: 'pano-courtyard',
      yaw: 45.5,
      pitch: -10.25,
      label: 'To Courtyard',
      hotspotType: 'navigation',
    })
    expect(nav.content).toBeUndefined()

    // Information hotspot keeps hotspotType + content after hydration.
    expect(info).toMatchObject({
      id: 'hs-info',
      type: 'information',
      target: 'b1',
      yaw: 180,
      pitch: 5,
      label: 'About',
      hotspotType: 'information',
      content: INFO_HOTSPOT.content,
    })

    // Distinguishing property holds end to end.
    expect(nav.type).not.toBe(info.type)
    expect(nav.hotspotType).not.toBe(info.hotspotType)

    // The panorama artifact itself loaded cleanly.
    const panoReport = result.package.reports.find(r => r.artifactType === 'panorama')
    expect(panoReport?.status).toBe('LOADED')
  })
})
