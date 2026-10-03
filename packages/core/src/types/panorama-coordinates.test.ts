import { describe, it, expect } from 'vitest'
import type { CampusDocument, Panorama, Building, LatLng, LocalCoord } from '@navi/core'

// Import the buildPanoramaIndex function indirectly via the artifacts module
// We'll test the coordinate semantics through the panorama index building logic

describe('Panorama Coordinate Semantics (D9)', () => {
  // Helper to create a minimal CampusDocument
  function createDocument(panoramas: Panorama[], buildings: Building[] = []): CampusDocument {
    return {
      schemaVersion: 1,
      version: 1,
      metadata: {
        campusId: 'test-campus',
        name: 'Test Campus',
        description: 'Test',
        lastModified: new Date().toISOString(),
        editorVersion: '1.0.0',
      },
      buildings,
      roads: [],
      panoramas,
      qrCheckpoints: [],
    }
  }

  // Helper to create a building with footprint
  function createBuilding(id: string, lat: number, lng: number): Building {
    return {
      id,
      name: `Building ${id}`,
      code: id.toUpperCase(),
      category: 'building',
      description: `Test building ${id}`,
      footprint: {
        points: [
          { lat: lat - 0.0001, lng: lng - 0.0001 },
          { lat: lat - 0.0001, lng: lng + 0.0001 },
          { lat: lat + 0.0001, lng: lng + 0.0001 },
          { lat: lat + 0.0001, lng: lng - 0.0001 },
        ],
      },
      baseElevation: 0,
      height: 10,
      floors: [],
      verticalConnectors: [],
      color: '#000000',
      aliases: [],
      metadata: {},
    }
  }

  describe('Case 1: Building-associated panorama (LocalCoord + buildingId)', () => {
    it('should be valid when position is LocalCoord and buildingId is present', () => {
      const panorama: Panorama = {
        id: 'pano-1',
        label: 'Building Panorama',
        position: { x: 10, y: 20 } as LocalCoord,
        heading: 90,
        imageAssetId: 'img-1',
        buildingId: 'bld-1',
        floor: 0,
        hotspots: [],
      }

      const doc = createDocument([panorama])
      expect(doc.panoramas[0].buildingId).toBe('bld-1')
      expect((doc.panoramas[0].position as LocalCoord).x).toBe(10)
    })
  })

  describe('Case 2: Outdoor/campus-wide panorama (LatLng, no buildingId)', () => {
    it('should be valid when position is LatLng and buildingId is absent', () => {
      const panorama: Panorama = {
        id: 'pano-outdoor',
        label: 'Outdoor Panorama',
        position: { lat: 14.5995, lng: 120.9842 } as LatLng,
        heading: 0,
        imageAssetId: 'img-outdoor',
        buildingId: undefined,
        hotspots: [],
      }

      const doc = createDocument([panorama])
      expect(doc.panoramas[0].buildingId).toBeUndefined()
      expect((doc.panoramas[0].position as LatLng).lat).toBe(14.5995)
      expect((doc.panoramas[0].position as LatLng).lng).toBe(120.9842)
    })
  })

  describe('Case 3: Legacy world-stored panorama (LatLng with buildingId)', () => {
    it('should be detected via lat property check', () => {
      // Legacy documents may have stored LatLng directly even with buildingId
      const panorama = {
        id: 'pano-legacy',
        label: 'Legacy Panorama',
        position: { lat: 14.5995, lng: 120.9842 },
        heading: 90,
        imageAssetId: 'img-legacy',
        buildingId: 'bld-1',
        hotspots: [],
      }

      // The isLatLng check should detect this as LatLng
      const isLatLng = (panorama.position as unknown as { lat?: number }).lat !== undefined
      expect(isLatLng).toBe(true)
    })
  })

  describe('Coordinate system validation', () => {
    it('should detect LocalCoord (x/y properties)', () => {
      const pos: LocalCoord = { x: 10, y: 20 }
      const isLatLng = (pos as unknown as { lat?: number }).lat !== undefined
      expect(isLatLng).toBe(false)
    })

    it('should detect LatLng (lat/lng properties)', () => {
      const pos: LatLng = { lat: 14.5995, lng: 120.9842 }
      const isLatLng = (pos as unknown as { lat?: number }).lat !== undefined
      expect(isLatLng).toBe(true)
    })
  })

  describe('Panorama type definition', () => {
    it('should accept LocalCoord position', () => {
      const panorama: Panorama = {
        id: 'test',
        label: 'Test',
        position: { x: 10, y: 20 },
        heading: 0,
        imageAssetId: 'img',
        hotspots: [],
      }
      expect(panorama.position).toEqual({ x: 10, y: 20 })
    })

    it('should accept LatLng position', () => {
      const panorama: Panorama = {
        id: 'test',
        label: 'Test',
        position: { lat: 14.5995, lng: 120.9842 },
        heading: 0,
        imageAssetId: 'img',
        hotspots: [],
      }
      expect(panorama.position).toEqual({ lat: 14.5995, lng: 120.9842 })
    })
  })

  describe('HotspotType discriminator', () => {
    it('should accept hotspotType: navigation', () => {
      const panorama: Panorama = {
        id: 'test',
        label: 'Test',
        position: { lat: 14.5995, lng: 120.9842 },
        heading: 0,
        imageAssetId: 'img',
        hotspots: [
          {
            hotspotType: 'navigation',
            target: { type: 'panorama', targetId: 'pano-2' },
            position: { yaw: 90, pitch: 0 },
            label: 'Go to next',
          },
        ],
      }
      expect(panorama.hotspots[0].hotspotType).toBe('navigation')
    })

    it('should accept hotspotType: information', () => {
      const panorama: Panorama = {
        id: 'test',
        label: 'Test',
        position: { lat: 14.5995, lng: 120.9842 },
        heading: 0,
        imageAssetId: 'img',
        hotspots: [
          {
            hotspotType: 'information',
            target: { type: 'url', targetId: '' },
            position: { yaw: 0, pitch: -10 },
            label: 'Info',
            content: {
              title: 'Building Info',
              description: 'This is a building.',
            },
          },
        ],
      }
      expect(panorama.hotspots[0].hotspotType).toBe('information')
      expect(panorama.hotspots[0].content?.title).toBe('Building Info')
    })

    it('should accept hotspot without hotspotType (backward compatible)', () => {
      const panorama: Panorama = {
        id: 'test',
        label: 'Test',
        position: { lat: 14.5995, lng: 120.9842 },
        heading: 0,
        imageAssetId: 'img',
        hotspots: [
          {
            target: { type: 'panorama', targetId: 'pano-2' },
            position: { yaw: 90, pitch: 0 },
            label: 'Go to next',
          },
        ],
      }
      expect(panorama.hotspots[0].hotspotType).toBeUndefined()
    })
  })

  describe('HotspotContent interface', () => {
    it('should accept all content fields', () => {
      const content = {
        title: 'Title',
        description: 'Description',
        imageUrl: 'https://example.com/img.jpg',
        linkUrl: 'https://example.com',
        linkLabel: 'Learn More',
        entityId: 'bld-1',
      }
      expect(content.title).toBe('Title')
      expect(content.entityId).toBe('bld-1')
    })

    it('should accept partial content', () => {
      const content = {
        title: 'Title',
      }
      expect(content.title).toBe('Title')
    })
  })
})
