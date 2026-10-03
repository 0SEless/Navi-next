import { describe, it, expect } from 'vitest'
import { validatePanoramaCoordinates, validatePanoramas, isOutdoorPanorama, isBuildingPanorama, getCoordinateSystem, validateHotspot } from './panorama-validation'
import type { Panorama, CampusDocument } from '../types/entities'

describe('Panorama Coordinate Validation (D9 invariant)', () => {
  describe('validatePanoramaCoordinates', () => {
    it('should pass for building-associated panorama with LocalCoord', () => {
      const panorama: Panorama = {
        id: 'pano-1',
        label: 'Building Panorama',
        position: { x: 10, y: 20 },
        heading: 90,
        imageAssetId: 'img-1',
        buildingId: 'bld-1',
        hotspots: [],
      }
      const issues = validatePanoramaCoordinates(panorama)
      expect(issues).toHaveLength(0)
    })

    it('should pass for outdoor panorama with LatLng', () => {
      const panorama: Panorama = {
        id: 'pano-outdoor',
        label: 'Outdoor Panorama',
        position: { lat: 14.5995, lng: 120.9842 },
        heading: 0,
        imageAssetId: 'img-outdoor',
        hotspots: [],
      }
      const issues = validatePanoramaCoordinates(panorama)
      expect(issues).toHaveLength(0)
    })

    it('should warn for building-associated panorama with LatLng (legacy)', () => {
      const panorama: Panorama = {
        id: 'pano-legacy',
        label: 'Legacy Panorama',
        position: { lat: 14.5995, lng: 120.9842 },
        heading: 90,
        imageAssetId: 'img-legacy',
        buildingId: 'bld-1',
        hotspots: [],
      }
      const issues = validatePanoramaCoordinates(panorama)
      expect(issues).toHaveLength(1)
      expect(issues[0].severity).toBe('warning')
      expect(issues[0].code).toBe('PANORAMA_LEGACY_COORDINATES')
    })

    it('should error for outdoor panorama with LocalCoord', () => {
      const panorama: Panorama = {
        id: 'pano-bad',
        label: 'Bad Outdoor Panorama',
        position: { x: 10, y: 20 },
        heading: 0,
        imageAssetId: 'img-bad',
        hotspots: [],
      }
      const issues = validatePanoramaCoordinates(panorama)
      expect(issues).toHaveLength(1)
      expect(issues[0].severity).toBe('error')
      expect(issues[0].code).toBe('PANORAMA_OUTDOOR_REQUIRES_LATLNG')
    })
  })

  describe('validatePanoramas', () => {
    it('should validate all panoramas in a document', () => {
      const document: CampusDocument = {
        schemaVersion: 1,
        version: 1,
        metadata: {
          campusId: 'test',
          name: 'Test',
          description: 'Test',
          lastModified: new Date().toISOString(),
          editorVersion: '1.0.0',
        },
        buildings: [],
        roads: [],
        panoramas: [
          {
            id: 'pano-1',
            label: 'Good Building Panorama',
            position: { x: 10, y: 20 },
            heading: 90,
            imageAssetId: 'img-1',
            buildingId: 'bld-1',
            hotspots: [],
          },
          {
            id: 'pano-2',
            label: 'Bad Outdoor Panorama',
            position: { x: 10, y: 20 },
            heading: 0,
            imageAssetId: 'img-2',
            hotspots: [],
          },
        ],
        qrCheckpoints: [],
      }
      const issues = validatePanoramas(document)
      expect(issues).toHaveLength(1)
      expect(issues[0].panoramaId).toBe('pano-2')
      expect(issues[0].severity).toBe('error')
    })
  })

  describe('Helper functions', () => {
    it('isOutdoorPanorama returns true when no buildingId', () => {
      const panorama: Panorama = {
        id: 'test',
        label: 'Test',
        position: { lat: 14.5995, lng: 120.9842 },
        heading: 0,
        imageAssetId: 'img',
        hotspots: [],
      }
      expect(isOutdoorPanorama(panorama)).toBe(true)
    })

    it('isOutdoorPanorama returns false when buildingId present', () => {
      const panorama: Panorama = {
        id: 'test',
        label: 'Test',
        position: { x: 10, y: 20 },
        heading: 0,
        imageAssetId: 'img',
        buildingId: 'bld-1',
        hotspots: [],
      }
      expect(isOutdoorPanorama(panorama)).toBe(false)
    })

    it('isBuildingPanorama returns true when buildingId present', () => {
      const panorama: Panorama = {
        id: 'test',
        label: 'Test',
        position: { x: 10, y: 20 },
        heading: 0,
        imageAssetId: 'img',
        buildingId: 'bld-1',
        hotspots: [],
      }
      expect(isBuildingPanorama(panorama)).toBe(true)
    })

    it('getCoordinateSystem returns world for LatLng', () => {
      const panorama: Panorama = {
        id: 'test',
        label: 'Test',
        position: { lat: 14.5995, lng: 120.9842 },
        heading: 0,
        imageAssetId: 'img',
        hotspots: [],
      }
      expect(getCoordinateSystem(panorama)).toBe('world')
    })

    it('getCoordinateSystem returns local for LocalCoord', () => {
      const panorama: Panorama = {
        id: 'test',
        label: 'Test',
        position: { x: 10, y: 20 },
        heading: 0,
        imageAssetId: 'img',
        hotspots: [],
      }
      expect(getCoordinateSystem(panorama)).toBe('local')
    })
  })

  describe('Hotspot Validation', () => {
    const mockHotspot = {
      hotspotType: 'navigation' as const,
      target: { type: 'panorama' as const, targetId: 'pano-2' },
      position: { yaw: 90, pitch: 0 },
      label: 'Go to next',
    }

    it('should pass for valid navigation hotspot', () => {
      const issues = validateHotspot('pano-1', 0, mockHotspot, ['pano-1', 'pano-2'])
      expect(issues).toHaveLength(0)
    })

    it('should warn for navigation hotspot without target', () => {
      const hotspot = { ...mockHotspot, target: { type: 'panorama' as const, targetId: '' } }
      const issues = validateHotspot('pano-1', 0, hotspot, ['pano-1', 'pano-2'])
      expect(issues).toHaveLength(1)
      expect(issues[0].code).toBe('HOTSPOT_MISSING_TARGET')
      expect(issues[0].severity).toBe('warning')
    })

    it('should error for navigation hotspot with invalid target', () => {
      const hotspot = { ...mockHotspot, target: { type: 'panorama' as const, targetId: 'nonexistent' } }
      const issues = validateHotspot('pano-1', 0, hotspot, ['pano-1', 'pano-2'])
      expect(issues).toHaveLength(1)
      expect(issues[0].code).toBe('HOTSPOT_INVALID_TARGET')
      expect(issues[0].severity).toBe('error')
    })

    it('should warn for information hotspot without content', () => {
      const hotspot = { ...mockHotspot, hotspotType: 'information' as const, content: {} }
      const issues = validateHotspot('pano-1', 0, hotspot, ['pano-1', 'pano-2'])
      expect(issues).toHaveLength(1)
      expect(issues[0].code).toBe('HOTSPOT_EMPTY_CONTENT')
      expect(issues[0].severity).toBe('warning')
    })

    it('should error for invalid yaw', () => {
      const hotspot = { ...mockHotspot, position: { yaw: 400, pitch: 0 } }
      const issues = validateHotspot('pano-1', 0, hotspot, ['pano-1', 'pano-2'])
      expect(issues).toHaveLength(1)
      expect(issues[0].code).toBe('HOTSPOT_INVALID_YAW')
      expect(issues[0].severity).toBe('error')
    })

    it('should error for invalid pitch', () => {
      const hotspot = { ...mockHotspot, position: { yaw: 90, pitch: 100 } }
      const issues = validateHotspot('pano-1', 0, hotspot, ['pano-1', 'pano-2'])
      expect(issues).toHaveLength(1)
      expect(issues[0].code).toBe('HOTSPOT_INVALID_PITCH')
      expect(issues[0].severity).toBe('error')
    })
  })
})
