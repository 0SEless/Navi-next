import { describe, it, expect } from 'vitest'
import { PanoramaService } from '../panorama-service'
import type { LoadedPackage } from '../../loader'
import type { PanoramaIndex } from '@navi/core'

function makePackage(index?: PanoramaIndex): LoadedPackage {
  return {
    manifest: {
      schemaVersion: '1.0.0',
    formatVersion: '0',
      campusId: 'test-campus',
      campusName: 'Test',
      publishedAt: '',
      compilerVersion: '',
      revision: '',
      artifacts: {
        graph: { path: 'g.json', checksum: '', size: 0, schemaVersion: '1.0', formatVersion: '0' },
      },
      metadata: {
        nodeCount: 1, edgeCount: 0, buildingCount: 1, floorCount: 1,
        boundingBox: { minLat: 0, maxLat: 0, minLng: 0, maxLng: 0 }, routeable: false,
      },
    },
    graph: {
      version: '1.0.0', campusId: 'test-campus', createdAt: '', checksum: '',
      nodes: [], edges: [],
      metadata: { nodeCount: 0, edgeCount: 0, buildings: 0, floors: 0, boundingBox: { minLat: 0, maxLat: 0, minLng: 0, maxLng: 0 } },
    },
    panoramaIndex: index,
    reports: [], warnings: [],
  }
}

const sampleIndex: PanoramaIndex = {
  version: '1.0',
  panoramas: [
    {
      id: 'pano-a',
      title: 'Lobby',
      imageAssetId: 'img-a',
      buildingId: 'b1',
      floor: 0,
      position: { lat: 14.0, lng: 121.0 },
      heading: 90,
      hotspots: [
        { id: 'h1', type: 'navigation', target: 'pano-b', yaw: 45, pitch: -10, label: 'To B' },
        { id: 'h2', type: 'navigation', target: 'rm-101', yaw: 120, pitch: 0, label: 'Room 101' },
        { id: 'h3', type: 'link', target: 'https://example.com', yaw: 200, pitch: 5, label: 'Site' },
        { id: 'h4', type: 'information', target: 'info-1', yaw: 300, pitch: 10, label: 'Info' },
      ],
    },
    {
      id: 'pano-b',
      title: 'Hall',
      imageAssetId: 'img-b',
      buildingId: 'b1',
      floor: 1,
      position: { lat: 14.001, lng: 121.001 },
      hotspots: [],
    },
    {
      id: 'pano-c',
      title: 'Other Building',
      imageAssetId: 'img-c',
      buildingId: 'b2',
      floor: 0,
      position: { lat: 14.5, lng: 121.5 },
      hotspots: [],
    },
  ],
}

describe('PanoramaService (M6.5b)', () => {
  it('get returns a panorama result by id', () => {
    const svc = new PanoramaService(makePackage(sampleIndex))
    const p = svc.get('pano-a')
    expect(p).toBeDefined()
    expect(p!.id).toBe('pano-a')
    expect(p!.imageAssetId).toBe('img-a')
    expect(p!.buildingId).toBe('b1')
    expect(p!.floor).toBe(0)
    expect(p!.heading).toBe(90)
    expect(p!.position).toEqual({ lat: 14.0, lng: 121.0 })
  })

  it('get returns undefined for unknown id', () => {
    const svc = new PanoramaService(makePackage(sampleIndex))
    expect(svc.get('nope')).toBeUndefined()
  })

  it('list returns all panoramas', () => {
    const svc = new PanoramaService(makePackage(sampleIndex))
    expect(svc.list()).toHaveLength(3)
  })

  it('list filters by buildingId', () => {
    const svc = new PanoramaService(makePackage(sampleIndex))
    const b1 = svc.list('b1')
    expect(b1).toHaveLength(2)
    expect(b1.every(p => p.buildingId === 'b1')).toBe(true)
  })

  it('list returns empty for unknown building', () => {
    const svc = new PanoramaService(makePackage(sampleIndex))
    expect(svc.list('zzz')).toHaveLength(0)
  })

  it('findNearest returns the closest panorama', () => {
    const svc = new PanoramaService(makePackage(sampleIndex))
    const near = svc.findNearest({ lat: 14.0001, lng: 121.0001 })
    expect(near!.id).toBe('pano-a')
  })

  it('findNearest returns undefined for empty index', () => {
    const svc = new PanoramaService(makePackage(undefined))
    expect(svc.findNearest({ lat: 0, lng: 0 })).toBeUndefined()
  })

  it('getHotspots returns navigation targets resolved to panorama ids', () => {
    const svc = new PanoramaService(makePackage(sampleIndex))
    const hs = svc.getHotspots('pano-a')
    expect(hs).toHaveLength(4)
    const navPano = hs.find(h => h.id === 'h1')!
    expect(navPano.type).toBe('navigation')
    expect(navPano.targetPanoramaId).toBe('pano-b')
    expect(navPano.position).toEqual({ yaw: 45, pitch: -10 })
  })

  it('getHotspots resolves navigation target to room id when not a panorama', () => {
    const svc = new PanoramaService(makePackage(sampleIndex))
    const hs = svc.getHotspots('pano-a')
    const navRoom = hs.find(h => h.id === 'h2')!
    expect(navRoom.targetRoomId).toBe('rm-101')
    expect(navRoom.targetPanoramaId).toBeUndefined()
  })

  it('getHotspots resolves link target to url', () => {
    const svc = new PanoramaService(makePackage(sampleIndex))
    const hs = svc.getHotspots('pano-a')
    const link = hs.find(h => h.id === 'h3')!
    expect(link.type).toBe('link')
    expect(link.targetUrl).toBe('https://example.com')
  })

  it('getHotspots returns empty for unknown panorama', () => {
    const svc = new PanoramaService(makePackage(sampleIndex))
    expect(svc.getHotspots('nope')).toHaveLength(0)
  })

  it('resolve returns the panorama that navigates to a room', () => {
    const svc = new PanoramaService(makePackage(sampleIndex))
    const p = svc.resolve('rm-101')
    expect(p).toBeDefined()
    expect(p!.id).toBe('pano-a')
    expect(p!.roomId).toBe('rm-101')
  })

  it('resolve returns undefined for unknown room', () => {
    const svc = new PanoramaService(makePackage(sampleIndex))
    expect(svc.resolve('rm-999')).toBeUndefined()
  })

  it('gracefully handles a package with no panoramaIndex', () => {
    const svc = new PanoramaService(makePackage(undefined))
    expect(svc.get('pano-a')).toBeUndefined()
    expect(svc.list()).toHaveLength(0)
    expect(svc.list('b1')).toHaveLength(0)
    expect(svc.findNearest({ lat: 0, lng: 0 })).toBeUndefined()
    expect(svc.getHotspots('pano-a')).toHaveLength(0)
    expect(svc.resolve('rm-101')).toBeUndefined()
  })
})
